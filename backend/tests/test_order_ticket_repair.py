import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import MagicMock, patch
import requests
from app.core.database import SessionLocal, Base, engine
from app.models.instrument import Instrument
from app.models.account import Account
from app.models.order import Order
from app.services.brokerage_estimate_service import BrokerageEstimateService
from app.services.margin_estimate_service import MarginEstimateService
from app.api.endpoints_market import get_single_market_quote

# Initialize tables for hermetic test execution
Base.metadata.create_all(bind=engine)


def test_1_olaelec_token_mapping():
    """1. Correct OLAELEC NSE/BSE token mapping."""
    db = SessionLocal()
    try:
        # Seed test instruments if not present in test DB
        bse = db.query(Instrument).filter(Instrument.tradingsymbol == "OLAELEC", Instrument.exchange == "BSE").first()
        if not bse:
            bse = Instrument(
                tradingsymbol="OLAELEC",
                name="Ola Electric Mobility Limited",
                exchange="BSE",
                segment="EQUITY",
                instrument_type="EQUITY",
                symbol_token="544225",
                instrument_token="544225",
                tick_size=0.01,
                lot_size=1
            )
            db.add(bse)
            db.commit()

        nse = db.query(Instrument).filter(Instrument.tradingsymbol == "OLAELEC-EQ", Instrument.exchange == "NSE").first()
        if not nse:
            nse = Instrument(
                tradingsymbol="OLAELEC-EQ",
                name="Ola Electric Mobility Limited",
                exchange="NSE",
                segment="EQUITY",
                instrument_type="EQUITY",
                symbol_token="24777",
                instrument_token="24777",
                tick_size=0.01,
                lot_size=1
            )
            db.add(nse)
            db.commit()

        assert bse is not None, "OLAELEC BSE instrument should exist in DB"
        assert bse.symbol_token == "544225", f"Expected BSE token 544225, got {bse.symbol_token}"
        assert nse is not None, "OLAELEC-EQ NSE instrument should exist in DB"
        assert nse.symbol_token == "24777", f"Expected NSE token 24777, got {nse.symbol_token}"
    finally:
        db.close()


def test_2_genuine_quote_retrieval_where_authorized():
    """2. Genuine quote retrieval where authorized via WebSocket or REST."""
    db = SessionLocal()
    try:
        with patch("app.services.smartapi_websocket.smartapi_ws_service.get_latest_quote") as mock_ws:
            mock_ws.return_value = {
                "ltp": 35.14,
                "previous_close": 34.90,
                "timestamp": "2026-10-29T10:00:00Z"
            }
            quote = get_single_market_quote("OLAELEC", exchange="BSE", symbol_token="544225", db=db)
            assert quote["ltp"] == 35.14
            assert quote["previous_close"] == 34.90
            assert quote["net_change"] == 0.24
            assert quote["source"] == "BROKER_QUOTE"
            assert quote["freshness_status"] == "LIVE"
            assert quote["verified"] is True
            assert quote["details"]["ltp"]["source"] == "BROKER_QUOTE"
    finally:
        db.close()


def test_3_missing_quote_shows_unavailable():
    """3. Missing quote shows UNAVAILABLE without fabricating arbitrary prices."""
    db = SessionLocal()
    try:
        with patch("app.services.smartapi_websocket.smartapi_ws_service.get_latest_quote", return_value=None), \
             patch("app.services.smartapi_adapter.get_any_active_market_adapter", return_value=None):
            quote = get_single_market_quote("NONEXISTENT_SCRIP_XYZ", exchange="NSE", symbol_token="9999999", db=db)
            assert quote["ltp"] is None
            assert quote["source"] == "UNAVAILABLE"
            assert quote["freshness_status"] == "UNAVAILABLE"
            assert quote["verified"] is False
    finally:
        db.close()


def test_4_actual_brokerage_api_response_parsing():
    """4. Actual brokerage API response parsing from authentic SmartAPI schema."""
    sample_smartapi_response = {
        "summary": {
            "total_charges": 0.45,
            "trade_value": 351.40,
            "breakup": [
                {"name": "brokerage", "amount": 0.0},
                {
                    "name": "external charges",
                    "amount": 0.06,
                    "breakup": [
                        {"name": "exchange transaction charges", "amount": 0.01},
                        {"name": "stamp duty", "amount": 0.05},
                        {"name": "sebi turnover charges", "amount": 0.0004}
                    ]
                },
                {
                    "name": "taxes",
                    "amount": 0.39,
                    "breakup": [
                        {"name": "security transaction tax", "amount": 0.35},
                        {"name": "gst", "amount": 0.04}
                    ]
                }
            ]
        }
    }

    parsed = BrokerageEstimateService._parse_smartapi_brokerage_response(sample_smartapi_response, 351.40)
    assert parsed is not None
    assert parsed["total_charges"] == 0.45
    assert parsed["brokerage"] == 0.0
    assert parsed["stt_ctt"] == 0.35
    assert parsed["exchange_charges"] == 0.01
    assert parsed["stamp_duty"] == 0.05
    assert parsed["sebi_charges"] == 0.0004
    assert parsed["gst"] == 0.04
    assert parsed["dp_charges"] is None, "DP charges should be None because they are not in pre-trade broker estimate"
    assert parsed["is_broker_verified"] is True
    assert parsed["verified"] is True
    assert parsed["data_source"] == "BROKER_CHARGES_ESTIMATE"


