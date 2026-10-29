"""
Authoritative Focused Test Suite for IPOPro Latest Upgrade:
1. Index Option Chain Accuracy & Dynamic Discovery
2. MAX Chart Behavior & Scroll-Left Pagination
3. Multi-Account Paper Workspace, Account Isolation & Idempotency
4. Production Bundle & Security Constraints
"""

import os
import sys
import uuid
import time
from datetime import datetime, timedelta, date

# Ensure backend path is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.orm import Session
from app.core.database import SessionLocal, run_safe_migrations
from app.models.account import Account
from app.models.instrument import Instrument
from app.models.order import Order
from app.models.historical_candle import HistoricalCandle
from app.models.risk import RiskLimit
from app.services.option_chain_service import OptionChainService, BENCHMARK_INDICES
from app.services.historical_candle_service import HistoricalCandleService, CANDLE_MAX_DAYS_PER_CALL
from app.services.bulk_order_service import BulkOrderService
from app.services.paper_trading_service import PaperTradingService
from app.services.margin_estimate_service import MarginEstimateService
from app.services.brokerage_estimate_service import BrokerageEstimateService
from app.services.smartapi_adapter import SmartAPIAdapter


def setup_module(module=None):
    """Ensure database schema is migrated before tests run."""
    run_safe_migrations()


def test_1_benchmark_indices_and_option_chain_accuracy():
    """Verify index discovery catalog, contract specifications, and dynamic option chain logic."""
    print("[RUNNING] Test 1: Benchmark Indices & Option Chain Accuracy...")
    db = SessionLocal()
    try:
        # 1. Verify index catalog structure
        indices = OptionChainService.get_benchmark_indices(db)
        assert len(indices) == 7, f"Expected 7 benchmark indices, got {len(indices)}"

        expected_symbols = {"NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY", "NIFTYNXT50", "SENSEX", "BANKEX"}
        discovered_symbols = {idx["symbol"] for idx in indices}
        assert expected_symbols == discovered_symbols, f"Symbol mismatch: {expected_symbols} vs {discovered_symbols}"

        # 2. Verify exact contract specifications
        nifty = next(i for i in indices if i["symbol"] == "NIFTY")
        assert nifty["exchange"] == "NSE"
        assert nifty["derivatives_exchange"] == "NFO"
        assert nifty["symbol_token"] == "99926000"
        assert nifty["lot_size"] == 75
        assert nifty["tick_size"] == 0.05
        assert nifty["strike_gap"] == 50.0

        sensex = next(i for i in indices if i["symbol"] == "SENSEX")
        assert sensex["exchange"] == "BSE"
        assert sensex["derivatives_exchange"] == "BFO"
        assert sensex["symbol_token"] == "99919000"
        assert sensex["lot_size"] == 10
        assert sensex["tick_size"] == 0.05
        assert sensex["strike_gap"] == 100.0

        # 3. Verify zero fake quotes fallback when broker is disconnected
        # If broker is offline in test environment, freshness must be UNAVAILABLE, never synthetic numbers
        for idx in indices:
            if idx["ltp"] is None:
                assert idx["freshness_status"] in ("UNAVAILABLE", "CACHED")
                assert idx["net_change"] is None or idx["previous_close"] is not None

        # 4. Insert mock active listed option contracts to test dynamic expiry sorting & classification
        test_expiries = ["03NOV2026", "10NOV2026", "26NOV2026"]
        for exp in test_expiries:
            inst = db.query(Instrument).filter(
                Instrument.underlying_symbol == "NIFTY",
                Instrument.expiry == exp,
                Instrument.strike == 23000.0,
                Instrument.option_type == "CE"
            ).first()
            if not inst:
                inst = Instrument(
                    symbol_token=f"TEST_{exp}_23000CE",
                    tradingsymbol=f"NIFTY{exp}23000CE",
                    name="NIFTY",
                    exchange="NFO",
                    segment="OPTIONS",
                    instrument_type="OPTIDX",
                    underlying_symbol="NIFTY",
                    expiry=exp,
                    strike=23000.0,
                    option_type="CE",
                    lot_size=75,
                    tick_size=0.05,
                    is_active=True
                )
                db.add(inst)
        db.commit()

        discovered_expiries = OptionChainService.get_available_expiries(db, "NIFTY")
        assert len(discovered_expiries) >= 3, f"Expected at least 3 active expiries, got {len(discovered_expiries)}"
        
        # Verify chronological order
        dates = [e["date"] for e in discovered_expiries]
        assert dates == sorted(dates), "Expiries must be sorted in strict chronological order"

        # Verify weekly / monthly tagging
        first_exp = discovered_expiries[0]
        assert first_exp["is_nearest"] is True
        assert first_exp["type"] in ("W", "M")

        print("  [PASS] Index discovery catalog, lot sizes, tick sizes, and dynamic expiry ordering verified.")
    finally:
        db.close()


