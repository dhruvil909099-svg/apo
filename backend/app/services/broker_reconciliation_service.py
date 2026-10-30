import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.order import Order
from app.models.account import Account
from app.services.smartapi_adapter import get_authenticated_adapter_for_account_id

logger = logging.getLogger(__name__)


class BrokerReconciliationService:
    """
    Broker Status Reconciliation Service for Angel One SmartAPI.
    Reconciles locally submitted orders with genuine broker-confirmed states from
    Angel One's official Order Book (/rest/secure/angelbroking/order/v1/getOrderBook).
    Resolves SUBMITTING, PREPARED, and UNKNOWN_SUBMISSION orders safely without blind retries.
    """

    @classmethod
    def reconcile_account_orders(
        cls,
        db: Session,
        account_id: int
    ) -> Dict[str, Any]:
        """
        Reconciles all open or pending orders for a specific Angel One account
        against the live broker order book.
        """
        account = db.query(Account).filter(Account.id == account_id).first()
        if not account or account.is_demo:
            return {"success": True, "reconciled_count": 0, "message": "Demo/simulated account skips broker reconciliation"}

        adapter = get_authenticated_adapter_for_account_id(db, account_id)
        if not adapter:
            return {"success": False, "reconciled_count": 0, "message": f"Active broker session unavailable for account {account.nickname}"}

        broker_orders = adapter.get_order_book()
        if broker_orders is None:
            return {"success": False, "reconciled_count": 0, "message": adapter.last_error or "Failed to fetch broker order book"}

        # Map broker orders by orderid
        broker_map: Dict[str, Dict[str, Any]] = {}
        for bo in broker_orders:
            oid = str(bo.get("orderid") or bo.get("orderId") or "")
            if oid:
                broker_map[oid] = bo

        # Find pending / active local orders
        active_local_orders = db.query(Order).filter(
            Order.account_id == account_id,
            Order.is_paper_trade == False,
            Order.status.in_(["SUBMITTED", "SUBMITTING", "PREPARED", "OPEN", "SUBMISSION_UNKNOWN", "UNKNOWN_SUBMISSION"])
        ).all()

        reconciled_count = 0
        for local_order in active_local_orders:
            b_id = str(local_order.broker_order_id or "")
            if b_id and b_id in broker_map:
                bo = broker_map[b_id]
                raw_status = str(bo.get("status") or bo.get("orderstatus") or "").lower()
                filled_shares = int(bo.get("filledshares") or bo.get("filledqty") or 0)
                avg_price = float(bo.get("averageprice") or bo.get("avgprice") or 0.0)
                text_reason = bo.get("text") or bo.get("rejectionreason") or None

                if "complete" in raw_status or "filled" in raw_status:
                    local_order.status = "EXECUTED"
                    local_order.filled_quantity = filled_shares or local_order.quantity
                    if avg_price > 0:
                        local_order.execution_price = avg_price
                elif "cancel" in raw_status:
                    local_order.status = "CANCELLED"
                    local_order.rejection_reason = text_reason
                elif "reject" in raw_status:
                    local_order.status = "REJECTED"
                    local_order.rejection_reason = text_reason
                elif "open" in raw_status or "trigger pending" in raw_status:
                    local_order.status = "ACCEPTED"
                    local_order.filled_quantity = filled_shares

                local_order.updated_at = datetime.utcnow()
                reconciled_count += 1
            elif local_order.status in ("SUBMITTING", "SUBMISSION_UNKNOWN", "UNKNOWN_SUBMISSION"):
                # If order is not found in broker order book after reasonable time
                elapsed = (datetime.utcnow() - (local_order.created_at or datetime.utcnow())).total_seconds()
                if elapsed > 120:  # 2 minutes grace period
                    local_order.status = "RECONCILIATION_REQUIRED"
                    local_order.rejection_reason = "Order not found in broker order book after submission timeout. Manual investigation required."
                    local_order.updated_at = datetime.utcnow()
                    reconciled_count += 1

        db.commit()
        return {
            "success": True,
            "account_id": account_id,
            "reconciled_count": reconciled_count,
            "total_broker_orders_today": len(broker_orders)
        }
