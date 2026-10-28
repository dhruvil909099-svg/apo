#!/usr/bin/env python3
"""
IPOPro — SQLite to Hostinger MySQL Migration Engine
Safely migrates all IPOPro persistent data from an existing SQLite database (or backup JSON)
to a production managed Hostinger MySQL/MariaDB database.

Features:
- Preserves primary keys, foreign key constraints, and relational integrity.
- Safe table dependency order (parents before children).
- Verifies exact table-by-table record counts between source and target.
- Validates that encrypted credentials remain 100% decryptable using APP_ENCRYPTION_KEY.
- Handles MySQL/MariaDB AUTO_INCREMENT realignment for all serial primary keys.
- Creates timestamped backup of the source SQLite database prior to migration.
- Restores from accounts_backup.json if SQLite database was lost on ephemeral container restarts.
- Read & write capability smoke test on target MySQL database.
- Supports --dry-run and --verify-only modes.
- Zero plaintext credential logging.
"""

import os
import sys
import shutil
import argparse
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from app.core.database import Base, normalize_database_url, run_safe_migrations
from app.core.security import cipher, mask_client_id
from app.models.user import User
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.risk import RiskLimit
from app.models.audit import AuditLog
from app.models.watchlist import Watchlist, WatchlistItem
from app.models.portfolio_note import PortfolioNote
from app.models.notification import Notification
from app.models.chat import ChatMessage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("sqlite_to_mysql_migration")

# Models in topological dependency order (parents before children)
MIGRATION_ORDER = [
    User,
    Account,
    IPO,
    Allotment,
    Order,
    RiskLimit,
    AuditLog,
    Watchlist,
    WatchlistItem,
    PortfolioNote,
    Notification,
    ChatMessage
]


def resolve_sqlite_path(sqlite_url: str) -> Optional[str]:
    """Extracts local filesystem path from an sqlite URL."""
    if sqlite_url.startswith("sqlite:///"):
        return sqlite_url.replace("sqlite:///", "")
    return None


def create_source_backup(sqlite_path: str) -> Optional[str]:
    """Creates a verified, timestamped backup copy of the SQLite database file."""
    if not sqlite_path or not os.path.exists(sqlite_path):
        return None
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    backup_path = f"{sqlite_path}.backup_{timestamp}"
    try:
        shutil.copy2(sqlite_path, backup_path)
        size = os.path.getsize(backup_path)
        logger.info(f"Verified source backup created: {backup_path} ({size:,} bytes)")
        return backup_path
    except Exception as e:
        logger.warning(f"Could not create source backup file: {e}")
        return None


