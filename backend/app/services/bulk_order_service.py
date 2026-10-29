import uuid
import json
from typing import Dict, Any, List
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.risk import RiskLimit
from app.models.audit import AuditLog
from app.core.config import settings
from app.core.security import cipher, sanitize_dict_for_logging
from app.services.paper_trading_service import PaperTradingService
import time
from app.services.smartapi_adapter import SmartAPIAdapter, get_adapter_for_account


class BulkOrderService:
    """
    Coordinates multi-account bulk order drafting, validation, pre-flight checks,
    and segregated order dispatching across authorized demat accounts.
    """

    @staticmethod
    def prepare_and_validate(db: Session, request_data: Dict[str, Any]) -> Dict[str, Any]:
        batch_id = str(uuid.uuid4())
        ipo_id = request_data.get("ipo_id")
        ipo = db.query(IPO).filter(IPO.id == ipo_id).first() if ipo_id else None
        
        target_accounts = request_data.get("accounts", [])
        base_price = float(request_data.get("price", 0.0))
        order_type = request_data.get("order_type", "LIMIT")
        transaction_type = request_data.get("transaction_type", "BUY").upper()
        product_type = request_data.get("product_type", "DELIVERY").upper()
        exchange = request_data.get("exchange", "NSE")
        symbol_token = str(request_data.get("symbol_token", ""))
        tradingsymbol = request_data.get("tradingsymbol", "")
        clean_symbol = tradingsymbol.replace("-EQ", "").strip().upper()

        proposed_orders: List[Dict[str, Any]] = []
        blocking_errors: List[str] = []
        warnings: List[str] = []

        total_quantity = 0
        total_estimated_value = 0.0

        # Global risk limit
        global_risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
        if global_risk and global_risk.emergency_trading_disabled:
            blocking_errors.append("EMERGENCY KILL SWITCH is active. Order preparation prohibited.")

        if not target_accounts:
            blocking_errors.append("No accounts selected for bulk operation.")

        for item in target_accounts:
            acc_id = item.get("account_id")
            proposed_qty = int(item.get("quantity", 0))
            price_override = item.get("price_override")
            price = float(price_override) if price_override is not None else base_price

            account = db.query(Account).filter(Account.id == acc_id).first()
            if not account:
                blocking_errors.append(f"Account ID {acc_id} does not exist in authorized account database.")
                continue

            holding_qty = 0
            if transaction_type == "SELL":
                from app.services.holdings_service import get_holding_for_symbol
                h_info = get_holding_for_symbol(db, account.id, clean_symbol)
                if h_info:
                    holding_qty = h_info["quantity"]
                elif ipo_id:
                    allotment = db.query(Allotment).filter(
                        Allotment.account_id == account.id,
                        Allotment.ipo_id == ipo_id
                    ).first()
                    holding_qty = allotment.allotted_quantity if allotment else 0

            is_valid = True
            msg = "Validation passed"

            # Check account connection state and enabled status
            if not account.is_demo and account.auth_status != "CONNECTED":
                is_valid = False
                msg = f"BROKER_ACCOUNT_DISCONNECTED: Account '{account.nickname}' is {account.auth_status}. Reconnection required."
            elif not account.is_enabled:
                is_valid = False
                msg = "Account is disabled."
            elif price <= 0 and order_type == "LIMIT":
                is_valid = False
                msg = "Limit price must be greater than zero."

            # Calculate value check
            est_val = proposed_qty * price

            # Check balance / holdings
            if is_valid:
                if transaction_type == "BUY":
                    avail_cash = account.available_cash or 0.0
                    if avail_cash < est_val:
                        is_valid = False
                        msg = f"Insufficient funds: required ₹{est_val:,.2f}, available ₹{avail_cash:,.2f}."
                elif transaction_type == "SELL":
                    if proposed_qty > holding_qty:
                        is_valid = False
                        msg = f"Insufficient shares: requested {proposed_qty}, only {holding_qty} available."

            # Check depository status if live trading SELL
            if settings.TRADING_MODE == "LIVE" and transaction_type == "SELL":
                if account.ddpi_status != "ACTIVE" and not account.edis_authorized_today:
                    warnings.append(f"Account {account.nickname} has no DDPI; CDSL eDIS TPIN authorization required before submission.")

            # Value limit check
            if global_risk and est_val > global_risk.max_order_value:
                is_valid = False
                msg = f"Order value (₹{est_val:,.2f}) exceeds max allowed per account (₹{global_risk.max_order_value:,.2f})."

            proposed_orders.append({
                "account_id": account.id,
                "nickname": account.nickname,
                "masked_client_code": account.masked_client_code,
                "account_group": account.account_group,
                "holding_quantity": holding_qty,
                "available_cash": account.available_cash or 0.0,
                "proposed_quantity": proposed_qty,
                "price": price,
                "transaction_type": transaction_type,
                "product_type": product_type,
                "order_type": order_type,
                "estimated_value": est_val,
                "ddpi_active": account.ddpi_status == "ACTIVE",
                "edis_authorized": account.edis_authorized_today,
                "is_valid": is_valid,
                "message": msg
            })

            if is_valid:
                total_quantity += proposed_qty
                total_estimated_value += est_val
            else:
                blocking_errors.append(f"[{account.nickname}]: {msg}")

        # Bulk limit caps
        if len(target_accounts) > settings.MAX_ORDERS_PER_BULK:
            blocking_errors.append(f"Requested {len(target_accounts)} orders exceeds maximum bulk limit of {settings.MAX_ORDERS_PER_BULK}.")

        is_executable = len(blocking_errors) == 0 and len(proposed_orders) > 0

        # Save prepared order drafts in DB with PREPARED status
        if is_executable:
            for p in proposed_orders:
                if p["is_valid"]:
                    order_record = Order(
                        client_order_id=str(uuid.uuid4()),
                        account_id=p["account_id"],
                        batch_id=batch_id,
                        tradingsymbol=tradingsymbol,
                        symbol_token=symbol_token,
                        exchange=exchange,
                        transaction_type=transaction_type,
                        order_type=p["order_type"],
                        product_type=product_type,
                        variety="NORMAL",
                        quantity=p["proposed_quantity"],
                        price=p["price"],
                        status="PREPARED",
                        is_paper_trade=(settings.TRADING_MODE == "PAPER" or account.is_demo)
                    )
                    db.add(order_record)
            db.commit()

        # Audit log of bulk preparation
        audit = AuditLog(
            event_type="BULK_ORDERS_PREPARED",
            operator="OPERATOR",
            details_json=json.dumps(sanitize_dict_for_logging({
                "batch_id": batch_id,
                "total_accounts": len(target_accounts),
                "total_quantity": total_quantity,
                "total_estimated_value": total_estimated_value,
                "is_executable": is_executable
            }))
        )
        db.add(audit)
        db.commit()

        return {
            "batch_id": batch_id,
            "is_executable": is_executable,
            "total_accounts": len(proposed_orders),
            "total_quantity": total_quantity,
            "total_estimated_value": total_estimated_value,
            "proposed_orders": proposed_orders,
            "blocking_errors": list(set(blocking_errors)),
            "warnings": list(set(warnings))
        }

    @staticmethod
    def execute_batch(db: Session, batch_id: str, operator_confirmed: bool) -> Dict[str, Any]:
        """
        Executes all PREPARED orders in a specific batch.
        Enforces explicit operator confirmation and handles account-level failures independently.
        """
        if not operator_confirmed:
            return {"success": False, "message": "Explicit operator confirmation is required to submit bulk orders."}

        # Check emergency halt before execution
        global_risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
        if global_risk and global_risk.emergency_trading_disabled:
            return {
                "success": False,
                "message": "EMERGENCY_HALT_ACTIVE: Bulk execution blocked by active kill switch."
            }

        prepared_orders = db.query(Order).filter(
            Order.batch_id == batch_id,
            Order.status == "PREPARED"
        ).all()

        if not prepared_orders:
            return {"success": False, "message": f"No prepared orders found for batch ID {batch_id}."}

        results: List[Dict[str, Any]] = []
        successful_count = 0
        failed_count = 0

        for order in prepared_orders:
            account = db.query(Account).filter(Account.id == order.account_id).first()
            if not account:
                order.status = "REJECTED"
                order.rejection_reason = "Account missing"
                db.commit()
                failed_count += 1
                continue

            if not account.is_demo and account.auth_status != "CONNECTED":
                order.status = "REJECTED"
                order.rejection_reason = f"BROKER_ACCOUNT_DISCONNECTED: Account '{account.nickname}' is {account.auth_status}."
                db.commit()
                failed_count += 1
                results.append({
                    "account_id": account.id,
                    "nickname": account.nickname,
                    "masked_client_code": account.masked_client_code,
                    "client_order_id": order.client_order_id,
                    "broker_order_id": order.broker_order_id,
                    "status": order.status,
                    "filled_quantity": 0,
                    "price": order.price,
                    "rejection_reason": order.rejection_reason
                })
                continue

            order.status = "SUBMITTED"
            db.commit()

            # Execute via paper trader or live adapter
            if settings.TRADING_MODE == "PAPER" or account.is_demo:
                sim_res = PaperTradingService.execute_paper_order(db, order)
                results.append({
                    "account_id": account.id,
                    "nickname": account.nickname,
                    "masked_client_code": account.masked_client_code,
                    "client_order_id": order.client_order_id,
                    "broker_order_id": order.broker_order_id,
                    "status": order.status,
                    "filled_quantity": order.filled_quantity,
                    "price": order.execution_price or order.price,
                    "rejection_reason": order.rejection_reason
                })
                if order.status in ["ACCEPTED", "EXECUTED"]:
                    successful_count += 1
                else:
                    failed_count += 1
            else:
                # Live Execution via SmartAPI adapter
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
                            failed_count += 1
                            results.append({
                                "account_id": account.id,
                                "nickname": account.nickname,
                                "client_order_id": order.client_order_id,
                                "status": "REJECTED",
                                "rejection_reason": order.rejection_reason
                            })
                            continue

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
                        successful_count += 1
                    else:
                        order.status = "REJECTED"
                        order.rejection_reason = live_res["message"]
                        failed_count += 1

                    db.commit()
                    results.append({
                        "account_id": account.id,
                        "nickname": account.nickname,
                        "client_order_id": order.client_order_id,
                        "broker_order_id": order.broker_order_id,
                        "status": order.status,
                        "rejection_reason": order.rejection_reason
                    })
                except Exception as e:
                    order.status = "REJECTED"
                    order.rejection_reason = f"Execution exception: {str(e)}"
                    db.commit()
                    failed_count += 1
                    results.append({
                        "account_id": account.id,
                        "nickname": account.nickname,
                        "client_order_id": order.client_order_id,
                        "status": "REJECTED",
                        "rejection_reason": order.rejection_reason
                    })

        # Record audit log
        audit = AuditLog(
            event_type="BULK_ORDERS_EXECUTED",
            operator="OPERATOR",
            details_json=json.dumps(sanitize_dict_for_logging({
                "batch_id": batch_id,
                "total_attempted": len(prepared_orders),
                "successful_count": successful_count,
                "failed_count": failed_count,
                "trading_mode": settings.TRADING_MODE
            }))
        )
        db.add(audit)
        db.commit()

        return {
            "batch_id": batch_id,
            "total_submitted": len(prepared_orders),
            "successful_count": successful_count,
            "failed_count": failed_count,
            "results": results
        }
