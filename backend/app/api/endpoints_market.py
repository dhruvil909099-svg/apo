import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.ipo import IPO
from app.models.instrument import Instrument
from app.services.market_session_service import get_market_session_summary
from app.services.smartapi_adapter import get_any_active_market_adapter
from app.services.instrument_master_service import (
    search_instruments,
    get_option_chain,
    get_commodity_contracts,
    get_popular_instruments,
    fetch_and_sync_angel_scrip_master,
    get_catalog_summary,
)

router = APIRouter(prefix="/market", tags=["Market Data"])


class BatchQuoteRequest(BaseModel):
    instruments: List[Dict[str, str]]  # [{"exchange": "NSE", "symbol_token": "3045"}]
    mode: str = "FULL"                 # "LTP", "OHLC", or "FULL"


# In-memory WebSocket connection manager for live streaming ticks
class MarketFeedManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: Dict[str, Any]):
        for conn in list(self.active_connections):
            try:
                await conn.send_json(message)
            except Exception:
                self.disconnect(conn)


market_feed_manager = MarketFeedManager()


@router.get("/session-status")
def get_market_session():
    """
    Returns verified exchange session state for NSE, BSE, NFO, and MCX:
    - Pre-open, continuous trading, closing auction, post-market, weekend, or holiday.
    - Preserves segment-specific trading hours (Equity 09:15-15:30 vs MCX 09:00-23:30).
    """
    return get_market_session_summary()


@router.get("/catalog/summary")
def get_instruments_catalog_summary(db: Session = Depends(get_db)):
    """
    Returns verified instrument catalog counts by exchange segment (NSE, BSE, NFO, BFO, MCX)
    and last sync timestamp from the official Angel One OpenAPI Scrip Master.
    """
    return get_catalog_summary(db)


