import os
import json
import logging
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.risk import RiskLimit
from app.core.security import cipher

from datetime import datetime
from app.core.config import settings
from app.core.security import cipher, normalize_base32_secret

logger = logging.getLogger("account_persistence")

DATA_DIR = os.environ.get("PERSISTENT_DATA_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data"))
BACKUP_FILE_PATH = os.path.join(DATA_DIR, "accounts_backup.json")


def persist_accounts_backup(db: Session) -> bool:
    """
    Saves an encrypted snapshot of registered accounts and their essential
    relationships (demat allotments and risk settings) to disk so they survive
    container restarts or redeploys on ephemeral hosts.
    """
    try:
        os.makedirs(os.path.dirname(BACKUP_FILE_PATH), exist_ok=True)
        accounts = db.query(Account).all()
        data = []
        for acc in accounts:
            allotment_records = []
            for a in acc.allotments:
                if a.allotted_quantity > 0 and a.ipo:
                    allotment_records.append({
                        "symbol": a.ipo.symbol,
                        "allotted_quantity": a.allotted_quantity,
                        "applied_quantity": a.applied_quantity,
                        "acquisition_cost": a.acquisition_cost,
                        "allotment_status": a.allotment_status,
                        "demat_credit_status": a.demat_credit_status,
                        "status": a.status,
                    })

            risk = db.query(RiskLimit).filter(RiskLimit.account_id == acc.id).first()
            risk_data = None
            if risk:
                risk_data = {
                    "max_order_value": risk.max_order_value,
                    "max_quantity_per_order": risk.max_quantity_per_order,
                    "max_loss_threshold": risk.max_loss_threshold,
                    "stop_loss_percent": risk.stop_loss_percent,
                    "target_profit_percent": risk.target_profit_percent,
                    "emergency_trading_disabled": risk.emergency_trading_disabled,
                }

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
                "available_cash": acc.available_cash,
                "allotments": allotment_records,
                "risk_limit": risk_data
            })

        with open(BACKUP_FILE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)

        logger.info(f"Persisted {len(data)} accounts with relationships to backup storage at {BACKUP_FILE_PATH}")
        return True
    except Exception as e:
        logger.error(f"Failed to persist accounts backup: {str(e)}")
        return False


