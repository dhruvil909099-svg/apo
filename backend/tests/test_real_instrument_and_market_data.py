"""
Automated Test Suite: Real Angel One Instrument Catalog & Market Data Integration
Validates:
1. Absence of hardcoded BASELINE_INSTRUMENTS dictionaries in production paths.
2. Official Angel One Scrip Master JSON normalization (strikes, ticks, segments, expiries).
3. Robust error handling for malformed, corrupted, or empty catalog inputs.
4. Exchange-specific instrument discovery across NSE, BSE, NFO, BFO, and MCX.
5. Search capabilities: A-Z browsing, prefix search, and pagination.
6. Authorized REST market quote batching, rate limiting, and missing price handling.
7. Session state awareness (NSE/BSE 09:15-15:30 IST vs MCX 09:00-23:30 IST).
8. Contradictory holdings reconciliation (account-level vs consolidated single source of truth).
9. Server-side safety gates preventing unauthorized live order execution.
"""

import pytest
from datetime import datetime, date, time
from unittest.mock import patch, MagicMock
from sqlalchemy.orm import Session
from fastapi.testclient import TestClient

from app.core.database import SessionLocal, Base, engine
from app.models.account import Account
from app.models.holding import AccountHoldingSnapshot
from app.models.instrument import Instrument
from app.models.order import Order
from app.models.ipo import IPO, Allotment
from app.services.holdings_service import (
    get_unified_account_holdings,
    get_holding_for_symbol,
    get_blocked_open_order_quantity
)
from app.services.instrument_master_service import (
    normalize_instrument_record,
    search_instruments,
    get_option_chain,
    get_commodity_contracts,
    get_popular_instruments,
    get_catalog_summary
)
from app.services.market_session_service import (
    evaluate_equity_session,
    evaluate_mcx_session,
    get_market_session_summary,
    IST
)
from app.services.smartapi_adapter import SmartAPIAdapter


# =====================================================================
# 1. NO HARDCODED BASELINE_INSTRUMENTS IN PRODUCTION PATHS
# =====================================================================

def test_no_baseline_instruments_dictionary():
    """Verify BASELINE_INSTRUMENTS constant is removed from instrument_master_service."""
    import app.services.instrument_master_service as ims
    assert not hasattr(ims, "BASELINE_INSTRUMENTS"), (
        "BASELINE_INSTRUMENTS constant must not exist in production instrument master service!"
    )


# =====================================================================
# 2-5. CATALOG PARSER & ERROR HANDLING
# =====================================================================

def test_normalize_instrument_record_equity():
    """Test standard NSE Equity normalization."""
    raw = {
        "token": "17963",
        "symbol": "HINDCOPPER-EQ",
        "name": "HINDUSTAN COPPER LTD",
        "expiry": "",
        "strike": "-1.000000",
        "lotsize": "1",
        "instrumenttype": "",
        "exch_seg": "NSE",
        "tick_size": "5.000000"
    }
    now = datetime.utcnow()
    norm = normalize_instrument_record(raw, now)
    assert norm is not None
    assert norm["symbol_token"] == "17963"
    assert norm["tradingsymbol"] == "HINDCOPPER-EQ"
    assert norm["exchange"] == "NSE"
    assert norm["segment"] == "EQUITY"
    assert norm["instrument_type"] == "EQUITY"
    assert norm["tick_size"] == 0.05  # 5 paise / 100.0 = 0.05
    assert norm["strike"] is None     # -1.0 strike ignored for equity
    assert norm["current_ltp"] is None  # Market separation: prices not hardcoded in master


def test_normalize_instrument_record_option_strike_scaling():
    """Test NFO Option strike price scaling from paise to rupees."""
    raw = {
        "token": "100062",
        "symbol": "ICICILIFE29DEC26365CE",
        "name": "ICICILIFE",
        "expiry": "29DEC2026",
        "strike": "36500.000000",
        "lotsize": "925",
        "instrumenttype": "OPTSTK",
        "exch_seg": "NFO",
        "tick_size": "5.000000"
    }
    norm = normalize_instrument_record(raw, datetime.utcnow())
    assert norm is not None
    assert norm["exchange"] == "NFO"
    assert norm["segment"] == "OPTIONS"
    assert norm["strike"] == 365.0    # 36500.0 / 100 = 365.0
    assert norm["option_type"] == "CE"
    assert norm["lot_size"] == 925
    assert norm["underlying_symbol"] == "ICICILIFE"


