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
    try:
        db.execute(text("SELECT 1"))
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
        "version": "1.0.0"
    }
