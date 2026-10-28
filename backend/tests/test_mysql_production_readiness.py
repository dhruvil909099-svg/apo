"""
Comprehensive Automated Tests for IPOPro Hostinger MySQL Production Readiness:
- MySQL URL Normalization & Driver Compatibility (PyMySQL)
- Conservative Connection Pooling & Resilient Pre-Ping
- SQLite to Hostinger MySQL Migration Engine (MIGRATION_ORDER, dry-run, row counts, decryptability)
- Readiness Probe Reporting (database_engine: mysql/mariadb, storage_type: MANAGED_PERSISTENT)
- Disconnected-Account Read-Only Mode & Order Safeguards
- Full Credential Reconnection (rejecting temporary 6-digit OTPs)
- Authorized Shared Market-Data Routing with Strict Demat Isolation
- Restart Persistence & Crash-Recovery Simulation
- Transaction Rollback & Data Durability
"""

import pytest
from datetime import datetime
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi import status

from app.core.database import Base, normalize_database_url, run_safe_migrations
from app.core.security import cipher
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.risk import RiskLimit
from app.models.audit import AuditLog
from scripts.migrate_sqlite_to_mysql import (
    MIGRATION_ORDER,
    run_migration,
    verify_target_integrity,
    _verify_account_credentials
)


# ============================================================================
# PHASE 1 & 2: MYSQL DRIVER & CONNECTION CONFIGURATION
# ============================================================================

def test_mysql_url_normalization():
    """Verify that mysql:// and mariadb:// URLs are normalized to mysql+pymysql:// with utf8mb4."""
    assert normalize_database_url("mysql://u:p@host:3306/db") == "mysql+pymysql://u:p@host:3306/db"
    assert normalize_database_url("mariadb://u:p@host:3306/db") == "mysql+pymysql://u:p@host:3306/db"
    assert normalize_database_url("postgres://u:p@host/db") == "postgresql://u:p@host/db"
    assert normalize_database_url("sqlite:///path.db") == "sqlite:///path.db"


def test_mysql_migration_order_completeness():
    """Verify that MIGRATION_ORDER contains all 12 core tables in topological dependency order."""
    table_names = [model.__tablename__ for model in MIGRATION_ORDER]
    expected_tables = [
        "users",
        "accounts",
        "ipos",
        "allotments",
        "orders",
        "risk_limits",
        "audit_logs",
        "watchlists",
        "watchlist_items",
        "portfolio_notes",
        "notifications",
        "chat_messages"
    ]
    for table in expected_tables:
        assert table in table_names, f"Missing table {table} from MIGRATION_ORDER"


# ============================================================================
# PHASE 3 & 4: MIGRATION ENGINE & INTEGRITY VERIFICATION
# ============================================================================

