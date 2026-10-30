import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.account import Account
from app.models.order import Order
from app.models.ipo import Allotment, IPO
from app.services.smartapi_adapter import SmartAPIAdapter


def test_paper_single_order_never_calls_broker(client: TestClient, db_session: Session):
    """
    Proves that placing a single order in PAPER mode NEVER invokes SmartAPIAdapter.place_order
    or submits requests to external Angel One endpoints.
    """
    assert settings.TRADING_MODE == "PAPER"

    with patch.object(SmartAPIAdapter, "place_order") as mock_adapter_place_order, \
         patch("requests.Session.post") as mock_http_post:

        payload = {
            "account_id": 1,
            "tradingsymbol": "TATATECH-EQ",
            "symbol_token": "19326",
            "exchange": "NSE",
            "transaction_type": "SELL",
            "order_type": "MARKET",
            "variety": "NORMAL",
            "quantity": 5,
            "price": 0.0,
            "trigger_price": 0.0
        }

        res = client.post("/api/v1/orders/single", json=payload)
        assert res.status_code == 201
        data = res.json()

        # Strict paper trade assertions
        assert data["is_paper_trade"] is True
        assert data["status"] in ["EXECUTED", "ACCEPTED"]
        assert data["broker_order_id"].startswith("SIM_")

        # Absolute proof: SmartAPI broker methods were NEVER called
        assert mock_adapter_place_order.call_count == 0
        assert mock_http_post.call_count == 0


def test_paper_bulk_order_never_calls_broker(client: TestClient, db_session: Session):
    """
    Proves that bulk prepare and bulk execute in PAPER mode NEVER invoke SmartAPIAdapter.place_order.
    """
    assert settings.TRADING_MODE == "PAPER"

    with patch.object(SmartAPIAdapter, "place_order") as mock_adapter_place_order, \
         patch("requests.Session.post") as mock_http_post:

        # 1. Bulk Prepare
        prepare_payload = {
            "ipo_id": 1,
            "price": 1050.0,
            "order_type": "LIMIT",
            "exchange": "NSE",
            "symbol_token": "19326",
            "tradingsymbol": "TATATECH",
            "accounts": [
                {"account_id": 1, "quantity": 10},
                {"account_id": 2, "quantity": 10}
            ]
        }
        prep_res = client.post("/api/v1/orders/bulk-prepare", json=prepare_payload)
        assert prep_res.status_code == 200
        prep_data = prep_res.json()
        assert prep_data["is_executable"] is True
        batch_id = prep_data["batch_id"]

        # 2. Bulk Execute
        exec_payload = {
            "batch_id": batch_id,
            "operator_confirmed": True
        }
        exec_res = client.post("/api/v1/orders/bulk-execute", json=exec_payload)
        assert exec_res.status_code == 200
        exec_data = exec_res.json()
        assert exec_data["successful_count"] == 2
        assert exec_data["failed_count"] == 0

        # Check DB records
        orders = db_session.query(Order).filter(Order.batch_id == batch_id).all()
        assert len(orders) == 2
        for o in orders:
            assert o.is_paper_trade is True
            assert o.broker_order_id.startswith("SIM_")
            assert o.status in ["ACCEPTED", "EXECUTED"]

        # Absolute proof: SmartAPI broker methods were NEVER called
        assert mock_adapter_place_order.call_count == 0
        assert mock_http_post.call_count == 0


def test_demo_account_in_live_mode_routes_to_paper_trader(client: TestClient, db_session: Session):
    """
    Proves that even if TRADING_MODE is set to 'LIVE', any account with is_demo=True
    is categorically intercepted and routed to PaperTradingService without hitting the broker.
    """
    original_mode = settings.TRADING_MODE
    try:
        settings.TRADING_MODE = "LIVE"

        acc = db_session.query(Account).filter(Account.id == 1).first()
        acc.is_demo = True
        db_session.commit()

        with patch.object(SmartAPIAdapter, "place_order") as mock_adapter_place_order, \
             patch("requests.Session.post") as mock_http_post:

            payload = {
                "account_id": 1,
                "tradingsymbol": "TATATECH-EQ",
                "symbol_token": "19326",
                "exchange": "NSE",
                "transaction_type": "SELL",
                "order_type": "LIMIT",
                "variety": "NORMAL",
                "quantity": 5,
                "price": 1050.0,
                "trigger_price": 0.0
            }

            res = client.post("/api/v1/orders/single", json=payload)
            assert res.status_code == 201
            data = res.json()

            assert data["is_paper_trade"] is True
            assert data["broker_order_id"].startswith("SIM_")
            assert mock_adapter_place_order.call_count == 0
            assert mock_http_post.call_count == 0
    finally:
        settings.TRADING_MODE = original_mode


def test_paper_order_insufficient_holdings_safely_rejected(client: TestClient, db_session: Session):
    """
    Verifies that paper trading rejects excessive quantities internally without broker interaction.
    """
    with patch.object(SmartAPIAdapter, "place_order") as mock_adapter_place_order:
        payload = {
            "account_id": 1,
            "tradingsymbol": "TATATECH-EQ",
            "symbol_token": "19326",
            "exchange": "NSE",
            "transaction_type": "SELL",
            "order_type": "MARKET",
            "variety": "NORMAL",
            "quantity": 100,  # Exceeds available holdings (15 shares) within global risk limit (5000)
            "price": 0.0,
            "trigger_price": 0.0
        }
        res = client.post("/api/v1/orders/single", json=payload)
        assert res.status_code == 201
        data = res.json()
        assert data["status"] == "REJECTED"
        assert "Insufficient holdings" in data["rejection_reason"]
        assert mock_adapter_place_order.call_count == 0
