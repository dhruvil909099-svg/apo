import json
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.risk import RiskLimit
from app.models.audit import AuditLog
from app.schemas.risk import RiskLimitUpdate, RiskLimitResponse
from app.core.rate_limit import rate_limit_risk

router = APIRouter(prefix="/risk", tags=["Risk Management"])


@router.get("", response_model=RiskLimitResponse)
def get_global_risk_limits(db: Session = Depends(get_db)):
    risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
    if not risk:
        # Create default global risk limit
        risk = RiskLimit(
            account_id=None,
            max_order_value=500000.0,
            max_quantity_per_order=5000,
            max_loss_threshold=50000.0,
            stop_loss_percent=5.0,
            target_profit_percent=20.0,
            emergency_trading_disabled=False,
            allow_market_orders_on_listing=False
        )
        db.add(risk)
        db.commit()
        db.refresh(risk)

    return risk


@router.put("", response_model=RiskLimitResponse)
def update_global_risk_limits(
    risk_in: RiskLimitUpdate,
    db: Session = Depends(get_db),
    _rate_ok: bool = Depends(rate_limit_risk)
):
    risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
    if not risk:
        risk = RiskLimit(account_id=None)
        db.add(risk)

    if risk_in.max_order_value is not None:
        risk.max_order_value = risk_in.max_order_value
    if risk_in.max_quantity_per_order is not None:
        risk.max_quantity_per_order = risk_in.max_quantity_per_order
    if risk_in.max_loss_threshold is not None:
        risk.max_loss_threshold = risk_in.max_loss_threshold
    if risk_in.stop_loss_percent is not None:
        risk.stop_loss_percent = risk_in.stop_loss_percent
    if risk_in.target_profit_percent is not None:
        risk.target_profit_percent = risk_in.target_profit_percent
    if risk_in.emergency_trading_disabled is not None:
        risk.emergency_trading_disabled = risk_in.emergency_trading_disabled
    if risk_in.allow_market_orders_on_listing is not None:
        risk.allow_market_orders_on_listing = risk_in.allow_market_orders_on_listing

    db.commit()
    db.refresh(risk)

    # Audit log
    audit = AuditLog(
        event_type="RISK_LIMITS_UPDATED",
        operator="OPERATOR",
        details_json=json.dumps({
            "max_order_value": risk.max_order_value,
            "max_quantity": risk.max_quantity_per_order,
            "emergency_disabled": risk.emergency_trading_disabled
        })
    )
    db.add(audit)
    db.commit()

    return risk


@router.post("/emergency-halt")
def toggle_emergency_halt(
    db: Session = Depends(get_db),
    _rate_ok: bool = Depends(rate_limit_risk)
):
    """
    Emergency kill switch: Halts or restores all trading operations immediately.
    """
    risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
    if not risk:
        risk = RiskLimit(account_id=None, emergency_trading_disabled=True)
        db.add(risk)
    else:
        risk.emergency_trading_disabled = not risk.emergency_trading_disabled

    db.commit()
    db.refresh(risk)

    state_str = "ACTIVATED" if risk.emergency_trading_disabled else "DEACTIVATED"
    audit = AuditLog(
        event_type=f"EMERGENCY_KILL_SWITCH_{state_str}",
        operator="OPERATOR",
        details_json=json.dumps({"emergency_trading_disabled": risk.emergency_trading_disabled})
    )
    db.add(audit)
    db.commit()

    return {
        "emergency_trading_disabled": risk.emergency_trading_disabled,
        "message": f"Emergency Kill Switch {state_str}. Trading {'HALTED' if risk.emergency_trading_disabled else 'RESUMED'}."
    }
