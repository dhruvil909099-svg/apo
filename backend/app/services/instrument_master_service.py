"""
Official Angel One OpenAPI Scrip Master Ingestion & Catalog Service
Downloads, normalizes, and maintains the authoritative instrument master from:
https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json

Provides:
- Complete A-Z indexed instrument discovery across NSE, BSE, NFO, BFO, and MCX.
- Real option chain matrices pairing Call (CE) and Put (PE) contracts across strikes.
- Verified MCX commodity contract specifications and trading hours.
- Zero hardcoded stock prices or artificial volume/LTP fallbacks.
"""

import logging
import json
import urllib.request
from typing import List, Dict, Any, Optional
from datetime import datetime, date
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_, func

from app.models.instrument import Instrument

logger = logging.getLogger("instrument_master")

OPENAPI_SCRIP_MASTER_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"
OPENAPI_SCRIP_MASTER_FALLBACK_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json"


def normalize_instrument_record(
    raw_item: Dict[str, Any],
    sync_time: datetime,
    company_names: Optional[Dict[str, str]] = None
) -> Optional[Dict[str, Any]]:
    """
    Normalizes a raw Angel One OpenAPI Scrip Master JSON item:
    - Normalizes exchange segments (NSE, BSE, NFO, BFO, MCX).
    - Normalizes derivative strikes from paise (division by 100.0).
    - Normalizes tick sizes from paise (division by 100.0).
    - Classifies Call (CE) and Put (PE) options.
    - Preserves lot sizes and underlying symbols.
    - Enriches company names from official exchange provider when available.
    - Leaves market prices (current_ltp, day_change) as None for true market separation.
    """
    token = raw_item.get("token")
    symbol = (raw_item.get("symbol") or "").strip()
    name = (raw_item.get("name") or "").strip()
    clean_sym = symbol.replace("-EQ", "").strip().upper()
    if company_names and clean_sym in company_names:
        name = company_names[clean_sym]
    exch_seg = (raw_item.get("exch_seg") or "").strip().upper()
    itype = (raw_item.get("instrumenttype") or "").strip().upper()

    if not token or not symbol or not exch_seg:
        return None

    # Exchange Segment Classification
    if exch_seg == "NSE":
        exchange = "NSE"
        segment = "INDEX" if itype == "AMXIDX" else "EQUITY"
        instrument_type = "INDEX" if itype == "AMXIDX" else ("EQUITY" if not itype else itype)
    elif exch_seg == "BSE":
        exchange = "BSE"
        segment = "INDEX" if itype == "AMXIDX" else "EQUITY"
        instrument_type = "INDEX" if itype == "AMXIDX" else ("EQUITY" if not itype else itype)
    elif exch_seg == "NFO":
        exchange = "NFO"
        segment = "OPTIONS" if "OPT" in itype else ("FUTURES" if "FUT" in itype else "DERIVATIVE")
        instrument_type = itype or ("OPTIONS" if segment == "OPTIONS" else "FUTURES")
    elif exch_seg == "BFO":
        exchange = "BFO"
        segment = "OPTIONS" if "OPT" in itype else ("FUTURES" if "FUT" in itype else "DERIVATIVE")
        instrument_type = itype or ("OPTIONS" if segment == "OPTIONS" else "FUTURES")
    elif exch_seg in ("MCX", "NCO", "NCDEX"):
        exchange = "MCX"
        segment = "COMMODITY"
        instrument_type = itype or "FUTCOM"
    else:
        exchange = exch_seg
        segment = "OTHER"
        instrument_type = itype or "OTHER"

    # Strike Price Normalization: Angel One scales strikes by 100 (in paise)
    raw_strike = float(raw_item.get("strike", 0.0) or 0.0)
    strike = round(raw_strike / 100.0, 2) if raw_strike > 0 else None

    # Tick Size Normalization: Angel One scales tick sizes by 100 (in paise)
    raw_tick = float(raw_item.get("tick_size", 0.0) or 0.0)
    tick_size = round(raw_tick / 100.0, 4) if raw_tick > 0 else 0.05

    # Lot size
    try:
        lot_size = int(raw_item.get("lotsize", 1) or 1)
        if lot_size <= 0:
            lot_size = 1
    except (ValueError, TypeError):
        lot_size = 1

    # Expiry
    expiry_str = (raw_item.get("expiry") or "").strip()

    # Option type detection
    option_type = None
    if segment == "OPTIONS" or "OPT" in instrument_type:
        if symbol.endswith("CE") or symbol.endswith("-CE"):
            option_type = "CE"
        elif symbol.endswith("PE") or symbol.endswith("-PE"):
            option_type = "PE"

    # Underlying Symbol extraction
    underlying = name if name else symbol.replace("-EQ", "").strip()

    return {
        "symbol_token": str(token),
        "instrument_token": f"{exchange}_{token}",
        "tradingsymbol": symbol,
        "name": name,
        "exchange": exchange,
        "segment": segment,
        "instrument_type": instrument_type,
        "underlying_symbol": underlying,
        "isin": None,
        "expiry": expiry_str if expiry_str else None,
        "strike": strike,
        "option_type": option_type,
        "lot_size": lot_size,
        "tick_size": tick_size,
        "current_ltp": None,
        "previous_close": None,
        "day_change": None,
        "day_change_percentage": None,
        "high_52week": None,
        "low_52week": None,
        "volume": 0,
        "open_interest": 0,
        "is_active": True,
        "trading_status": "ACTIVE",
        "data_source": "ANGEL_ONE_OPENAPI_MASTER",
        "last_sync_at": sync_time,
        "created_at": sync_time,
        "updated_at": sync_time,
    }


