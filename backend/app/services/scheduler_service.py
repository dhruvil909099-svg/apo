import asyncio
import logging
from typing import Dict, Any, Optional
from datetime import datetime, timezone
from app.core.database import SessionLocal
from app.services.ipo_feed_service import IPOFeedService

logger = logging.getLogger("scheduler_service")


class BackgroundSyncManager:
    """
    Lightweight, resource-efficient in-process background scheduler for FastAPI.
    - Prevents overlapping job executions using asyncio.Lock.
    - Guarantees single-task lifecycle per application instance.
    - Eliminates extra dependencies (no Celery, Redis, or APScheduler required).
    - Automatically cleans up and cancels tasks on application shutdown.
    """

    def __init__(self, interval_seconds: int = 1800):  # Default 30 minutes
        self.interval_seconds = interval_seconds
        self._task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self._is_running = False
        
        # Telemetry & Diagnostics
        self.last_run_timestamp: Optional[datetime] = None
        self.last_run_status: str = "IDLE"
        self.last_run_message: str = "Scheduler initialized"
        self.total_runs: int = 0
        self.total_errors: int = 0
        self.next_run_timestamp: Optional[datetime] = None

    def start(self):
        if self._is_running:
            logger.warning("BackgroundSyncManager is already running.")
            return

        self._is_running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info(f"BackgroundSyncManager started with interval {self.interval_seconds}s.")

    def stop(self):
        self._is_running = False
        if self._task and not self._task.done():
            self._task.cancel()
            logger.info("BackgroundSyncManager task cancelled cleanly.")

    async def _run_loop(self):
        # Initial brief sleep to allow server startup to complete
        await asyncio.sleep(5)

        while self._is_running:
            try:
                self.next_run_timestamp = datetime.now(timezone.utc)
                await self.trigger_sync_job()
            except asyncio.CancelledError:
                logger.info("Scheduler task received cancellation signal.")
                break
            except Exception as e:
                self.total_errors += 1
                logger.error(f"Unexpected error in background sync loop: {str(e)}")

            # Calculate next run timestamp
            await asyncio.sleep(self.interval_seconds)

    async def trigger_sync_job(self) -> Dict[str, Any]:
        """
        Executes synchronization safely inside an async lock.
        Prevents duplicate or overlapping job executions.
        """
        if self._lock.locked():
            logger.warning("Sync job already in progress. Skipping overlapping run.")
            return {"status": "SKIPPED", "message": "Job already running"}

        async with self._lock:
            start_time = datetime.now(timezone.utc)
            self.last_run_timestamp = start_time
            self.last_run_status = "RUNNING"
            logger.info("Executing scheduled IPO discovery & Demat verification sync...")

            # Run synchronous database work in a thread pool to avoid blocking event loop
            loop = asyncio.get_running_loop()
            result = await loop.run_in_executor(None, self._execute_db_sync)

            self.total_runs += 1
            if result.get("success"):
                self.last_run_status = "SUCCESS"
                self.last_run_message = f"Created: {result.get('created_count')}, Updated: {result.get('updated_count')}"
            else:
                self.last_run_status = "ERROR"
                self.last_run_message = result.get("error", "Unknown error")
                self.total_errors += 1

            return result

    def _execute_db_sync(self) -> Dict[str, Any]:
        """Synchronous worker executed in background thread."""
        db = SessionLocal()
        try:
            # 1. Authoritative IPO discovery and allotment sync
            feed_res = IPOFeedService.sync_feed(db)

            # 2. Automated background Demat accounts & RMS sync
            from app.models.account import Account
            from app.core.security import cipher
            from app.services.smartapi_adapter import get_adapter_for_account
            from app.services.portfolio_sync_service import reconcile_broker_holdings
            from app.services.account_persistence import persist_accounts_backup
            import time

            now = datetime.utcnow()
            active_accounts = db.query(Account).filter(Account.is_enabled == True).all()
            synced_acc_count = 0

            for acc in active_accounts:
                try:
                    if acc.is_demo:
                        acc.last_sync_time = now
                        acc.auth_status = "CONNECTED"
                        acc.last_auth_error = None
                        synced_acc_count += 1
                        continue

                    raw_key = cipher.decrypt(acc.encrypted_api_key)
                    raw_pin = cipher.decrypt(acc.encrypted_pin)
                    raw_totp = cipher.decrypt(acc.encrypted_totp_secret)
                    if not (raw_key and raw_pin and raw_totp):
                        continue

                    adapter = get_adapter_for_account(acc.id, raw_key, acc.client_code, raw_pin, raw_totp)
                    if not (adapter.jwt_token and time.time() < adapter.token_expiry_timestamp and not adapter.is_session_expired):
                        auth_res = adapter.authenticate()
                        if not auth_res.get("success"):
                            acc.auth_status = "ERROR"
                            acc.last_auth_error = auth_res.get("message")
                            db.commit()
                            continue

                    # Refresh funds
                    rms = adapter.get_rms()
                    if rms:
                        cash_val = float(rms.get("availablecash", rms.get("net", 0.0)))
                        acc.available_cash = round(cash_val, 2)

                    # Refresh Demat holdings
                    holdings = adapter.get_holdings()
                    if holdings is not None and not adapter.last_error:
                        reconcile_broker_holdings(db, acc, holdings, now)

                    if adapter.last_error:
                        acc.auth_status = "ERROR"
                        acc.last_auth_error = adapter.last_error
                    else:
                        acc.auth_status = "CONNECTED"
                        acc.last_auth_error = None
                        acc.last_sync_time = now
                        synced_acc_count += 1
                    db.commit()
                except Exception as acc_err:
                    logger.warning(f"Automated background sync for account {acc.nickname} failed: {str(acc_err)}")

            if synced_acc_count > 0:
                persist_accounts_backup(db)

            return {
                "success": True,
                "feed": feed_res,
                "synced_accounts": synced_acc_count
            }
        except Exception as e:
            logger.error(f"Failed to execute background auto-sync: {str(e)}")
            return {"success": False, "error": str(e)}
        finally:
            db.close()

    def get_status(self) -> Dict[str, Any]:
        return {
            "is_running": self._is_running,
            "interval_seconds": self.interval_seconds,
            "total_runs": self.total_runs,
            "total_errors": self.total_errors,
            "last_run_status": self.last_run_status,
            "last_run_message": self.last_run_message,
            "last_run_timestamp": self.last_run_timestamp.isoformat() if self.last_run_timestamp else None,
            "is_locked": self._lock.locked()
        }


# Global singleton scheduler instance with 3-minute automatic refresh interval
sync_manager = BackgroundSyncManager(interval_seconds=180)