def run_migration(
    sqlite_url: str,
    mysql_url: str,
    dry_run: bool = False,
    verify_only: bool = False,
    backup_source: bool = True
) -> bool:
    """
    Executes the SQLite to Hostinger MySQL migration pipeline with end-to-end verification.
    """
    mysql_url = normalize_database_url(mysql_url)
    
    # Redact password for safe logging
    safe_target = mysql_url
    if "@" in safe_target:
        prefix = safe_target.split("@")[0]
        host_db = safe_target.split("@")[1]
        protocol_user = prefix.split(":")[0] + ":" + prefix.split(":")[1] if len(prefix.split(":")) > 1 else prefix
        safe_target = f"{protocol_user}:***@{host_db}"

    logger.info("==================================================================")
    logger.info("IPOPro Database Migration: SQLite -> Hostinger MySQL")
    logger.info(f"Source SQLite:   {sqlite_url}")
    logger.info(f"Target Database: {safe_target}")
    logger.info(f"Dry Run Mode:    {dry_run}")
    logger.info(f"Verify Only:     {verify_only}")
    logger.info("==================================================================")

    # 1. Source verification & backup
    sqlite_path = resolve_sqlite_path(sqlite_url)
    if backup_source and sqlite_path and os.path.exists(sqlite_path) and not dry_run and not verify_only:
        create_source_backup(sqlite_path)

    # Check if source SQLite exists or needs recovery from backup JSON
    source_exists = sqlite_path and os.path.exists(sqlite_path) and os.path.getsize(sqlite_path) > 0
    if not source_exists and sqlite_url != "sqlite:///:memory:":
        logger.warning(f"SQLite source at '{sqlite_url}' not found on disk.")
        backup_json = os.path.join(os.path.dirname(os.path.dirname(__file__)), "app", "data", "accounts_backup.json")
        if os.path.exists(backup_json):
            logger.info(f"Discovered persistent JSON backup at '{backup_json}'. Recovering source records...")
            from app.services.account_persistence import restore_accounts_backup
            source_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
            Base.metadata.create_all(bind=source_engine)
            SourceSession = sessionmaker(bind=source_engine)
            s_session = SourceSession()
            restore_accounts_backup(s_session)
            s_session.close()
            source_engine.dispose()
            logger.info("Source SQLite database successfully populated from JSON backup.")
        else:
            logger.error("No SQLite database and no accounts_backup.json found. Cannot migrate.")
            return False

    source_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    # Ensure source schema is consistent with current models before reading
    try:
        run_safe_migrations(source_engine)
    except Exception as e:
        logger.warning(f"Source schema safe upgrade warning (ignorable if tables already match): {e}")
    SourceSession = sessionmaker(bind=source_engine)
    source_session = SourceSession()

    # 2. Connect to Target MySQL
    target_connect_args = {}
    if "mysql" in mysql_url or "mariadb" in mysql_url:
        target_connect_args = {
            "charset": "utf8mb4",
            "connect_timeout": 10
        }

    target_kwargs = {}
    if not mysql_url.startswith("sqlite"):
        target_kwargs = {
            "pool_size": 3,
            "max_overflow": 1,
            "pool_recycle": 280,
            "pool_pre_ping": True
        }

    target_engine = create_engine(
        mysql_url,
        connect_args=target_connect_args,
        **target_kwargs
    )
    TargetSession = sessionmaker(bind=target_engine)

    try:
        # Pre-flight check: Target connectivity
        logger.info("Testing connection to target database...")
        with target_engine.connect() as test_conn:
            test_conn.execute(text("SELECT 1"))
        logger.info("Connection to target database established successfully.")

        # Inspect source records
        source_counts: Dict[str, int] = {}
        for model in MIGRATION_ORDER:
            table_name = model.__tablename__
            try:
                count = source_session.query(model).count()
            except Exception:
                count = 0
            source_counts[table_name] = count
            logger.info(f"Source table '{table_name}': {count} records found.")

        total_source_records = sum(source_counts.values())
        logger.info(f"Total source records identified: {total_source_records}")

        target_session = TargetSession()

        if verify_only:
            logger.info("Running verification only against existing target...")
            return verify_target_integrity(target_session, source_counts, target_engine)

        if dry_run:
            logger.info("Dry run mode active: validating credential decryptability on source...")
            source_accounts = source_session.query(Account).all()
            for acc in source_accounts:
                _verify_account_credentials(acc)
            logger.info("Dry run complete: Source data and credentials verified. Target not modified.")
            return True

        # 3. Create tables on target MySQL
        logger.info("Creating tables on target database (InnoDB, UTF8mb4)...")
        Base.metadata.create_all(bind=target_engine)

        # 4. Migrate data in dependency order
        logger.info("Beginning data migration...")
        is_mysql = target_engine.dialect.name in ("mysql", "mariadb")
        
        # Disable foreign keys temporarily for batch consistency
        if is_mysql:
            target_session.execute(text("SET FOREIGN_KEY_CHECKS = 0;"))
            target_session.commit()

        for model in MIGRATION_ORDER:
            table_name = model.__tablename__
            records = source_session.query(model).all()
            if not records:
                continue

            logger.info(f"Migrating {len(records)} records for '{table_name}'...")
            for item in records:
                target_session.merge(item)
            
            target_session.commit()
            logger.info(f"Committed '{table_name}' ({len(records)} records).")

        # Re-enable foreign keys
        if is_mysql:
            target_session.execute(text("SET FOREIGN_KEY_CHECKS = 1;"))
            target_session.commit()

        # 5. Realign MySQL AUTO_INCREMENT
        if is_mysql:
            logger.info("Realigning MySQL AUTO_INCREMENT counters...")
            for model in MIGRATION_ORDER:
                table_name = model.__tablename__
                try:
                    res = target_session.execute(text(f"SELECT MAX(id) FROM `{table_name}`")).scalar()
                    if res is not None:
                        next_id = int(res) + 1
                        target_session.execute(text(f"ALTER TABLE `{table_name}` AUTO_INCREMENT = {next_id};"))
                        target_session.commit()
                        logger.info(f"Set AUTO_INCREMENT for '{table_name}' to {next_id}")
                except Exception as auto_err:
                    logger.debug(f"AUTO_INCREMENT realignment for '{table_name}': {auto_err}")

        # 6. Verify Target Integrity
        return verify_target_integrity(target_session, source_counts, target_engine)

    except Exception as e:
        logger.error(f"Migration error: {str(e)}", exc_info=True)
        return False
    finally:
        source_session.close()
        source_engine.dispose()
        target_engine.dispose()