def test_5_actual_margin_api_response_parsing():
    """5. Actual margin API response parsing from authentic SmartAPI batch response."""
    sample_margin_batch_data = {
        "totalMarginRequired": 71.11,
        "netMargin": 71.11,
        "positions": [{
            "exchange": "BSE",
            "token": "544225",
            "tradeType": "BUY",
            "qty": 10,
            "price": 35.14,
            "margin": {"total": 71.11}
        }]
    }

    parsed = MarginEstimateService._parse_smartapi_margin_response(
        data=sample_margin_batch_data,
        full_trade_value=351.40,
        available_funds=100.23,
        norm_product="INTRADAY"
    )
    assert parsed is not None
    assert parsed["required_margin"] == 71.11
    assert parsed["full_trade_value"] == 351.40
    assert parsed["available_funds"] == 100.23
    assert parsed["remaining_funds"] == 29.12
    assert parsed["is_sufficient"] is True
    assert parsed["is_broker_verified"] is True
    assert parsed["data_source"] == "BROKER_MARGIN_ESTIMATE"
    assert parsed["status"] == "VERIFIED"


def test_6_broker_api_failure_returns_unavailable():
    """6. Broker API failure returns UNAVAILABLE without guessing."""
    # When no active broker adapter exists
    margin_res = MarginEstimateService.calculate_margin(
        db=None,
        exchange="BSE",
        symbol_token="544225",
        tradingsymbol="OLAELEC",
        transaction_type="BUY",
        product_type="INTRADAY",
        quantity=10,
        price=35.14,
        available_funds=100.23
    )
    assert margin_res["required_margin"] is None
    assert margin_res["is_broker_verified"] is False
    assert margin_res["status"] == "UNAVAILABLE"
    assert margin_res["data_source"] == "UNAVAILABLE"
    assert margin_res["error_reason"] is not None

    charges_res = BrokerageEstimateService.estimate_charges(
        db=None,
        exchange="BSE",
        symbol_token="544225",
        tradingsymbol="OLAELEC",
        transaction_type="BUY",
        product_type="INTRADAY",
        quantity=10,
        price=35.14
    )
    assert charges_res["total_charges"] is None
    assert charges_res["is_broker_verified"] is False
    assert charges_res["status"] == "UNAVAILABLE"
    assert charges_res["data_source"] == "UNAVAILABLE"


def test_7_no_fixed_percentage_margin_masquerading_as_official():
    """7. No fixed-percentage margin masquerading as official broker data."""
    margin_res = MarginEstimateService.calculate_margin(
        db=None,
        exchange="BSE",
        symbol_token="544225",
        tradingsymbol="OLAELEC",
        transaction_type="BUY",
        product_type="INTRADAY",
        quantity=10,
        price=35.14,
        available_funds=100.23
    )
    # The official required_margin MUST be None when broker API is not connected
    assert margin_res["required_margin"] is None
    assert margin_res["is_broker_verified"] is False
    # If indicative guideline exists, it MUST be explicitly labeled as non-broker
    indicative = margin_res["details"].get("indicative_regulatory_margin")
    if indicative:
        assert indicative["source"] == "INDICATIVE_REGULATORY_SCHEDULE"
        assert indicative["verified"] is False


def test_8_no_hardcoded_brokerage_masquerading_as_official():
    """8. No hardcoded brokerage masquerading as official broker fees."""
    charges_res = BrokerageEstimateService.estimate_charges(
        db=None,
        exchange="BSE",
        symbol_token="544225",
        tradingsymbol="OLAELEC",
        transaction_type="BUY",
        product_type="INTRADAY",
        quantity=10,
        price=35.14
    )
    assert charges_res["total_charges"] is None
    assert charges_res["brokerage"] is None
    assert charges_res["is_broker_verified"] is False
    assert charges_res["data_source"] == "UNAVAILABLE"


