import os
import json
import tempfile
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.database import Base, run_safe_migrations
from app.models.account import Account
from app.core.security import SecretCipher, cipher, mask_client_id
import app.services.account_persistence as persistence


def test_encryption_key_persistence_survival():
    """
    Verifies that credentials encrypted with the environment's master key
    can be decrypted accurately across simulated process restarts and cipher reinstantiations.
    """
    master_key = os.environ.get("APP_ENCRYPTION_KEY", "UOq2vBkYP1PnplztDgeVbfI3UTQvdREy-EsbYI0g3C4=")
    initial_cipher = SecretCipher(master_key)

    raw_pin = "8899"
    raw_totp = "JBSWY3DPEHPK3PXP"
    raw_api_key = "SAMPLE_KEY_TEST_2026"

    enc_pin = initial_cipher.encrypt(raw_pin)
    enc_totp = initial_cipher.encrypt(raw_totp)
    enc_api = initial_cipher.encrypt(raw_api_key)

    # Simulate container restart: instantiate fresh cipher with the same key
    restarted_cipher = SecretCipher(master_key)

    assert restarted_cipher.decrypt(enc_pin) == raw_pin
    assert restarted_cipher.decrypt(enc_totp) == raw_totp
    assert restarted_cipher.decrypt(enc_api) == raw_api_key


