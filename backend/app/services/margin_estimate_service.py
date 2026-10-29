import time
from datetime import datetime
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from app.services.smartapi_adapter import get_any_active_market_adapter
from app.models.financial_types import make_financial_amount


class MarginEstimateService:
    """
    Authoritative Margin Calculator Service for IPOPro.
    Strictly integrates Angel One SmartAPI Margin Batch API:
    POST /rest/secure/angelbroking/margin/v1/batch

    Strict Data Rule:
    - Broker estimates MUST originate from authenticated SmartAPI responses.
    - If the broker API is unavailable, required_margin returns None with source UNAVAILABLE.
    - No hardcoded 20%, 20.236%, or arbitrary leverage calculation is ever presented as official broker data.
    """

    _cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
    CACHE_TTL_SECONDS = 45.0

    @classmethod
    def _make_cache_key(
        cls,
        exchange: str,
        symbol_token: str,
        transaction_type: str,
        product_type: str,
        quantity: int,
        price: float,
        order_type: str = "LIMIT"
    ) -> str:
        return f"{exchange.upper()}_{symbol_token}_{transaction_type.upper()}_{product_type.upper()}_{quantity}_{round(price, 2)}_{order_type.upper()}"

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
        order_type: Optional[str] = "LIMIT"
    ) -> Dict[str, Any]:
        """
        Calculates required margin for an order.
        Strictly consumes authentic broker API responses. If unavailable, returns UNAVAILABLE.
        """
        exchange = (exchange or "NSE").upper().strip()
        transaction_type = (transaction_type or "BUY").upper().strip()
        product_type = (product_type or "DELIVERY").upper().strip()
        order_type_val = (order_type or "LIMIT").upper().strip()

        # Normalize product type
        if product_type in ("CNC", "DELIVERY"):
            norm_product = "DELIVERY"
        elif product_type in ("MIS", "INTRADAY"):
            norm_product = "INTRADAY"
        else:
            norm_product = product_type

        quantity = max(1, int(quantity))
        price = max(0.0, float(price))
        full_trade_value = round(quantity * price, 2) if price > 0 else 0.0

        trade_val_amount = make_financial_amount(
            value=full_trade_value if price > 0 else None,
            source="DERIVED_FROM_VERIFIED_INPUTS" if price > 0 else "UNAVAILABLE",
            is_estimate=True,
            verified=(price > 0),
            error=None if price > 0 else "Price is zero or unavailable"
        )

        avail_funds_amount = make_financial_amount(
            value=available_funds,
            source="USER_INPUT",
            is_estimate=False,
            verified=True,
            error=None
        )

        # In-memory cache check
        cache_key = cls._make_cache_key(exchange, symbol_token, transaction_type, norm_product, quantity, price, order_type_val)
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
                            margin_resp["data"],
                            full_trade_value,
                            available_funds,
                            norm_product
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
        # We do NOT silently substitute 20.236% or arbitrary numbers as official data.
        req_margin_amount = make_financial_amount(
            value=None,
            source="UNAVAILABLE",
            is_estimate=False,
            verified=False,
            error=error_reason
        )

        # Optional separate indicative guideline explicitly labeled as non-broker schedule
        indicative_amount = None
        if price > 0:
            indicative_val = round(full_trade_value * 0.20, 2) if norm_product == "INTRADAY" else full_trade_value
            indicative_amount = make_financial_amount(
                value=indicative_val,
                source="INDICATIVE_REGULATORY_SCHEDULE",
                is_estimate=True,
                verified=False,
                error="Non-broker regulatory guideline only. Never used for live trade authorization."
            )

        resp = {
            "full_trade_value": full_trade_value,
            "required_margin": None,
            "available_funds": round(available_funds, 2),
            "remaining_funds": None,
            "is_sufficient": None,
            "leverage_multiplier": 1.0,
            "is_broker_verified": False,
            "data_source": "UNAVAILABLE",
            "status": "UNAVAILABLE",
            "message": error_reason or "Margin estimate unavailable from broker",
            "error_reason": error_reason,
            "details": {
                "full_trade_value": trade_val_amount,
                "required_margin": req_margin_amount,
                "available_funds": avail_funds_amount,
                "remaining_funds": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "indicative_regulatory_margin": indicative_amount
            }
        }
        return resp

    @classmethod
    def _parse_smartapi_margin_response(
        cls,
        data: Dict[str, Any],
        full_trade_value: float,
        available_funds: float,
        norm_product: str
    ) -> Optional[Dict[str, Any]]:
        """Parses authenticated response returned by official SmartAPI Margin Calculator."""
        try:
            total_margin = float(data.get("totalMarginRequired") or data.get("netMargin") or 0.0)
            if total_margin <= 0 and full_trade_value > 0:
                positions = data.get("positions") or []
                if positions:
                    pos = positions[0]
                    margin_obj = pos.get("margin") or {}
                    total_margin = float(margin_obj.get("total") or 0.0)

            if total_margin > 0:
                req_margin = round(total_margin, 2)
                remaining = round(available_funds - req_margin, 2)
                leverage = round(full_trade_value / req_margin, 2) if req_margin > 0 else 1.0
                is_sufficient = available_funds >= req_margin

                trade_val_amount = make_financial_amount(
                    value=full_trade_value,
                    source="DERIVED_FROM_VERIFIED_INPUTS",
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
                    source="USER_INPUT",
                    is_estimate=False,
                    verified=True
                )
                rem_funds_amount = make_financial_amount(
                    value=remaining,
                    source="DERIVED_FROM_VERIFIED_INPUTS",
                    is_estimate=True,
                    verified=True
                )

                return {
                    "full_trade_value": full_trade_value,
                    "required_margin": req_margin,
                    "available_funds": round(available_funds, 2),
                    "remaining_funds": remaining,
                    "is_sufficient": is_sufficient,
                    "leverage_multiplier": leverage,
                    "is_broker_verified": True,
                    "data_source": "BROKER_MARGIN_ESTIMATE",
                    "status": "VERIFIED",
                    "message": "Official Angel One SmartAPI margin estimate",
                    "error_reason": None,
                    "details": {
                        "full_trade_value": trade_val_amount,
                        "required_margin": req_margin_amount,
                        "available_funds": avail_funds_amount,
                        "remaining_funds": rem_funds_amount,
                        "indicative_regulatory_margin": None
                    }
                }
            return None
        except Exception:
            return None