def fetch_and_sync_angel_scrip_master(
    db: Session,
    max_records: Optional[int] = None,
    custom_url: Optional[str] = None
) -> Dict[str, Any]:
    """
    Fetches the verified official Angel One Scrip Master JSON and synchronizes
    the MySQL/SQLite database in staged, high-performance batches.
    """
    target_urls = [custom_url] if custom_url else [OPENAPI_SCRIP_MASTER_URL, OPENAPI_SCRIP_MASTER_FALLBACK_URL]
    data = None
    successful_url = None

    import requests

    for url in target_urls:
        if not url:
            continue
        try:
            logger.info(f"Connecting to official Angel One Scrip Master at {url}...")
            resp = requests.get(
                url,
                headers={
                    "User-Agent": "IPOPro-SmartAPI-Master/1.0 (Enterprise Gateway)",
                    "Accept-Encoding": "gzip, deflate"
                },
                timeout=60
            )
            if resp.status_code == 200:
                data = resp.json()
                successful_url = url
                logger.info(f"Successfully retrieved and parsed Scrip Master JSON ({len(data)} items)")
                break
        except Exception as e:
            logger.warning(f"Failed to fetch from {url} via requests: {e}")
            try:
                # Fallback to urllib
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "IPOPro-SmartAPI-Master/1.0 (Enterprise Gateway)"}
                )
                with urllib.request.urlopen(req, timeout=60) as u_resp:
                    if u_resp.status == 200:
                        raw_bytes = u_resp.read().decode("utf-8")
                        data = json.loads(raw_bytes)
                        successful_url = url
                        break
            except Exception as u_err:
                logger.warning(f"Failed to fetch from {url} via urllib: {u_err}")

    if not data or not isinstance(data, list):
        raise RuntimeError("Unable to download official Angel One Scrip Master from verified endpoints.")

    total_downloaded = len(data)
    logger.info(f"Parsed {total_downloaded} instruments in memory. Normalizing records...")

    sync_time = datetime.utcnow()
    records_to_insert = []
    skipped_count = 0

    target_items = data if max_records is None else data[:max_records]

    # Fetch authoritative listed equity names directly from official exchange provider (NSE)
    company_name_map = {}
    try:
        import csv
        nse_req = urllib.request.Request(
            "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        )
        with urllib.request.urlopen(nse_req, timeout=10) as nse_resp:
            lines = nse_resp.read().decode("utf-8").splitlines()
            reader = csv.DictReader(lines)
            for row in reader:
                sym = (row.get("SYMBOL") or "").strip().upper()
                cname = (row.get("NAME OF COMPANY") or "").strip()
                if sym and cname:
                    company_name_map[sym] = cname
        logger.info(f"Loaded {len(company_name_map)} authoritative equity names from exchange provider.")
    except Exception as e:
        logger.warning(f"Could not fetch official NSE equity names (non-fatal): {e}")

    for item in target_items:
        norm = normalize_instrument_record(item, sync_time, company_name_map)
        if norm:
            records_to_insert.append(norm)
        else:
            skipped_count += 1

    logger.info(f"Prepared {len(records_to_insert)} normalized instruments (skipped {skipped_count} malformed).")

    # Clear existing catalog to maintain clean, staged catalog version
    logger.info("Synchronizing instruments table...")
    db.query(Instrument).delete()
    db.commit()

    # Batch insert in chunks of 5000 records
    chunk_size = 5000
    for i in range(0, len(records_to_insert), chunk_size):
        chunk = records_to_insert[i:i + chunk_size]
        db.bulk_insert_mappings(Instrument, chunk)
        db.commit()

    # Compile segment statistics from saved data
    counts_by_exchange = {}
    for exch in ["NSE", "BSE", "NFO", "BFO", "MCX"]:
        cnt = db.query(Instrument).filter(Instrument.exchange == exch).count()
        counts_by_exchange[exch] = cnt

    total_persisted = db.query(Instrument).count()
    logger.info(f"Catalog synchronization complete! Total persisted: {total_persisted}. Counts: {counts_by_exchange}")

    return {
        "status": "SUCCESS",
        "data_source_url": successful_url,
        "total_downloaded": total_downloaded,
        "total_persisted": total_persisted,
        "counts_by_exchange": counts_by_exchange,
        "sync_timestamp": sync_time.isoformat()
    }


def search_instruments(
    db: Session,
    query: Optional[str] = None,
    exchange: Optional[str] = None,
    segment: Optional[str] = None,
    instrument_type: Optional[str] = None,
    letter: Optional[str] = None,
    underlying: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
    enrich_quotes: bool = False
) -> Dict[str, Any]:
    """
    Fast server-side indexed search against the genuine Angel One instruments catalog.
    Supports A-Z browsing, prefix matching, exchange filters, and segment isolation.
    Decoupled from blocking quote enrichment for sub-100ms response times.
    """
    q = db.query(Instrument).filter(
        Instrument.is_active == True,
        ~Instrument.tradingsymbol.ilike("%TEST%")
    )

    if exchange:
        q = q.filter(Instrument.exchange == exchange.upper().strip())

    if segment:
        q = q.filter(Instrument.segment == segment.upper().strip())

    if instrument_type:
        q = q.filter(Instrument.instrument_type == instrument_type.upper().strip())

    if letter:
        clean_letter = letter.strip().upper()
        if clean_letter:
            q = q.filter(Instrument.tradingsymbol.startswith(clean_letter))

    if underlying:
        q = q.filter(Instrument.underlying_symbol.ilike(f"%{underlying.strip()}%"))

    clean_q = query.strip().upper() if query else None
    base_q = clean_q.replace("-EQ", "").strip() if clean_q else None

    if clean_q:
        or_clauses = [
            Instrument.tradingsymbol == clean_q,
            Instrument.tradingsymbol == f"{base_q}-EQ",
            Instrument.symbol_token == clean_q,
            Instrument.tradingsymbol.like(f"{clean_q}%"),
            Instrument.tradingsymbol.like(f"{base_q}%"),
            Instrument.underlying_symbol.like(f"{base_q}%"),
            Instrument.tradingsymbol.like(f"%{clean_q}%"),
            Instrument.name.ilike(f"%{clean_q}%")
        ]

        # Support common concatenated corporate names (e.g. TATAMOTORS -> TATA MOTORS, HDFCBANK -> HDFC BANK)
        for suffix in ("MOTORS", "BANK", "FINANCE", "HOLDINGS", "PHARMA", "INDUSTRIES", "STEEL", "POWER"):
            if clean_q.endswith(suffix) and len(clean_q) > len(suffix):
                spaced = clean_q[:-len(suffix)] + " " + suffix
                or_clauses.append(Instrument.name.ilike(f"%{spaced}%"))

        q = q.filter(or_(*or_clauses))

    from sqlalchemy import case

    segment_priority = case(
        (Instrument.segment == 'EQUITY', 1),
        (Instrument.segment == 'INDEX', 2),
        (Instrument.segment == 'COMMODITY', 3),
        (Instrument.segment == 'FUTURES', 4),
        (Instrument.segment == 'OPTIONS', 5),
        else_=6
    )

    if clean_q:
        exact_match = case(
            (Instrument.tradingsymbol == clean_q, 1),
            (Instrument.tradingsymbol == f"{base_q}-EQ", 1),
            (Instrument.symbol_token == clean_q, 1),
            else_=2
        )
        name_or_sym_prefix = case(
            (Instrument.tradingsymbol.like(f"{clean_q}%"), 1),
            (Instrument.tradingsymbol.like(f"{base_q}%"), 1),
            (Instrument.underlying_symbol.like(f"{base_q}%"), 1),
            else_=2
        )
        instruments = q.order_by(
            exact_match.asc(),
            segment_priority.asc(),
            name_or_sym_prefix.asc(),
            Instrument.tradingsymbol.asc()
        ).offset(offset).limit(limit).all()
    else:
        # Prioritize traded equity scrips starting with A-Z over numerical debentures
        alpha_first = case((Instrument.tradingsymbol >= 'A', 1), else_=2)
        instruments = q.order_by(
            segment_priority.asc(),
            alpha_first.asc(),
            Instrument.tradingsymbol.asc()
        ).offset(offset).limit(limit).all()

    # Fast count calculation: avoid expensive table count when result set fits on the first page
    if offset == 0 and len(instruments) < limit:
        total_count = len(instruments)
    else:
        total_count = q.count()

    from app.services.smartapi_websocket import smartapi_ws_service

    # Auto-enrich returned instruments with live quotes from SmartAPI only if explicitly requested
    quote_cache_map: Dict[str, Dict[str, Any]] = {}
    if enrich_quotes and instruments:
        from app.services.smartapi_adapter import get_any_active_market_adapter
        adapter = get_any_active_market_adapter(db)
        if adapter:
            exchange_tokens: Dict[str, List[str]] = {}
            for inst in instruments:
                if inst.symbol_token and inst.exchange:
                    exchange_tokens.setdefault(inst.exchange, []).append(str(inst.symbol_token).strip())
            if exchange_tokens:
                try:
                    batch_res = adapter.get_market_quotes_batch(exchange_tokens, mode="FULL")
                    if batch_res and batch_res.get("fetched"):
                        for q_item in batch_res["fetched"]:
                            tok = str(q_item.get("symbol_token") or "").strip()
                            if tok:
                                quote_cache_map[tok] = q_item
                except Exception as e:
                    logger.debug(f"Auto quote enrichment error: {e}")

    items = []
    has_db_updates = False
    for inst in instruments:
        clean = inst.tradingsymbol.replace("-EQ", "").strip().upper()
        live_tick = (
            smartapi_ws_service.get_latest_quote(clean) or 
            smartapi_ws_service.get_latest_quote(inst.tradingsymbol) or
            (smartapi_ws_service.get_latest_quote(inst.symbol_token) if inst.symbol_token else None)
        )
        q_batch = quote_cache_map.get(str(inst.symbol_token)) if inst.symbol_token else None

        ltp = (
            (live_tick["ltp"] if live_tick and live_tick.get("ltp") else None) or
            (q_batch["ltp"] if q_batch and q_batch.get("ltp") else None) or
            inst.current_ltp
        )
        p_close = (
            (live_tick["previous_close"] if live_tick and live_tick.get("previous_close") else None) or
            (q_batch["close"] if q_batch and q_batch.get("close") else None) or
            inst.previous_close
        )
        chg = (
            (live_tick.get("change") if live_tick else None) or
            (q_batch.get("net_change") if q_batch else None) or
            inst.day_change
        )
        chg_pct = (
            (live_tick.get("change_percent") if live_tick else None) or
            (q_batch.get("percent_change") if q_batch else None) or
            inst.day_change_percentage
        )

        if ltp and p_close and (chg is None or chg == 0):
            chg = round(ltp - p_close, 2)
            chg_pct = round((chg / p_close) * 100, 2) if p_close > 0 else 0.0

        if enrich_quotes and ltp and inst.current_ltp != ltp:
            inst.current_ltp = ltp
            if p_close:
                inst.previous_close = p_close
            if chg is not None:
                inst.day_change = chg
            if chg_pct is not None:
                inst.day_change_percentage = chg_pct
            has_db_updates = True

        items.append({
            "id": inst.id,
            "symbol_token": inst.symbol_token,
            "instrument_token": inst.instrument_token,
            "tradingsymbol": inst.tradingsymbol,
            "name": inst.name,
            "exchange": inst.exchange,
            "segment": inst.segment,
            "instrument_type": inst.instrument_type,
            "underlying_symbol": inst.underlying_symbol,
            "isin": inst.isin or "—",
            "expiry": inst.expiry,
            "strike": inst.strike,
            "option_type": inst.option_type,
            "lot_size": inst.lot_size,
            "tick_size": inst.tick_size,
            "current_ltp": ltp,
            "previous_close": p_close,
            "day_change": chg,
            "day_change_percentage": chg_pct,
            "volume": inst.volume,
            "open_interest": inst.open_interest,
            "trading_status": inst.trading_status,
            "last_sync_at": inst.last_sync_at.strftime("%Y-%m-%d %H:%M:%S IST") if inst.last_sync_at else None
        })

    if enrich_quotes and has_db_updates:
        try:
            db.commit()
        except Exception:
            db.rollback()

    return {
        "total_count": total_count,
        "limit": limit,
        "offset": offset,
        "has_more": (offset + limit) < total_count,
        "instruments": items
    }


def get_option_chain(
    db: Session,
    underlying: str = "NIFTY",
    expiry_date: Optional[str] = None
) -> Dict[str, Any]:
    """
    Builds a structured Options Chain matrix pairing Call (CE) and Put (PE) options
    across strike prices for the selected underlying instrument.
    """
    clean_underlying = underlying.replace("-EQ", "").strip().upper()

    expiries_query = db.query(Instrument.expiry).filter(
        Instrument.underlying_symbol == clean_underlying,
        Instrument.segment == "OPTIONS",
        Instrument.expiry != None,
        Instrument.is_active == True
    ).distinct().order_by(Instrument.expiry.asc()).all()

    available_expiries = [exp[0] for exp in expiries_query if exp[0]]
    selected_expiry = expiry_date if (expiry_date and expiry_date in available_expiries) else (available_expiries[0] if available_expiries else None)

    if not selected_expiry:
        return {
            "underlying": clean_underlying,
            "selected_expiry": None,
            "available_expiries": [],
            "strikes": []
        }

    options = db.query(Instrument).filter(
        Instrument.underlying_symbol == clean_underlying,
        Instrument.segment == "OPTIONS",
        Instrument.expiry == selected_expiry,
        Instrument.is_active == True
    ).all()

    grouped: Dict[float, Dict[str, Any]] = {}
    for opt in options:
        st = opt.strike
        if st is None:
            continue
        if st not in grouped:
            grouped[st] = {
                "strike": st,
                "call": None,
                "put": None
            }

        opt_data = {
            "symbol_token": opt.symbol_token,
            "tradingsymbol": opt.tradingsymbol,
            "exchange": opt.exchange,
            "lot_size": opt.lot_size,
            "tick_size": opt.tick_size,
            "current_ltp": opt.current_ltp,
            "previous_close": opt.previous_close,
            "day_change": opt.day_change,
            "day_change_percentage": opt.day_change_percentage,
            "open_interest": opt.open_interest,
            "volume": opt.volume
        }

        if opt.option_type == "CE":
            grouped[st]["call"] = opt_data
        elif opt.option_type == "PE":
            grouped[st]["put"] = opt_data

    sorted_strikes = [grouped[s] for s in sorted(grouped.keys())]

    return {
        "underlying": clean_underlying,
        "selected_expiry": selected_expiry,
        "available_expiries": available_expiries,
        "strikes_count": len(sorted_strikes),
        "strikes": sorted_strikes
    }


def get_commodity_contracts(db: Session) -> List[Dict[str, Any]]:
    """
    Returns active MCX Commodity contracts with contract specifications and trading status.
    """
    commodities = db.query(Instrument).filter(
        Instrument.exchange == "MCX",
        Instrument.is_active == True
    ).order_by(Instrument.tradingsymbol.asc()).all()

    results = []
    for c in commodities:
        results.append({
            "symbol_token": c.symbol_token,
            "tradingsymbol": c.tradingsymbol,
            "commodity_name": c.underlying_symbol or c.name,
            "contract_name": c.name,
            "exchange": "MCX",
            "segment": "COMMODITY",
            "expiry": c.expiry,
            "lot_size": c.lot_size,
            "tick_size": c.tick_size,
            "current_ltp": c.current_ltp,
            "previous_close": c.previous_close,
            "day_change": c.day_change,
            "day_change_percentage": c.day_change_percentage,
            "volume": c.volume,
            "open_interest": c.open_interest,
            "trading_hours": "09:00 - 23:30 IST",
            "status": c.trading_status
        })

    return results


def get_popular_instruments(db: Session) -> List[Dict[str, Any]]:
    """
    Returns liquid instruments for quick watchlist and search recommendations.
    """
    popular_patterns = [
        "NIFTY 50", "NIFTY BANK", "HINDCOPPER-EQ", "RELIANCE-EQ", "TCS-EQ",
        "INFY-EQ", "HDFCBANK-EQ", "SBIN-EQ", "GOLD", "CRUDEOIL"
    ]
    
    results = []
    for pat in popular_patterns:
        inst = db.query(Instrument).filter(
            or_(
                Instrument.tradingsymbol == pat,
                Instrument.name == pat,
                Instrument.tradingsymbol.like(f"{pat}%")
            ),
            Instrument.is_active == True
        ).first()
        if inst:
            results.append({
                "symbol_token": inst.symbol_token,
                "tradingsymbol": inst.tradingsymbol,
                "name": inst.name,
                "exchange": inst.exchange,
                "segment": inst.segment,
                "current_ltp": inst.current_ltp,
                "day_change": inst.day_change,
                "day_change_percentage": inst.day_change_percentage,
                "lot_size": inst.lot_size
            })

    return results


def get_catalog_summary(db: Session) -> Dict[str, Any]:
    """
    Returns official catalog counts by exchange segment and last sync timestamp.
    """
    total = db.query(Instrument).count()
    counts = {}
    for exch in ["NSE", "BSE", "NFO", "BFO", "MCX"]:
        counts[exch] = db.query(Instrument).filter(Instrument.exchange == exch).count()

    last_record = db.query(Instrument.last_sync_at).order_by(Instrument.last_sync_at.desc()).first()
    last_sync = last_record[0].strftime("%Y-%m-%d %H:%M:%S IST") if last_record and last_record[0] else None

    return {
        "total_instruments": total,
        "counts_by_exchange": counts,
        "last_sync_timestamp": last_sync,
        "data_source": "ANGEL_ONE_OPENAPI_SCRIP_MASTER"
    }


# Backward-compatibility alias
def initialize_baseline_catalog(db: Session) -> int:
    """Synchronizes catalog using the official Angel One OpenAPI source."""
    res = fetch_and_sync_angel_scrip_master(db)
    return res.get("total_persisted", 0)