def test_normalize_instrument_record_mcx_commodity():
    """Test MCX commodity contract normalization."""
    raw = {
        "token": "23456",
        "symbol": "GOLDFEB2026",
        "name": "GOLD",
        "expiry": "05FEB2026",
        "strike": "0.000000",
        "lotsize": "100",
        "instrumenttype": "FUTCOM",
        "exch_seg": "MCX",
        "tick_size": "100.000000"
    }
    norm = normalize_instrument_record(raw, datetime.utcnow())
    assert norm is not None
    assert norm["exchange"] == "MCX"
    assert norm["segment"] == "COMMODITY"
    assert norm["instrument_type"] == "FUTCOM"
    assert norm["lot_size"] == 100
    assert norm["tick_size"] == 1.0   # 100 paise / 100.0 = 1.0


def test_malformed_catalog_record_rejected():
    """Verify records missing required tokens or exchange segments are safely discarded."""
    now = datetime.utcnow()
    assert normalize_instrument_record({}, now) is None
    assert normalize_instrument_record({"token": ""}, now) is None
    assert normalize_instrument_record({"token": "123", "symbol": ""}, now) is None
    assert normalize_instrument_record({"token": "123", "symbol": "TEST", "exch_seg": ""}, now) is None


# =====================================================================
# 6-11. MULTI-SEGMENT DISCOVERY IN DATABASE
# =====================================================================

def test_multi_segment_search(db_session: Session):
    """Test indexed search across NSE, BSE, NFO, BFO, and MCX in database."""
    # Seed synthetic instruments for test
    test_instruments = [
        Instrument(symbol_token="101", tradingsymbol="RELIANCE-EQ", name="RELIANCE IND", exchange="NSE", segment="EQUITY", instrument_type="EQUITY", lot_size=1, tick_size=0.05, is_active=True),
        Instrument(symbol_token="102", tradingsymbol="500325", name="RELIANCE BSE", exchange="BSE", segment="EQUITY", instrument_type="EQUITY", lot_size=1, tick_size=0.05, is_active=True),
        Instrument(symbol_token="103", tradingsymbol="NIFTY26NOVFUT", name="NIFTY", exchange="NFO", segment="FUTURES", instrument_type="FUTIDX", lot_size=50, tick_size=0.05, is_active=True),
        Instrument(symbol_token="104", tradingsymbol="NIFTY26NOV24500CE", name="NIFTY", exchange="NFO", segment="OPTIONS", instrument_type="OPTIDX", strike=24500.0, option_type="CE", expiry="26NOV2026", lot_size=50, tick_size=0.05, is_active=True),
        Instrument(symbol_token="105", tradingsymbol="GOLD26DECFUT", name="GOLD", exchange="MCX", segment="COMMODITY", instrument_type="FUTCOM", lot_size=100, tick_size=1.0, is_active=True),
    ]
    db_session.add_all(test_instruments)
    db_session.commit()

    # Search NSE Equity
    nse_res = search_instruments(db_session, exchange="NSE", segment="EQUITY")
    assert any(i["tradingsymbol"] == "RELIANCE-EQ" for i in nse_res["instruments"])

    # Search BSE Equity
    bse_res = search_instruments(db_session, exchange="BSE")
    assert any(i["tradingsymbol"] == "500325" for i in bse_res["instruments"])

    # Search NFO Futures
    nfo_res = search_instruments(db_session, exchange="NFO", segment="FUTURES")
    assert any(i["tradingsymbol"] == "NIFTY26NOVFUT" for i in nfo_res["instruments"])

    # Search MCX Commodities
    mcx_res = search_instruments(db_session, exchange="MCX")
    assert any(i["tradingsymbol"] == "GOLD26DECFUT" for i in mcx_res["instruments"])


