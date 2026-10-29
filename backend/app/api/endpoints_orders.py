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
    BulkOrderExecuteRequest, OrderResponse, OrderPreviewRequest, OrderPreviewResponse,
    OrderModifyRequest
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
    inst = db.query(Instrument).filter(
        (Instrument.tradingsymbol == req.tradingsymbol) |
        (Instrument.tradingsymbol == clean_symbol) |
        (Instrument.tradingsymbol == f"{clean_symbol}-EQ")
    ).first()

    effective_price = req.price
    if effective_price <= 0:
        if inst and inst.current_ltp:
            effective_price = float(inst.current_ltp)
        elif ipo and ipo.current_ltp:
            effective_price = float(ipo.current_ltp)
        elif ipo and ipo.issue_price:
            effective_price = float(ipo.issue_price)

    est_value = round(req.quantity * effective_price, 2) if effective_price > 0 else 0.0

    # Calculate authoritative charges using BrokerageEstimateService
    from app.services.brokerage_estimate_service import BrokerageEstimateService
    charges_res = BrokerageEstimateService.estimate_charges(
        db=db,
        exchange=inst.exchange if inst else "NSE",
        symbol_token=inst.symbol_token if inst else (ipo.symbol_token if ipo else "0"),
        tradingsymbol=req.tradingsymbol,
        transaction_type=req.transaction_type,
        product_type="DELIVERY",
        quantity=req.quantity,
        price=effective_price,
        order_type=req.order_type
    )

    brokerage = charges_res.get("brokerage")
    stt = charges_res.get("stt_ctt")
    exchange_charges = charges_res.get("exchange_charges")
    gst = charges_res.get("gst")
    sebi_fees = charges_res.get("sebi_charges")
    stamp_duty = charges_res.get("stamp_duty")
    total_charges = charges_res.get("total_charges")
    safe_charges = total_charges if total_charges is not None else 0.0
    net_total = round(est_value + safe_charges if req.transaction_type == "BUY" else est_value - safe_charges, 2)

    blocking_reasons = []
    warnings = []

    if charges_res.get("status") == "UNAVAILABLE":
        warnings.append("Brokerage estimate unavailable: Live SmartAPI demat connection required for broker charges.")

    if effective_price <= 0:
        blocking_reasons.append("Price unavailable: Valid market quote or limit price required for order validation.")


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
        from app.services.holdings_service import get_holding_for_symbol
        holding_info = get_holding_for_symbol(db, account.id, clean_symbol)
        
        if not holding_info:
            available_balance = 0.0
            blocking_reasons.append(
                f"Insufficient holdings: Requested {req.quantity} shares of {clean_symbol}, but no verified holdings exist for account '{account.nickname}'."
            )
        else:
            total_owned = holding_info["quantity"]
            sellable_qty = holding_info["sellable_quantity"]
            blocked_qty = holding_info["blocked_quantity"]
            ver_status = holding_info["verification_status"]
            available_balance = float(sellable_qty)

            if req.quantity > total_owned:
                blocking_reasons.append(
                    f"Insufficient holdings: Requested {req.quantity} shares, but total owned quantity is only {total_owned}."
                )
            elif req.quantity > sellable_qty:
                if blocked_qty > 0:
                    blocking_reasons.append(
                        f"Insufficient sellable quantity: Requested {req.quantity} shares, but only {sellable_qty} available to sell ({blocked_qty} shares currently blocked in open orders)."
                    )
                else:
                    blocking_reasons.append(
                        f"Insufficient sellable quantity: Requested {req.quantity} shares, but only {sellable_qty} available."
                    )

            if ver_status == "VERIFICATION_REQUIRED":
                warnings.append(
                    "Sellability verification required: DDPI is not active. CDSL T-PIN authorization (eDIS) will be required prior to broker settlement."
                )
            elif ver_status == "DISCONNECTED":
                blocking_reasons.append(
                    f"Account '{account.nickname}' is disconnected. Reconnection required before submitting broker orders."
                )

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
                "success": False,
                "error_code": "BROKER_ACCOUNT_DISCONNECTED",
                "message": f"This account is disconnected. Historical data is available, but broker operations are disabled until reconnection."
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
            elif live_res.get("status") == "SUBMISSION_UNKNOWN":
                order.status = "SUBMISSION_UNKNOWN"
                order.rejection_reason = live_res.get("message", "Live order request timed out. Status unknown.")
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
                "success": False,
                "error_code": "BROKER_ACCOUNT_DISCONNECTED",
                "message": "This account is disconnected. Historical data is available, but broker operations are disabled until reconnection."
            }
        )

    if order.status not in ["ACCEPTED", "PREPARED"]:
        raise HTTPException(status_code=400, detail=f"Cannot cancel order in status '{order.status}'. Only open orders can be cancelled.")

    order.status = "CANCELLED"
    db.commit()
    return {"success": True, "message": "Order successfully cancelled.", "order_id": order.id, "status": "CANCELLED"}


@router.put("/{order_id}")
def modify_order(
    order_id: int,
    mod_in: Optional[OrderModifyRequest] = None,
    price: Optional[float] = Query(None),
    quantity: Optional[int] = Query(None),
    db: Session = Depends(get_db)
):
    """
    Modifies an open or prepared order.
    Enforces broker-account connection safety; disconnected accounts cannot modify orders.
    """
    order = db.query(Order).filter(Order.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    if order.account and not order.account.is_demo and order.account.auth_status != "CONNECTED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "success": False,
                "error_code": "BROKER_ACCOUNT_DISCONNECTED",
                "message": "This account is disconnected. Historical data is available, but broker operations are disabled until reconnection."
            }
        )

    if order.status not in ["ACCEPTED", "PREPARED"]:
        raise HTTPException(status_code=400, detail=f"Cannot modify order in status '{order.status}'.")

    eff_price = mod_in.price if mod_in and mod_in.price is not None else price
    eff_quantity = mod_in.quantity if mod_in and mod_in.quantity is not None else quantity

    if eff_price is not None and eff_price > 0:
        order.price = eff_price
    if eff_quantity is not None and eff_quantity > 0:
        order.quantity = eff_quantity

    db.commit()
    return {"success": True, "message": "Order successfully modified.", "order_id": order.id, "status": order.status}

