import time
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from app.models.historical_candle import HistoricalCandle
from app.models.instrument import Instrument
from app.services.smartapi_adapter import get_any_active_market_adapter

logger = logging.getLogger("historical_candle")

# Max calendar days per getCandleData request allowed by Angel One SmartAPI
CANDLE_MAX_DAYS_PER_CALL: Dict[str, int] = {
    "ONE_MINUTE": 30,
    "THREE_MINUTE": 60,
    "FIVE_MINUTE": 100,
    "TEN_MINUTE": 100,
    "FIFTEEN_MINUTE": 200,
    "THIRTY_MINUTE": 200,
    "ONE_HOUR": 400,
    "ONE_DAY": 2000,
}

# Supported range aliases to calendar days
CANDLE_RANGE_DAYS: Dict[str, int] = {
    "1D": 4,       # buffer for weekends & exchange holidays
    "5D": 7,
    "1W": 7,
    "1M": 31,
    "3M": 92,
    "6M": 183,
    "1Y": 366,
    "5Y": 1826,
    "MAX": 2500,
    "ALL": 2500
}

CANDLE_INTERVAL_ALIASES: Dict[str, str] = {
    "1M": "ONE_MINUTE", "1MIN": "ONE_MINUTE", "ONE_MINUTE": "ONE_MINUTE",
    "3M": "THREE_MINUTE", "3MIN": "THREE_MINUTE", "THREE_MINUTE": "THREE_MINUTE",
    "5M": "FIVE_MINUTE", "5MIN": "FIVE_MINUTE", "FIVE_MINUTE": "FIVE_MINUTE",
    "10M": "TEN_MINUTE", "10MIN": "TEN_MINUTE", "TEN_MINUTE": "TEN_MINUTE",
    "15M": "FIFTEEN_MINUTE", "15MIN": "FIFTEEN_MINUTE", "FIFTEEN_MINUTE": "FIFTEEN_MINUTE",
    "30M": "THIRTY_MINUTE", "30MIN": "THIRTY_MINUTE", "THIRTY_MINUTE": "THIRTY_MINUTE",
    "1H": "ONE_HOUR", "60M": "ONE_HOUR", "60MIN": "ONE_HOUR", "ONE_HOUR": "ONE_HOUR",
    "1D": "ONE_DAY", "D": "ONE_DAY", "DAY": "ONE_DAY", "DAILY": "ONE_DAY", "ONE_DAY": "ONE_DAY"
}


def normalize_interval(interval: Optional[str]) -> str:
    if not interval:
        return "ONE_DAY"
    upper = interval.strip().upper()
    return CANDLE_INTERVAL_ALIASES.get(upper, "ONE_DAY")