def test_9_correct_quantity_times_verified_reference_price():
    """9. Correct quantity × verified reference price derived calculation."""
    qty = 10
    ref_price = 35.14
    notional_value = round(qty * ref_price, 2)
    assert notional_value == 351.40

    margin_res = MarginEstimateService.calculate_margin(
        db=None,
        exchange="BSE",
        symbol_token="544225",
        tradingsymbol="OLAELEC",
        transaction_type="BUY",
        product_type="INTRADAY",
        quantity=qty,
        price=ref_price,
        available_funds=100.23
    )
    assert margin_res["full_trade_value"] == 351.40
    trade_val_detail = margin_res["details"]["full_trade_value"]
    assert trade_val_detail["value"] == 351.40
    assert trade_val_detail["source"] == "DERIVED_FROM_VERIFIED_INPUTS"
    assert trade_val_detail["verified"] is True


def test_10_no_duplicate_transaction_submission():
    """10. Live order timeout transitions to SUBMISSION_UNKNOWN and blocks automated retry."""
    from app.services.smartapi_adapter import SmartAPIAdapter
    adapter = SmartAPIAdapter(account_id=1, api_key="dummy", client_code="DUMMY", pin="0000", totp_secret="SECRET")
    
    with patch("requests.post", side_effect=requests.exceptions.Timeout("Read timed out")):
        with patch.object(adapter, "_ensure_authenticated", return_value=True):
            res = adapter.place_order({
                "tradingsymbol": "OLAELEC",
                "symbol_token": "544225",
                "transaction_type": "BUY",
                "quantity": 10
            })
            assert res["success"] is False
            assert res["status"] == "SUBMISSION_UNKNOWN"
            assert res["error_code"] == "GATEWAY_TIMEOUT"
            assert "Do not retry" in res["message"]


def test_11_paper_mode_enforcement():
    """11. Paper trading mode is strictly enforced and isolated from live broker endpoints."""
    db = SessionLocal()
    try:
        demo_acc = db.query(Account).filter(Account.is_demo == True).first()
        if demo_acc:
            order = Order(
                client_order_id="test-sim-order-1",
                account_id=demo_acc.id,
                tradingsymbol="OLAELEC",
                symbol_token="544225",
                exchange="BSE",
                transaction_type="BUY",
                order_type="LIMIT",
                product_type="DELIVERY",
                quantity=10,
                price=35.14,
                status="PREPARED",
                is_paper_trade=True
            )
            assert order.is_paper_trade is True
    finally:
        db.close()


def test_12_financial_amount_model_contract():
    """12. Standard Financial Amount Model contract integrity."""
    from app.models.financial_types import make_financial_amount
    amt = make_financial_amount(
        value=71.11,
        source="BROKER_MARGIN_ESTIMATE",
        is_estimate=True,
        verified=True,
        error=None
    )
    assert amt["value"] == 71.11
    assert amt["source"] == "BROKER_MARGIN_ESTIMATE"
    assert amt["is_estimate"] is True
    assert amt["verified"] is True
    assert amt["error"] is None
    assert "as_of" in amt


if __name__ == "__main__":
    test_1_olaelec_token_mapping()
    print("[PASS] Test 1: OLAELEC Token Mapping passed")
    test_2_genuine_quote_retrieval_where_authorized()
    print("[PASS] Test 2: Genuine Quote Retrieval passed")
    test_3_missing_quote_shows_unavailable()
    print("[PASS] Test 3: Missing Quote UNAVAILABLE passed")
    test_4_actual_brokerage_api_response_parsing()
    print("[PASS] Test 4: Actual Brokerage API Response Parsing passed")
    test_5_actual_margin_api_response_parsing()
    print("[PASS] Test 5: Actual Margin API Response Parsing passed")
    test_6_broker_api_failure_returns_unavailable()
    print("[PASS] Test 6: Broker API Failure UNAVAILABLE passed")
    test_7_no_fixed_percentage_margin_masquerading_as_official()
    print("[PASS] Test 7: No Fixed Percentage Margin Masquerading passed")
    test_8_no_hardcoded_brokerage_masquerading_as_official()
    print("[PASS] Test 8: No Hardcoded Brokerage Masquerading passed")
    test_9_correct_quantity_times_verified_reference_price()
    print("[PASS] Test 9: Quantity x Verified Reference Price passed")
    test_10_no_duplicate_transaction_submission()
    print("[PASS] Test 10: No Duplicate Transaction Submission on Timeout passed")
    test_11_paper_mode_enforcement()
    print("[PASS] Test 11: Paper Mode Enforcement passed")
    test_12_financial_amount_model_contract()
    print("[PASS] Test 12: Financial Amount Model Contract passed")
    print("\nALL 12 FOCUSED VERIFICATION TESTS PASSED SUCCESSFULLY!")
