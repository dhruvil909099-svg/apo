from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.risk import RiskLimit
from app.core.config import settings


class RiskValidationService:
    """
    Risk Validation Service for IPOPro.
    Enforces maximum order notional value, per-account quantity thresholds,
    and emergency halts.
    """

    @classmethod
    def validate_order_risk(
        cls,
        db: Session,
        account_id: int,
        quantity: int,
        price: float
    ) -> Dict[str, Any]:
        """
        Validates order quantity and trade value against global and account-specific risk parameters.
        """
        errors: List[str] = []
        warnings: List[str] = []

        # 1. Global Emergency Kill Switch
        global_risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
        if global_risk and global_risk.emergency_trading_disabled:
            errors.append("EMERGENCY KILL SWITCH is ACTIVE. Trading is currently halted.")
            return {"passed": False, "errors": errors, "warnings": warnings}

        # 2. Account-specific Risk Limits
        acc_risk = db.query(RiskLimit).filter(RiskLimit.account_id == account_id).first()

        max_order_val = (
            float(acc_risk.max_order_value)
            if (acc_risk and acc_risk.max_order_value)
            else settings.GLOBAL_MAX_ORDER_VALUE
        )
        max_order_qty = (
            int(acc_risk.max_order_quantity)
            if (acc_risk and acc_risk.max_order_quantity)
            else settings.GLOBAL_MAX_QUANTITY_PER_ACCOUNT
        )

        order_val = round(quantity * price, 2)

        if order_val > max_order_val:
            errors.append(
                f"Order value ₹{order_val:,.2f} exceeds permitted maximum ₹{max_order_val:,.2f}."
            )

        if quantity > max_order_qty:
            errors.append(
                f"Order quantity {quantity:,} exceeds permitted maximum {max_order_qty:,} shares."
            )

        return {
            "passed": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "order_value": order_val,
            "max_order_value": max_order_val,
            "max_order_quantity": max_order_qty
        }
