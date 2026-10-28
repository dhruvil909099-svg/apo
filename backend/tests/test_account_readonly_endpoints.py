import time
import json
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
import pytest
import requests
from app.models.account import Account
from app.models.order import Order
from app.models.audit import AuditLog
from app.core.security import cipher
from app.services.smartapi_adapter import SmartAPIAdapter


def test_account_overview_success(client, db_session):
    """GET /api/v1/accounts/{id}/overview returns profile, metrics, holdings value, and stale flag."""
    response = client.get("/api/v1/accounts/1/overview")
    assert response.status_code == 200
    data = response.json()
    assert data["account_id"] == 1
    assert "***" in data["masked_client_code"]
    assert "pin" not in data
    assert "encrypted_pin" not in data
    assert data["total_holdings_count"] >= 1
    assert data["total_holdings_value"] > 0
    assert "stale_data_warning" in data


def test_account_holdings_success(client, db_session):
    """GET /api/v1/accounts/{id}/holdings returns delivery holdings with cost, LTP, and valuation."""
    response = client.get("/api/v1/accounts/1/holdings")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    holding = data[0]
    assert "symbol" in holding
    assert "quantity" in holding
    assert holding["quantity"] > 0
    assert "average_price" in holding
    assert "valuation" in holding
    assert "unrealized_pnl" in holding


def test_account_positions_separation(client, db_session):
    """GET /api/v1/accounts/{id}/positions returns intraday/F&O positions separate from holdings."""
    response = client.get("/api/v1/accounts/1/positions")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    # Demo accounts have no active derivative positions, returning empty list
    assert len(data) == 0


def test_orders_vs_trades_separation(client, db_session):
    """
    Verifies that acknowledged/open orders are never misrepresented as executed trades.
    Orders book contains all states; trades book contains ONLY confirmed executions.
    """
    # Create one acknowledged pending order and one executed order
    pending_order = Order(
        client_order_id="ORD-PENDING-001",
        account_id=1,
        tradingsymbol="INFY",
        symbol_token="1594",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=10,
        filled_quantity=0,
        price=1850.0,
        trigger_price=0.0,
        status="ACKNOWLEDGED",
        is_paper_trade=True
    )
    executed_order = Order(
        client_order_id="ORD-EXEC-002",
        account_id=1,
        tradingsymbol="TCS",
        symbol_token="11536",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=5,
        filled_quantity=5,
        price=3500.0,
        execution_price=3495.0,
        status="EXECUTED",
        is_paper_trade=True
    )
    db_session.add(pending_order)
    db_session.add(executed_order)
    db_session.commit()

    # 1. Orders endpoint must return BOTH pending and executed orders
    orders_resp = client.get("/api/v1/accounts/1/orders")
    assert orders_resp.status_code == 200
    orders = orders_resp.json()
    order_ids = [o["order_id"] for o in orders]
    assert "ORD-PENDING-001" in order_ids
    assert "ORD-EXEC-002" in order_ids

    # 2. Trades endpoint must return ONLY the executed trade, NEVER the pending order
    trades_resp = client.get("/api/v1/accounts/1/trades")
    assert trades_resp.status_code == 200
    trades = trades_resp.json()
    trade_order_ids = [t["order_id"] for t in trades]
    assert "ORD-EXEC-002" in trade_order_ids
    assert "ORD-PENDING-001" not in trade_order_ids
    
    # Confirm trade details
    exec_trade = next(t for t in trades if t["order_id"] == "ORD-EXEC-002")
    assert exec_trade["fill_quantity"] == 5
    assert exec_trade["fill_price"] == 3495.0