def parse_timestamp_to_epoch(ts: Any) -> int:
    """Converts ISO or SmartAPI string timestamp to epoch seconds."""
    if isinstance(ts, (int, float)):
        return int(ts) if ts < 1e11 else int(ts // 1000)
    s = str(ts).strip()
    try:
        # SmartAPI returns "2026-10-29T09:15:00+05:30" or "2026-10-29 09:15"
        if "T" in s:
            dt = datetime.fromisoformat(s)
            return int(dt.timestamp())
        elif " " in s:
            parts = s.split(" ")
            ymd = parts[0]
            hm = parts[1][:5]
            dt = datetime.strptime(f"{ymd} {hm}", "%Y-%m-%d %H:%M")
            # Assume IST (+5:30)
            return int(dt.timestamp()) - 19800
        else:
            dt = datetime.strptime(s, "%Y-%m-%d")
            return int(dt.timestamp()) - 19800
    except Exception:
        return int(time.time())


class HistoricalCandleService:
    """
    Authoritative Historical Candle Service for IPOPro.
    Fetches, chunks, caches, and merges genuine SmartAPI OHLCV data
    across NSE, BSE, NFO, BFO, and MCX segments.
    """

    normalize_interval = staticmethod(normalize_interval)

    @classmethod
    def resolve_instrument(
        cls,
        db: Session,
        symbol: str,
        exchange: Optional[str] = None
    ) -> Tuple[Optional[str], str, Optional[Instrument]]:
        sym = symbol.strip().upper()
        clean_sym = sym[:-3] if sym.endswith("-EQ") else sym
        query = db.query(Instrument).filter(
            (Instrument.tradingsymbol == sym) |
            (Instrument.tradingsymbol == clean_sym) |
            (Instrument.tradingsymbol == f"{clean_sym}-EQ") |
            (Instrument.symbol_token == sym)
        )
        if exchange:
            query = query.filter(Instrument.exchange == exchange.upper().strip())
        inst = query.first()
        res_exchange = (exchange or (inst.exchange if inst else "NSE")).upper().strip()
        res_token = inst.symbol_token if inst else sym
        return res_token, res_exchange, inst

    @classmethod
    def _chunk_date_range(cls, start_epoch: int, end_epoch: int, interval: str) -> List[Tuple[int, int]]:
        norm = normalize_interval(interval)
        max_days = CANDLE_MAX_DAYS_PER_CALL.get(norm, 2000)
        max_sec = max_days * 86400
        chunks = []
        curr_start = start_epoch
        while curr_start < end_epoch:
            curr_end = min(curr_start + max_sec, end_epoch)
            chunks.append((curr_start, curr_end))
            curr_start = curr_end
        return chunks

    @classmethod
    def _get_cached_candles(
        cls,
        db: Session,
        exchange: str,
        symbol_token: str,
        interval: str,
        from_epoch: int,
        to_epoch: int
    ) -> List[Dict[str, Any]]:
        norm = normalize_interval(interval)
        rows = db.query(HistoricalCandle).filter(
            HistoricalCandle.exchange == exchange,
            HistoricalCandle.symbol_token == symbol_token,
            HistoricalCandle.interval == norm,
            HistoricalCandle.epoch_time >= from_epoch,
            HistoricalCandle.epoch_time <= to_epoch
        ).order_by(HistoricalCandle.epoch_time.asc()).all()
        return [
            {
                "timestamp": r.timestamp,
                "open": r.open,
                "high": r.high,
                "low": r.low,
                "close": r.close,
                "volume": r.volume,
                "epoch": r.epoch_time
            }
            for r in rows
        ]

    @classmethod
    def get_candles(
        cls,
        db: Session,
        symbol: str,
        interval: str = "ONE_DAY",
        range_period: Optional[str] = "1M",
        exchange: Optional[str] = None,
        symbol_token: Optional[str] = None,
        from_date_str: Optional[str] = None,
        to_date_str: Optional[str] = None,
        before_timestamp: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Retrieves authentic candles for the requested instrument and interval.
        - Resolves exact exchange and symbol token.
        - Checks database cache first to avoid unnecessary broker API calls.
        - Queries SmartAPI getCandleData for missing historical windows.
        - Validates, deduplicates, and sorts candles chronologically.
        - Never fabricates or fills missing sessions with synthetic data.
        """
        sym = symbol.strip().upper()
        clean_sym = sym[:-3] if sym.endswith("-EQ") else sym

        # 1. Resolve Instrument Master metadata
        inst = None
        if symbol_token and symbol_token != "0":
            inst = db.query(Instrument).filter(Instrument.symbol_token == str(symbol_token).strip()).first()
        if not inst:
            inst = db.query(Instrument).filter(
                (Instrument.tradingsymbol == sym) |
                (Instrument.tradingsymbol == clean_sym) |
                (Instrument.tradingsymbol == f"{clean_sym}-EQ") |
                (Instrument.symbol_token == sym)
            ).first()

        resolved_exchange = (exchange or (inst.exchange if inst else "NSE")).upper().strip()
        resolved_token = str(symbol_token).strip() if (symbol_token and symbol_token != "0") else (inst.symbol_token if inst else sym)
        tradingsymbol = inst.tradingsymbol if inst else sym
        company_name = inst.name if inst else tradingsymbol

        norm_interval = normalize_interval(interval)
        now_utc = datetime.utcnow()
        now_ist = now_utc + timedelta(hours=5, minutes=30)

        # 2. Determine requested date range (IST)
        max_call_days = CANDLE_MAX_DAYS_PER_CALL.get(norm_interval, 2000)

        if from_date_str and to_date_str:
            req_from_ist = from_date_str.strip()
            req_to_ist = to_date_str.strip()
        elif before_timestamp:
            # Backfill pagination: fetch the previous window of candles before the given timestamp
            try:
                before_epoch = parse_timestamp_to_epoch(before_timestamp)
                target_dt = datetime.utcfromtimestamp(before_epoch) + timedelta(hours=5, minutes=30)
                window_days = min(30 if norm_interval in ("ONE_MINUTE", "THREE_MINUTE") else (max_call_days if norm_interval == "ONE_DAY" else 100), max_call_days)
                req_to_ist = target_dt.strftime("%Y-%m-%d %H:%M")
                req_from_ist = (target_dt - timedelta(days=window_days)).strftime("%Y-%m-%d 09:15")
            except Exception:
                req_to_ist = now_ist.strftime("%Y-%m-%d %H:%M")
                req_from_ist = (now_ist - timedelta(days=30)).strftime("%Y-%m-%d 09:15")
        else:
            range_key = (range_period or "1M").upper()
            total_days = CANDLE_RANGE_DAYS.get(range_key, 31)
            # Cap initial fetch to max allowed for short intervals to prevent broker rejection
            eff_days = min(total_days, max_call_days)
            req_to_ist = now_ist.strftime("%Y-%m-%d %H:%M")
            req_from_ist = (now_ist - timedelta(days=eff_days)).strftime("%Y-%m-%d 09:15")

        from_epoch = parse_timestamp_to_epoch(req_from_ist)
        to_epoch = parse_timestamp_to_epoch(req_to_ist)

        # 3. Check DB Cache
        cached_rows = db.query(HistoricalCandle).filter(
            HistoricalCandle.exchange == resolved_exchange,
            HistoricalCandle.symbol_token == resolved_token,
            HistoricalCandle.interval == norm_interval,
            HistoricalCandle.epoch_time >= from_epoch,
            HistoricalCandle.epoch_time <= to_epoch
        ).order_by(HistoricalCandle.epoch_time.asc()).all()

        cached_candles: List[Dict[str, Any]] = []
        for r in cached_rows:
            cached_candles.append({
                "timestamp": r.timestamp,
                "open": r.open,
                "high": r.high,
                "low": r.low,
                "close": r.close,
                "volume": r.volume,
                "epoch": r.epoch_time
            })

        # Check if cache covers this window (if we have a substantial number of candles and latest candle is recent)
        needs_broker_fetch = True
        if cached_candles:
            oldest_cached = cached_candles[0]["epoch"]
            newest_cached = cached_candles[-1]["epoch"]
            # If cached span covers the requested range within reasonable tolerance
            if oldest_cached <= from_epoch + 86400 and (to_epoch - newest_cached < 86400 or norm_interval == "ONE_DAY"):
                needs_broker_fetch = False

        fetched_candles: List[Dict[str, Any]] = []
        data_source = "CACHE_VERIFIED"
        error_message: Optional[str] = None

        # 4. Fetch missing history from SmartAPI getCandleData
        if needs_broker_fetch:
            adapter = get_any_active_market_adapter(db)
            if adapter and resolved_token and resolved_token != "0":
                try:
                    # SmartAPI expects from_date and to_date formatted as "yyyy-MM-dd HH:mm"
                    raw_candles = adapter.get_candle_data(
                        exchange=resolved_exchange,
                        symbol_token=resolved_token,
                        interval=norm_interval,
                        from_date=req_from_ist,
                        to_date=req_to_ist
                    )
                    if raw_candles:
                        fetched_candles = raw_candles
                        data_source = "SMARTAPI_HISTORICAL_API"
                        # Save closed candles into database cache
                        cls._save_candles_to_cache(db, resolved_exchange, resolved_token, tradingsymbol, norm_interval, raw_candles)
                    else:
                        data_source = "SMARTAPI_EMPTY"
                        error_message = "Historical data unavailable for this instrument or period."
                except Exception as e:
                    logger.error(f"Error fetching candles for {tradingsymbol} ({resolved_token}): {str(e)}")
                    data_source = "SMARTAPI_ERROR"
                    error_message = f"Broker historical API error: {str(e)}"
            else:
                data_source = "BROKER_SESSION_REQUIRED"
                error_message = "Historical data unavailable: No active SmartAPI demat connection available for chart feed"

        # 5. Merge and deduplicate (Cached + Fetched)
        all_bars_map: Dict[int, Dict[str, Any]] = {}
        for c in cached_candles:
            all_bars_map[c["epoch"]] = c

        for f in fetched_candles:
            epoch = parse_timestamp_to_epoch(f["timestamp"])
            f["epoch"] = epoch
            all_bars_map[epoch] = f

        # Sort strictly ascending by timestamp
        sorted_candles = [all_bars_map[k] for k in sorted(all_bars_map.keys())]

        # 6. Calculate reference metrics
        ltp = sorted_candles[-1]["close"] if sorted_candles else (inst.current_ltp if inst else None)
        prev_close = (
            sorted_candles[-2]["close"] if len(sorted_candles) > 1
            else (inst.previous_close if inst else (sorted_candles[0]["open"] if sorted_candles else None))
        )
        change = round(ltp - prev_close, 2) if (ltp is not None and prev_close is not None) else None
        change_pct = round((change / prev_close) * 100, 2) if (change is not None and prev_close and prev_close > 0) else None

        # Clean return structure (remove internal 'epoch' key from payload)
        clean_candles = []
        for c in sorted_candles:
            clean_candles.append({
                "timestamp": c["timestamp"],
                "open": c["open"],
                "high": c["high"],
                "low": c["low"],
                "close": c["close"],
                "volume": c["volume"]
            })

        return {
            "symbol": sym,
            "trading_symbol": tradingsymbol,
            "company_name": company_name,
            "exchange": resolved_exchange,
            "symbol_token": resolved_token,
            "current_ltp": ltp,
            "previous_close": prev_close,
            "change": change,
            "change_percent": change_pct,
            "candles_count": len(clean_candles),
            "candles": clean_candles,
            "interval": norm_interval,
            "range_period": range_period or "CUSTOM",
            "from_date": req_from_ist,
            "to_date": req_to_ist,
            "data_source": "UNAVAILABLE" if not clean_candles else data_source,
            "is_stale": len(clean_candles) == 0,
            "message": error_message or ("Historical data unavailable for this instrument or period." if not clean_candles else None),
            "has_more_history": len(clean_candles) > 0 and (from_epoch > 946684800)  # year 2000 cutoff
        }

    @classmethod
    def _save_candles_to_cache(
        cls,
        db: Session,
        exchange: str,
        symbol_token: str,
        tradingsymbol: str,
        interval: str,
        candles: List[Dict[str, Any]]
    ):
        """Idempotently saves verified closed candles into SQLite/MySQL cache."""
        try:
            if not candles:
                return
            # Don't save the very last candle if it's currently active/forming
            closed_candles = candles[:-1] if len(candles) > 1 else candles

            epochs = [parse_timestamp_to_epoch(c["timestamp"]) for c in closed_candles]
            existing = db.query(HistoricalCandle.epoch_time).filter(
                HistoricalCandle.exchange == exchange,
                HistoricalCandle.symbol_token == symbol_token,
                HistoricalCandle.interval == interval,
                HistoricalCandle.epoch_time.in_(epochs)
            ).all()
            existing_set = {r[0] for r in existing}

            new_objs = []
            for c in closed_candles:
                ep = parse_timestamp_to_epoch(c["timestamp"])
                if ep not in existing_set:
                    new_objs.append(HistoricalCandle(
                        exchange=exchange,
                        symbol_token=symbol_token,
                        tradingsymbol=tradingsymbol,
                        interval=interval,
                        timestamp=str(c["timestamp"]),
                        epoch_time=ep,
                        open=float(c["open"]),
                        high=float(c["high"]),
                        low=float(c["low"]),
                        close=float(c["close"]),
                        volume=int(c.get("volume") or 0),
                        is_complete=True,
                        data_source="SMARTAPI_HISTORICAL_API"
                    ))
                    existing_set.add(ep)

            if new_objs:
                db.bulk_save_objects(new_objs)
                db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"Failed to cache historical candles: {str(e)}")
