import time
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.risk import RiskLimit
from app.core.config import settings


class AccountEligibilityService:
    """
    Account Eligibility Service for IPOPro Angel One Order Management.
    Evaluates demat accounts against connection status, session freshness,
    funds/holdings sufficiency, DDPI/eDIS compliance, and commercial static-IP restrictions.
    """

    @classmethod
    def check_single_account_eligibility(
        cls,
        db: Session,
        account: Account,
        symbol: str,
        transaction_type: str,
        quantity: int,
        price: float,
        product_type: str = "DELIVERY",
        is_live_requested: bool = False
    ) -> Dict[str, Any]:
        """
        Validates whether a single Angel One account is eligible to submit an order.
        """
        blocking_reasons: List[str] = []
        warnings: List[str] = []

        # 1. Account existence and enabled state
        if not account.is_enabled:
            blocking_reasons.append(f"Account '{account.nickname}' is disabled.")

        # 2. Connection and authentication state
        if not account.is_demo:
            if account.auth_status != "CONNECTED":
                blocking_reasons.append(
                    f"Account '{account.nickname}' is {account.auth_status}. Angel One SmartAPI reconnection required."
                )

        # 3. Static IP and commercial permission gate for Live trading
        if is_live_requested and not account.is_demo and settings.TRADING_MODE == "LIVE":
            if settings.STATIC_IP_CHECK:
                from app.services.smartapi_adapter import verify_production_egress_ip
                egress_res = verify_production_egress_ip()
                if not egress_res.get("is_valid"):
                    blocking_reasons.append(
                        f"STATIC IP GATE: {egress_res.get('message')}"
                    )
                else:
                    warnings.append(
                        f"Static IP verified: Outbound egress {egress_res.get('actual_egress_ip')} matches Angel One whitelist."
                    )

        # 4. Emergency Kill Switch check
        global_risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
        if global_risk and global_risk.emergency_trading_disabled:
            blocking_reasons.append("EMERGENCY KILL SWITCH is ACTIVE. All order placements are blocked.")

        # 5. Quantity and Price sanity
        if quantity <= 0:
            blocking_reasons.append("Quantity must be greater than zero.")
        if price <= 0 and product_type != "MARKET":
            warnings.append("Price is zero or reference price. Market execution will be used.")

        # 6. Funds check for BUY
        est_val = round(quantity * price, 2)
        if transaction_type.upper() == "BUY":
            avail_funds = float(account.available_cash or 0.0)
            if avail_funds < est_val and product_type.upper() in ("DELIVERY", "CNC"):
                shortfall = round(est_val - avail_funds, 2)
                blocking_reasons.append(
                    f"Insufficient funds: Required ₹{est_val:,.2f}, Available ₹{avail_funds:,.2f} (Shortfall: ₹{shortfall:,.2f})."
                )

        # 7. Holdings check for SELL
        if transaction_type.upper() == "SELL":
            from app.services.holdings_service import get_holding_for_symbol
            clean_sym = symbol.replace("-EQ", "").strip().upper()
            holding_info = get_holding_for_symbol(db, account.id, clean_sym)
            owned_qty = holding_info.get("quantity", 0) if holding_info else 0
            blocked_qty = holding_info.get("blocked_quantity", 0) if holding_info else 0
            sellable_qty = max(0, owned_qty - blocked_qty)

            if quantity > owned_qty:
                blocking_reasons.append(
                    f"Insufficient holdings: Requested {quantity} shares, but total owned quantity is {owned_qty}."
                )
            elif quantity > sellable_qty:
                blocking_reasons.append(
                    f"Insufficient sellable quantity: Requested {quantity} shares, but only {sellable_qty} available ({blocked_qty} blocked in pending orders)."
                )

            # DDPI / eDIS check
            if account.ddpi_status != "ACTIVE" and not account.edis_authorized_today and not account.is_demo:
                warnings.append(
                    "DDPI is inactive. CDSL eDIS T-PIN authorization may be required prior to trade settlement."
                )

        is_eligible = len(blocking_reasons) == 0
        return {
            "account_id": account.id,
            "nickname": account.nickname,
            "masked_client_code": account.masked_client_code,
            "is_eligible": is_eligible,
            "blocking_reasons": blocking_reasons,
            "warnings": warnings,
            "available_funds": float(account.available_cash or 0.0),
            "estimated_value": est_val,
            "auth_status": account.auth_status,
            "ddpi_status": account.ddpi_status
        }

    @classmethod
    def filter_all_eligible_accounts(
        cls,
        db: Session,
        symbol: str,
        transaction_type: str,
        quantity: int,
        price: float,
        product_type: str = "DELIVERY"
    ) -> Dict[str, Any]:
        """
        Mode C — Evaluates all accounts in the system and categorizes them into
        Eligible vs Blocked/Excluded, providing clear transparent reasons.
        """
        all_accounts = db.query(Account).all()
        eligible_accounts: List[Dict[str, Any]] = []
        blocked_accounts: List[Dict[str, Any]] = []

        for acc in all_accounts:
            res = cls.check_single_account_eligibility(
                db=db,
                account=acc,
                symbol=symbol,
                transaction_type=transaction_type,
                quantity=quantity,
                price=price,
                product_type=product_type
            )
            if res["is_eligible"]:
                eligible_accounts.append(res)
            else:
                blocked_accounts.append(res)

        return {
            "total_accounts": len(all_accounts),
            "eligible_count": len(eligible_accounts),
            "blocked_count": len(blocked_accounts),
            "eligible_accounts": eligible_accounts,
            "blocked_accounts": blocked_accounts
        }
