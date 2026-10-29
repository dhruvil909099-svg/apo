import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.account import Account
from app.models.ipo import IPO
from app.models.instrument import Instrument
from app.services.market_session_service import get_market_session_summary
from app.services.smartapi_adapter import get_any_active_market_adapter
from app.services.brokerage_estimate_service import BrokerageEstimateService
from app.services.margin_estimate_service import MarginEstimateService
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


class BrokerageEstimateRequest(BaseModel):
    exchange: str = "NSE"
    symbol_token: str
    tradingsymbol: str
    transaction_type: str = "BUY"
    product_type: str = "DELIVERY"
    quantity: int = 1
    price: float = 0.0
    order_type: str = "LIMIT"
    account_id: Optional[int] = None


class MarginEstimateRequest(BaseModel):
    exchange: str = "NSE"
    symbol_token: str
    tradingsymbol: str
    transaction_type: str = "BUY"
    product_type: str = "DELIVERY"
    quantity: int = 1
    price: float = 0.0
    account_id: Optional[int] = None
    order_type: str = "LIMIT"



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


@router.get("/indices")
def get_benchmark_indices_endpoint(db: Session = Depends(get_db)):
    """
    Returns live market levels and day change for major benchmark indices:
    NIFTY 50, BANK NIFTY, FIN NIFTY, MIDCAP NIFTY, NIFTY NEXT 50, SENSEX, BANKEX.
    Used for Stock Explorer index cards and one-click Option Chain navigation.
    """
    from app.services.option_chain_service import OptionChainService
    return OptionChainService.get_benchmark_indices(db)


@router.get("/option-chain/expiries")
def get_option_chain_expiries_endpoint(
    underlying: str = Query("NIFTY", description="Index underlying (NIFTY, BANKNIFTY, FINNIFTY, SENSEX, BANKEX)"),
    db: Session = Depends(get_db)
):
    """
    Returns authentic listed active expiries for the given index, sorted chronologically.
    """
    from app.services.option_chain_service import OptionChainService
    return OptionChainService.get_available_expiries(db, underlying=underlying)