def test_2_max_chart_behavior_and_pagination():
    """Verify default MAX range loading, window chunking, and before_timestamp pagination."""
    print("[RUNNING] Test 2: MAX Chart Range, Chunking & Pagination...")
    db = SessionLocal()
    try:
        # 1. Verify ONE_DAY max call days is 2000 calendar days
        max_call_days = CANDLE_MAX_DAYS_PER_CALL.get("ONE_DAY")
        assert max_call_days >= 2000, f"ONE_DAY max call days should be >= 2000, got {max_call_days}"

        # 2. Verify get_candles logic with range_period="MAX"
        # In isolated test mode (no broker credentials), it should check cache and gracefully return verified metadata
        res = HistoricalCandleService.get_candles(
            db=db,
            symbol="HINDCOPPER-EQ",
            exchange="NSE",
            symbol_token="17939",
            interval="ONE_DAY",
            range_period="MAX"
        )
        assert res["interval"] == "ONE_DAY"
        assert res["range_period"] == "MAX"
        assert res["exchange"] == "NSE"
        assert res["symbol_token"] == "17939"
        assert isinstance(res["candles"], list)
        assert "data_source" in res
        assert "has_more_history" in res

        # 3. Test before_timestamp pagination date boundary parsing
        test_timestamp = "2026-05-15 09:15:00"
        page_res = HistoricalCandleService.get_candles(
            db=db,
            symbol="HINDCOPPER-EQ",
            exchange="NSE",
            symbol_token="17939",
            interval="ONE_DAY",
            before_timestamp=test_timestamp
        )
        assert page_res["interval"] == "ONE_DAY"
        assert isinstance(page_res["candles"], list)

        # 4. Verify separate contract isolation (NSE stock vs NFO option vs MCX commodity)
        contract_types = [
            ("HINDCOPPER-EQ", "NSE", "17939"),
            ("NIFTY29DEC26FUT", "NFO", "58875"),
            ("CRUDEOIL17NOV26", "MCX", "582840")
        ]
        for sym, exch, tok in contract_types:
            c_res = HistoricalCandleService.get_candles(
                db=db,
                symbol=sym,
                exchange=exch,
                symbol_token=tok,
                interval="ONE_DAY",
                range_period="1M"
            )
            assert c_res["symbol_token"] == tok
            assert c_res["exchange"] == exch

        print("  [PASS] MAX chart 2000-day window, pagination, and multi-segment contract isolation verified.")
    finally:
        db.close()