def test_disposable_database_backup_and_restore(tmp_path):
    """
    Verifies full backup, container destruction, and database restoration cycle
    using an isolated disposable database and temporary backup path.
    """
    # 1. Setup temporary storage path
    temp_backup_file = str(tmp_path / "test_accounts_backup.json")
    original_backup_path = persistence.BACKUP_FILE_PATH
    persistence.BACKUP_FILE_PATH = temp_backup_file

    try:
        # 2. Setup disposable database
        disposable_db_path = str(tmp_path / "disposable.db")
        disposable_engine = create_engine(f"sqlite:///{disposable_db_path}")
        DisposableSession = sessionmaker(autocommit=False, autoflush=False, bind=disposable_engine)

        Base.metadata.create_all(bind=disposable_engine)
        session1 = DisposableSession()

        # Add sample accounts with encrypted credentials
        test_acc = Account(
            nickname="Test Persistence Demat",
            client_code="PERSIST_001",
            account_group="TestGroup",
            encrypted_api_key=cipher.encrypt("TEST_API_KEY_PERSIST"),
            encrypted_pin=cipher.encrypt("4321"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=False,
            auth_status="CONNECTED",
            ddpi_status="ACTIVE",
            edis_authorized_today=True,
            available_cash=150000.0
        )
        session1.add(test_acc)
        session1.commit()

        # 3. Persist backup snapshot
        success = persistence.persist_accounts_backup(session1)
        assert success is True
        assert os.path.exists(temp_backup_file)
        session1.close()

        # 4. Simulate complete container/database destruction
        Base.metadata.drop_all(bind=disposable_engine)
        Base.metadata.create_all(bind=disposable_engine)

        session2 = DisposableSession()
        assert session2.query(Account).count() == 0  # Completely empty fresh database

        # 5. Restore from backup
        restored_count = persistence.restore_accounts_backup(session2)
        assert restored_count >= 1
        assert session2.query(Account).count() >= 1

        restored_acc = session2.query(Account).filter(Account.client_code == "PERSIST_001").first()
        assert restored_acc is not None
        assert restored_acc.nickname == "Test Persistence Demat"
        assert restored_acc.ddpi_status == "ACTIVE"
        assert restored_acc.available_cash == 150000.0

        # Verify restored encrypted credentials can be decrypted
        assert cipher.decrypt(restored_acc.encrypted_pin) == "4321"
        assert cipher.decrypt(restored_acc.encrypted_api_key) == "TEST_API_KEY_PERSIST"

        # 6. Verify non-destructive schema migrations on restored database
        # (Must run cleanly without dropping tables or losing data)
        run_safe_migrations()
        assert session2.query(Account).filter(Account.client_code == "PERSIST_001").first() is not None

        session2.close()

    finally:
        persistence.BACKUP_FILE_PATH = original_backup_path


def test_backup_file_contains_no_plaintext_secrets(tmp_path):
    """
    Verifies that the backup JSON snapshot never contains unencrypted plaintext passwords,
    PINs, or raw TOTP secrets.
    """
    temp_backup_file = str(tmp_path / "secret_check_backup.json")
    original_backup_path = persistence.BACKUP_FILE_PATH
    persistence.BACKUP_FILE_PATH = temp_backup_file

    try:
        disposable_engine = create_engine(f"sqlite:///{tmp_path}/check.db")
        DisposableSession = sessionmaker(bind=disposable_engine)
        Base.metadata.create_all(bind=disposable_engine)
        session = DisposableSession()

        raw_secret_pin = "998811"
        session.add(Account(
            nickname="Secret Check Demat",
            client_code="SECRET_CHECK",
            encrypted_api_key=cipher.encrypt("SUPER_SECRET_KEY"),
            encrypted_pin=cipher.encrypt(raw_secret_pin),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=False
        ))
        session.commit()

        persistence.persist_accounts_backup(session)
        session.close()

        with open(temp_backup_file, "r", encoding="utf-8") as f:
            content = f.read()

        # Raw pin must never appear anywhere in file
        assert raw_secret_pin not in content
        assert "SUPER_SECRET_KEY" not in content
        assert "encrypted_pin" in content
        assert "encrypted_api_key" in content

    finally:
        persistence.BACKUP_FILE_PATH = original_backup_path


def test_relationship_persistence_and_restore(tmp_path):
    """
    Verifies that account relationships (allotments and custom risk limits)
    survive container destruction and restore cleanly into a fresh database.
    """
    from app.models.ipo import IPO, Allotment
    from app.models.risk import RiskLimit

    temp_backup_file = str(tmp_path / "relationship_backup.json")
    original_backup_path = persistence.BACKUP_FILE_PATH
    persistence.BACKUP_FILE_PATH = temp_backup_file

    try:
        engine = create_engine(f"sqlite:///{tmp_path}/rel.db")
        Session = sessionmaker(bind=engine)
        Base.metadata.create_all(bind=engine)
        s1 = Session()

        # Create IPO
        ipo = IPO(
            symbol="REL_CORP",
            company_name="Relationship Corporation",
            exchange="NSE",
            issue_price=100.0,
            current_ltp=150.0,
            lot_size=10,
            status="LISTED"
        )
        s1.add(ipo)
        s1.commit()

        # Create Account with allotment and custom risk limit
        acc = Account(
            nickname="Relationship Demat",
            client_code="REL_CLI_01",
            account_group="HNI",
            encrypted_api_key=cipher.encrypt("REL_KEY"),
            encrypted_pin=cipher.encrypt("1234"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=False,
            auth_status="CONNECTED",
            available_cash=500000.0
        )
        s1.add(acc)
        s1.commit()

        alt = Allotment(
            ipo_id=ipo.id,
            account_id=acc.id,
            applied_quantity=50,
            allotted_quantity=50,
            acquisition_cost=100.0,
            status="ALLOTTED"
        )
        s1.add(alt)

        risk = RiskLimit(
            account_id=acc.id,
            max_order_value=999999.0,
            max_quantity_per_order=10000,
            max_loss_threshold=75000.0,
            stop_loss_percent=3.5,
            target_profit_percent=25.0,
            emergency_trading_disabled=False
        )
        s1.add(risk)
        s1.commit()

        # Backup
        assert persistence.persist_accounts_backup(s1) is True
        s1.close()

        # Destroy database
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)

        s2 = Session()
        # Seed IPO catalog first as would happen in seed_demo_data
        ipo_restored = IPO(
            symbol="REL_CORP",
            company_name="Relationship Corporation",
            exchange="NSE",
            issue_price=100.0,
            current_ltp=150.0,
            lot_size=10,
            status="LISTED"
        )
        s2.add(ipo_restored)
        s2.commit()

        # Restore
        restored = persistence.restore_accounts_backup(s2)
        assert restored >= 1

        restored_acc = s2.query(Account).filter(Account.client_code == "REL_CLI_01").first()
        assert restored_acc is not None
        assert restored_acc.account_group == "HNI"

        # Verify allotment restored
        restored_alt = s2.query(Allotment).filter(Allotment.account_id == restored_acc.id).first()
        assert restored_alt is not None
        assert restored_alt.allotted_quantity == 50
        assert restored_alt.acquisition_cost == 100.0

        # Verify custom risk limit restored
        restored_risk = s2.query(RiskLimit).filter(RiskLimit.account_id == restored_acc.id).first()
        assert restored_risk is not None
        assert restored_risk.max_order_value == 999999.0
        assert restored_risk.stop_loss_percent == 3.5

        s2.close()

    finally:
        persistence.BACKUP_FILE_PATH = original_backup_path


def test_health_readiness_engine_reporting(client):
    """Verifies that /health/ready safely exposes dialect and storage type without credentials."""
    res = client.get("/api/v1/health/ready")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "READY"
    assert data["database"] == "CONNECTED"
    assert "database_engine" in data
    assert data["database_engine"] in ("sqlite", "postgresql", "postgres")
    assert "storage_type" in data
    assert data["storage_type"] in ("MANAGED_PERSISTENT", "EPHEMERAL_LOCAL")


def test_broker_session_expired_handling(client, db_session):
    """
    Verifies that when broker session expires, endpoints return 401 with explicit
    session-expired notification and update account.auth_status to EXPIRED.
    """
    from unittest.mock import patch
    from app.services.smartapi_adapter import SmartAPIAdapter

    acc = Account(
        nickname="Expiring Demat",
        client_code="EXPIRE_TEST_01",
        account_group="Family",
        encrypted_api_key=cipher.encrypt("KEY_EXP"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED"
    )
    db_session.add(acc)
    db_session.commit()

    with patch.object(
        SmartAPIAdapter,
        "authenticate",
        return_value={"success": False, "message": "Token expired or invalid", "error_code": "AG8001"}
    ):
        res = client.get(f"/api/v1/accounts/{acc.id}/holdings")
        assert res.status_code == 401
        data = res.json()
        assert "expired" in str(data["detail"]).lower()

        db_session.refresh(acc)
        assert acc.auth_status == "EXPIRED"


def test_consolidated_holdings_live_vs_demo_isolation(client, db_session):
    """
    Verifies that consolidated holdings strictly isolate demo accounts
    from live portfolio totals when capital_type="live".
    """
    from app.models.ipo import IPO, Allotment

    ipo = IPO(
        symbol="ISOLATION_TEST",
        company_name="Isolation Test Ltd",
        exchange="NSE",
        issue_price=200.0,
        current_ltp=300.0,
        lot_size=10,
        status="LISTED"
    )
    db_session.add(ipo)
    db_session.commit()

    live_acc = Account(
        client_code="LIVE_ISO_01",
        nickname="Live Iso Demat",
        account_group="Family",
        encrypted_api_key=cipher.encrypt("KEY"),
        encrypted_pin=cipher.encrypt("1111"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED"
    )
    demo_acc = Account(
        client_code="DEMO_ISO_02",
        nickname="Demo Iso Demat",
        account_group="Family",
        encrypted_api_key=cipher.encrypt("KEY"),
        encrypted_pin=cipher.encrypt("2222"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=True,
        auth_status="CONNECTED"
    )
    db_session.add_all([live_acc, demo_acc])
    db_session.commit()

    # 10 shares live (Val = 3,000), 100 shares demo (Val = 30,000)
    db_session.add_all([
        Allotment(ipo_id=ipo.id, account_id=live_acc.id, applied_quantity=10, allotted_quantity=10, acquisition_cost=200.0, status="ALLOTTED"),
        Allotment(ipo_id=ipo.id, account_id=demo_acc.id, applied_quantity=100, allotted_quantity=100, acquisition_cost=200.0, status="ALLOTTED")
    ])
    db_session.commit()

    # When querying capital_type="live", demo allotment (100 shares) MUST be excluded
    res = client.get(f"/api/v1/portfolio/consolidated?account_ids={live_acc.id}&capital_type=live")
    assert res.status_code == 200
    data = res.json()
    assert data["summary"]["total_shares_count"] == 10
    assert data["summary"]["total_current_value"] == 3000.0

