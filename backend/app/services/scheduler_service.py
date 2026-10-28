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
            feed_res = IPOFeedService.sync_feed(db)
            return feed_res
        except Exception as e:
            logger.error(f"Failed to execute background feed sync: {str(e)}")
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


# Global singleton scheduler instance
sync_manager = BackgroundSyncManager(interval_seconds=1800)
