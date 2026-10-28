import uuid
import time
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.config import settings
from app.models.order import Order
from app.models.account import Account
from app.models.risk import RiskLimit
from app.core.rate_limit import rate_limit_orders
from app.models.ipo import IPO, Allotment
from app.schemas.order import (
    OrderSingleCreate, BulkOrderPrepareRequest, BulkOrderPreviewResponse,
    BulkOrderExecuteRequest, OrderResponse, OrderPreviewRequest, OrderPreviewResponse
)
from app.services.bulk_order_service import BulkOrderService
from app.services.paper_trading_service import PaperTradingService

router = APIRouter(prefix="/orders", tags=["Orders"])


@router.post("/preview", response_model=OrderPreviewResponse)
def preview_single_order(
    req: OrderPreviewRequest,
    db: Session = Depends(get_db)
):
    """
    Validates single order parameters, checks available funds/holdings,
    and returns comprehensive pre-trade analysis including estimated regulatory charges.
    """
    account = db.query(Account).filter(Account.id == req.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    clean_symbol = req.tradingsymbol.replace("-EQ", "").strip().upper()
    ipo = db.query(IPO).filter(IPO.symbol == clean_symbol).first()
    effective_price = req.price
    if effective_price <= 0 and ipo:
        effective_price = ipo.current_ltp or ipo.issue_price or 100.0
    elif effective_price <= 0:
        effective_price = 100.0

    est_value = round(req.quantity * effective_price, 2)

    # Calculate standard Indian equity delivery statutory charges:
    # Brokerage: ₹0
    brokerage = 0.0
    # STT (Securities Transaction Tax): 0.1% on delivery Buy & Sell
    stt = round(est_value * 0.001, 2)
    # Exchange turnover charge (NSE): ~0.00345%
    exchange_charges = round(est_value * 0.0000345, 2)
    # GST: 18% on (brokerage + exchange charges)
    gst = round((brokerage + exchange_charges) * 0.18, 2)
    # SEBI turnover fees: 0.0001% (₹10/crore)
    sebi_fees = round(est_value * 0.000001, 2)
    # Stamp duty: 0.015% on BUY only
    stamp_duty = round(est_value * 0.00015, 2) if req.transaction_type == "BUY" else 0.0

    total_charges = round(brokerage + stt + exchange_charges + gst + sebi_fees + stamp_duty, 2)
    net_total = round(est_value + total_charges if req.transaction_type == "BUY" else est_value - total_charges, 2)

    blocking_reasons = []
    warnings = []

    if not account.is_enabled:
        blocking_reasons.append(f"Account '{account.nickname}' is disabled.")

    if not account.is_demo and account.auth_status != "CONNECTED":
        blocking_reasons.append(
            f"Account '{account.nickname}' is {account.auth_status}. Live broker orders are disabled until reconnection."
        )

    risk = db.query(RiskLimit).filter(
        (RiskLimit.account_id == account.id) | (RiskLimit.account_id == None)
    ).first()
    if risk and risk.emergency_trading_disabled:
        blocking_reasons.append("Emergency Kill Switch is ACTIVE across all accounts.")

    available_balance = 0.0
    balance_label = "Available Cash"

    if req.transaction_type == "BUY":
        available_balance = account.available_cash or 0.0
        balance_label = "Available Cash"
        if available_balance < (est_value + total_charges):
            blocking_reasons.append(
                f"Insufficient funds: Required ₹{(est_value + total_charges):,.2f}, Available ₹{available_balance:,.2f}"
            )
    else:  # SELL
        balance_label = "Sellable Shares"
        allotment = db.query(Allotment).join(IPO).filter(
            Allotment.account_id == account.id,
            IPO.symbol == clean_symbol
        ).first()
        available_balance = float(allotment.allotted_quantity) if allotment else 0.0
        if available_balance < req.quantity:
            blocking_reasons.append(
                f"Insufficient holdings: Requested {req.quantity} shares, but only {int(available_balance)} available."
            )
        if account.ddpi_status != "ACTIVE" and not account.edis_authorized_today:
            warnings.append("DDPI is not active for this account. CDSL T-PIN authorization (eDIS) will be required prior to broker settlement.")

    is_valid = len(blocking_reasons) == 0

    return OrderPreviewResponse(
        is_valid=is_valid,
        tradingsymbol=clean_symbol,
        transaction_type=req.transaction_type,
        order_type=req.order_type,
        quantity=req.quantity,
        price=effective_price,
        estimated_value=est_value,
        estimated_charges=total_charges,
        net_total=net_total,
        available_balance=available_balance,
        balance_label=balance_label,
        ddpi_status=account.ddpi_status,
        is_paper_trade=(settings.TRADING_MODE == "PAPER" or account.is_demo),
        charges_breakdown={
            "brokerage": brokerage,
            "stt": stt,
            "exchange_charges": exchange_charges,
            "gst": gst,
            "sebi_fees": sebi_fees,
            "stamp_duty": stamp_duty
        },
        blocking_reasons=blocking_reasons,
        warnings=warnings
    )


@router.get("", response_model=List[OrderResponse])
def list_orders(
    account_id: Optional[int] = Query(None),
    status_filter: Optional[str] = Query(None),
    symbol: Optional[str] = Query(None),
    batch_id: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    query = db.query(Order)
    if account_id:
        query = query.filter(Order.account_id == account_id)
    if status_filter:
        query = query.filter(Order.status == status_filter.upper())
    if symbol:
        query = query.filter(Order.tradingsymbol.contains(symbol.upper()))
    if batch_id:
        query = query.filter(Order.batch_id == batch_id)

    orders = query.order_by(Order.id.desc()).all()
    results = []

    for o in orders:
        acc = o.account
        results.append(OrderResponse(
            id=o.id,
            client_order_id=o.client_order_id,
            account_id=o.account_id,
            account_nickname=acc.nickname if acc else None,
            account_masked_code=acc.masked_client_code if acc else None,
            broker_order_id=o.broker_order_id,
            batch_id=o.batch_id,
            tradingsymbol=o.tradingsymbol,
            symbol_token=o.symbol_token,
            exchange=o.exchange,
            transaction_type=o.transaction_type,
            order_type=o.order_type,
            product_type=o.product_type,
            variety=o.variety,
            quantity=o.quantity,
            filled_quantity=o.filled_quantity,
            price=o.price,
            trigger_price=o.trigger_price,
            execution_price=o.execution_price,
            status=o.status,
            rejection_reason=o.rejection_reason,
            is_paper_trade=o.is_paper_trade,
            created_at=o.created_at,
            updated_at=o.updated_at
        ))

    return results


@router.post("/single", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def place_single_order(
    order_in: OrderSingleCreate,
    db: Session = Depends(get_db),
    _rate_ok: bool = Depends(rate_limit_orders)
):
    account = db.query(Account).filter(Account.id == order_in.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if not account.is_enabled:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account '{account.nickname}' is disabled. Cannot place orders."
        )

    if not account.is_demo and account.auth_status != "CONNECTED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "BROKER_ACCOUNT_DISCONNECTED",
                "message": f"Account '{account.nickname}' is {account.auth_status}. Broker order placement is disabled until reconnection."
            }
        )

    clean_symbol = order_in.tradingsymbol.replace("-EQ", "").strip().upper()
    token = order_in.symbol_token
    if not token or token == "0":
        ipo = db.query(IPO).filter(IPO.symbol == clean_symbol).first()
        if ipo and ipo.symbol_token:
            token = ipo.symbol_token
        else:
            token = "0"

    client_order_id = str(uuid.uuid4())
    order = Order(
        client_order_id=client_order_id,
        account_id=account.id,
        tradingsymbol=clean_symbol,
        symbol_token=token,
        exchange=order_in.exchange,
        transaction_type=order_in.transaction_type,
        order_type=order_in.order_type,
        product_type=order_in.product_type or "DELIVERY",
        variety=order_in.variety,
        quantity=order_in.quantity,
        price=order_in.price,
        trigger_price=order_in.trigger_price,
        status="PREPARED",
        is_paper_trade=(settings.TRADING_MODE == "PAPER" or account.is_demo)
    )
    db.add(order)
    db.commit()
    db.refresh(order)

    # Execute paper order if in paper mode or demo account
    if settings.TRADING_MODE == "PAPER" or account.is_demo:
        PaperTradingService.execute_paper_order(db, order)

    else:
        # Live order execution via SmartAPI adapter
        from app.core.security import cipher
        import time
        from app.services.smartapi_adapter import SmartAPIAdapter, get_adapter_for_account
        try:
            adapter = get_adapter_for_account(
                account_id=account.id,
                api_key=cipher.decrypt(account.encrypted_api_key),
                client_code=account.client_code,
                pin=cipher.decrypt(account.encrypted_pin),
                totp_secret=cipher.decrypt(account.encrypted_totp_secret)
            )
            if not (adapter.jwt_token and time.time() < adapter.token_expiry_timestamp and not adapter.is_session_expired):
                auth_res = adapter.authenticate()
                if not auth_res["success"]:
                    order.status = "REJECTED"
                    order.rejection_reason = auth_res["message"]
                    db.commit()
                    return order
            live_res = adapter.place_order({
                "variety": order.variety,
                "tradingsymbol": order.tradingsymbol,
                "symbol_token": order.symbol_token,
                "transaction_type": order.transaction_type,
                "exchange": order.exchange,
                "order_type": order.order_type,
                "product_type": order.product_type,
                "price": order.price,
                "quantity": order.quantity
            })
            if live_res["success"]:
                order.status = "ACCEPTED"
                order.broker_order_id = live_res["broker_order_id"]
            else:
                order.status = "REJECTED"
                order.rejection_reason = live_res["message"]
            db.commit()
        except Exception as e:
            order.status = "REJECTED"
            order.rejection_reason = str(e)
            db.commit()

    return OrderResponse(
        id=order.id,
        client_order_id=order.client_order_id,
        account_id=order.account_id,
        account_nickname=account.nickname,
        account_masked_code=account.masked_client_code,
        broker_order_id=order.broker_order_id,
        batch_id=order.batch_id,
        tradingsymbol=order.tradingsymbol,
        symbol_token=order.symbol_token,
        exchange=order.exchange,
        transaction_type=order.transaction_type,
        order_type=order.order_type,
        product_type=order.product_type,
        variety=order.variety,
        quantity=order.quantity,
        filled_quantity=order.filled_quantity,
        price=order.price,
        trigger_price=order.trigger_price,
        execution_price=order.execution_price,
        status=order.status,
        rejection_reason=order.rejection_reason,
        is_paper_trade=order.is_paper_trade,
        created_at=order.created_at,
        updated_at=order.updated_at
    )


@router.post("/bulk-prepare", response_model=BulkOrderPreviewResponse)
def prepare_bulk_orders(req: BulkOrderPrepareRequest, db: Session = Depends(get_db)):
    result = BulkOrderService.prepare_and_validate(db, req.model_dump())
    return BulkOrderPreviewResponse(**result)



@router.post("/bulk-execute")
def execute_bulk_orders(
    req: BulkOrderExecuteRequest,
    db: Session = Depends(get_db),
    _rate_ok: bool = Depends(rate_limit_orders)
):
    result = BulkOrderService.execute_batch(db, req.batch_id, req.operator_confirmed)
    return result


@router.post("/{order_id}/cancel")
def cancel_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.account and not order.account.is_demo and order.account.auth_status != "CONNECTED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "error_code": "BROKER_ACCOUNT_DISCONNECTED",
                "message": f"Account '{order.account.nickname}' is {order.account.auth_status}. Order cancellation is disabled until reconnection."
            }
        )

    if order.status not in ["ACCEPTED", "PREPARED"]:
        raise HTTPException(status_code=400, detail=f"Cannot cancel order in status '{order.status}'. Only open orders can be cancelled.")

    order.status = "CANCELLED"
    db.commit()
    return {"message": "Order successfully cancelled.", "order_id": order.id, "status": "CANCELLED"}