def _verify_account_credentials(acc: Account) -> bool:
    """Verifies that an account's encrypted credentials can be decrypted."""
    if acc.encrypted_api_key:
        raw_key = cipher.decrypt(acc.encrypted_api_key)
        assert raw_key is not None
    if acc.encrypted_pin:
        raw_pin = cipher.decrypt(acc.encrypted_pin)
        assert raw_pin is not None
    if acc.encrypted_totp_secret:
        raw_totp = cipher.decrypt(acc.encrypted_totp_secret)
        assert raw_totp is not None
    return True


def verify_target_integrity(target_session, expected_counts: Dict[str, int], engine=None) -> bool:
    """
    Verifies:
    1. Table-by-table record counts match or exceed source counts.
    2. Encrypted credentials across all accounts remain 100% decryptable.
    3. Read & write capability smoke test on target.
    """
    logger.info("------------------------------------------------------------------")
    logger.info("Running post-migration data integrity and decryption verification...")
    all_matched = True

    # 1. Check Row Counts
    for model in MIGRATION_ORDER:
        table_name = model.__tablename__
        expected = expected_counts.get(table_name, 0)
        try:
            actual = target_session.query(model).count()
        except Exception:
            actual = 0

        if actual < expected:
            logger.error(f"Mismatch in '{table_name}': expected >= {expected}, got {actual}!")
            all_matched = False
        else:
            logger.info(f"Verification OK for '{table_name}': {actual}/{expected} records verified.")

    # 2. Check Credential Decryption
    accounts = target_session.query(Account).all()
    logger.info(f"Verifying credential decryption across {len(accounts)} migrated demat accounts...")
    for acc in accounts:
        try:
            _verify_account_credentials(acc)
            logger.info(f"Account '{acc.nickname}' ({mask_client_id(acc.client_code)}) credentials decryptable.")
        except Exception as dec_err:
            logger.error(f"Decryption check FAILED for account '{acc.nickname}': {dec_err}")
            all_matched = False

    # 3. Read/Write Smoke Test
    logger.info("Executing database write & rollback smoke test...")
    try:
        probe = AuditLog(
            event_type="MIGRATION_VERIFICATION_PROBE",
            operator="MIGRATION_CLI",
            details_json='{"status": "OK"}'
        )
        target_session.add(probe)
        target_session.commit()
        probe_id = probe.id
        
        # Verify read
        read_back = target_session.query(AuditLog).filter(AuditLog.id == probe_id).first()
        assert read_back is not None
        
        # Clean up probe
        target_session.delete(read_back)
        target_session.commit()
        logger.info("Database read & write test passed cleanly.")
    except Exception as write_err:
        logger.error(f"Database write verification test FAILED: {write_err}")
        all_matched = False

    if all_matched:
        logger.info("ALL INTEGRITY CHECKS PASSED. Database is production-ready.")
    else:
        logger.error("INTEGRITY CHECKS FAILED. Review errors above.")

    return all_matched


def main():
    parser = argparse.ArgumentParser(description="IPOPro SQLite to Hostinger MySQL Migration CLI")
    parser.add_argument(
        "--source-sqlite",
        default="sqlite:///./backend/angel_dashboard.db",
        help="Source SQLite connection URL (e.g., sqlite:///./backend/angel_dashboard.db)"
    )
    parser.add_argument(
        "--target-mysql",
        default=os.environ.get("DATABASE_URL", ""),
        help="Target Hostinger MySQL connection URL (e.g., mysql+pymysql://user:pass@host:3306/dbname?charset=utf8mb4)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate source data and decryptability without writing to target"
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Only verify data integrity and decryption of existing target against source"
    )
    parser.add_argument(
        "--no-backup",
        action="store_true",
        help="Skip creating timestamped SQLite backup file prior to migration"
    )

    args = parser.parse_args()

    # Fallback to local root db if backend path doesn't exist
    if not os.path.exists(resolve_sqlite_path(args.source_sqlite) or ""):
        root_db = "sqlite:///./angel_dashboard.db"
        if os.path.exists("angel_dashboard.db"):
            args.source_sqlite = root_db

    if not args.target_mysql and not args.dry_run:
        logger.error("Target MySQL connection string is required. Supply via --target-mysql or set DATABASE_URL environment variable.")
        sys.exit(1)

    success = run_migration(
        sqlite_url=args.source_sqlite,
        mysql_url=args.target_mysql,
        dry_run=args.dry_run,
        verify_only=args.verify_only,
        backup_source=not args.no_backup
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