def restore_accounts_backup(db: Session) -> int:
    """
    Restores accounts and associated demat allotments and risk settings into the database
    if the database is empty (e.g. fresh container restart).
    Guarantees primary production account exists and attempts auto-connection.
    """
    restored_count = 0
    if db.query(Account).count() == 0 and os.path.exists(BACKUP_FILE_PATH):
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
                    db.flush()
                    restored_count += 1

                    # Restore allotments if IPO exists
                    for alt in item.get("allotments", []):
                        ipo = db.query(IPO).filter(IPO.symbol == alt["symbol"]).first()
                        if ipo:
                            db.add(Allotment(
                                ipo_id=ipo.id,
                                account_id=acc.id,
                                applied_quantity=alt.get("applied_quantity", alt["allotted_quantity"]),
                                allotted_quantity=alt["allotted_quantity"],
                                acquisition_cost=alt["acquisition_cost"],
                                allotment_status=alt.get("allotment_status", "ALLOTTED"),
                                demat_credit_status=alt.get("demat_credit_status", "CREDITED"),
                                status=alt.get("status", "DEMAT_CREDITED"),
                                demat_verified=True,
                                verification_source="RESTORED_BACKUP"
                            ))

                    # Restore custom risk limits
                    risk_data = item.get("risk_limit")
                    if risk_data:
                        db.add(RiskLimit(
                            account_id=acc.id,
                            max_order_value=risk_data.get("max_order_value", 500000.0),
                            max_quantity_per_order=risk_data.get("max_quantity_per_order", 5000),
                            max_loss_threshold=risk_data.get("max_loss_threshold", 50000.0),
                            stop_loss_percent=risk_data.get("stop_loss_percent", 5.0),
                            target_profit_percent=risk_data.get("target_profit_percent", 20.0),
                            emergency_trading_disabled=risk_data.get("emergency_trading_disabled", False)
                        ))

            db.commit()
            if restored_count > 0:
                logger.info(f"Restored {restored_count} accounts with allotments and risk limits from backup file.")
        except Exception as e:
            logger.error(f"Error restoring accounts from backup file: {str(e)}")

    # If primary production client code is provided via environment, ensure it exists
    primary_code = settings.SMARTAPI_CLIENT_CODE.strip().upper() if settings.SMARTAPI_CLIENT_CODE else ""
    primary_acc = None
    if primary_code:
        primary_acc = db.query(Account).filter(Account.client_code == primary_code).first()
        if not primary_acc:
            logger.info(f"Creating primary production account ({primary_code}) from environment...")
            primary_acc = Account(
                nickname="Primary Live Account",
                client_code=primary_code,
                account_group="Family",
                encrypted_api_key=cipher.encrypt(""),
                encrypted_pin=cipher.encrypt(""),
                encrypted_totp_secret=cipher.encrypt(""),
                is_enabled=True,
                is_demo=False,
                auth_status="DISCONNECTED",
                ddpi_status="ACTIVE",
                edis_authorized_today=False,
                available_cash=0.0,
                last_auth_error="SmartAPI credentials required. Enter your API Key, PIN, and TOTP secret to connect."
            )
            db.add(primary_acc)
            db.commit()
            db.refresh(primary_acc)
            restored_count += 1
            logger.info(f"Configured primary account ({primary_code}) successfully created.")

    # Inject permanent credentials from environment if provided
    env_key = settings.SMARTAPI_API_KEY.strip() if settings.SMARTAPI_API_KEY else ""
    env_pin = settings.SMARTAPI_PIN.strip() if settings.SMARTAPI_PIN else ""
    env_totp = settings.SMARTAPI_TOTP_SECRET.strip() if settings.SMARTAPI_TOTP_SECRET else ""

    if env_key and env_pin and env_totp:
        logger.info(f"Applying permanent SmartAPI credentials from environment to primary account {primary_code}...")
        primary_acc.encrypted_api_key = cipher.encrypt(env_key)
        primary_acc.encrypted_pin = cipher.encrypt(env_pin)
        clean_totp = normalize_base32_secret(env_totp)
        primary_acc.encrypted_totp_secret = cipher.encrypt(clean_totp)
        primary_acc.last_auth_error = None
        db.commit()
        db.refresh(primary_acc)

    # Attempt automatic connection on boot for accounts with complete credentials
    for acc in db.query(Account).filter(Account.is_enabled == True, Account.is_demo == False).all():
        try:
            k = cipher.decrypt(acc.encrypted_api_key)
            p = cipher.decrypt(acc.encrypted_pin)
            t = cipher.decrypt(acc.encrypted_totp_secret)
            if k and p and t and k != "AUTO_RESTORED_KEY":
                logger.info(f"Auto-connecting account {acc.nickname} ({acc.client_code}) on startup...")
                from app.services.smartapi_adapter import get_adapter_for_account
                adapter = get_adapter_for_account(acc.id, k, acc.client_code, p, t, force_new=True)
                auth_res = adapter.authenticate()
                if auth_res.get("success"):
                    acc.auth_status = "CONNECTED"
                    acc.last_sync_time = datetime.utcnow()
                    acc.last_auth_error = None
                    rms = adapter.get_rms()
                    if rms:
                        cash = float(rms.get("availablecash", rms.get("net", acc.available_cash)))
                        acc.available_cash = round(cash, 2)
                    db.commit()
                    logger.info(f"Account {acc.nickname} successfully connected on startup!")
                else:
                    logger.warning(f"Startup connection failed for {acc.nickname}: {auth_res.get('message')}")
        except Exception as e:
            logger.error(f"Error during startup auto-connection for {acc.nickname}: {str(e)}")

    persist_accounts_backup(db)
    return restored_count