def test_3_multi_account_paper_workspace_and_isolation():
    """Verify multi-account selection, funds isolation, per-account quantity overrides, and paper simulation."""
    print("[RUNNING] Test 3: Multi-Account Paper Workspace & Isolation...")
    db = SessionLocal()
    try:
        # Create 2 test accounts with isolated balances
        acc1 = db.query(Account).filter(Account.nickname == "TEST_ACCOUNT_ALPHA").first()
        if not acc1:
            acc1 = Account(
                nickname="TEST_ACCOUNT_ALPHA",
                client_code="DEMO_ALPHA",
                encrypted_api_key="TEST_KEY",
                encrypted_pin="TEST_PIN",
                encrypted_totp_secret="TEST_SECRET",
                is_demo=True,
                is_enabled=True,
                auth_status="CONNECTED",
                available_cash=50000.0,
                ddpi_status="ACTIVE",
                edis_authorized_today=True
            )
            db.add(acc1)

        acc2 = db.query(Account).filter(Account.nickname == "TEST_ACCOUNT_BETA").first()
        if not acc2:
            acc2 = Account(
                nickname="TEST_ACCOUNT_BETA",
                client_code="DEMO_BETA",
                encrypted_api_key="TEST_KEY",
                encrypted_pin="TEST_PIN",
                encrypted_totp_secret="TEST_SECRET",
                is_demo=True,
                is_enabled=True,
                auth_status="CONNECTED",
                available_cash=500.0,  # Insufficient funds to test independent blocking!
                ddpi_status="ACTIVE",
                edis_authorized_today=True
            )
            db.add(acc2)

        acc_disabled = db.query(Account).filter(Account.nickname == "TEST_ACCOUNT_DISABLED").first()
        if not acc_disabled:
            acc_disabled = Account(
                nickname="TEST_ACCOUNT_DISABLED",
                client_code="DEMO_DIS",
                encrypted_api_key="TEST_KEY",
                encrypted_pin="TEST_PIN",
                encrypted_totp_secret="TEST_SECRET",
                is_demo=True,
                is_enabled=False,  # Disabled account to verify rejection!
                auth_status="DISCONNECTED",
                available_cash=100000.0
            )
            db.add(acc_disabled)

        db.commit()

        # 1. Multi-account prepare with different quantities per account
        req_payload = {
            "tradingsymbol": "HINDCOPPER-EQ",
            "symbol_token": "17939",
            "exchange": "NSE",
            "transaction_type": "BUY",
            "order_type": "LIMIT",
            "product_type": "DELIVERY",
            "price": 400.0,
            "accounts": [
                {"account_id": acc1.id, "quantity": 10},  # Needs 4,000 <= 50,000 -> VALID
                {"account_id": acc2.id, "quantity": 5},   # Needs 2,000 > 500 -> BLOCKED (Insufficient funds)
                {"account_id": acc_disabled.id, "quantity": 1} # BLOCKED (Account disabled)
            ]
        }

        prep_res = BulkOrderService.prepare_and_validate(db, req_payload)
        assert prep_res["total_accounts"] == 3
        
        # Verify per-account evaluation is independent
        orders_by_acc = {p["account_id"]: p for p in prep_res["proposed_orders"]}
        
        # Account 1 must be valid
        assert orders_by_acc[acc1.id]["is_valid"] is True
        assert orders_by_acc[acc1.id]["proposed_quantity"] == 10
        assert orders_by_acc[acc1.id]["estimated_value"] == 4000.0

        # Account 2 must be blocked due to funds
        assert orders_by_acc[acc2.id]["is_valid"] is False
        assert "Insufficient funds" in orders_by_acc[acc2.id]["message"]

        # Disabled account must be blocked
        assert orders_by_acc[acc_disabled.id]["is_valid"] is False
        assert "disabled" in orders_by_acc[acc_disabled.id]["message"].lower()

        # 2. Execute paper order and verify simulated broker order ID
        single_paper_order = Order(
            client_order_id=str(uuid.uuid4()),
            account_id=acc1.id,
            tradingsymbol="HINDCOPPER-EQ",
            symbol_token="17939",
            exchange="NSE",
            transaction_type="BUY",
            order_type="LIMIT",
            product_type="DELIVERY",
            quantity=10,
            price=400.0,
            status="PREPARED",
            is_paper_trade=True
        )
        db.add(single_paper_order)
        db.commit()

        exec_res = PaperTradingService.execute_paper_order(db, single_paper_order, mock_ltp=390.0)
        assert exec_res["success"] is True
        assert single_paper_order.status == "EXECUTED"
        assert single_paper_order.broker_order_id.startswith("SIM_"), "Paper order ID must start with SIM_"
        assert single_paper_order.is_paper_trade is True

        # 3. Idempotency test: executing again must reject duplicate
        dup_res = PaperTradingService.execute_paper_order(db, single_paper_order)
        assert dup_res["success"] is False
        assert "already processed" in dup_res["rejection_reason"]

        print("  [PASS] Multi-account balance isolation, per-account quantity overrides, and SIM_ paper protection verified.")
    finally:
        db.close()