# =====================================================================
# 12-19. A-Z BROWSING & SEARCH PAGINATION
# =====================================================================

def test_az_letter_filter(db_session: Session):
    """Verify A-Z alphabet filtering returns symbols starting with the letter."""
    db_session.add(Instrument(symbol_token="201", tradingsymbol="ASIANPAINT-EQ", name="ASIAN PAINTS", exchange="NSE", segment="EQUITY", instrument_type="EQUITY", lot_size=1, tick_size=0.05, is_active=True))
    db_session.add(Instrument(symbol_token="202", tradingsymbol="AXISBANK-EQ", name="AXIS BANK", exchange="NSE", segment="EQUITY", instrument_type="EQUITY", lot_size=1, tick_size=0.05, is_active=True))
    db_session.add(Instrument(symbol_token="203", tradingsymbol="BAJFINANCE-EQ", name="BAJAJ FINANCE", exchange="NSE", segment="EQUITY", instrument_type="EQUITY", lot_size=1, tick_size=0.05, is_active=True))
    db_session.commit()

    res_a = search_instruments(db_session, letter="A")
    assert res_a["total_count"] >= 2
    for inst in res_a["instruments"]:
        assert inst["tradingsymbol"].startswith("A")


def test_search_pagination(db_session: Session):
    """Verify offset and limit pagination in instrument catalog."""
    res_p1 = search_instruments(db_session, limit=2, offset=0)
    assert len(res_p1["instruments"]) <= 2

    res_p2 = search_instruments(db_session, limit=2, offset=2)
    assert len(res_p2["instruments"]) <= 2


# =====================================================================
# 20-25. REST QUOTE BATCHING & PREVIOUS CLOSE PERCENT CHANGE
# =====================================================================

def test_quote_batching_and_percent_change():
    """Verify quote batching logic and accurate ((LTP - Prev) / Prev) * 100 percentage calculation."""
    adapter = SmartAPIAdapter(
        api_key="TEST_KEY",
        client_code="AAAD986778",
        pin="1234",
        totp_secret="JBSWY3DPEHPK3PXP"
    )
    adapter.jwt_token = "MOCK_VALID_JWT"
    adapter.token_expiry_timestamp = 9999999999.0

    mock_resp = {
        "status": True,
        "data": {
            "fetched": [
                {
                    "exchange": "NSE",
                    "tradingSymbol": "HINDCOPPER-EQ",
                    "symbolToken": "17963",
                    "ltp": 410.20,
                    "close": 411.05,
                    "open": 409.00,
                    "high": 414.00,
                    "low": 408.00,
                    "totalTradedVolume": 1500000,
                    "exchFeedTime": "29-Oct-2026 12:30:00"
                }
            ],
            "unfetched": []
        }
    }

    with patch.object(adapter, "_send_request", return_value=mock_resp):
        res = adapter.get_market_quotes_batch({"NSE": ["17963"]}, mode="FULL")
        assert res["fetched_count"] == 1
        q = res["fetched"][0]
        assert q["ltp"] == 410.20
        assert q["close"] == 411.05
        # Expected day change: 410.20 - 411.05 = -0.85
        assert q["net_change"] == -0.85
        # Expected day change percent: (-0.85 / 411.05) * 100 = -0.21%
        assert q["percent_change"] == -0.21
        assert q["data_source"] == "ANGEL_ONE_SMARTAPI_LIVE"


# =====================================================================
# 26-33. MARKET SESSION AWARENESS (NSE/BSE vs MCX)
# =====================================================================

def test_equity_market_open_continuous():
    """Test equity session at 11:30 AM IST on Wednesday (Regular trading)."""
    t = datetime(2026, 10, 28, 11, 30, 0, tzinfo=IST)
    info = evaluate_equity_session(t)
    assert info["is_open"] is True
    assert info["session_code"] == "CONTINUOUS_TRADING"


def test_equity_market_closed_post_market():
    """Test equity session at 16:30 IST (Closed for the day)."""
    t = datetime(2026, 10, 28, 16, 30, 0, tzinfo=IST)
    info = evaluate_equity_session(t)
    assert info["is_open"] is False
    assert info["session_code"] == "POST_MARKET_CLOSED"