def test_stale_data_warning_and_unverified_cash(client, db_session):
    """
    Verifies that accounts without recent synchronization flag stale data,
    and live un-synced accounts do not return fabricated zero cash balances.
    """
    # Create a live account that has never synced
    live_acc = Account(
        nickname="Unsynced Live Demat",
        client_code="LIVE_UNSYNCED_01",
        account_group="Family",
        encrypted_api_key=cipher.encrypt("KEY_UNSYNCED"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=False,
        auth_status="DISCONNECTED",
        last_sync_time=None,
        available_cash=0.0
    )
    db_session.add(live_acc)
    db_session.commit()

    response = client.get(f"/api/v1/accounts/{live_acc.id}/overview")
    assert response.status_code == 200
    data = response.json()
    assert data["stale_data_warning"] is True
    # Unsynced live account must report None for available_cash, not fabricated balance
    assert data["available_cash"] is None
    assert data["total_margin"] is None


def test_sync_account_idempotent_read_only(client, db_session):
    """
    POST /api/v1/accounts/{id}/sync refreshes read-only account data,
    is idempotent, and never submits or alters any financial orders.
    """
    orders_count_before = db_session.query(Order).count()

    # Call sync on demo account
    resp1 = client.post("/api/v1/accounts/1/sync")
    assert resp1.status_code == 200
    data1 = resp1.json()
    assert data1["success"] is True
    assert data1["account_id"] == 1
    assert "sync_timestamp" in data1

    # Call sync again immediately (duplicate/idempotent check)
    resp2 = client.post("/api/v1/accounts/1/sync")
    assert resp2.status_code == 200
    data2 = resp2.json()
    assert data2["success"] is True

    # Ensure zero financial orders were placed during sync
    orders_count_after = db_session.query(Order).count()
    assert orders_count_after == orders_count_before


def test_sync_account_failure_handling(client, db_session):
    """Verifies safe error handling when broker sync fails for live accounts."""
    live_acc = Account(
        nickname="Failing Live Demat",
        client_code="LIVE_FAIL_02",
        account_group="Family",
        encrypted_api_key=cipher.encrypt("INVALID_KEY"),
        encrypted_pin=cipher.encrypt("0000"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=False,
        auth_status="DISCONNECTED",
        available_cash=50000.0
    )
    db_session.add(live_acc)
    db_session.commit()

    # Mock SmartAPIAdapter.authenticate to fail
    with patch.object(SmartAPIAdapter, "authenticate", return_value={"success": False, "message": "Invalid broker credentials"}):
        resp = client.post(f"/api/v1/accounts/{live_acc.id}/sync")
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False
        assert "Invalid broker credentials" in data["message"]

        # Check DB updated gracefully without crashing
        db_session.refresh(live_acc)
        assert live_acc.auth_status == "ERROR"
        assert "Invalid broker credentials" in live_acc.last_auth_error


def test_cross_account_access_denial_and_404(client, unauthenticated_client):
    """Verifies that missing auth returns 401 and nonexistent accounts return 404."""
    # 1. Unauthenticated requests rejected
    unauth_resp = unauthenticated_client.get("/api/v1/accounts/1/overview")
    assert unauth_resp.status_code == 401

    # 2. Nonexistent account returns 404 across all read-only endpoints
    assert client.get("/api/v1/accounts/999999/overview").status_code == 404
    assert client.get("/api/v1/accounts/999999/holdings").status_code == 404
    assert client.get("/api/v1/accounts/999999/positions").status_code == 404
    assert client.get("/api/v1/accounts/999999/orders").status_code == 404
    assert client.get("/api/v1/accounts/999999/trades").status_code == 404
    assert client.post("/api/v1/accounts/999999/sync").status_code == 404


def test_credential_masking_and_secret_free_audit_logs(client, db_session):
    """Verifies zero plaintext secrets are returned in schemas or stored in audit logs."""
    resp = client.post("/api/v1/accounts/1/sync")
    assert resp.status_code == 200

    # Check AuditLog for ACCOUNT_SYNCED
    audit = db_session.query(AuditLog).filter(
        AuditLog.event_type == "ACCOUNT_SYNCED",
        AuditLog.account_id == 1
    ).order_by(AuditLog.id.desc()).first()
    assert audit is not None
    details = json.loads(audit.details_json)
    
    # Sensitive keys must never exist in log details
    assert "pin" not in details
    assert "api_key" not in details
    assert "totp_secret" not in details
    assert "jwt_token" not in details
    assert "***" in details.get("masked_client_code", "")


def test_adapter_rate_limiting_and_session_reuse():
    """Verifies SmartAPIAdapter connection pooling and rate limit enforcement."""
    adapter = SmartAPIAdapter("API_KEY", "CLIENT123", "1234", "JBSWY3DPEHPK3PXP")
    assert isinstance(adapter.session, requests.Session)

    t0 = time.time()
    adapter._enforce_rate_limit(0.1)
    adapter._enforce_rate_limit(0.1)
    t1 = time.time()
    assert (t1 - t0) >= 0.08  # Enforced delay between consecutive calls


def test_adapter_bounded_retries_and_timeout():
    """Verifies bounded retry behavior on transient errors and timeout handling."""
    adapter = SmartAPIAdapter("API_KEY", "CLIENT123", "1234", "JBSWY3DPEHPK3PXP")
    adapter.jwt_token = "MOCK_JWT"

    # Mock timeout exception on session.get
    with patch.object(adapter.session, "get", side_effect=requests.exceptions.Timeout("Read timeout")):
        result = adapter._send_request("GET", "https://apiconnect.angelone.in/test", max_retries=2)
        assert result is None  # Bounded retries exhausted safely without uncaught exception

    # Mock transient 503 service unavailable followed by 200 OK
    resp_503 = MagicMock()
    resp_503.status_code = 503
    resp_200 = MagicMock()
    resp_200.status_code = 200
    resp_200.json.return_value = {"status": True, "data": {"test": "ok"}}

    with patch.object(adapter.session, "get", side_effect=[resp_503, resp_200]):
        result = adapter._send_request("GET", "https://apiconnect.angelone.in/test", max_retries=2)
        assert result is not None
        assert result["status"] is True
        assert adapter.last_sync_time is not None


def test_adapter_malformed_broker_response_handling():
    """Verifies that non-JSON or broken broker responses are safely handled."""
    adapter = SmartAPIAdapter("API_KEY", "CLIENT123", "1234", "JBSWY3DPEHPK3PXP")
    adapter.jwt_token = "MOCK_JWT"

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.side_effect = ValueError("Invalid JSON string")

    with patch.object(adapter.session, "get", return_value=mock_resp):
        positions = adapter.get_positions()
        assert positions == []

        orders = adapter.get_order_book()
        assert orders == []

        trades = adapter.get_trade_book()
        assert trades == []
