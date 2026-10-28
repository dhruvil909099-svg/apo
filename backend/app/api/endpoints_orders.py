import uuid
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
from app.schemas.order import (
    OrderSingleCreate, BulkOrderPrepareRequest, BulkOrderPreviewResponse,
    BulkOrderExecuteRequest, OrderResponse
)
from app.services.bulk_order_service import BulkOrderService
from app.services.paper_trading_service import PaperTradingService

router = APIRouter(prefix="/orders", tags=["Orders"])


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

    client_order_id = str(uuid.uuid4())
    order = Order(
        client_order_id=client_order_id,
        account_id=account.id,
        tradingsymbol=order_in.tradingsymbol,
        symbol_token=order_in.symbol_token,
        exchange=order_in.exchange,
        transaction_type=order_in.transaction_type,
        order_type=order_in.order_type,
        product_type="DELIVERY",
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

    if order.status not in ["ACCEPTED", "PREPARED"]:
        raise HTTPException(status_code=400, detail=f"Cannot cancel order in status '{order.status}'. Only open orders can be cancelled.")

    order.status = "CANCELLED"
    db.commit()
    return {"message": "Order successfully cancelled.", "order_id": order.id, "status": "CANCELLED"}