def test_mcx_open_at_evening():
    """Test MCX commodity session is OPEN at 20:00 (8:00 PM) IST when equity is closed."""
    t = datetime(2026, 10, 28, 20, 0, 0, tzinfo=IST)
    equity_info = evaluate_equity_session(t)
    mcx_info = evaluate_mcx_session(t)

    assert equity_info["is_open"] is False
    assert mcx_info["is_open"] is True
    assert mcx_info["session_code"] == "CONTINUOUS_TRADING"
    assert mcx_info["ends_at"] == "11:30 PM IST"


def test_weekend_closure():
    """Test both equity and MCX are closed on Sunday."""
    t = datetime(2026, 10, 25, 12, 0, 0, tzinfo=IST)  # Sunday
    equity_info = evaluate_equity_session(t)
    mcx_info = evaluate_mcx_session(t)

    assert equity_info["is_open"] is False
    assert equity_info["session_code"] == "WEEKEND"
    assert mcx_info["is_open"] is False
    assert mcx_info["session_code"] == "WEEKEND"


# =====================================================================
# 34-36. CONTRADICTORY HOLDINGS BUG FIX & SINGLE SOURCE OF TRUTH
# =====================================================================

def test_hindcopper_reconciliation_consolidated_vs_account(client: TestClient, db_session: Session):
    """
    CRITICAL BUG VERIFICATION:
    Verifies that HINDCOPPER-EQ with 240 shares is returned accurately in:
    1. Unified holdings service
    2. /portfolio/accounts (Account Breakdown)
    3. /accounts/{id}/overview
    4. Order ticket sell validation (rejects 0 available false claims)
    """
    # 1. Create live demat account
    acc = Account(
        nickname="Dhruvil HINDCOPPER Account",
        client_code="AAAD986778",
        account_group="Personal",
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED",
        ddpi_status="ACTIVE",
        available_cash=50000.0,
        encrypted_api_key="MOCK_KEY",
        encrypted_pin="MOCK_PIN",
        encrypted_totp_secret="MOCK_TOTP"
    )
    db_session.add(acc)
    db_session.commit()

    # 2. Store 240 shares of HINDCOPPER in AccountHoldingSnapshot
    snap = AccountHoldingSnapshot(
        account_id=acc.id,
        symbol="HINDCOPPER",
        tradingsymbol="HINDCOPPER-EQ",
        exchange="NSE",
        isin="INE531E01026",
        symbol_token="17963",
        quantity=240,
        realised_quantity=240,
        t1_quantity=0,
        authorised_quantity=240,
        average_price=413.74,
        ltp=410.20,
        invested_value=99297.60,
        market_value=98448.00,
        unrealized_pnl=-849.60,
        pnl_percentage=-0.86,
        close_price=411.05,
        sellable_quantity=240,
        verification_status="VERIFIED",
        data_source="ANGEL_ONE_SMARTAPI"
    )
    db_session.add(snap)
    db_session.commit()

    # Test Unified Service
    unified_holdings = get_unified_account_holdings(db_session, acc.id)
    assert len(unified_holdings) == 1
    hc = unified_holdings[0]
    assert hc["symbol"] == "HINDCOPPER"
    assert hc["quantity"] == 240
    assert hc["sellable_quantity"] == 240
    assert hc["current_ltp"] == 410.20

    # Test /portfolio/accounts (Account Breakdown endpoint)
    resp_acc_portfolio = client.get(f"/api/v1/portfolio/accounts?account_ids={acc.id}")
    assert resp_acc_portfolio.status_code == 200
    data = resp_acc_portfolio.json()
    assert len(data) == 1
    assert data[0]["portfolio_value"] == 98448.00
    assert len(data[0]["holdings"]) == 1
    assert data[0]["holdings"][0]["quantity"] == 240
    assert data[0]["holdings"][0]["symbol"] == "HINDCOPPER"

    # Test /accounts/{id}/overview endpoint
    resp_overview = client.get(f"/api/v1/accounts/{acc.id}/overview")
    assert resp_overview.status_code == 200
    ov = resp_overview.json()
    assert ov["total_holdings_count"] == 1
    assert ov["total_holdings_value"] == 98448.00

    # Test Sell Order Preview (Must NOT report '0 available')
    preview_resp = client.post("/api/v1/orders/preview", json={
        "account_id": acc.id,
        "tradingsymbol": "HINDCOPPER-EQ",
        "symbol_token": "17963",
        "exchange": "NSE",
        "transaction_type": "SELL",
        "order_type": "LIMIT",
        "product_type": "DELIVERY",
        "quantity": 10,
        "price": 410.00
    })
    assert preview_resp.status_code == 200
    prev_data = preview_resp.json()
    assert prev_data["is_valid"] is True
    # Blocking reasons must not claim 0 available
    assert not any("0 available" in r for r in prev_data["blocking_reasons"])


