import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.risk import RiskLimit
from app.models.audit import AuditLog
from app.schemas.risk import AuditLogResponse, DashboardSummaryResponse

router = APIRouter(prefix="/audit", tags=["Audit & Dashboard KPI"])


@router.get("/logs", response_model=List[AuditLogResponse])
def list_audit_logs(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    event_type: Optional[str] = Query(None),
    account_id: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(AuditLog)
    if event_type:
        query = query.filter(AuditLog.event_type == event_type)
    if account_id:
        query = query.filter(AuditLog.account_id == account_id)

    logs = query.order_by(AuditLog.id.desc()).offset(offset).limit(limit).all()
    results = []

    for l in logs:
        try:
            details = json.loads(l.details_json)
        except Exception:
            details = {"raw": l.details_json}

        results.append(AuditLogResponse(
            id=l.id,
            timestamp=l.timestamp,
            event_type=l.event_type,
            account_id=l.account_id,
            operator=l.operator,
            details=details
        ))

    return results


@router.get("/summary", response_model=DashboardSummaryResponse)
def get_dashboard_summary(db: Session = Depends(get_db)):
    """
    Computes high-level KPI metrics for the Dashboard overview.
    """
    total_acc = db.query(Account).count()
    connected_acc = db.query(Account).filter(Account.auth_status == "CONNECTED").count()
    error_acc = db.query(Account).filter(Account.auth_status.in_(["ERROR", "EXPIRED"])).count()
    disconnected_acc = total_acc - connected_acc

    total_ipos = db.query(IPO).count()
    
    # Portfolio calculations: strictly exclude demo accounts in LIVE mode
    allotment_query = db.query(Allotment).join(IPO).join(Account).filter(
        Account.is_enabled == True,
        Allotment.allotted_quantity > 0
    )
    if settings.TRADING_MODE == "LIVE":
        allotment_query = allotment_query.filter(Account.is_demo == False)

    allotments = allotment_query.all()
    total_shares = sum(a.allotted_quantity for a in allotments)
    total_val = 0.0
    total_cost = 0.0
    for a in allotments:
        ltp = a.ipo.current_ltp or a.ipo.issue_price
        total_val += (a.allotted_quantity * ltp)
        total_cost += (a.allotted_quantity * a.acquisition_cost)

    unrealized_pnl = total_val - total_cost
    pnl_pct = (unrealized_pnl / total_cost * 100) if total_cost > 0 else 0.0

    # Orders today
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    orders_today = db.query(Order).filter(Order.created_at >= today_start).count()
    orders_filled = db.query(Order).filter(Order.created_at >= today_start, Order.status == "EXECUTED").count()
    orders_rejected = db.query(Order).filter(Order.created_at >= today_start, Order.status == "REJECTED").count()

    risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
    emergency_halt = risk.emergency_trading_disabled if risk else False

    return DashboardSummaryResponse(
        trading_mode=settings.TRADING_MODE,
        total_accounts=total_acc,
        connected_accounts=connected_acc,
        disconnected_accounts=disconnected_acc,
        error_accounts=error_acc,
        total_ipos_monitored=total_ipos,
        total_allotted_shares=total_shares,
        total_portfolio_value=round(total_val, 2),
        total_unrealized_pnl=round(unrealized_pnl, 2),
        pnl_percentage=round(pnl_pct, 2),
        orders_today_count=orders_today,
        orders_filled_count=orders_filled,
        orders_rejected_count=orders_rejected,
        emergency_trading_disabled=emergency_halt,
        server_time=datetime.utcnow()
    )
