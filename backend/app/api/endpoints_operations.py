from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import verify_api_key
from app.services.data_orchestrator import orchestrator
from app.services.ai_ops_service import AIOperationsAssistant, APPROVED_ACTIONS

router = APIRouter(prefix="/operations", tags=["Automated Operations & Data Engine"])


class AutoRefreshPayload(BaseModel):
    force: bool = False


class RemediationPayload(BaseModel):
    action: str
    account_id: Optional[int] = None


@router.get("/status")
def get_operations_status(
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Returns real-time data engine telemetry, account freshness,
    sync statuses, and background worker health.
    """
    return orchestrator.get_orchestration_status(db)


@router.post("/auto-refresh")
async def trigger_auto_refresh(
    payload: Optional[AutoRefreshPayload] = None,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Trigger non-blocking background synchronization for any stale or unverified account data.
    Automatically called by the frontend on dashboard mount to keep records fresh.
    """
    force = payload.force if payload else False
    result = await orchestrator.auto_refresh_stale_accounts(db, force=force)
    return result


@router.get("/diagnostics")
def get_ai_operations_diagnostics(
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    AI-Assisted Operations Diagnostic:
    Analyzes sanitized logs, error classifications, staleness, and recommends safe recovery actions.
    Never exposes credentials or secrets.
    """
    return AIOperationsAssistant.analyze_operational_health(db)


@router.post("/remediate")
def execute_operations_remediation(
    payload: RemediationPayload,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Executes an allowlisted, safe deterministic remediation action.
    Unapproved actions or dangerous operations are categorically rejected.
    """
    if payload.action not in APPROVED_ACTIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Action '{payload.action}' is not in the approved safe operations allowlist. Allowed: {list(APPROVED_ACTIONS.keys())}"
        )

    result = AIOperationsAssistant.execute_remediation(
        db, action=payload.action, account_id=payload.account_id
    )
    return result
