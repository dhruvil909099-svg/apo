import asyncio
import logging
import time
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.ipo import Allotment
from app.core.security import cipher
from app.services.smartapi_adapter import get_adapter_for_account
from app.services.portfolio_sync_service import reconcile_broker_holdings
from app.services.account_persistence import persist_accounts_backup

logger = logging.getLogger("data_orchestrator")


class DataOrchestrator:
    """
    Centralized Data Engine & Resilient Orchestration Service.
    - Evaluates data freshness per account and category.
    - Guarantees instant response using stored data (no blank screens).
    - Asynchronously auto-refreshes stale accounts in background with per-account mutex locks.
    - Prevents duplicate overlapping jobs.
    - Recovers from expired sessions automatically using stored TOTP secrets.
    - Falls back gracefully to verified Demat ledgers without zeroing balances on transient errors.
    """

    FRESHNESS_TTL_SECONDS = 180  # 3 minutes default freshness window

    def __init__(self):
        self._account_locks: Dict[int, asyncio.Lock] = {}
        self._global_lock = asyncio.Lock()
        self.last_orchestration_run: Optional[datetime] = None

    def _get_account_lock(self, account_id: int) -> asyncio.Lock:
        if account_id not in self._account_locks:
            self._account_locks[account_id] = asyncio.Lock()
        return self._account_locks[account_id]

    @staticmethod
    def is_data_stale(last_sync_time: Optional[datetime]) -> bool:
        """Helper to check if a timestamp is beyond the freshness TTL."""
        if not last_sync_time:
            return True
        return (datetime.utcnow() - last_sync_time).total_seconds() >= DataOrchestrator.FRESHNESS_TTL_SECONDS

    @staticmethod
    def refresh_account_if_stale_background(account_id: int):
        """Dispatches an asynchronous non-blocking refresh task for an account if loop is running."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(orchestrator._refresh_single_account(account_id))
        except RuntimeError:
            pass

    def is_account_fresh(self, account: Account) -> bool:
        """Determines if the account's data was verified within the freshness TTL."""
        if not account.last_sync_time:
            return False
        age_seconds = (datetime.utcnow() - account.last_sync_time).total_seconds()
        return age_seconds < self.FRESHNESS_TTL_SECONDS


    async def auto_refresh_stale_accounts(self, db: Session, force: bool = False) -> Dict[str, Any]:
        """
        Scans enabled accounts and triggers non-blocking background refreshes for any stale accounts.
        Deduplicates concurrent requests and executes with bounded concurrency.
        """
        now = datetime.utcnow()
        self.last_orchestration_run = now
        active_accounts = db.query(Account).filter(Account.is_enabled == True).all()

        stale_accounts: List[Account] = []
        for acc in active_accounts:
            # Stop polling/live sync for disconnected or reauthentication-required accounts
            if acc.auth_status in ("DISCONNECTED", "REAUTHENTICATION_REQUIRED"):
                continue
            if force or not self.is_account_fresh(acc):
                stale_accounts.append(acc)

        if not stale_accounts:
            return {
                "success": True,
                "status": "ALL_FRESH",
                "message": "All enabled accounts are within freshness window.",
                "total_checked": len(active_accounts),
                "refreshed_count": 0
            }

        refreshed_count = 0
        tasks = []
        for acc in stale_accounts:
            lock = self._get_account_lock(acc.id)
            if not lock.locked():
                tasks.append(self._refresh_single_account(acc.id))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in results:
                if isinstance(r, dict) and r.get("success"):
                    refreshed_count += 1

        return {
            "success": True,
            "status": "COMPLETED",
            "message": f"Auto-refresh completed for {len(stale_accounts)} stale accounts ({refreshed_count} active).",
            "total_checked": len(active_accounts),
            "stale_detected": len(stale_accounts),
            "refreshed_count": refreshed_count,
            "timestamp": now.isoformat()
        }


    async def _refresh_single_account(self, account_id: int) -> Dict[str, Any]:
        """Refreshes an individual account safely under its dedicated mutex lock."""
        lock = self._get_account_lock(account_id)
        async with lock:
            loop = asyncio.get_running_loop()
            return await loop.run_in_executor(None, self._sync_account_worker, account_id)

    def _sync_account_worker(self, account_id: int) -> Dict[str, Any]:
        """Synchronous sync execution in thread pool."""
        from app.core.database import SessionLocal
        db = SessionLocal()
        now = datetime.utcnow()
        try:
            account = db.query(Account).filter(Account.id == account_id).first()
            if not account or not account.is_enabled:
                return {"success": False, "message": "Account missing or disabled"}

            account.last_sync_attempt = now
            account.sync_status = "REFRESHING"
            db.commit()

            if account.is_demo:
                account.auth_status = "CONNECTED"
                account.sync_status = "SUCCESS"
                account.last_sync_time = now
                account.last_auth_error = None
                account.consecutive_errors = 0
                db.commit()
                return {"success": True, "message": "Demo account verified"}

            try:
                raw_key = cipher.decrypt(account.encrypted_api_key)
                raw_pin = cipher.decrypt(account.encrypted_pin)
                raw_totp = cipher.decrypt(account.encrypted_totp_secret)
            except Exception as e:
                account.sync_status = "ERROR"
                account.auth_status = "ERROR"
                account.last_auth_error = f"Credential decryption failed: {str(e)}"
                db.commit()
                return {"success": False, "message": account.last_auth_error}

            if not (raw_key and raw_pin and raw_totp) or raw_key == "AUTO_RESTORED_KEY":
                account.sync_status = "ERROR"
                account.auth_status = "ERROR"
                account.last_auth_error = "SmartAPI credentials incomplete or placeholder. Please configure your API Key, PIN, and TOTP secret."
                db.commit()
                return {"success": False, "message": account.last_auth_error}

            # Retrieve or instantiate self-healing adapter
            adapter = get_adapter_for_account(
                account.id,
                api_key=raw_key,
                client_code=account.client_code,
                pin=raw_pin,
                totp_secret=raw_totp
            )

            # Auto-authenticate if session is uninitialized or expired
            if not (adapter.jwt_token and time.time() < adapter.token_expiry_timestamp and not adapter.is_session_expired):
                auth_res = adapter.authenticate(force_fresh=True)
                if not auth_res.get("success"):
                    account.sync_status = "ERROR"
                    account.auth_status = "REAUTHENTICATION_REQUIRED"
                    account.last_auth_error = auth_res.get("message")
                    account.consecutive_errors += 1
                    db.commit()
                    return {"success": False, "message": account.last_auth_error}

            # 1. Refresh funds / RMS balance
            rms = adapter.get_rms()
            if rms:
                cash_val = float(rms.get("availablecash", rms.get("net", account.available_cash)))
                account.available_cash = round(cash_val, 2)

            # 2. Refresh Demat holdings with multi-tier fallback
            holdings = adapter.get_holdings()

            # Handle errors without wiping verified ledger
            if adapter.last_error:
                account.sync_status = "STALE_FALLBACK"
                account.last_auth_error = adapter.last_error
                account.consecutive_errors += 1
            else:
                account.auth_status = "CONNECTED"
                account.sync_status = "SUCCESS"
                account.last_auth_error = None
                account.last_sync_time = now
                account.consecutive_errors = 0
                if holdings is not None:
                    reconcile_broker_holdings(db, account, holdings, now)

            db.commit()
            persist_accounts_backup(db)
            return {"success": account.sync_status == "SUCCESS", "message": account.last_auth_error or "Synchronized successfully"}

        except Exception as e:
            logger.error(f"Error in data orchestrator worker for account {account_id}: {str(e)}")
            if account:
                account.sync_status = "STALE_FALLBACK"
                account.last_auth_error = f"Background sync exception: {str(e)}"
                account.consecutive_errors += 1
                db.commit()
            return {"success": False, "message": str(e)}
        finally:
            db.close()

    def get_orchestration_status(self, db: Session) -> Dict[str, Any]:
        """Provides full operational health telemetry for dashboard and diagnostics."""
        accounts = db.query(Account).filter(Account.is_enabled == True).all()
        now = datetime.utcnow()

        fresh_count = 0
        stale_count = 0
        refreshing_count = 0
        error_count = 0

        details = []
        for a in accounts:
            is_fresh = self.is_account_fresh(a)
            if is_fresh:
                fresh_count += 1
            else:
                stale_count += 1

            if a.sync_status == "REFRESHING":
                refreshing_count += 1
            elif a.sync_status == "ERROR" or a.auth_status == "ERROR":
                error_count += 1

            details.append({
                "account_id": a.id,
                "nickname": a.nickname,
                "masked_client_code": a.masked_client_code,
                "is_demo": a.is_demo,
                "auth_status": a.auth_status,
                "sync_status": a.sync_status,
                "is_fresh": is_fresh,
                "last_sync_time": a.last_sync_time.isoformat() if a.last_sync_time else None,
                "last_sync_attempt": a.last_sync_attempt.isoformat() if a.last_sync_attempt else None,
                "consecutive_errors": a.consecutive_errors,
                "last_auth_error": a.last_auth_error
            })

        return {
            "total_accounts": len(accounts),
            "total_enabled_accounts": len(accounts),
            "fresh_count": fresh_count,
            "stale_count": stale_count,
            "refreshing_count": refreshing_count,
            "error_count": error_count,
            "freshness_window_seconds": self.FRESHNESS_TTL_SECONDS,
            "last_orchestration_run": self.last_orchestration_run.isoformat() if self.last_orchestration_run else None,
            "accounts": details
        }


# Global singleton data orchestrator instance
orchestrator = DataOrchestrator()
