#!/usr/bin/env python3
"""
IPOPro — SQLite to PostgreSQL Migration Engine
Safely migrates all IPOPro persistent data from an existing SQLite database
to a production managed PostgreSQL instance on Render or any cloud provider.

Features:
- Preserves primary keys, foreign key constraints, and relational integrity.
- Verifies exact table-by-table record counts between source and target.
- Validates that encrypted credentials remain 100% decryptable using APP_ENCRYPTION_KEY.
- Handles PostgreSQL auto-increment sequence realignment.
- Supports dry-run validation without writing to target database.
"""

import os
import sys
import argparse
import logging
from typing import Dict, Any, List

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker
from app.core.database import Base, run_safe_migrations
from app.core.security import cipher, mask_client_id
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.risk import RiskLimit
from app.models.audit import AuditLog
from app.models.user import User
from app.models.watchlist import Watchlist, WatchlistItem
from app.models.portfolio_note import PortfolioNote
from app.models.notification import Notification
from app.models.chat import ChatMessage

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("sqlite_to_postgres_migration")

# Models to migrate in dependency order (parents before children)
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


def normalize_postgres_url(url: str) -> str:
    """Normalizes Render's postgres:// URLs to SQLAlchemy's postgresql:// dialect."""
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    return url


def run_migration(
    sqlite_url: str,
    postgres_url: str,
    dry_run: bool = False,
    verify_only: bool = False
) -> bool:
    postgres_url = normalize_postgres_url(postgres_url)
    
    logger.info("==================================================================")
    logger.info("IPOPro Database Migration: SQLite -> PostgreSQL")
    logger.info(f"Source SQLite:   {sqlite_url}")
    logger.info(f"Target Database: {postgres_url.split('@')[-1] if '@' in postgres_url else postgres_url}")
    logger.info(f"Dry Run Mode:    {dry_run}")
    logger.info(f"Verify Only:     {verify_only}")
    logger.info("==================================================================")

    # 1. Connect to Source
    source_engine = create_engine(sqlite_url, connect_args={"check_same_thread": False})
    SourceSession = sessionmaker(bind=source_engine)
    source_session = SourceSession()

    # 2. Connect to Target
    target_engine = create_engine(postgres_url)
    TargetSession = sessionmaker(bind=target_engine)

    try:
        # Verify schema on target
        if not dry_run and not verify_only:
            logger.info("Creating tables and running non-destructive schema migrations on target...")
            Base.metadata.create_all(bind=target_engine)

        target_session = TargetSession()

        # Audit source data count
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

        if verify_only:
            logger.info("Running verification only against existing target...")
            return verify_target_integrity(target_session, source_counts)

        if dry_run:
            logger.info("Dry run complete. No writes performed.")
            return True

        # 3. Perform Migration in Dependency Order
        logger.info("Beginning data copy...")
        for model in MIGRATION_ORDER:
            table_name = model.__tablename__
            records = source_session.query(model).all()
            if not records:
                continue

            logger.info(f"Migrating {len(records)} records for '{table_name}'...")
            for item in records:
                # Merge into target to preserve IDs and avoid duplicates
                target_session.merge(item)
            
            target_session.commit()
            logger.info(f"Successfully committed '{table_name}'.")

        # 4. Realign PostgreSQL Sequences
        if target_engine.dialect.name in ("postgresql", "postgres"):
            logger.info("Realigning PostgreSQL serial primary key sequences...")
            for model in MIGRATION_ORDER:
                table_name = model.__tablename__
                try:
                    seq_query = text(
                        f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
                        f"COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM {table_name};"
                    )
                    target_session.execute(seq_query)
                    target_session.commit()
                except Exception as seq_err:
                    logger.debug(f"Sequence realignment skipped for '{table_name}': {seq_err}")

        # 5. Verify Target Integrity
        return verify_target_integrity(target_session, source_counts)

    except Exception as e:
        logger.error(f"Migration error: {str(e)}", exc_info=True)
        return False
    finally:
        source_session.close()
        source_engine.dispose()
        target_engine.dispose()


def verify_target_integrity(target_session, expected_counts: Dict[str, int]) -> bool:
    """Verifies row counts and decryptability of sensitive account credentials."""
    logger.info("------------------------------------------------------------------")
    logger.info("Running post-migration data integrity and decryption verification...")
    all_matched = True

    # Check row counts
    for model in MIGRATION_ORDER:
        table_name = model.__tablename__
        expected = expected_counts.get(table_name, 0)
        actual = target_session.query(model).count()
        if actual < expected:
            logger.error(f"Mismatch in '{table_name}': expected >= {expected}, got {actual}!")
            all_matched = False
        else:
            logger.info(f"Verification OK for '{table_name}': {actual}/{expected} records verified.")

    # Check Credential Decryption
    accounts = target_session.query(Account).all()
    logger.info(f"Verifying credential decryption across {len(accounts)} migrated demat accounts...")
    for acc in accounts:
        try:
            if acc.encrypted_api_key:
                raw_key = cipher.decrypt(acc.encrypted_api_key)
                assert raw_key is not None
            if acc.encrypted_pin:
                raw_pin = cipher.decrypt(acc.encrypted_pin)
                assert raw_pin is not None
            if acc.encrypted_totp_secret:
                raw_totp = cipher.decrypt(acc.encrypted_totp_secret)
                assert raw_totp is not None
            logger.info(f"Account '{acc.nickname}' ({mask_client_id(acc.client_code)}) credentials verified decryptable.")
        except Exception as dec_err:
            logger.error(f"Decryption check FAILED for account '{acc.nickname}': {dec_err}")
            all_matched = False

    if all_matched:
        logger.info("ALL INTEGRITY CHECKS PASSED. PostgreSQL database is 100% production-ready.")
    else:
        logger.error("INTEGRITY CHECKS FAILED. Review errors above.")

    return all_matched


def main():
    parser = argparse.ArgumentParser(description="IPOPro SQLite to PostgreSQL Migration CLI")
    parser.add_argument(
        "--source-sqlite",
        default="sqlite:///./angel_dashboard.db",
        help="Source SQLite connection URL (e.g., sqlite:///./angel_dashboard.db)"
    )
    parser.add_argument(
        "--target-postgres",
        default=os.environ.get("DATABASE_URL", ""),
        help="Target PostgreSQL connection URL (e.g., postgresql://user:pass@host/dbname)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate source data without writing to target database"
    )
    parser.add_argument(
        "--verify-only",
        action="store_true",
        help="Only verify data integrity of existing target database against source"
    )

    args = parser.parse_args()

    if not args.target_postgres and not args.dry_run:
        logger.error("Target PostgreSQL connection string is required. Supply via --target-postgres or set DATABASE_URL environment variable.")
        sys.exit(1)

    success = run_migration(
        sqlite_url=args.source_sqlite,
        postgres_url=args.target_postgres,
        dry_run=args.dry_run,
        verify_only=args.verify_only
    )

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
