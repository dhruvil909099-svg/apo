"""
Comprehensive automated tests for IPOPro Production Readiness & Architecture:
- Phase 2: Database Migration & Persistent Verification
- Phase 3 & 4: Disconnected Account Read-Only Enforcement & Order Safeguards
- Phase 5: Full Credential Reconnection (rejecting temporary 6-digit OTP)
- Phase 6: Authorized Shared Market Data feed across accounts with strict isolation
- Phase 7: Reconnection without historical data loss
"""
import pytest
from datetime import datetime
from unittest.mock import patch, MagicMock
from app.models.account import Account
from app.models.order import Order
from app.models.ipo import IPO, Allotment
from app.core.security import cipher
from scripts.migrate_sqlite_to_postgres import (
    MIGRATION_ORDER,
    verify_target_integrity,
    run_migration,
)


# ============================================================================
# PHASE 2: DATABASE MIGRATION ENGINE & INTEGRITY VERIFICATION
# ============================================================================

def test_migration_table_dependency_order():
    """Verify that migration table dependency order includes all core tables."""
    table_names = [model.__tablename__ for model in MIGRATION_ORDER]
    expected_tables = [
        "accounts",
        "ipos",
        "allotments",
        "orders",
        "risk_limits",
        "audit_logs",
    ]
    for table in expected_tables:
        assert table in table_names, f"Table {table} missing from migration order"


def test_verify_database_integrity(db_session):
    """Test that database verification passes on valid seeded database."""
    expected_counts = {
        model.__tablename__: db_session.query(model).count()
        for model in MIGRATION_ORDER
    }
    status = verify_target_integrity(db_session, expected_counts)
    assert status is True


def test_verify_database_integrity_catches_corrupt_credentials(db_session):
    """Test that verification detects corrupted or undecryptable credentials."""
    corrupt_acc = Account(
        nickname="Corrupt Demat",
        client_code="CORRUPT01",
        account_group="Test",
        encrypted_api_key="NOT_VALID_FERNET_CIPHERTEXT",
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED"
    )
    db_session.add(corrupt_acc)
    db_session.commit()

    expected_counts = {
        model.__tablename__: db_session.query(model).count()
        for model in MIGRATION_ORDER
    }
    status = verify_target_integrity(db_session, expected_counts)
    assert status is False


def test_migration_dry_run_executes_safely(tmp_path):
    """Test that run_migration with dry_run=True performs source inspection without writing."""
    db_file = tmp_path / "test_source.db"
    source_url = f"sqlite:///{db_file}"
    success = run_migration(
        sqlite_url=source_url,
        postgres_url="sqlite:///:memory:",
        dry_run=True
    )
    assert success is True


# ============================================================================
# PHASE 3 & 4: DISCONNECTED ACCOUNT READ-ONLY ENFORCEMENT & ORDER SAFEGUARDS
# ============================================================================

def test_disconnected_account_single_order_rejected(client, db_session):
    """Disconnected accounts cannot submit single orders."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    db_session.commit()

    order_payload = {
        "account_id": account.id,
        "tradingsymbol": "TATATECH",
        "symbol_token": "19326",
        "exchange": "NSE",
        "transaction_type": "BUY",
        "quantity": 10,
        "price": 1000.0,
        "order_type": "LIMIT",
        "product_type": "DELIVERY",
    }
    response = client.post("/api/v1/orders/single", json=order_payload)
    assert response.status_code == 409
    body = response.json()
    detail = body.get("detail", body)
    assert detail["error_code"] == "BROKER_ACCOUNT_DISCONNECTED"
    assert "disconnected" in detail["message"].lower()


def test_disconnected_account_modify_order_rejected(client, db_session):
    """Disconnected accounts cannot modify orders."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"

    order = Order(
        client_order_id="TEST_MOD_ORD",
        account_id=account.id,
        tradingsymbol="TATATECH",
        symbol_token="19326",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        variety="NORMAL",
        quantity=10,
        price=1000.0,
        status="ACCEPTED",
        broker_order_id="TEST_ORD_1"
    )
    db_session.add(order)
    db_session.commit()

    modify_payload = {
        "quantity": 15,
        "price": 990.0,
        "order_type": "LIMIT"
    }
    response = client.put(f"/api/v1/orders/{order.id}", json=modify_payload)
    assert response.status_code == 409
    body = response.json()
    detail = body.get("detail", body)
    assert detail["error_code"] == "BROKER_ACCOUNT_DISCONNECTED"