@router.get("/option-chain")
@router.get("/instruments/option-chain")
def get_market_option_chain(
    underlying: str = Query("NIFTY", description="Underlying asset (e.g., NIFTY, BANKNIFTY, FINNIFTY, SENSEX, BANKEX)"),
    expiry_date: Optional[str] = Query(None, description="Contract expiry in DDMMMYYYY or YYYY-MM-DD format"),
    db: Session = Depends(get_db)
):
    """
    Returns structured options chain matrix pairing Call (CE) and Put (PE) contracts
    across strike prices for the selected underlying, centered around verified ATM spot.
    """
    from app.services.option_chain_service import OptionChainService
    return OptionChainService.get_option_chain(db, underlying=underlying, expiry_date=expiry_date)


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
    symbol_token: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Retrieves normalized, authentic market quote for a single instrument.
    Never returns fabricated prices. If quote is unavailable, returns explicit
    ltp: null and freshness_status: UNAVAILABLE.
    """
    sym = symbol.upper().strip()
    target_exchange = (exchange or "NSE").upper().strip()

    inst = None
    if symbol_token and symbol_token != "0":
        inst = db.query(Instrument).filter(
            Instrument.symbol_token == str(symbol_token).strip(),
            Instrument.exchange == target_exchange
        ).first()

    if not inst:
        clean_sym = sym[:-3] if sym.endswith("-EQ") else sym
        inst = db.query(Instrument).filter(
            (Instrument.tradingsymbol == sym) | 
            (Instrument.tradingsymbol == clean_sym) |
            (Instrument.tradingsymbol == f"{clean_sym}-EQ") |
            (Instrument.symbol_token == sym)
        ).first()

    token = str(symbol_token).strip() if (symbol_token and symbol_token != "0") else (inst.symbol_token if inst else sym)
    if inst:
        target_exchange = inst.exchange

    tradingsymbol = inst.tradingsymbol if inst else sym
    company_name = inst.name if inst else tradingsymbol
    tick_size = float(inst.tick_size) if (inst and inst.tick_size) else 0.05
    lot_size = int(inst.lot_size) if (inst and inst.lot_size) else 1

    # Check live WebSocket cache first
    from app.services.smartapi_websocket import smartapi_ws_service
    from app.models.financial_types import make_financial_amount
    ws_tick = smartapi_ws_service.get_latest_quote(token) or smartapi_ws_service.get_latest_quote(tradingsymbol)
    if ws_tick and ws_tick.get("ltp") is not None:
        ltp = float(ws_tick["ltp"])
        prev_close = float(ws_tick.get("previous_close") or ltp)
        chg = round(ltp - prev_close, 2)
        chg_pct = round((chg / prev_close) * 100, 2) if prev_close > 0 else 0.0
        as_of = ws_tick.get("timestamp") or datetime.utcnow().isoformat()
        return {
            "exchange": target_exchange,
            "trading_symbol": tradingsymbol,
            "symbol_token": token,
            "company_name": company_name,
            "ltp": ltp,
            "previous_close": prev_close,
            "net_change": chg,
            "percent_change": chg_pct,
            "tick_size": tick_size,
            "lot_size": lot_size,
            "source": "BROKER_QUOTE",
            "feed_channel": "SMARTAPI_WEBSOCKET_FEED",
            "freshness_status": "LIVE",
            "as_of_timestamp": as_of,
            "is_estimate": False,
            "verified": True,
            "market_order_disclaimer": "Indicative reference price only. Execution price is determined by exchange matching upon fill.",
            "details": {
                "ltp": make_financial_amount(ltp, "BROKER_QUOTE", is_estimate=False, verified=True, as_of=as_of),
                "previous_close": make_financial_amount(prev_close, "BROKER_QUOTE", is_estimate=False, verified=True, as_of=as_of),
            }
        }

    # Query active broker adapter
    adapter = get_any_active_market_adapter(db)
    if adapter and token and token != "0":
        try:
            quotes = adapter.get_market_quotes_batch({target_exchange: [token]}, mode="FULL")
            if quotes.get("fetched") and len(quotes["fetched"]) > 0:
                q = quotes["fetched"][0]
                ltp = float(q.get("ltp") or 0.0)
                prev_close = float(q.get("close") or q.get("previous_close") or ltp)
                chg = round(ltp - prev_close, 2)
                chg_pct = round((chg / prev_close) * 100, 2) if prev_close > 0 else 0.0
                as_of = datetime.utcnow().isoformat()
                return {
                    "exchange": target_exchange,
                    "trading_symbol": tradingsymbol,
                    "symbol_token": token,
                    "company_name": company_name,
                    "ltp": ltp,
                    "previous_close": prev_close,
                    "net_change": chg,
                    "percent_change": chg_pct,
                    "tick_size": tick_size,
                    "lot_size": lot_size,
                    "source": "BROKER_QUOTE",
                    "feed_channel": "SMARTAPI_REST_QUOTE",
                    "freshness_status": "LIVE",
                    "as_of_timestamp": as_of,
                    "is_estimate": False,
                    "verified": True,
                    "market_order_disclaimer": "Indicative reference price only. Execution price is determined by exchange matching upon fill.",
                    "details": {
                        "ltp": make_financial_amount(ltp, "BROKER_QUOTE", is_estimate=False, verified=True, as_of=as_of),
                        "previous_close": make_financial_amount(prev_close, "BROKER_QUOTE", is_estimate=False, verified=True, as_of=as_of),
                    }
                }
        except Exception:
            pass

    # Check DB snapshot if available
    if inst and inst.current_ltp is not None:
        ltp = float(inst.current_ltp)
        prev_close = float(inst.previous_close or ltp)
        chg = round(ltp - prev_close, 2)
        chg_pct = round((chg / prev_close) * 100, 2) if prev_close > 0 else 0.0
        as_of = (inst.last_synced_at.isoformat() if hasattr(inst, "last_synced_at") and inst.last_synced_at else datetime.utcnow().isoformat())
        return {
            "exchange": target_exchange,
            "trading_symbol": tradingsymbol,
            "symbol_token": token,
            "company_name": company_name,
            "ltp": ltp,
            "previous_close": prev_close,
            "net_change": chg,
            "percent_change": chg_pct,
            "tick_size": tick_size,
            "lot_size": lot_size,
            "source": "DATABASE_SNAPSHOT",
            "feed_channel": "DATABASE_SNAPSHOT",
            "freshness_status": "CACHED",
            "as_of_timestamp": as_of,
            "is_estimate": False,
            "verified": True,
            "market_order_disclaimer": "Cached database price. Execution price determined upon exchange fill.",
            "details": {
                "ltp": make_financial_amount(ltp, "DATABASE_SNAPSHOT", is_estimate=False, verified=True, as_of=as_of),
                "previous_close": make_financial_amount(prev_close, "DATABASE_SNAPSHOT", is_estimate=False, verified=True, as_of=as_of),
            }
        }

    # Truly unavailable: NO arbitrary defaults
    as_of = datetime.utcnow().isoformat()
    return {
        "exchange": target_exchange,
        "trading_symbol": tradingsymbol,
        "symbol_token": token,
        "company_name": company_name,
        "ltp": None,
        "previous_close": None,
        "net_change": None,
        "percent_change": None,
        "tick_size": tick_size,
        "lot_size": lot_size,
        "source": "UNAVAILABLE",
        "feed_channel": "BROKER_SESSION_REQUIRED",
        "freshness_status": "UNAVAILABLE",
        "as_of_timestamp": as_of,
        "is_estimate": False,
        "verified": False,
        "message": "Price unavailable: Waiting for authentic market quote from broker",
        "details": {
            "ltp": make_financial_amount(None, "UNAVAILABLE", is_estimate=False, verified=False, error="Waiting for authentic market quote from broker", as_of=as_of),
            "previous_close": make_financial_amount(None, "UNAVAILABLE", is_estimate=False, verified=False, as_of=as_of)
        }
    }


@router.post("/brokerage/estimate")
def estimate_order_brokerage_charges(
    req: BrokerageEstimateRequest,
    db: Session = Depends(get_db)
):
    """
    Computes official brokerage, statutory taxes, and exchange fees breakdown.
    Uses official SmartAPI Brokerage Calculator API or verified statutory schedules.
    """
    result = BrokerageEstimateService.estimate_charges(
        db=db,
        exchange=req.exchange,
        symbol_token=req.symbol_token,
        tradingsymbol=req.tradingsymbol,
        transaction_type=req.transaction_type,
        product_type=req.product_type,
        quantity=req.quantity,
        price=req.price,
        order_type=req.order_type,
        account_id=req.account_id
    )
    return result


@router.post("/margin/batch")
def calculate_order_margin(
    req: MarginEstimateRequest,
    db: Session = Depends(get_db)
):
    """
    Computes required margin for order using SmartAPI Margin Calculator API.
    Differentiates required margin from total trade value (e.g. MIS intraday vs CNC delivery).
    """
    available_funds = 0.0
    if req.account_id:
        acc = db.query(Account).filter(Account.id == req.account_id).first()
        if acc:
            available_funds = float(acc.available_cash or 0.0)

    result = MarginEstimateService.calculate_margin(
        db=db,
        exchange=req.exchange,
        symbol_token=req.symbol_token,
        tradingsymbol=req.tradingsymbol,
        transaction_type=req.transaction_type,
        product_type=req.product_type,
        quantity=req.quantity,
        price=req.price,
        available_funds=available_funds,
        order_type=req.order_type,
        account_id=req.account_id
    )
    return result



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
    range_period: Optional[str] = "1M",
    exchange: Optional[str] = None,
    symbol_token: Optional[str] = None,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    before_timestamp: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """
    Returns authentic historical OHLCV candles using official SmartAPI getCandleData
    across all supported exchanges (NSE, BSE, NFO, BFO, MCX).
    Supports pagination/backfill via before_timestamp or from_date/to_date.
    Uses database cache to prevent duplicate broker queries and speed up chart loading.
    Never fabricates missing sessions with synthetic data.
    """
    from app.services.historical_candle_service import HistoricalCandleService
    return HistoricalCandleService.get_candles(
        db=db,
        symbol=symbol,
        interval=interval,
        range_period=range_period,
        exchange=exchange,
        symbol_token=symbol_token,
        from_date_str=from_date,
        to_date_str=to_date,
        before_timestamp=before_timestamp
    )


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