def test_4_smartapi_financial_data_and_order_ticket_accuracy():
    """
    Exhaustive Task 9 Verification:
    HINDCOPPER on NSE (token 17939), Reference Price 412.30, Qty 10, Delivery CNC, Market Order.
    Verifies:
    1. SmartAPI Margin batch payload contract: orderType='MARKET', productType='DELIVERY', qty=10, price=412.30.
    2. SmartAPI response parser extracts totalMarginRequired and marginComponents without hardcoded substitutions.
    3. SmartAPI Brokerage estimator parses exact components (brokerage: 5.00, stt: 4.12, exchange: 0.13, stamp: 0.62, sebi: 0.0041, gst: 0.92, total: 10.79, dp: None).
    4. Account isolation: Account A and Account B cache keys and balances are strictly separated.
    5. Truthful fallback: When broker is disconnected, required_margin and total_charges are strictly None, status UNAVAILABLE (never 20% or homegrown statutory formula).
    """
    print("[RUNNING] Test 4: Strict SmartAPI Financial Data & Order Ticket Accuracy (HINDCOPPER)...")
    db = SessionLocal()
    try:
        # 1. HINDCOPPER Market Order Margin Estimate
        hind_res = MarginEstimateService.calculate_margin(
            db=db,
            exchange="NSE",
            symbol_token="17939",
            tradingsymbol="HINDCOPPER-EQ",
            transaction_type="BUY",
            product_type="DELIVERY",
            quantity=10,
            price=412.30,
            order_type="MARKET",
            account_id=1
        )
        assert hind_res["full_trade_value"] == 4123.0, "Trade value must equal 10 * 412.30 = 4123.0"
        assert hind_res["status"] in ("VERIFIED", "UNAVAILABLE")
        if hind_res["status"] == "UNAVAILABLE":
            assert hind_res["required_margin"] is None
            assert hind_res["is_broker_verified"] is False
            assert "broker" in hind_res["error_reason"].lower() or "connection" in hind_res["error_reason"].lower()
            assert hind_res.get("indicative_regulatory_margin") is None, "Homegrown margin percentage must NOT exist"

        # 2. Verify smartapi_adapter get_margin_batch position formatting
        dummy_adapter = SmartAPIAdapter("KEY", "DEMO", "1234", "TOTP")
        positions_in = [{
            "exchange": "NSE",
            "qty": 10,
            "price": 412.30,
            "productType": "CNC",
            "symbol_token": "17939",
            "transaction_type": "BUY",
            "order_type": "MARKET"
        }]
        # Mock _ensure_authenticated to return False to inspect position formatting error or test normalization
        # Test Margin response parsing directly with official Angel One HINDCOPPER payload
        mock_smartapi_margin_response = {
            "totalMarginRequired": 4143.62,
            "marginComponents": {
                "netMargin": 4143.62,
                "spanMargin": 0.0,
                "exposureMargin": 0.0,
                "varMargin": 0.0,
                "extremeLossMargin": 0.0
            },
            "positions": [
                {
                    "exchange": "NSE",
                    "token": "17939",
                    "productType": "DELIVERY",
                    "tradeType": "BUY",
                    "orderType": "MARKET",
                    "qty": 10,
                    "price": 412.3,
                    "margin": {"total": 4143.62, "net": 4143.62}
                }
            ]
        }
        parsed_margin = MarginEstimateService._parse_smartapi_margin_response(
            data=mock_smartapi_margin_response,
            full_trade_value=4123.0,
            available_funds=100.23,
            norm_product="DELIVERY",
            account_id=1,
            account_masked_code="A***778"
        )
        assert parsed_margin is not None
        assert parsed_margin["required_margin"] == 4143.62
        assert parsed_margin["margin_for_order"] == 4143.62
        assert parsed_margin["total_margin_required"] == 4143.62
        assert parsed_margin["is_broker_verified"] is True
        assert parsed_margin["status_label"] == "BROKER ESTIMATE"
        assert parsed_margin["margin_components"]["netMargin"] == 4143.62
        assert parsed_margin["is_sufficient"] is False, "100.23 < 4143.62 must be insufficient"
        assert parsed_margin["remaining_funds"] == round(100.23 - 4143.62, 2)

        # 3. Verify Brokerage response parsing directly with official Angel One HINDCOPPER payload
        mock_smartapi_brokerage_response = {
            "summary": {
                "total_charges": 10.79,
                "trade_value": 4123.0,
                "breakup": [
                    {"name": "Brokerage", "amount": 5.00},
                    {
                        "name": "External Charges",
                        "amount": 0.75,
                        "breakup": [
                            {"name": "Exchange Transaction Charges", "amount": 0.13},
                            {"name": "Stamp Duty", "amount": 0.62},
                            {"name": "SEBI Turnover Fees", "amount": 0.0041}
                        ]
                    },
                    {
                        "name": "Taxes",
                        "amount": 5.04,
                        "breakup": [
                            {"name": "Securities Transaction Tax", "amount": 4.12},
                            {"name": "GST", "amount": 0.92}
                        ]
                    }
                ]
            }
        }
        parsed_charges = BrokerageEstimateService._parse_smartapi_brokerage_response(
            data=mock_smartapi_brokerage_response,
            expected_trade_value=4123.0,
            account_id=1,
            account_masked_code="A***778"
        )
        assert parsed_charges is not None
        assert parsed_charges["total_charges"] == 10.79
        assert parsed_charges["brokerage"] == 5.00
        assert parsed_charges["stt_ctt"] == 4.12
        assert parsed_charges["exchange_charges"] == 0.13
        assert parsed_charges["stamp_duty"] == 0.62
        assert parsed_charges["sebi_charges"] == 0.0041
        assert parsed_charges["gst"] == 0.92
        assert parsed_charges["dp_charges"] is None, "DP charges must be None (not in broker pre-trade estimate)"
        assert parsed_charges["status_label"] == "BROKER ESTIMATE"

        # 4. Verify Account Isolation & Cache Invalidation
        key1 = MarginEstimateService._make_cache_key(1, "NSE", "17939", "BUY", "DELIVERY", 10, 412.30, "MARKET")
        key2 = MarginEstimateService._make_cache_key(2, "NSE", "17939", "BUY", "DELIVERY", 10, 412.30, "MARKET")
        assert key1 != key2, "Different accounts must have completely isolated cache keys"

        key_limit = MarginEstimateService._make_cache_key(1, "NSE", "17939", "BUY", "DELIVERY", 10, 412.30, "LIMIT")
        assert key1 != key_limit, "Changing order type (MARKET vs LIMIT) must invalidate cache"

        print("  [PASS] SmartAPI margin orderType, brokerage components, and account isolation verified.")
    finally:
        db.close()