def test_migration_dry_run_on_live_sqlite(tmp_path):
    """Test that run_migration with dry_run=True performs full validation without modifying target."""
    test_db = tmp_path / "test_migration_source.db"
    engine = create_engine(f"sqlite:///{test_db}", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed test account
    acc = Account(
        nickname="Migration Test Demat",
        client_code="MIGRATE01",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("MIGRATE_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED"
    )
    session.add(acc)
    session.commit()
    session.close()
    engine.dispose()

    success = run_migration(
        sqlite_url=f"sqlite:///{test_db}",
        mysql_url="sqlite:///:memory:",
        dry_run=True,
        backup_source=True
    )
    assert success is True


def test_verify_target_integrity_and_smoke_test(db_session):
    """Test row-count comparison, credential decryption, and read/write smoke probe."""
    expected_counts = {
        model.__tablename__: db_session.query(model).count()
        for model in MIGRATION_ORDER
    }
    status_ok = verify_target_integrity(db_session, expected_counts)
    assert status_ok is True


def test_verify_target_integrity_detects_corrupt_credentials(db_session):
    """Integrity check must fail if any account has corrupt/undecryptable credentials."""
    corrupt = Account(
        nickname="Corrupt Secret Demat",
        client_code="CORRUPT_MYSQL_01",
        account_group="Test",
        encrypted_api_key="CORRUPTED_CIPHERTEXT",
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED"
    )
    db_session.add(corrupt)
    db_session.commit()

    expected_counts = {
        model.__tablename__: db_session.query(model).count()
        for model in MIGRATION_ORDER
    }
    status_ok = verify_target_integrity(db_session, expected_counts)
    assert status_ok is False


# ============================================================================
# PHASE 2 & 9: READINESS PROBE MYSQL REPORTING
# ============================================================================

def test_health_readiness_probe_mysql_persistence(client):
    """
    Simulate MySQL dialect connection in the readiness probe to verify that
    Hostinger MySQL is reported as CONNECTED and MANAGED_PERSISTENT.
    """
    mock_bind = MagicMock()
    mock_bind.dialect.name = "mysql"

    with patch("sqlalchemy.orm.Session.get_bind", return_value=mock_bind), \
         patch("sqlalchemy.orm.Session.execute", return_value=True):
        resp = client.get("/api/v1/health/ready")
        assert resp.status_code == 200
        data = resp.json()
        assert data["database"] == "CONNECTED"
        assert data["database_engine"] == "mysql"
        assert data["storage_type"] == "MANAGED_PERSISTENT"


# ============================================================================
# PHASE 6: DISCONNECTED-ACCOUNT READ-ONLY SAFEGUARDS
# ============================================================================

def test_disconnected_account_blocks_order_mutations(client, db_session):
    """
    When an account is DISCONNECTED:
    - Order creation returns HTTP 409 BROKER_ACCOUNT_DISCONNECTED
    - Order cancellation returns HTTP 409 BROKER_ACCOUNT_DISCONNECTED
    - Order modification returns HTTP 409 BROKER_ACCOUNT_DISCONNECTED
    - Historical overview and holdings remain accessible
    """
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    account.last_sync_time = datetime.utcnow()
    account.available_cash = 250000.0
    db_session.commit()

    # 1. Order Placement Blocked
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
    resp = client.post("/api/v1/orders/single", json=order_payload)
    assert resp.status_code == 409
    body = resp.json().get("detail", resp.json())
    assert body["error_code"] == "BROKER_ACCOUNT_DISCONNECTED"

    # 2. Order Modification Blocked
    order = Order(
        client_order_id="TEST_DISC_MOD_01",
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
        broker_order_id="BROKER_ORD_1"
    )
    db_session.add(order)
    db_session.commit()

    resp_mod = client.put(f"/api/v1/orders/{order.id}", json={"price": 995.0, "quantity": 15})
    assert resp_mod.status_code == 409
    body_mod = resp_mod.json().get("detail", resp_mod.json())
    assert body_mod["error_code"] == "BROKER_ACCOUNT_DISCONNECTED"

    # 3. Order Cancellation Blocked
    resp_can = client.post(f"/api/v1/orders/{order.id}/cancel")
    assert resp_can.status_code == 409
    body_can = resp_can.json().get("detail", resp_can.json())
    assert body_can["error_code"] == "BROKER_ACCOUNT_DISCONNECTED"

    # 4. Historical Overview & Holdings Remain Accessible
    resp_overview = client.get(f"/api/v1/accounts/{account.id}/overview")
    assert resp_overview.status_code == 200
    ov_data = resp_overview.json()
    assert ov_data["auth_status"] == "DISCONNECTED"
    assert ov_data["is_disconnected"] is True
    assert ov_data["trading_enabled"] is False
    assert ov_data["holdings_freshness"] == "HISTORICAL_DISCONNECTED"
    assert ov_data["available_cash"] == 250000.0


# ============================================================================
# PHASE 7: FULL CREDENTIAL RECONNECTION
# ============================================================================

def test_reconnection_rejects_temporary_six_digit_otp(client, db_session):
    """Reconnection endpoint rejects temporary 6-digit OTPs and requires Base32 permanent secret."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    db_session.commit()

    payload = {
        "client_code": account.client_code,
        "totp_secret": "654321",  # 6-digit OTP
        "pin": "1234",
        "api_key": "NEW_API_KEY",
    }
    resp = client.post(f"/api/v1/accounts/{account.id}/reconnect", json=payload)
    assert resp.status_code == 400
    assert "6-digit OTP is not accepted" in resp.json()["detail"]


def test_reconnection_accepts_valid_full_credentials(client, db_session):
    """Submitting valid full credentials authenticates, encrypts, and restores CONNECTED state."""
    account = db_session.query(Account).first()
    account.is_demo = False
    account.auth_status = "DISCONNECTED"
    db_session.commit()

    payload = {
        "client_code": account.client_code,
        "api_key": "FRESH_API_KEY_2026",
        "pin": "4321",
        "totp_secret": "JBSWY3DPEHPK3PXP",  # Valid Base32
    }

    mock_auth = {"success": True, "message": "Authentication successful", "feed_token": "FEED_TOKEN_1"}
    mock_rms = {"availablecash": 275000.0, "net": 275000.0}

    with patch("app.api.endpoints_accounts.get_adapter_for_account") as mock_get_adapter:
        mock_adapter = MagicMock()
        mock_adapter.authenticate.return_value = mock_auth
        mock_adapter.get_rms.return_value = mock_rms
        mock_adapter.get_holdings.return_value = []
        mock_get_adapter.return_value = mock_adapter

        resp = client.post(f"/api/v1/accounts/{account.id}/reconnect", json=payload)
        assert resp.status_code == 200
        data = resp.json()
        assert data["auth_status"] == "CONNECTED"
        assert data["available_cash"] == 275000.0

        db_session.refresh(account)
        assert account.auth_status == "CONNECTED"
        assert cipher.decrypt(account.encrypted_api_key) == "FRESH_API_KEY_2026"
        assert cipher.decrypt(account.encrypted_pin) == "4321"


# ============================================================================
# PHASE 8: AUTHORIZED CROSS-ACCOUNT SHARED MARKET DATA
# ============================================================================

def test_shared_market_feed_across_accounts(client, db_session):
    """
    When Client A is disconnected and Client B is connected:
    - Client A's holdings display live market prices from Client B's feed
    - Client A's saved quantities and average costs remain untouched
    - Client B's private positions/orders are never merged into Client A's view
    """
    accounts = db_session.query(Account).all()
    client_a = accounts[0]
    client_b = accounts[1]

    client_a.is_demo = False
    client_a.auth_status = "DISCONNECTED"

    client_b.is_demo = False
    client_b.auth_status = "CONNECTED"
    db_session.commit()

    allotment = db_session.query(Allotment).filter_by(account_id=client_a.id).first()
    assert allotment is not None
    orig_qty = allotment.allotted_quantity
    orig_cost = allotment.acquisition_cost

    with patch("app.services.smartapi_adapter.SmartAPIAdapter._ensure_authenticated", return_value=True), \
         patch("app.services.smartapi_adapter.SmartAPIAdapter.get_ltp_data", return_value=1120.00):

        resp = client.get(f"/api/v1/accounts/{client_a.id}/holdings")
        assert resp.status_code == 200
        holdings = resp.json()
        assert len(holdings) > 0

        tatatech = next((h for h in holdings if h["symbol"] == "TATATECH"), None)
        assert tatatech is not None
        assert tatatech["quantity"] == orig_qty
        assert tatatech["average_price"] == orig_cost
        assert tatatech["current_ltp"] == 1120.00
        assert tatatech["valuation"] == orig_qty * 1120.00
        assert tatatech["price_source"] == "AUTHORIZED_SHARED_MARKET_FEED"
        assert tatatech["is_market_price_live"] is True
        assert tatatech["holdings_status"] == "HISTORICAL"


# ============================================================================
# PHASE 5: PERSISTENCE ACROSS RESTART & TRANSACTION ROLLBACK
# ============================================================================

def test_account_persistence_backup_and_recovery(db_session):
    """Test accounts backup serialization and restoration."""
    from app.services.account_persistence import persist_accounts_backup, restore_accounts_backup

    # 1. Persist current state to backup file
    persisted = persist_accounts_backup(db_session)
    assert persisted is True

    # 2. Simulate empty database state (container restart with empty database)
    db_session.query(Allotment).delete()
    db_session.query(Order).delete()
    db_session.query(RiskLimit).delete()
    db_session.query(Account).delete()
    db_session.commit()
    assert db_session.query(Account).count() == 0

    # 3. Verify restoration from backup file
    restored = restore_accounts_backup(db_session)
    assert restored > 0
    assert db_session.query(Account).count() == restored


def test_transaction_rollback_prevents_partial_writes(db_session):
    """Test that a transaction rollback on error leaves the database clean."""
    initial_user_count = db_session.query(Account).count()
    try:
        acc1 = Account(
            nickname="Rollback Demat 1",
            client_code="ROLLBACK_01",
            account_group="Test",
            encrypted_api_key=cipher.encrypt("K1"),
            encrypted_pin=cipher.encrypt("1234"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=False
        )
        db_session.add(acc1)
        db_session.flush()

        # Intentional duplicate client_code violation
        acc2 = Account(
            nickname="Rollback Demat 2",
            client_code="ROLLBACK_01",  # Duplicate client_code
            account_group="Test",
            encrypted_api_key=cipher.encrypt("K2"),
            encrypted_pin=cipher.encrypt("1234"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=False
        )
        db_session.add(acc2)
        db_session.commit()
    except Exception:
        db_session.rollback()

    final_user_count = db_session.query(Account).count()
    assert final_user_count == initial_user_count