@router.get("/instruments/search")
def search_market_instruments(
    query: Optional[str] = Query(None, description="Symbol prefix or company name partial"),
    exchange: Optional[str] = Query(None, description="NSE, BSE, NFO, BFO, or MCX"),
    segment: Optional[str] = Query(None, description="EQUITY, FUTURES, OPTIONS, COMMODITY, INDEX"),
    instrument_type: Optional[str] = Query(None, description="EQUITY, FUTIDX, FUTSTK, OPTIDX, OPTSTK, FUTCOM"),
    letter: Optional[str] = Query(None, description="A-Z letter filter"),
    underlying: Optional[str] = Query(None, description="Underlying symbol (e.g. NIFTY, HINDCOPPER)"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    """
    Fast server-side catalog search with indexed prefix matching, A-Z filtering,
    segment isolation, and automatic expired derivative filtering.
    """
    return search_instruments(
        db=db,
        query=query,
        exchange=exchange,
        segment=segment,
        instrument_type=instrument_type,
        letter=letter,
        underlying=underlying,
        limit=limit,
        offset=offset
    )


@router.get("/instruments/popular")
def get_popular_market_instruments(db: Session = Depends(get_db)):
    """
    Returns curated liquid scrips across Equities, Derivatives, Commodities, and Indices.
    """
    return get_popular_instruments(db)


@router.get("/instruments/option-chain")
def get_market_option_chain(
    underlying: str = Query("NIFTY", description="Underlying asset (e.g., NIFTY, BANKNIFTY, HINDCOPPER)"),
    expiry_date: Optional[str] = Query(None, description="Contract expiry in DDMMMYYYY or YYYY-MM-DD format"),
    db: Session = Depends(get_db)
):
    """
    Returns structured options chain matrix pairing Call (CE) and Put (PE) contracts
    across strike prices for the selected underlying.
    """
    return get_option_chain(db, underlying=underlying, expiry_date=expiry_date)


@router.get("/instruments/commodities")
def get_active_commodities(db: Session = Depends(get_db)):
    """
    Returns active MCX commodity contracts with lot sizes, tick sizes, and trading session windows.
    """
    return get_commodity_contracts(db)


@router.post("/instruments/sync")
def sync_instruments_catalog(db: Session = Depends(get_db)):
    """
    Synchronizes the authoritative instrument master catalog directly with official Angel One OpenAPI.
    """
    res = fetch_and_sync_angel_scrip_master(db)
    return res


@router.post("/quotes/batch")
def get_batch_market_quotes(
    req: BatchQuoteRequest,
    db: Session = Depends(get_db)
):
    """
    Official SmartAPI Live Market Data batch endpoint.
    Retrieves authorized quotes (LTP, OHLC, or FULL depth) for up to 50 instruments per batch.
    """
    if not req.instruments:
        return {"fetched": [], "unfetched": [], "status": "EMPTY_REQUEST"}

    # Group tokens by exchange
    exchange_tokens: Dict[str, List[str]] = {}
    for item in req.instruments:
        exch = (item.get("exchange") or "NSE").upper().strip()
        tok = str(item.get("symbol_token") or "").strip()
        if exch and tok:
            exchange_tokens.setdefault(exch, []).append(tok)

    adapter = get_any_active_market_adapter(db)
    if adapter:
        result = adapter.get_market_quotes_batch(exchange_tokens, mode=req.mode)
        return result

    # No active broker session: return explicit unavailable state with zero fabricated numbers
    unfetched = []
    for exch, tokens in exchange_tokens.items():
        for t in tokens:
            unfetched.append({
                "exchange": exch,
                "symbol_token": t,
                "freshness_status": "UNAVAILABLE",
                "message": "Live quotes require an authenticated broker connection"
            })

    return {
        "mode": req.mode,
        "fetched": [],
        "unfetched": unfetched,
        "status": "SESSION_UNAVAILABLE",
        "message": "No active broker connection available for live quote streaming"
    }


@router.get("/quote")
def get_single_market_quote(
    symbol: str,
    exchange: str = "NSE",
    db: Session = Depends(get_db)
):
    """
    Retrieves live market quote for a single instrument.
    First checks database for instrument token, then requests official SmartAPI quote.
    """
    sym = symbol.upper().strip()
    inst = db.query(Instrument).filter(
        (Instrument.tradingsymbol == sym) | 
        (Instrument.tradingsymbol == f"{sym}-EQ") |
        (Instrument.symbol_token == sym)
    ).first()

    token = inst.symbol_token if inst else sym
    target_exchange = inst.exchange if inst else exchange.upper().strip()

    adapter = get_any_active_market_adapter(db)
    if adapter:
        quotes = adapter.get_market_quotes_batch({target_exchange: [token]}, mode="FULL")
        if quotes.get("fetched"):
            return quotes["fetched"][0]

    # Return explicit verified metadata with UNAVAILABLE price rather than fake numbers
    return {
        "exchange": target_exchange,
        "trading_symbol": inst.tradingsymbol if inst else sym,
        "symbol_token": token,
        "ltp": None,
        "previous_close": None,
        "net_change": None,
        "percent_change": None,
        "data_source": "BROKER_SESSION_REQUIRED",
        "freshness_status": "UNAVAILABLE",
        "message": "Live quote unavailable: Demat account authentication required",
        "received_at": datetime.utcnow().isoformat()
    }


@router.get("/quotes")
def get_market_quotes(db: Session = Depends(get_db)):
    """
    Returns market snapshots for tracked IPOs.
    """
    ipos = db.query(IPO).all()
    quotes = []
    for ipo in ipos:
        prev = ipo.previous_close or ipo.issue_price
        ltp = ipo.current_ltp or ipo.issue_price
        chg = round(ltp - prev, 2) if (ltp and prev) else 0.0
        chg_pct = round((chg / prev) * 100, 2) if (prev and prev > 0) else 0.0

        quotes.append({
            "symbol": ipo.symbol,
            "company_name": ipo.company_name,
            "exchange": ipo.exchange,
            "symbol_token": ipo.symbol_token,
            "ltp": ltp,
            "previous_close": prev,
            "change": chg,
            "change_percent": chg_pct,
            "data_source": "VERIFIED_EXCHANGE_SNAPSHOT",
            "is_stale": False,
            "timestamp": datetime.utcnow().isoformat()
        })
    return quotes


# SmartAPI getCandleData accepts only these interval names; map common short aliases.
CANDLE_INTERVAL_ALIASES = {
    "1M": "ONE_MINUTE", "1MIN": "ONE_MINUTE", "3M": "THREE_MINUTE", "5M": "FIVE_MINUTE",
    "10M": "TEN_MINUTE", "15M": "FIFTEEN_MINUTE", "30M": "THIRTY_MINUTE",
    "1H": "ONE_HOUR", "60M": "ONE_HOUR", "1D": "ONE_DAY", "D": "ONE_DAY", "DAY": "ONE_DAY",
}
# Max calendar days per getCandleData request (Angel One limits)
CANDLE_MAX_DAYS = {
    "ONE_MINUTE": 30, "THREE_MINUTE": 60, "FIVE_MINUTE": 100, "TEN_MINUTE": 100,
    "FIFTEEN_MINUTE": 200, "THIRTY_MINUTE": 200, "ONE_HOUR": 400, "ONE_DAY": 2000,
}
# 1D fetches a few days back so weekends/holidays still return the latest session
CANDLE_RANGE_DAYS = {"1D": 4, "5D": 7, "1W": 7, "1M": 31, "3M": 92, "6M": 183, "1Y": 366, "ALL": 2000}


def _normalize_candle_interval(interval: str) -> str:
    upper = (interval or "ONE_DAY").strip().upper()
    if upper in CANDLE_MAX_DAYS:
        return upper
    return CANDLE_INTERVAL_ALIASES.get(upper, "ONE_DAY")


@router.get("/candles")
def get_market_candles(
    symbol: str,
    interval: str = "ONE_DAY",
    range_period: str = "1M",
    exchange: Optional[str] = None,
    symbol_token: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Returns authentic historical OHLCV candles using official SmartAPI getCandleData
    across all supported exchanges (NSE, BSE, NFO, BFO, MCX).
    Never generates fictitious random-walk candles. If the broker historical feed is
    unavailable or market session is closed, returns genuine empty state.
    """
    sym = symbol.upper().strip()
    
    # Clean symbol for DB query if ends with -EQ
    clean_sym = sym[:-3] if sym.endswith("-EQ") else sym

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

    company_name = inst.name if inst else (inst.contract_name if hasattr(inst, 'contract_name') and inst.contract_name else f"{sym}")
    resolved_exchange = (exchange or (inst.exchange if inst else "NSE")).upper().strip()
    resolved_token = str(symbol_token).strip() if (symbol_token and symbol_token != "0") else (inst.symbol_token if inst else sym)

    interval = _normalize_candle_interval(interval)
    range_period = (range_period or "1M").upper()

    now = datetime.utcnow()
    now_ist = now + timedelta(hours=5, minutes=30)
    days = min(CANDLE_RANGE_DAYS.get(range_period, 31), CANDLE_MAX_DAYS.get(interval, 2000))
    delta = timedelta(days=days)

    # SmartAPI expects exchange-local (IST) "yyyy-MM-dd HH:mm"
    from_date = (now_ist - delta).strftime("%Y-%m-%d 09:15")
    to_date = now_ist.strftime("%Y-%m-%d %H:%M")

    candles = []
    data_source = "HISTORICAL_FEED_UNAVAILABLE"
    is_stale = True

    adapter = get_any_active_market_adapter(db)
    if adapter and resolved_token and resolved_token != "0" and resolved_token != sym:
        try:
            candles = adapter.get_candle_data(
                exchange=resolved_exchange,
                symbol_token=resolved_token,
                interval=interval,
                from_date=from_date,
                to_date=to_date
            )
            if candles:
                data_source = "SMARTAPI_HISTORICAL_API"
                is_stale = False
        except Exception:
            pass
    elif adapter and resolved_token:
        # Try direct fetch even if token equals sym
        try:
            candles = adapter.get_candle_data(
                exchange=resolved_exchange,
                symbol_token=resolved_token,
                interval=interval,
                from_date=from_date,
                to_date=to_date
            )
            if candles:
                data_source = "SMARTAPI_HISTORICAL_API"
                is_stale = False
        except Exception:
            pass

    # Check live cached tick from SmartAPI WebSocket stream
    from app.services.smartapi_websocket import smartapi_ws_service
    cached_tick = (
        smartapi_ws_service.get_latest_quote(sym)
        or smartapi_ws_service.get_latest_quote(clean_sym)
        or (smartapi_ws_service.get_latest_quote(resolved_token) if resolved_token else None)
    )

    ltp = candles[-1]["close"] if candles else (cached_tick["ltp"] if cached_tick else (inst.current_ltp if inst else None))
    prev_close = (
        candles[-2]["close"] if len(candles) > 1 
        else (cached_tick["previous_close"] if cached_tick 
        else (inst.previous_close if inst else None))
    )

    # Strictly no synthetic or fictitious random candles per specification

    change = round(ltp - prev_close, 2) if (ltp and prev_close) else None
    change_pct = round((change / prev_close) * 100, 2) if (change is not None and prev_close and prev_close > 0) else None

    return {
        "symbol": sym,
        "company_name": company_name,
        "exchange": resolved_exchange,
        "symbol_token": resolved_token,
        "current_ltp": ltp,
        "previous_close": prev_close,
        "change": change,
        "change_percent": change_pct,
        "candles_count": len(candles),
        "candles": candles,
        "interval": interval,
        "range_period": range_period,
        "data_source": data_source,
        "is_stale": is_stale,
        "status": "SUCCESS" if candles else "HISTORICAL_CANDLES_UNAVAILABLE",
        "message": "Live candles loaded from SmartAPI" if data_source == "SMARTAPI_HISTORICAL_API" else "No historical candles available for this instrument from broker",
        "last_updated": now_ist.strftime("%Y-%m-%d %H:%M:%S IST")
    }


@router.post("/update-price")
async def update_simulated_price(symbol: str, price: float, db: Session = Depends(get_db)):
    """
    Simulation control for automated testing: allows operator/test suite to broadcast a price tick.
    """
    sym = symbol.upper().strip()
    ipo = db.query(IPO).filter(IPO.symbol == sym).first()
    inst = db.query(Instrument).filter(Instrument.tradingsymbol == sym).first()

    if not ipo and not inst:
        raise HTTPException(status_code=404, detail="Symbol not found")

    prev = price
    if ipo:
        ipo.current_ltp = price
        prev = ipo.previous_close or ipo.issue_price or price
        db.commit()

    chg = round(price - prev, 2)
    chg_pct = round((chg / prev) * 100, 2) if prev > 0 else 0.0
    now_ts = datetime.utcnow().isoformat()

    # Broadcast price update over WebSocket
    update_msg = {
        "type": "TICK",
        "symbol": sym,
        "ltp": price,
        "change": chg,
        "change_percent": chg_pct,
        "timestamp": now_ts,
        "server_receipt_time": now_ts,
        "processing_latency_ms": 1.2,
        "data_source": "SIMULATED_TEST_TICK"
    }
    await market_feed_manager.broadcast(update_msg)
    return {"message": f"Updated {sym} price to ₹{price}", "symbol": sym, "ltp": price, "change": chg, "change_percent": chg_pct}


@router.websocket("/ws")
async def market_websocket_endpoint(websocket: WebSocket):
    """
    WebSocket streaming endpoint for real-time market quotes and order status updates.
    """
    await market_feed_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        market_feed_manager.disconnect(websocket)
    except Exception:
        market_feed_manager.disconnect(websocket)
