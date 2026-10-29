import time
from datetime import datetime
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from app.services.smartapi_adapter import (
    get_any_active_market_adapter,
    get_authenticated_adapter_for_account_id
)
from app.models.financial_types import make_financial_amount


class BrokerageEstimateService:
    """
    Authoritative Brokerage and Statutory Charges Estimator for IPOPro.
    Strictly integrates Angel One SmartAPI Brokerage Calculator API:
    POST /rest/secure/angelbroking/brokerage/v1/estimateCharges

    Strict Data Rules:
    - Broker estimates MUST originate from authenticated SmartAPI responses.
    - If the broker API is unavailable, total_charges returns None with source UNAVAILABLE.
    - DP charges are explicitly labeled as not included in broker pre-trade estimates.
    - No homegrown statutory formulas or guessed taxes.
    - Account isolation is strictly enforced.
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
    def estimate_charges(
        cls,
        db: Optional[Session],
        exchange: str,
        symbol_token: str,
        tradingsymbol: str,
        transaction_type: str,
        product_type: str,
        quantity: int,
        price: float,
        order_type: str = "LIMIT",
        account_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Calculates detailed brokerage and tax estimates.
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
        elif product_type in ("NRML", "CARRYFORWARD"):
            norm_product = "CARRYFORWARD"
        elif product_type in ("MTF", "MARGIN"):
            norm_product = "MARGIN"
        else:
            norm_product = product_type

        quantity = max(1, int(quantity))
        price = max(0.0, float(price))
        trade_value = round(quantity * price, 2) if price > 0 else 0.0

        trade_val_amount = make_financial_amount(
            value=trade_value if price > 0 else None,
            source="CALCULATED",
            is_estimate=True,
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
                adapter = get_authenticated_adapter_for_account_id(db, account_id)

        # In-memory cache check (account-specific key, 15s TTL)
        cache_key = cls._make_cache_key(account_id, exchange, symbol_token, transaction_type, norm_product, quantity, price, order_type_val)
        cached = cls._cache.get(cache_key)
        if cached:
            ts, val = cached
            if time.time() - ts < cls.CACHE_TTL_SECONDS:
                return val

        # 1. Attempt official SmartAPI Brokerage Calculator API
        error_reason: Optional[str] = None
        if price <= 0:
            error_reason = "Cannot estimate charges: Market quote or limit price is zero or unavailable"
        elif not symbol_token or symbol_token == "0":
            error_reason = "Cannot estimate charges: Instrument token is missing or invalid"
        elif db:
            if not adapter:
                adapter = get_any_active_market_adapter(db)
            if not adapter:
                error_reason = "No active Angel One SmartAPI demat connection available for broker charges calculation"
            else:
                try:
                    orders_payload = [{
                        "product_type": norm_product,
                        "transaction_type": transaction_type,
                        "quantity": str(quantity),
                        "price": str(price),
                        "exchange": exchange,
                        "symbol_name": tradingsymbol,
                        "token": str(symbol_token)
                    }]
                    broker_resp = adapter.estimate_charges(orders_payload)
                    if broker_resp and broker_resp.get("status") and broker_resp.get("data"):
                        parsed = cls._parse_smartapi_brokerage_response(
                            data=broker_resp["data"],
                            expected_trade_value=trade_value,
                            account_id=account_id,
                            account_masked_code=account_masked_code
                        )
                        if parsed:
                            cls._cache[cache_key] = (time.time(), parsed)
                            return parsed
                        else:
                            error_reason = "SmartAPI brokerage response contained no valid charge breakup"
                    else:
                        msg = broker_resp.get("message") if broker_resp else "Unknown error"
                        error_reason = f"SmartAPI brokerage calculation rejected by broker: {msg}"
                except Exception as e:
                    error_reason = f"Network exception communicating with SmartAPI Brokerage endpoint: {str(e)}"
        else:
            error_reason = "Database session required to access active broker adapter"

        # 2. Broker API is UNAVAILABLE: Return explicit null with provenance
        # We do NOT silently substitute homemade statutory formulas as official broker data.
        resp = {
            "trade_value": trade_value,
            "brokerage": None,
            "stt_ctt": None,
            "exchange_charges": None,
            "sebi_charges": None,
            "stamp_duty": None,
            "gst": None,
            "dp_charges": None,
            "total_charges": None,
            "is_broker_verified": False,
            "verified": False,
            "data_source": "UNAVAILABLE",
            "status": "UNAVAILABLE",
            "status_label": "UNAVAILABLE",
            "error_reason": error_reason,
            "account_id": account_id,
            "account_masked_code": account_masked_code,
            "request_timestamp": datetime.utcnow().isoformat(),
            "disclaimer": "Broker charges unavailable. Live Angel One SmartAPI demat connection required.",
            "details": {
                "trade_value": trade_val_amount,
                "brokerage": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "stt_ctt": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "exchange_charges": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "sebi_charges": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "stamp_duty": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "gst": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "dp_charges": make_financial_amount(None, "UNAVAILABLE", False, False, error="DP charges apply upon CDSL settlement and are not included in broker trade estimate"),
                "total_charges": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason)
            }
        }
        return resp

    @classmethod
    def _parse_smartapi_brokerage_response(
        cls,
        data: Dict[str, Any],
        expected_trade_value: float,
        account_id: Optional[int] = None,
        account_masked_code: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Parses authentic charges breakup returned by official SmartAPI Brokerage Calculator."""
        try:
            summary = data.get("summary") or {}
            charges_list = data.get("charges") or []
            item_charge = charges_list[0] if charges_list else summary

            total_charges_raw = item_charge.get("total_charges") or summary.get("total_charges")
            total_charges = float(total_charges_raw) if total_charges_raw is not None else None

            trade_val_raw = item_charge.get("trade_value") or summary.get("trade_value")
            trade_val = float(trade_val_raw) if trade_val_raw is not None else expected_trade_value

            brokerage: Optional[float] = None
            stt: Optional[float] = None
            exchange_charges: Optional[float] = None
            stamp_duty: Optional[float] = None
            sebi_charges: Optional[float] = None
            gst: Optional[float] = None

            def _extract_from_breakup(items: list):
                nonlocal brokerage, stt, exchange_charges, stamp_duty, sebi_charges, gst
                for b in items:
                    name = (b.get("name") or "").lower()
                    amt = float(b.get("amount") or 0.0)
                    sub_items = b.get("breakup") or []
                    if sub_items:
                        _extract_from_breakup(sub_items)
                    else:
                        if "brokerage" in name:
                            brokerage = round((brokerage or 0.0) + amt, 2)
                        elif "exchange" in name or ("transaction charge" in name and "sebi" not in name):
                            exchange_charges = round((exchange_charges or 0.0) + amt, 2)
                        elif "stamp" in name:
                            stamp_duty = round((stamp_duty or 0.0) + amt, 2)
                        elif "sebi" in name:
                            sebi_charges = round((sebi_charges or 0.0) + amt, 4)
                        elif any(k in name for k in ("stt", "ctt", "securit", "commodit")):
                            stt = round((stt or 0.0) + amt, 2)
                        elif "gst" in name:
                            gst = round((gst or 0.0) + amt, 2)

            breakup = item_charge.get("breakup") or summary.get("breakup") or []
            if breakup:
                _extract_from_breakup(breakup)

            # Flat key fallbacks if present in broker response
            if brokerage is None and item_charge.get("brokerage") is not None:
                brokerage = float(item_charge["brokerage"])
            if stt is None and (item_charge.get("stt") is not None or item_charge.get("stt_ctt") is not None):
                stt = float(item_charge.get("stt") or item_charge.get("stt_ctt"))
            if exchange_charges is None and (item_charge.get("exchange_charges") is not None or item_charge.get("exchange_transaction_charges") is not None):
                exchange_charges = float(item_charge.get("exchange_charges") or item_charge.get("exchange_transaction_charges"))
            if stamp_duty is None and item_charge.get("stamp_duty") is not None:
                stamp_duty = float(item_charge["stamp_duty"])
            if sebi_charges is None and (item_charge.get("sebi_charges") is not None or item_charge.get("sebi_turnover_fees") is not None):
                sebi_charges = float(item_charge.get("sebi_charges") or item_charge.get("sebi_turnover_fees"))
            if gst is None and item_charge.get("gst") is not None:
                gst = float(item_charge["gst"])

            # DP Charges are explicitly noted as NOT calculated by SmartAPI pre-trade endpoint
            dp_amount = make_financial_amount(
                value=None,
                source="UNAVAILABLE",
                is_estimate=False,
                verified=False,
                error="DP charges apply upon CDSL settlement and are not included in broker trade estimate"
            )

            now_iso = datetime.utcnow().isoformat()

            return {
                "trade_value": round(trade_val, 2),
                "brokerage": brokerage,
                "stt_ctt": stt,
                "exchange_charges": exchange_charges,
                "sebi_charges": sebi_charges,
                "stamp_duty": stamp_duty,
                "gst": gst,
                "dp_charges": None,
                "total_charges": round(total_charges, 2) if total_charges is not None else None,
                "is_broker_verified": True,
                "verified": True,
                "data_source": "BROKER_CHARGES_ESTIMATE",
                "status": "VERIFIED",
                "status_label": "BROKER ESTIMATE",
                "error_reason": None,
                "account_id": account_id,
                "account_masked_code": account_masked_code,
                "request_timestamp": now_iso,
                "disclaimer": "Official Angel One Brokerage Calculator estimate. Actual exchange execution fees may vary slightly based on final tick round-off.",
                "details": {
                    "trade_value": make_financial_amount(trade_val, "CALCULATED", True, True),
                    "brokerage": make_financial_amount(brokerage, "BROKER_CHARGES_ESTIMATE", True, True) if brokerage is not None else make_financial_amount(None, "NOT_PROVIDED", False, False),
                    "stt_ctt": make_financial_amount(stt, "BROKER_CHARGES_ESTIMATE", True, True) if stt is not None else make_financial_amount(None, "NOT_PROVIDED", False, False),
                    "exchange_charges": make_financial_amount(exchange_charges, "BROKER_CHARGES_ESTIMATE", True, True) if exchange_charges is not None else make_financial_amount(None, "NOT_PROVIDED", False, False),
                    "sebi_charges": make_financial_amount(sebi_charges, "BROKER_CHARGES_ESTIMATE", True, True) if sebi_charges is not None else make_financial_amount(None, "NOT_PROVIDED", False, False),
                    "stamp_duty": make_financial_amount(stamp_duty, "BROKER_CHARGES_ESTIMATE", True, True) if stamp_duty is not None else make_financial_amount(None, "NOT_PROVIDED", False, False),
                    "gst": make_financial_amount(gst, "BROKER_CHARGES_ESTIMATE", True, True) if gst is not None else make_financial_amount(None, "NOT_PROVIDED", False, False),
                    "dp_charges": dp_amount,
                    "total_charges": make_financial_amount(total_charges, "BROKER_CHARGES_ESTIMATE", True, True) if total_charges is not None else make_financial_amount(None, "UNAVAILABLE", False, False)
                }
            }
        except Exception:
            return None
