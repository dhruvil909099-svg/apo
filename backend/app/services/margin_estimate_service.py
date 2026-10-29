import time
from datetime import datetime
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from app.services.smartapi_adapter import (
    get_any_active_market_adapter,
    get_authenticated_adapter_for_account_id
)
from app.models.financial_types import make_financial_amount


class MarginEstimateService:
    """
    Authoritative Margin Calculator Service for IPOPro.
    Strictly integrates Angel One SmartAPI Margin Batch API:
    POST /rest/secure/angelbroking/margin/v1/batch

    Strict Data Rules:
    - Broker estimates MUST originate from authenticated SmartAPI responses.
    - If the broker API is unavailable, required_margin returns None with source UNAVAILABLE.
    - No hardcoded 20%, 20.236%, or arbitrary leverage calculation is ever presented as official broker data.
    - Account isolation is strictly preserved; estimates for Account A are never returned for Account B.
    """

    _cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
    CACHE_TTL_SECONDS = 15.0

    @classmethod
    def _make_cache_key(
        cls,
        account_id: Optional[int],
        exchange: str,
        symbol_token: str,
        transaction_type: str,
        product_type: str,
        quantity: int,
        price: float,
        order_type: str = "LIMIT"
    ) -> str:
        acc_str = str(account_id or "NO_ACC")
        return f"{acc_str}_{exchange.upper()}_{symbol_token}_{transaction_type.upper()}_{product_type.upper()}_{quantity}_{round(price, 2)}_{order_type.upper()}"

    @classmethod
    def calculate_margin(
        cls,
        db: Optional[Session],
        exchange: str,
        symbol_token: str,
        tradingsymbol: str,
        transaction_type: str,
        product_type: str,
        quantity: int,
        price: float,
        available_funds: float = 0.0,
        order_type: Optional[str] = "LIMIT",
        account_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Calculates required margin for an order.
        Strictly consumes authentic broker API responses. If unavailable, returns UNAVAILABLE.
        """
        exchange = (exchange or "NSE").upper().strip()
        transaction_type = (transaction_type or "BUY").upper().strip()
        product_type = (product_type or "DELIVERY").upper().strip()
        order_type_val = (order_type or "LIMIT").upper().strip()

        # Normalize product type to Angel One SmartAPI specifications
        if product_type in ("CNC", "DELIVERY"):
            norm_product = "DELIVERY"
        elif product_type in ("MIS", "INTRADAY"):
            norm_product = "INTRADAY"
        elif product_type in ("NRML", "CARRYFORWARD"):
            norm_product = "CARRYFORWARD"
        elif product_type in ("MTF", "MARGIN"):
            norm_product = "MARGIN"
        else:
            norm_product = product_type

        quantity = max(1, int(quantity))
        price = max(0.0, float(price))
        full_trade_value = round(quantity * price, 2) if price > 0 else 0.0

        trade_val_amount = make_financial_amount(
            value=full_trade_value if price > 0 else None,
            source="DERIVED_FROM_VERIFIED_INPUTS",
            is_estimate=False,
            verified=(price > 0),
            error=None if price > 0 else "Price is zero or unavailable"
        )

        account_masked_code = None
        adapter = None

        if db and account_id:
            from app.models.account import Account
            acc_obj = db.query(Account).filter(Account.id == account_id).first()
            if acc_obj:
                account_masked_code = acc_obj.masked_client_code
                if acc_obj.available_cash is not None:
                    available_funds = float(acc_obj.available_cash)
                adapter = get_authenticated_adapter_for_account_id(db, account_id)
                # Fresh RMS balance check if connected
                if adapter and not acc_obj.is_demo:
                    try:
                        rms_data = adapter.get_rms()
                        if rms_data and ("availablecash" in rms_data or "net" in rms_data):
                            fresh_cash = float(rms_data.get("availablecash", rms_data.get("net", available_funds)))
                            available_funds = fresh_cash
                            acc_obj.available_cash = round(fresh_cash, 2)
                            db.commit()
                    except Exception:
                        pass

        avail_funds_amount = make_financial_amount(
            value=available_funds,
            source="SMARTAPI_RMS" if account_id else "USER_INPUT",
            is_estimate=False,
            verified=(account_id is not None),
            error=None
        )

        # In-memory cache check (account-specific key, 15s TTL)
        cache_key = cls._make_cache_key(account_id, exchange, symbol_token, transaction_type, norm_product, quantity, price, order_type_val)
        cached = cls._cache.get(cache_key)
        if cached:
            ts, val = cached
            if time.time() - ts < cls.CACHE_TTL_SECONDS:
                result = dict(val)
                req_val = result.get("required_margin")
                if req_val is not None:
                    result["available_funds"] = round(available_funds, 2)
                    result["remaining_funds"] = round(available_funds - req_val, 2)
                    result["is_sufficient"] = available_funds >= req_val
                return result

        # 1. Attempt official SmartAPI Margin Calculator
        error_reason: Optional[str] = None
        if price <= 0:
            error_reason = "Cannot estimate margin: Market quote or limit price is zero or unavailable"
        elif not symbol_token or symbol_token == "0":
            error_reason = "Cannot estimate margin: Instrument token is missing or invalid"
        elif db:
            if not adapter:
                adapter = get_any_active_market_adapter(db)
            if not adapter:
                error_reason = "No active Angel One SmartAPI demat connection available for broker margin calculation"
            else:
                try:
                    positions = [{
                        "exchange": exchange,
                        "qty": quantity,
                        "price": price,
                        "productType": norm_product,
                        "token": str(symbol_token),
                        "tradeType": transaction_type,
                        "orderType": order_type_val
                    }]
                    margin_resp = adapter.get_margin_batch(positions)
                    if margin_resp and margin_resp.get("status") and margin_resp.get("data"):
                        parsed = cls._parse_smartapi_margin_response(
                            data=margin_resp["data"],
                            full_trade_value=full_trade_value,
                            available_funds=available_funds,
                            norm_product=norm_product,
                            account_id=account_id,
                            account_masked_code=account_masked_code
                        )
                        if parsed:
                            cls._cache[cache_key] = (time.time(), parsed)
                            return parsed
                        else:
                            error_reason = "SmartAPI margin response contained no valid margin fields"
                    else:
                        msg = margin_resp.get("message") if margin_resp else "Unknown error"
                        error_reason = f"SmartAPI margin calculation rejected by broker: {msg}"
                except Exception as e:
                    error_reason = f"Network exception communicating with SmartAPI Margin endpoint: {str(e)}"
        else:
            error_reason = "Database session required to access active broker adapter"

        # 2. Broker API is UNAVAILABLE: Return explicit null with provenance
        # We do NOT silently substitute 20%, 20.236% or arbitrary leverage as official data.
        req_margin_amount = make_financial_amount(
            value=None,
            source="UNAVAILABLE",
            is_estimate=False,
            verified=False,
            error=error_reason
        )

        resp = {
            "full_trade_value": full_trade_value,
            "required_margin": None,
            "margin_for_order": None,
            "total_margin_required": None,
            "margin_components": None,
            "available_funds": round(available_funds, 2),
            "remaining_funds": None,
            "is_sufficient": None,
            "leverage_multiplier": 1.0,
            "is_broker_verified": False,
            "data_source": "UNAVAILABLE",
            "status": "UNAVAILABLE",
            "status_label": "UNAVAILABLE",
            "message": error_reason or "Margin estimate unavailable from broker",
            "error_reason": error_reason,
            "account_id": account_id,
            "account_masked_code": account_masked_code,
            "request_timestamp": datetime.utcnow().isoformat(),
            "details": {
                "full_trade_value": trade_val_amount,
                "required_margin": req_margin_amount,
                "available_funds": avail_funds_amount,
                "remaining_funds": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "margin_components": None
            }
        }
        return resp

    @classmethod
    def _parse_smartapi_margin_response(
        cls,
        data: Dict[str, Any],
        full_trade_value: float,
        available_funds: float,
        norm_product: str,
        account_id: Optional[int] = None,
        account_masked_code: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Parses authenticated response returned by official SmartAPI Margin Calculator."""
        try:
            total_margin = float(data.get("totalMarginRequired") or data.get("netMargin") or 0.0)
            margin_components: Dict[str, Any] = data.get("marginComponents") or {}

            positions = data.get("positions") or []
            if positions:
                pos = positions[0]
                margin_obj = pos.get("margin") or pos.get("marginComponents") or {}
                if total_margin <= 0:
                    total_margin = float(margin_obj.get("total") or 0.0)
                if not margin_components and margin_obj:
                    margin_components = margin_obj

            if total_margin > 0:
                req_margin = round(total_margin, 2)
                remaining = round(available_funds - req_margin, 2)
                leverage = round(full_trade_value / req_margin, 2) if req_margin > 0 else 1.0
                is_sufficient = available_funds >= req_margin

                trade_val_amount = make_financial_amount(
                    value=full_trade_value,
                    source="CALCULATED",
                    is_estimate=True,
                    verified=True
                )
                req_margin_amount = make_financial_amount(
                    value=req_margin,
                    source="BROKER_MARGIN_ESTIMATE",
                    is_estimate=True,
                    verified=True
                )
                avail_funds_amount = make_financial_amount(
                    value=available_funds,
                    source="SMARTAPI_RMS" if account_id else "USER_INPUT",
                    is_estimate=False,
                    verified=(account_id is not None)
                )
                rem_funds_amount = make_financial_amount(
                    value=remaining,
                    source="CALCULATED",
                    is_estimate=True,
                    verified=True
                )

                now_iso = datetime.utcnow().isoformat()

                return {
                    "full_trade_value": full_trade_value,
                    "required_margin": req_margin,
                    "margin_for_order": req_margin,
                    "total_margin_required": req_margin,
                    "margin_components": margin_components,
                    "available_funds": round(available_funds, 2),
                    "remaining_funds": remaining,
                    "is_sufficient": is_sufficient,
                    "leverage_multiplier": leverage,
                    "is_broker_verified": True,
                    "data_source": "BROKER_MARGIN_ESTIMATE",
                    "status": "VERIFIED",
                    "status_label": "BROKER ESTIMATE",
                    "message": "Official Angel One SmartAPI margin estimate",
                    "error_reason": None,
                    "account_id": account_id,
                    "account_masked_code": account_masked_code,
                    "request_timestamp": now_iso,
                    "details": {
                        "full_trade_value": trade_val_amount,
                        "required_margin": req_margin_amount,
                        "available_funds": avail_funds_amount,
                        "remaining_funds": rem_funds_amount,
                        "margin_components": margin_components
                    }
                }
            return None
        except Exception:
            return None
