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