def test_disconnected_account_cancel_order_rejected(client, db_session):
    """Disconnected accounts cannot cancel orders."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"

    order = Order(
        client_order_id="TEST_CAN_ORD",
        account_id=account.id,
        tradingsymbol="TATATECH",
        symbol_token="19326",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        variety="NORMAL",
        quantity=10,
        price=1000.0,
        status="ACCEPTED",
        broker_order_id="TEST_ORD_2"
    )
    db_session.add(order)
    db_session.commit()

    response = client.post(f"/api/v1/orders/{order.id}/cancel")
    assert response.status_code == 409
    body = response.json()
    detail = body.get("detail", body)
    assert detail["error_code"] == "BROKER_ACCOUNT_DISCONNECTED"


def test_disconnected_account_bulk_order_rejected(client, db_session):
    """Bulk order preparation flags disconnected accounts as non-executable."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    db_session.commit()

    ipo = db_session.query(IPO).first()

    bulk_payload = {
        "ipo_id": ipo.id,
        "tradingsymbol": ipo.symbol,
        "symbol_token": ipo.symbol_token or "19326",
        "exchange": "NSE",
        "order_type": "LIMIT",
        "price": 1050.0,
        "accounts": [
            {"account_id": account.id, "quantity": 30}
        ]
    }
    response = client.post("/api/v1/orders/bulk-prepare", json=bulk_payload)
    assert response.status_code == 200
    body = response.json()
    assert body["is_executable"] is False
    assert any("BROKER_ACCOUNT_DISCONNECTED" in p["message"] for p in body["proposed_orders"])


def test_disconnected_account_read_only_overview_preserves_data(client, db_session):
    """Disconnected account overview returns historical data with trading disabled."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    account.last_sync_time = datetime.utcnow()
    account.available_cash = 250000.0
    db_session.commit()

    response = client.get(f"/api/v1/accounts/{account.id}/overview")
    assert response.status_code == 200
    data = response.json()
    assert data["auth_status"] == "DISCONNECTED"
    assert data["is_disconnected"] is True
    assert data["trading_enabled"] is False
    assert data["holdings_freshness"] == "HISTORICAL_DISCONNECTED"
    assert data["available_cash"] == 250000.0
    assert data["total_holdings_count"] > 0

    # Historical holdings endpoint also remains accessible
    holdings_resp = client.get(f"/api/v1/accounts/{account.id}/holdings")
    assert holdings_resp.status_code == 200
    holdings = holdings_resp.json()
    assert len(holdings) > 0


def test_background_scheduler_skips_disconnected_accounts(db_session):
    """The background scheduler skips polling for accounts that are disconnected."""
    from app.services.scheduler_service import background_sync_all_accounts

    accounts = db_session.query(Account).all()
    for acc in accounts:
        acc.is_demo = False
        acc.auth_status = "DISCONNECTED"
    db_session.commit()

    with patch("app.services.smartapi_adapter.SmartAPIAdapter") as MockAdapter:
        result = background_sync_all_accounts(db_session)
        assert MockAdapter.call_count == 0
        assert result.get("synced_count", 0) == 0


# ============================================================================
# PHASE 5: FULL CREDENTIAL RECONNECTION & SIX-DIGIT OTP REJECTION
# ============================================================================

def test_reconnect_rejects_temporary_six_digit_otp(client, db_session):
    """Reconnection endpoint rejects temporary 6-digit OTPs."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    db_session.commit()

    payload = {
        "client_code": account.client_code,
        "totp_secret": "123456",  # 6-digit OTP
        "pin": "1234",
        "api_key": "VALID_API_KEY",
    }
    response = client.post(f"/api/v1/accounts/{account.id}/reconnect", json=payload)
    assert response.status_code == 400
    assert "6-digit OTP is not accepted" in response.json()["detail"]


