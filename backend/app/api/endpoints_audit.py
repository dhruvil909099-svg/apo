import json
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, case
from app.core.database import get_db
from app.core.config import settings
from app.core.cache import app_cache
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.risk import RiskLimit
from app.models.audit import AuditLog
from app.schemas.risk import AuditLogResponse, DashboardSummaryResponse
from app.core.auth import get_current_user, UserPrincipal

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
    Uses unified SQL aggregation and in-memory caching to eliminate remote DB latency.
    """
    cache_key = f"dashboard_summary_{settings.TRADING_MODE}"
    cached = app_cache.get(cache_key)
    if cached is not None:
        # Return deep copy or update server_time
        return cached

    # 1. Consolidated Single-Query Account Aggregation
    acc_stats = db.query(
        func.count(Account.id),
        func.coalesce(func.sum(case((Account.auth_status == "CONNECTED", 1), else_=0)), 0),
        func.coalesce(func.sum(case((Account.auth_status.in_(["ERROR", "EXPIRED"]), 1), else_=0)), 0),
    ).first()
    
    total_acc = int(acc_stats[0] or 0) if acc_stats else 0
    connected_acc = int(acc_stats[1] or 0) if acc_stats else 0
    error_acc = int(acc_stats[2] or 0) if acc_stats else 0
    disconnected_acc = total_acc - connected_acc

    total_ipos = db.query(func.count(IPO.id)).scalar() or 0
    
    # 2. Portfolio calculations: joined load to avoid N+1 queries
    allotment_query = db.query(Allotment).options(
        joinedload(Allotment.ipo)
    ).join(Account).filter(
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
        ltp = a.ipo.current_ltp or a.ipo.issue_price if a.ipo else 0.0
        total_val += (a.allotted_quantity * ltp)
        total_cost += (a.allotted_quantity * a.acquisition_cost)

    unrealized_pnl = total_val - total_cost
    pnl_pct = (unrealized_pnl / total_cost * 100) if total_cost > 0 else 0.0

    # 3. Consolidated Single-Query Order Aggregation for Today
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    order_stats = db.query(
        func.count(Order.id),
        func.coalesce(func.sum(case((Order.status == "EXECUTED", 1), else_=0)), 0),
        func.coalesce(func.sum(case((Order.status == "REJECTED", 1), else_=0)), 0),
    ).filter(Order.created_at >= today_start).first()

    orders_today = int(order_stats[0] or 0) if order_stats else 0
    orders_filled = int(order_stats[1] or 0) if order_stats else 0
    orders_rejected = int(order_stats[2] or 0) if order_stats else 0

    risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
    emergency_halt = risk.emergency_trading_disabled if risk else False

    result = DashboardSummaryResponse(
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
    # Cache for 10 seconds to make repeat dashboard requests sub-millisecond
    app_cache.set(cache_key, result, ttl=10.0, tag="summary")
    return result


@router.get("/bootstrap")
def get_dashboard_bootstrap(
    db: Session = Depends(get_db),
    current_user: UserPrincipal = Depends(get_current_user)
):
    """
    Unified high-performance bootstrap endpoint that bundles summary,
    accounts, IPOs, and market quotes into a SINGLE network round trip.
    """
    summary = get_dashboard_summary(db)

    acc_query = db.query(Account)
    if not current_user.is_admin and current_user.id is not None:
        acc_query = acc_query.filter((Account.user_id == current_user.id) | (Account.user_id.is_(None)))
    accounts = acc_query.order_by(Account.id.asc()).all()
    accounts_data = [
        {
            "id": a.id,
            "nickname": a.nickname,
            "masked_client_code": a.masked_client_code,
            "account_group": a.account_group,
            "is_enabled": a.is_enabled,
            "is_demo": a.is_demo,
            "auth_status": a.auth_status,
            "ddpi_status": a.ddpi_status,
            "edis_authorized_today": a.edis_authorized_today,
            "available_cash": a.available_cash,
            "last_sync_time": a.last_sync_time.isoformat() if a.last_sync_time else None,
            "last_auth_error": a.last_auth_error,
            "created_at": a.created_at.isoformat() if a.created_at else None
        }
        for a in accounts
    ]

    from app.api.endpoints_ipos import _build_ipo_response
    ipos = db.query(IPO).options(joinedload(IPO.allotments)).order_by(IPO.id.desc()).all()
    ipos_data = [_build_ipo_response(ipo) for ipo in ipos]

    from app.api.endpoints_market import get_market_quotes
    quotes = get_market_quotes(db)

    return {
        "success": True,
        "summary": summary,
        "accounts": accounts_data,
        "ipos": ipos_data,
        "quotes": quotes,
        "server_time": datetime.utcnow().isoformat()
    }

