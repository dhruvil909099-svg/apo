from datetime import datetime
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db
from app.core.config import settings

router = APIRouter(prefix="/health", tags=["Health"])


@router.get("")
def health_check(db: Session = Depends(get_db)):
    """
    Application health and readiness probe.
    Verifies database connectivity, trading mode, and runtime status.
    """
    db_status = "HEALTHY"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = f"UNHEALTHY: {str(e)}"

    return {
        "status": "UP",
        "timestamp": datetime.utcnow().isoformat(),
        "app_name": settings.APP_NAME,
        "trading_mode": settings.TRADING_MODE,
        "database": db_status,
        "version": "1.0.0"
    }