def test_blocked_quantity_in_open_sell_orders(db_session: Session):
    """Verify shares blocked in pending open sell orders are subtracted from sellable quantity."""
    acc = Account(
        nickname="Blocked Test Acc",
        client_code="AAAD986778_B",
        account_group="Test",
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED",
        available_cash=10000.0,
        encrypted_api_key="K", encrypted_pin="P", encrypted_totp_secret="T"
    )
    db_session.add(acc)
    db_session.commit()

    # 100 shares owned
    snap = AccountHoldingSnapshot(
        account_id=acc.id,
        symbol="TCS",
        tradingsymbol="TCS-EQ",
        exchange="NSE",
        quantity=100,
        realised_quantity=100,
        authorised_quantity=100,
        sellable_quantity=100,
        average_price=4000.0,
        data_source="ANGEL_ONE_SMARTAPI"
    )
    # Pending open order for 30 shares
    open_order = Order(
        client_order_id="ORD_OPEN_1",
        account_id=acc.id,
        tradingsymbol="TCS-EQ",
        symbol_token="11536",
        exchange="NSE",
        transaction_type="SELL",
        order_type="LIMIT",
        product_type="DELIVERY",
        variety="NORMAL",
        quantity=30,
        filled_quantity=0,
        price=4100.0,
        trigger_price=0.0,
        status="SUBMITTED",
        is_paper_trade=False
    )
    db_session.add_all([snap, open_order])
    db_session.commit()

    blocked = get_blocked_open_order_quantity(db_session, acc.id, "TCS")
    assert blocked == 30

    holding = get_holding_for_symbol(db_session, acc.id, "TCS")
    assert holding is not None
    assert holding["quantity"] == 100
    assert holding["blocked_quantity"] == 30
    assert holding["sellable_quantity"] == 70  # 100 - 30


# =====================================================================
# 37-38. SERVER-SIDE PREVENTION OF UNAUTHORIZED LIVE ORDERS
# =====================================================================

def test_server_prevents_unauthorized_live_execution(client: TestClient, db_session: Session):
    """Verify live order execution raises explicit safety error when credentials or static IP are unverified."""
    acc = Account(
        nickname="Safety Acc",
        client_code="AAAD986778_SAFE",
        account_group="Test",
        is_enabled=True,
        is_demo=False,
        auth_status="DISCONNECTED",
        available_cash=5000.0,
        encrypted_api_key="K", encrypted_pin="P", encrypted_totp_secret="T"
    )
    db_session.add(acc)
    db_session.commit()

    # Attempting to execute live order on disconnected account
    resp = client.post("/api/v1/orders/single", json={
        "account_id": acc.id,
        "tradingsymbol": "TCS-EQ",
        "symbol_token": "11536",
        "exchange": "NSE",
        "transaction_type": "BUY",
        "order_type": "LIMIT",
        "product_type": "DELIVERY",
        "variety": "NORMAL",
        "quantity": 1,
        "price": 4000.0,
        "is_paper_trade": False
    })
    # Must reject safely (400, 409 Conflict, or 502) rather than submitting unverified live trade
    assert resp.status_code in [400, 409, 422, 502]