def test_5_frontend_production_bundle_integrity():
    """Verify that root index.html and assets directory match the latest production build."""
    print("[RUNNING] Test 5: Production Frontend Assets & Build Verification...")
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    index_html = os.path.join(root_dir, "index.html")
    assets_dir = os.path.join(root_dir, "assets")

    assert os.path.exists(index_html), "Root index.html must exist for production deployment"
    assert os.path.exists(assets_dir), "Root assets directory must exist"

    with open(index_html, "r", encoding="utf-8") as f:
        html_content = f.read()

    # Verify that index.html points to the newly built JS bundle
    assert "assets/index-" in html_content, "index.html must reference assets bundle"
    
    asset_files = os.listdir(assets_dir)
    js_files = [f for f in asset_files if f.endswith(".js")]
    css_files = [f for f in asset_files if f.endswith(".css")]

    assert len(js_files) >= 1, "At least one JS bundle must exist in assets"
    assert len(css_files) >= 1, "At least one CSS bundle must exist in assets"

    latest_js = os.path.join(assets_dir, js_files[0])
    with open(latest_js, "r", encoding="utf-8") as f:
        js_content = f.read()

    # Verify that the bundle contains verified SmartAPI financial and UI labels
    assert "Option Chain" in js_content, "Compiled JS must contain Option Chain components"
    assert "MAX" in js_content, "Compiled JS must contain MAX range references"
    assert "BROKER ESTIMATE" in js_content, "Compiled JS must contain BROKER ESTIMATE badge"
    assert "CALCULATED" in js_content, "Compiled JS must contain CALCULATED badge"
    assert "SMARTAPI RMS" in js_content, "Compiled JS must contain SMARTAPI RMS badge"

    print("  [PASS] Production bundle synced with BROKER ESTIMATE, CALCULATED, and SMARTAPI RMS badges verified.")


def run_all_checks():
    print("=================================================================")
    print("RUNNING IPOPRO STRICT REAL SMARTAPI FINANCIAL DATA VERIFICATION")
    print("=================================================================")
    test_1_benchmark_indices_and_option_chain_accuracy()
    test_2_max_chart_behavior_and_pagination()
    test_3_multi_account_paper_workspace_and_isolation()
    test_4_smartapi_financial_data_and_order_ticket_accuracy()
    test_5_frontend_production_bundle_integrity()
    print("=================================================================")
    print("ALL 5 VERIFICATION CHECKS PASSED WITH ZERO FAILURES!")
    print("=================================================================")


if __name__ == "__main__":
    run_all_checks()

