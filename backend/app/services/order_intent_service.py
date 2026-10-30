import uuid
import logging
from typing import Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.order import Order
from app.models.account import Account
from app.core.config import settings
from app.services.paper_trading_service import PaperTradingService
from app.services.account_eligibility_service import AccountEligibilityService
from app.services.risk_validation_service import RiskValidationService

logger = logging.getLogger(__name__)


class OrderIntentService:
    """
    Durable Order Intent Service for IPOPro.
    Ensures every order intent is durably recorded in the database BEFORE broker transmission.
    Prevents duplicates through client_order_id idempotency keys.
    Maintains rigorous paper vs. live mode boundary.
    """

    @classmethod
    def create_and_execute_order(
        cls,
        db: Session,
        account_id: int,
        tradingsymbol: str,
        symbol_token: str,
        exchange: str,
        transaction_type: str,
        order_type: str,
        product_type: str,
        quantity: int,
        price: float,
        trigger_price: float = 0.0,
        variety: str = "NORMAL",
        idempotency_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Creates a durable order intent, validates eligibility and risk,
        and safely routes to either Paper Simulator or Live SmartAPI Adapter.
        """
        account = db.query(Account).filter(Account.id == account_id).first()
        if not account:
            return {"success": False, "status": "REJECTED", "message": f"Account {account_id} not found."}

        # Idempotency check: if client_order_id already exists in database
        client_order_id = idempotency_key or str(uuid.uuid4())
        existing = db.query(Order).filter(Order.client_order_id == client_order_id).first()
        if existing:
            logger.warning(f"Duplicate order submission blocked by idempotency key: {client_order_id}")
            return {
                "success": existing.status in ("ACCEPTED", "EXECUTED"),
                "status": existing.status,
                "order_id": existing.id,
                "client_order_id": existing.client_order_id,
                "broker_order_id": existing.broker_order_id,
                "is_paper_trade": existing.is_paper_trade,
                "message": f"Order already processed (Status: {existing.status}). Duplicate submission prevented."
            }

        # Risk validation
        risk_check = RiskValidationService.validate_order_risk(db, account_id, quantity, price)
        if not risk_check["passed"]:
            return {
                "success": False,
                "status": "BLOCKED",
                "message": "; ".join(risk_check["errors"])
            }

        clean_symbol = tradingsymbol.replace("-EQ", "").strip().upper()
        norm_product = "DELIVERY" if product_type.upper() in ("CNC", "DELIVERY") else "INTRADAY"
        is_paper = (settings.TRADING_MODE == "PAPER" or account.is_demo)

        # 1. Durably record order in DRAFT / PREPARED state before any external communication
        order = Order(
            client_order_id=client_order_id,
            account_id=account.id,
            tradingsymbol=clean_symbol,
            symbol_token=str(symbol_token or "0"),
            exchange=exchange.upper(),
            transaction_type=transaction_type.upper(),
            order_type=order_type.upper(),
            product_type=norm_product,
            variety=variety,
            quantity=quantity,
            price=price,
            trigger_price=trigger_price,
            status="PREPARED",
            is_paper_trade=is_paper
        )
        db.add(order)
        db.commit()
        db.refresh(order)

        # 2. Execution Routing
        if is_paper:
            # Paper execution (100% simulated, never debits real funds or contacts Angel One exchange)
            sim_res = PaperTradingService.execute_paper_order(db, order)
            return {
                "success": sim_res.get("success", False) or order.status in ("ACCEPTED", "EXECUTED"),
                "status": order.status,
                "order_id": order.id,
                "client_order_id": order.client_order_id,
                "broker_order_id": order.broker_order_id,
                "is_paper_trade": True,
                "rejection_reason": order.rejection_reason,
                "message": (
                    f"Simulated Paper order executed! Status: {order.status} (Client ID: {order.client_order_id[:8]}). "
                    "Note: Operating in Paper Mode. Simulated orders do NOT appear in the Angel One app."
                )
            }
        else:
            # Live execution via Angel One SmartAPI
            from app.core.security import cipher
            import time
            from app.services.smartapi_adapter import get_adapter_for_account

            order.status = "SUBMITTING"
            db.commit()

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
                        order.rejection_reason = f"Authentication failure: {auth_res['message']}"
                        db.commit()
                        return {
                            "success": False,
                            "status": "REJECTED",
                            "order_id": order.id,
                            "client_order_id": order.client_order_id,
                            "is_paper_trade": False,
                            "message": order.rejection_reason
                        }

                live_res = adapter.place_order({
                    "variety": order.variety,
                    "tradingsymbol": order.tradingsymbol,
                    "symbol_token": order.symbol_token,
                    "transaction_type": order.transaction_type,
                    "exchange": order.exchange,
                    "order_type": order.order_type,
                    "product_type": order.product_type,
                    "price": order.price,
                    "quantity": order.quantity,
                    "trigger_price": order.trigger_price
                })

                if live_res.get("success"):
                    order.status = "ACCEPTED"
                    order.broker_order_id = live_res.get("broker_order_id")
                    db.commit()
                    return {
                        "success": True,
                        "status": "ACCEPTED",
                        "order_id": order.id,
                        "client_order_id": order.client_order_id,
                        "broker_order_id": order.broker_order_id,
                        "is_paper_trade": False,
                        "message": f"Live order submitted to Angel One! Broker Order ID: {order.broker_order_id}"
                    }
                elif live_res.get("status") == "SUBMISSION_UNKNOWN":
                    order.status = "UNKNOWN_SUBMISSION"
                    order.rejection_reason = live_res.get("message", "Live order request timed out. Status unknown.")
                    db.commit()
                    return {
                        "success": False,
                        "status": "UNKNOWN_SUBMISSION",
                        "order_id": order.id,
                        "client_order_id": order.client_order_id,
                        "is_paper_trade": False,
                        "message": "Order submission timed out. Status unknown. Check Order Book for broker reconciliation."
                    }
                else:
                    order.status = "REJECTED"
                    order.rejection_reason = live_res.get("message", "Order rejected by broker")
                    db.commit()
                    return {
                        "success": False,
                        "status": "REJECTED",
                        "order_id": order.id,
                        "client_order_id": order.client_order_id,
                        "is_paper_trade": False,
                        "message": order.rejection_reason
                    }
            except Exception as e:
                order.status = "REJECTED"
                order.rejection_reason = str(e)
                db.commit()
                return {
                    "success": False,
                    "status": "REJECTED",
                    "order_id": order.id,
                    "client_order_id": order.client_order_id,
                    "is_paper_trade": False,
                    "message": f"Exception submitting live order: {str(e)}"
                }
