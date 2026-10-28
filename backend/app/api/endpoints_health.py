import os
from datetime import datetime
from fastapi import APIRouter, Depends, status, Response
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db
from app.core.config import settings

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("")
def health_liveness():
    """
    Lightweight process liveness probe.
    Confirms the application server is responsive without querying databases.
    """
    return {
        "status": "UP",
        "timestamp": datetime.utcnow().isoformat(),
        "app_name": settings.APP_NAME,
        "trading_mode": settings.TRADING_MODE,
        "version": "1.0.0"
    }


@router.get("/ready")
def health_readiness(response: Response, db: Session = Depends(get_db)):
    """
    Dependency readiness probe.
    Verifies database connectivity and essential services are ready to accept traffic.
    """
    is_ready = True
    db_status = "CONNECTED"
    engine_name = "unknown"
    is_persistent = False
    try:
        db.execute(text("SELECT 1"))
        bind = db.get_bind()
        engine_name = bind.dialect.name if bind else "unknown"
        # Managed MySQL/MariaDB (Hostinger) and PostgreSQL are persistent; SQLite with PERSISTENT_DATA_DIR is disk-backed
        is_persistent = engine_name in ["mysql", "mariadb", "postgresql", "postgres"] or bool(os.environ.get("PERSISTENT_DATA_DIR"))
    except Exception:
        is_ready = False
        db_status = "UNAVAILABLE"
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "READY" if is_ready else "DEGRADED",
        "timestamp": datetime.utcnow().isoformat(),
        "app_name": settings.APP_NAME,
        "trading_mode": settings.TRADING_MODE,
        "database": db_status,
        "database_engine": engine_name,
        "storage_type": "MANAGED_PERSISTENT" if is_persistent else "EPHEMERAL_LOCAL",
        "version": "1.0.0"
    }