def test_reconnect_succeeds_with_valid_full_credentials(client, db_session):
    """Reconnection succeeds with valid credentials and updates connection state."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    db_session.commit()

    payload = {
        "client_code": account.client_code,
        "api_key": "NEW_API_KEY",
        "pin": "9999",
        "totp_secret": "JBSWY3DPEHPK3PXP",  # Valid Base32
    }

    mock_auth = {"success": True, "message": "Authentication successful", "feed_token": "FEED_123"}
    mock_rms = {"availablecash": 300000.0, "net": 300000.0}

    with patch("app.api.endpoints_accounts.get_adapter_for_account") as mock_get_adapter:
        mock_adapter = MagicMock()
        mock_adapter.authenticate.return_value = mock_auth
        mock_adapter.get_rms.return_value = mock_rms
        mock_adapter.get_holdings.return_value = []
        mock_get_adapter.return_value = mock_adapter

        response = client.post(f"/api/v1/accounts/{account.id}/reconnect", json=payload)
        assert response.status_code == 200
        body = response.json()
        assert body["auth_status"] == "CONNECTED"


# ============================================================================
# PHASE 6: AUTHORIZED SHARED MARKET DATA ACROSS ACCOUNTS
# ============================================================================

def test_shared_market_data_for_disconnected_account(client, db_session):
    """
    When Client A is disconnected and Client B is connected:
    - Client A's holdings request uses Client B's active market adapter to fetch live LTP.
    - Client A's saved quantities and average costs remain unchanged.
    - Price source is marked AUTHORIZED_SHARED_MARKET_FEED.
    - Client B's private account details are never merged into Client A's response.
    """
    accounts = db_session.query(Account).all()
    client_a = accounts[0]
    client_b = accounts[1]

    # Set Client A to DISCONNECTED
    client_a.is_demo = False
    client_a.auth_status = "DISCONNECTED"
    # Set Client B to CONNECTED (live Demat, not demo)
    client_b.is_demo = False
    client_b.auth_status = "CONNECTED"
    db_session.commit()

    # Client A has an allotment of TATATECH (30 qty at 500.0)
    allotment = db_session.query(Allotment).filter_by(account_id=client_a.id).first()
    assert allotment is not None
    original_qty = allotment.allotted_quantity
    original_cost = allotment.acquisition_cost

    with patch("app.services.smartapi_adapter.SmartAPIAdapter._ensure_authenticated", return_value=True), \
         patch("app.services.smartapi_adapter.SmartAPIAdapter.get_ltp_data", return_value=1088.50):

        response = client.get(f"/api/v1/accounts/{client_a.id}/holdings")
        assert response.status_code == 200
        holdings = response.json()
        assert len(holdings) > 0

        tatatech_holding = next((h for h in holdings if h["symbol"] == "TATATECH"), None)
        assert tatatech_holding is not None

        # 1. Saved quantity and cost must remain unchanged
        assert tatatech_holding["quantity"] == original_qty
        assert tatatech_holding["average_price"] == original_cost

        # 2. Live market price from authorized shared feed is reflected
        assert tatatech_holding["current_ltp"] == 1088.50
        assert tatatech_holding["price_source"] == "AUTHORIZED_SHARED_MARKET_FEED"
        assert tatatech_holding["is_market_price_live"] is True
        assert tatatech_holding["holdings_status"] == "HISTORICAL"

        # 3. Market value is computed accurately (30 * 1088.50 = 32655.0)
        assert tatatech_holding["valuation"] == 30 * 1088.50

        # 4. Verify Client A's database record was NOT mutated
        db_session.refresh(allotment)
        assert allotment.allotted_quantity == original_qty
        assert allotment.acquisition_cost == original_cost


def test_shared_market_data_fallback_when_no_active_client(client, db_session):
    """
    When all clients are disconnected:
    - Holdings fall back to saved/stale ledger price.
    - price_source is marked HISTORICAL_STALE.
    - is_market_price_live is False.
    """
    accounts = db_session.query(Account).all()
    for acc in accounts:
        acc.is_demo = False
        acc.auth_status = "DISCONNECTED"
    db_session.commit()

    client_a = accounts[0]
    response = client.get(f"/api/v1/accounts/{client_a.id}/holdings")
    assert response.status_code == 200
    holdings = response.json()
    assert len(holdings) > 0

    for h in holdings:
        assert h["holdings_status"] == "HISTORICAL"
        assert h["price_source"] == "HISTORICAL_STALE"
        assert h["is_market_price_live"] is False


# ============================================================================
# PHASE 7: RECONNECTION PRESERVES HISTORICAL SNAPSHOTS & ALLOTMENTS
# ============================================================================

def test_reconnection_preserves_historical_allotments(client, db_session):
    """Reconnection reconciles data without erasing historical allotments or transactions."""
    account = db_session.query(Account).first()
    allotments_before = db_session.query(Allotment).filter_by(account_id=account.id).count()
    assert allotments_before > 0

    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    db_session.commit()

    payload = {
        "client_code": account.client_code,
        "api_key": "RECONNECT_KEY",
        "pin": "1234",
        "totp_secret": "JBSWY3DPEHPK3PXP",
    }

    mock_auth = {"success": True, "message": "Authentication successful", "feed_token": "FEED_123"}
    mock_rms = {"availablecash": 250000.0, "net": 250000.0}

    with patch("app.api.endpoints_accounts.get_adapter_for_account") as mock_get_adapter:
        mock_adapter = MagicMock()
        mock_adapter.authenticate.return_value = mock_auth
        mock_adapter.get_rms.return_value = mock_rms
        mock_adapter.get_holdings.return_value = []
        mock_get_adapter.return_value = mock_adapter

        resp = client.post(f"/api/v1/accounts/{account.id}/reconnect", json=payload)
        assert resp.status_code == 200

        # Verify historical allotments were preserved
        allotments_after = db_session.query(Allotment).filter_by(account_id=account.id).count()
        assert allotments_after == allotments_before
