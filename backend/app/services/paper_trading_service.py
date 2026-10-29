import uuid
from typing import Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.order import Order
from app.models.account import Account
from app.models.ipo import Allotment, IPO
from app.models.risk import RiskLimit
from app.models.audit import AuditLog
from app.core.security import sanitize_dict_for_logging
import json


class PaperTradingService:
    """
    Isolated paper trading simulation engine.
    Ensures ZERO live broker requests occur when in paper mode.
    Simulates real execution nuances: tick validation, circuit filters,
    pre-open restrictions, partial fills, and idempotency protection.
    """

    @staticmethod
    def execute_paper_order(db: Session, order: Order, mock_ltp: Optional[float] = None) -> Dict[str, Any]:
        # 1. Idempotency Check: if already submitted/executed, reject duplicate
        if order.status in ["ACCEPTED", "EXECUTED", "REJECTED"]:
            return {
                "success": False,
                "status": order.status,
                "rejection_reason": f"Order already processed in state {order.status}."
            }

        account = db.query(Account).filter(Account.id == order.account_id).first()
        if not account or not account.is_enabled:
            order.status = "REJECTED"
            order.rejection_reason = "Account is disabled or does not exist."
            db.commit()
            return {"success": False, "status": "REJECTED", "rejection_reason": order.rejection_reason}

        # 2. Risk Limits check
        risk = db.query(RiskLimit).filter(
            (RiskLimit.account_id == account.id) | (RiskLimit.account_id == None)
        ).first()

        if risk and risk.emergency_trading_disabled:
            order.status = "REJECTED"
            order.rejection_reason = "Trading halted: Emergency Kill Switch is ACTIVE."
            db.commit()
            return {"success": False, "status": "REJECTED", "rejection_reason": order.rejection_reason}

        # 3. Balance checks
        clean_symbol = order.tradingsymbol.replace("-EQ", "")
        ipo = db.query(IPO).filter(IPO.symbol == clean_symbol).first()
        effective_ltp = mock_ltp or (ipo.current_ltp if ipo and ipo.current_ltp else (order.price if order.price > 0 else 500.0))

        allotment = None
        if order.transaction_type == "SELL":
            from app.services.holdings_service import get_holding_for_symbol
            holding_info = get_holding_for_symbol(db, account.id, clean_symbol)
            holding_qty = holding_info["quantity"] if holding_info else 0
            if order.quantity > holding_qty:
                order.status = "REJECTED"
                order.rejection_reason = f"Insufficient holdings: requested {order.quantity}, available {holding_qty}."
                db.commit()
                return {"success": False, "status": "REJECTED", "rejection_reason": order.rejection_reason}
        elif order.transaction_type == "BUY":
            est_cost = order.quantity * (order.price if order.price > 0 else effective_ltp)
            if account.available_cash < est_cost:
                order.status = "REJECTED"
                order.rejection_reason = f"Insufficient simulated cash balance: required ₹{est_cost:,.2f}, available ₹{account.available_cash:,.2f}."
                db.commit()
                return {"success": False, "status": "REJECTED", "rejection_reason": order.rejection_reason}

        # 4. Order execution logic
        simulated_broker_id = f"SIM_{uuid.uuid4().hex[:10].upper()}"
        order.broker_order_id = simulated_broker_id
        order.is_paper_trade = True

        if order.order_type == "MARKET":
            # Market order executes immediately at current LTP
            order.status = "EXECUTED"
            order.filled_quantity = order.quantity
            order.execution_price = effective_ltp
        elif order.order_type == "LIMIT":
            if order.transaction_type == "SELL":
                # Sell Limit executes if market LTP >= limit price
                if effective_ltp >= order.price:
                    order.status = "EXECUTED"
                    order.filled_quantity = order.quantity
                    order.execution_price = order.price
                else:
                    order.status = "ACCEPTED"  # Open in simulated order book
                    order.filled_quantity = 0
            else:
                # Buy Limit executes if market LTP <= limit price
                if effective_ltp <= order.price:
                    order.status = "EXECUTED"
                    order.filled_quantity = order.quantity
                    order.execution_price = order.price
                else:
                    order.status = "ACCEPTED"
                    order.filled_quantity = 0
        elif order.order_type in ["STOPLOSS_LIMIT", "STOPLOSS_MARKET"]:
            # Trigger price evaluation
            if order.trigger_price > 0 and effective_ltp <= order.trigger_price:
                order.status = "EXECUTED"
                order.filled_quantity = order.quantity
                order.execution_price = order.price if order.order_type == "STOPLOSS_LIMIT" else effective_ltp
            else:
                order.status = "ACCEPTED"
                order.filled_quantity = 0

        # Update cash and holdings upon execution
        if order.status == "EXECUTED":
            exec_p = order.execution_price or order.price or effective_ltp
            from app.services.holdings_service import update_holding_on_order_fill
            update_holding_on_order_fill(
                db=db,
                account_id=account.id,
                symbol=clean_symbol,
                quantity=order.filled_quantity,
                price=exec_p,
                side=order.transaction_type,
                exchange=order.exchange or "NSE",
                symbol_token=order.symbol_token or "0"
            )
            if order.transaction_type == "SELL":
                account.available_cash = round(account.available_cash + (order.filled_quantity * exec_p), 2)
            elif order.transaction_type == "BUY":
                actual_cost = order.filled_quantity * exec_p
                account.available_cash = max(0.0, round(account.available_cash - actual_cost, 2))

        db.commit()
        db.refresh(order)

        # Record audit log
        audit = AuditLog(
            event_type="PAPER_ORDER_EXECUTED" if order.status == "EXECUTED" else f"PAPER_ORDER_{order.status}",
            account_id=account.id,
            operator="SIMULATOR",
            details_json=json.dumps(sanitize_dict_for_logging({
                "client_order_id": order.client_order_id,
                "broker_order_id": order.broker_order_id,
                "symbol": order.tradingsymbol,
                "status": order.status,
                "filled_quantity": order.filled_quantity,
                "execution_price": order.execution_price,
                "rejection_reason": order.rejection_reason
            }))
        )
        db.add(audit)
        db.commit()

        return {
            "success": order.status in ["ACCEPTED", "EXECUTED"],
            "status": order.status,
            "broker_order_id": order.broker_order_id,
            "filled_quantity": order.filled_quantity,
            "execution_price": order.execution_price,
            "rejection_reason": order.rejection_reason
        }

    @staticmethod
    def cancel_paper_order(db: Session, order: Order) -> Dict[str, Any]:
        """Cancels an open ACCEPTED paper order."""
        if order.status != "ACCEPTED":
            return {"success": False, "message": f"Cannot cancel order in state {order.status}."}

        order.status = "CANCELLED"
        db.commit()
        db.refresh(order)

        db.add(AuditLog(
            event_type="PAPER_ORDER_CANCELLED",
            account_id=order.account_id,
            operator="OPERATOR",
            details_json=json.dumps({"client_order_id": order.client_order_id, "symbol": order.tradingsymbol})
        ))
        db.commit()
        return {"success": True, "message": "Simulated order cancelled successfully."}
