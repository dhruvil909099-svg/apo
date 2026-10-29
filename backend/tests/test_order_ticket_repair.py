import pytest
from app.core.database import SessionLocal
from app.models.instrument import Instrument
from app.models.account import Account
from app.models.order import Order
from app.services.brokerage_estimate_service import BrokerageEstimateService
from app.services.margin_estimate_service import MarginEstimateService


def test_olaelec_tokens():
    db = SessionLocal()
    try:
        bse = db.query(Instrument).filter(Instrument.tradingsymbol == "OLAELEC", Instrument.exchange == "BSE").first()
        nse = db.query(Instrument).filter(Instrument.tradingsymbol == "OLAELEC-EQ", Instrument.exchange == "NSE").first()
        assert bse is not None, "OLAELEC BSE instrument should exist in DB"
        assert bse.symbol_token == "544225", f"Expected BSE token 544225, got {bse.symbol_token}"
        assert nse is not None, "OLAELEC-EQ NSE instrument should exist in DB"
        assert nse.symbol_token == "24777", f"Expected NSE token 24777, got {nse.symbol_token}"
    finally:
        db.close()


def test_no_fabricated_100_ltp_on_missing_quote():
    db = SessionLocal()
    try:
        # Quote calculation when price is 0/None must NOT fabricate 100
        margin_res = MarginEstimateService.calculate_margin(
            db=db,
            exchange="BSE",
            symbol_token="544225",
            tradingsymbol="OLAELEC",
            transaction_type="BUY",
            product_type="INTRADAY",
            quantity=10,
            price=0.0,
            available_funds=100.23
        )
        assert margin_res["status"] == "UNAVAILABLE"
        assert margin_res["required_margin"] == 0.0
        assert margin_res["full_trade_value"] == 0.0
    finally:
        db.close()


def test_olaelec_quantity_10_notional_value_and_intraday_margin():
    db = SessionLocal()
    try:
        price = 35.14
        qty = 10
        trade_val = round(qty * price, 2)
        assert trade_val == 351.40, f"Expected trade value 351.40, got {trade_val}"

        # Margin test for Intraday (MIS)
        margin_res = MarginEstimateService.calculate_margin(
            db=db,
            exchange="BSE",
            symbol_token="544225",
            tradingsymbol="OLAELEC",
            transaction_type="BUY",
            product_type="INTRADAY",
            quantity=qty,
            price=price,
            available_funds=100.23
        )
        # Required margin should be approximately ~₹71.11 (not ₹351.40 or ₹1,000!)
        assert margin_res["full_trade_value"] == 351.40
        assert 70.0 <= margin_res["required_margin"] <= 72.0, f"Expected margin ~71.11, got {margin_res['required_margin']}"
        assert margin_res["is_sufficient"] is True, "₹100.23 available funds should be sufficient for ₹71.11 margin"
        assert margin_res["remaining_funds"] == round(100.23 - margin_res["required_margin"], 2)

        # Delivery (CNC) must require full 100% (351.40)
        margin_cnc = MarginEstimateService.calculate_margin(
            db=db,
            exchange="BSE",
            symbol_token="544225",
            tradingsymbol="OLAELEC",
            transaction_type="BUY",
            product_type="DELIVERY",
            quantity=qty,
            price=price,
            available_funds=100.23
        )
        assert margin_cnc["required_margin"] == 351.40
        assert margin_cnc["is_sufficient"] is False, "₹100.23 should be insufficient for ₹351.40 delivery order"
    finally:
        db.close()


def test_brokerage_breakdown_structure():
    db = SessionLocal()
    try:
        res = BrokerageEstimateService.estimate_charges(
            db=db,
            exchange="BSE",
            symbol_token="544225",
            tradingsymbol="OLAELEC",
            transaction_type="BUY",
            product_type="DELIVERY",
            quantity=10,
            price=35.14,
            order_type="LIMIT"
        )
        assert "brokerage" in res
        assert "stt_ctt" in res
        assert "exchange_charges" in res
        assert "stamp_duty" in res
        assert "sebi_charges" in res
        assert "gst" in res
        assert "total_charges" in res
        assert res["total_charges"] > 0
        assert res["trade_value"] == 351.40
    finally:
        db.close()


if __name__ == "__main__":
    test_olaelec_tokens()
    print("✓ test_olaelec_tokens passed")
    test_no_fabricated_100_ltp_on_missing_quote()
    print("✓ test_no_fabricated_100_ltp_on_missing_quote passed")
    test_olaelec_quantity_10_notional_value_and_intraday_margin()
    print("✓ test_olaelec_quantity_10_notional_value_and_intraday_margin passed")
    test_brokerage_breakdown_structure()
    print("✓ test_brokerage_breakdown_structure passed")
    print("\nAll targeted order ticket financial tests PASSED successfully!")
