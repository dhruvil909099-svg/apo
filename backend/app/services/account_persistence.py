import os
import json
import logging
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.models.account import Account
from app.core.security import cipher

logger = logging.getLogger("account_persistence")

DATA_DIR = os.environ.get("PERSISTENT_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data"))
BACKUP_FILE_PATH = os.path.join(DATA_DIR, "accounts_backup.json")


def persist_accounts_backup(db: Session) -> bool:
    """
    Saves an encrypted snapshot of registered accounts to disk so they survive
    container restarts or redeploys on ephemeral hosts (like Render).
    """
    try:
        os.makedirs(os.path.dirname(BACKUP_FILE_PATH), exist_ok=True)
        accounts = db.query(Account).all()
        data = []
        for acc in accounts:
            data.append({
                "nickname": acc.nickname,
                "client_code": acc.client_code,
                "account_group": acc.account_group,
                "encrypted_api_key": acc.encrypted_api_key,
                "encrypted_pin": acc.encrypted_pin,
                "encrypted_totp_secret": acc.encrypted_totp_secret,
                "is_enabled": acc.is_enabled,
                "is_demo": acc.is_demo,
                "auth_status": acc.auth_status,
                "ddpi_status": acc.ddpi_status,
                "edis_authorized_today": acc.edis_authorized_today,
                "available_cash": acc.available_cash
            })

        with open(BACKUP_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        logger.info(f"Persisted {len(data)} accounts to backup storage at {BACKUP_FILE_PATH}")
        return True
    except Exception as e:
        logger.error(f"Failed to persist accounts backup: {str(e)}")
        return False


def restore_accounts_backup(db: Session) -> int:
    """
    Restores accounts into the database if the database is empty (e.g. fresh container on Render).
    If no backup file exists, seeds the default verified account 'dhruvil' (AAAD986778).
    """
    if db.query(Account).count() > 0:
        return 0

    restored_count = 0
    if os.path.exists(BACKUP_FILE_PATH):
        try:
            with open(BACKUP_FILE_PATH, "r", encoding="utf-8") as f:
                records = json.load(f)

            for item in records:
                existing = db.query(Account).filter(Account.client_code == item["client_code"]).first()
                if not existing:
                    acc = Account(
                        nickname=item["nickname"],
                        client_code=item["client_code"],
                        account_group=item.get("account_group", "Family"),
                        encrypted_api_key=item["encrypted_api_key"],
                        encrypted_pin=item["encrypted_pin"],
                        encrypted_totp_secret=item["encrypted_totp_secret"],
                        is_enabled=item.get("is_enabled", True),
                        is_demo=item.get("is_demo", False),
                        auth_status=item.get("auth_status", "DISCONNECTED"),
                        ddpi_status=item.get("ddpi_status", "ACTIVE"),
                        edis_authorized_today=item.get("edis_authorized_today", False),
                        available_cash=item.get("available_cash", 0.0)
                    )
                    db.add(acc)
                    restored_count += 1

            db.commit()
            if restored_count > 0:
                logger.info(f"Restored {restored_count} accounts from backup file.")
        except Exception as e:
            logger.error(f"Error restoring accounts from backup file: {str(e)}")

    # Always guarantee primary production account 'dhruvil' (AAAD986778) exists
    primary_acc = db.query(Account).filter(Account.client_code == "AAAD986778").first()
    if not primary_acc:
        logger.info("Ensuring primary production account 'dhruvil' (AAAD986778) is present...")
        primary_account = Account(
            nickname="dhruvil",
            client_code="AAAD986778",
            account_group="Family",
            encrypted_api_key=cipher.encrypt("AUTO_RESTORED_KEY"),
            encrypted_pin=cipher.encrypt("8887"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=False,
            auth_status="DISCONNECTED",
            ddpi_status="ACTIVE",
            edis_authorized_today=False,
            available_cash=0.0
        )
        db.add(primary_account)
        db.commit()
        restored_count += 1
        persist_accounts_backup(db)
        logger.info("Primary production account 'dhruvil' successfully verified/seeded.")

    return restored_count
