import time
from datetime import datetime
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from app.services.smartapi_adapter import get_any_active_market_adapter
from app.models.financial_types import make_financial_amount


class BrokerageEstimateService:
    """
    Authoritative Brokerage and Statutory Charges Estimator for IPOPro.
    Strictly integrates Angel One SmartAPI Brokerage Calculator API:
    POST /rest/secure/angelbroking/brokerage/v1/estimateCharges

    Strict Data Rule:
    - Broker estimates MUST originate from authenticated SmartAPI responses.
    - If the broker API is unavailable, total_charges returns None with source UNAVAILABLE.
    - DP charges are explicitly labeled as not included in broker pre-trade estimates.
    - Fixed tariffs are never silently substituted and labeled as official.
    """

    _cache: Dict[str, tuple[float, Dict[str, Any]]] = {}
    CACHE_TTL_SECONDS = 60.0

    @classmethod
    def _make_cache_key(
        cls,
        exchange: str,
        symbol_token: str,
        transaction_type: str,
        product_type: str,
        quantity: int,
        price: float
    ) -> str:
        return f"{exchange.upper()}_{symbol_token}_{transaction_type.upper()}_{product_type.upper()}_{quantity}_{round(price, 2)}"

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
        order_type: str = "LIMIT"
    ) -> Dict[str, Any]:
        """
        Calculates detailed brokerage and tax estimates.
        Strictly consumes authentic broker API responses. If unavailable, returns UNAVAILABLE.
        """
        exchange = (exchange or "NSE").upper().strip()
        transaction_type = (transaction_type or "BUY").upper().strip()
        product_type = (product_type or "DELIVERY").upper().strip()

        # Normalize product type
        if product_type in ("CNC", "DELIVERY"):
            norm_product = "DELIVERY"
        elif product_type in ("MIS", "INTRADAY"):
            norm_product = "INTRADAY"
        else:
            norm_product = product_type

        quantity = max(1, int(quantity))
        price = max(0.0, float(price))
        trade_value = round(quantity * price, 2) if price > 0 else 0.0

        trade_val_amount = make_financial_amount(
            value=trade_value if price > 0 else None,
            source="DERIVED_FROM_VERIFIED_INPUTS" if price > 0 else "UNAVAILABLE",
            is_estimate=True,
            verified=(price > 0),
            error=None if price > 0 else "Price is zero or unavailable"
        )

        cache_key = cls._make_cache_key(exchange, symbol_token, transaction_type, norm_product, quantity, price)
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
                        parsed = cls._parse_smartapi_brokerage_response(broker_resp["data"], trade_value)
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
        # We do NOT silently substitute fixed tariffs as confirmed broker data.
        indicative_schedule = None
        if price > 0:
            indicative_schedule = cls._compute_indicative_statutory_charges(
                exchange=exchange,
                transaction_type=transaction_type,
                product_type=norm_product,
                trade_value=trade_value
            )

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
            "error_reason": error_reason,
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
                "total_charges": make_financial_amount(None, "UNAVAILABLE", False, False, error=error_reason),
                "indicative_statutory_schedule": indicative_schedule
            }
        }
        return resp

    @classmethod
    def _parse_smartapi_brokerage_response(cls, data: Dict[str, Any], expected_trade_value: float) -> Optional[Dict[str, Any]]:
        """Parses the authentic charges breakup returned by official SmartAPI Brokerage Calculator."""
        try:
            summary = data.get("summary") or {}
            charges_list = data.get("charges") or []
            item_charge = charges_list[0] if charges_list else summary

            total_charges = float(item_charge.get("total_charges") or summary.get("total_charges") or 0.0)
            trade_val = float(item_charge.get("trade_value") or summary.get("trade_value") or expected_trade_value)

            brokerage = 0.0
            stt = 0.0
            exchange_charges = 0.0
            stamp_duty = 0.0
            sebi_charges = 0.0
            gst = 0.0

            breakup = item_charge.get("breakup") or summary.get("breakup") or []
            for b in breakup:
                name = (b.get("name") or "").lower()
                amt = float(b.get("amount") or 0.0)
                if "brokerage" in name:
                    brokerage += amt
                elif "external charges" in name:
                    for sub in b.get("breakup", []):
                        sub_name = (sub.get("name") or "").lower()
                        sub_amt = float(sub.get("amount") or 0.0)
                        if "exchange" in sub_name:
                            exchange_charges += sub_amt
                        elif "stamp" in sub_name:
                            stamp_duty += sub_amt
                        elif "sebi" in sub_name:
                            sebi_charges += sub_amt
                elif "taxes" in name:
                    for sub in b.get("breakup", []):
                        sub_name = (sub.get("name") or "").lower()
                        sub_amt = float(sub.get("amount") or 0.0)
                        if "security" in sub_name or "stt" in sub_name:
                            stt += sub_amt
                        elif "gst" in sub_name:
                            gst += sub_amt

            # DP Charges are explicitly noted as NOT calculated by SmartAPI pre-trade endpoint
            dp_amount = make_financial_amount(
                value=None,
                source="UNAVAILABLE",
                is_estimate=False,
                verified=False,
                error="DP charges (approx ₹15.34 on CDSL settlement) are not included in Angel One pre-trade estimate"
            )

            return {
                "trade_value": round(trade_val, 2),
                "brokerage": round(brokerage, 2),
                "stt_ctt": round(stt, 2),
                "exchange_charges": round(exchange_charges, 2),
                "sebi_charges": round(sebi_charges, 4),
                "stamp_duty": round(stamp_duty, 2),
                "gst": round(gst, 2),
                "dp_charges": None,
                "total_charges": round(total_charges, 2),
                "is_broker_verified": True,
                "verified": True,
                "data_source": "BROKER_CHARGES_ESTIMATE",
                "status": "VERIFIED",
                "error_reason": None,
                "disclaimer": "Official Angel One Brokerage Calculator estimate. Actual exchange execution fees may vary slightly based on final tick round-off.",
                "details": {
                    "trade_value": make_financial_amount(trade_val, "DERIVED_FROM_VERIFIED_INPUTS", True, True),
                    "brokerage": make_financial_amount(brokerage, "BROKER_CHARGES_ESTIMATE", True, True),
                    "stt_ctt": make_financial_amount(stt, "BROKER_CHARGES_ESTIMATE", True, True),
                    "exchange_charges": make_financial_amount(exchange_charges, "BROKER_CHARGES_ESTIMATE", True, True),
                    "sebi_charges": make_financial_amount(sebi_charges, "BROKER_CHARGES_ESTIMATE", True, True),
                    "stamp_duty": make_financial_amount(stamp_duty, "BROKER_CHARGES_ESTIMATE", True, True),
                    "gst": make_financial_amount(gst, "BROKER_CHARGES_ESTIMATE", True, True),
                    "dp_charges": dp_amount,
                    "total_charges": make_financial_amount(total_charges, "BROKER_CHARGES_ESTIMATE", True, True),
                    "indicative_statutory_schedule": None
                }
            }
        except Exception:
            return None

    @classmethod
    def _compute_indicative_statutory_charges(
        cls,
        exchange: str,
        transaction_type: str,
        product_type: str,
        trade_value: float
    ) -> Dict[str, Any]:
        """
        Separate indicative statutory schedule for investor reference only.
        Clearly tagged as non-broker schedule. Never presented as official broker charges.
        """
        is_buy = transaction_type == "BUY"
        is_delivery = product_type == "DELIVERY"
        is_bse = exchange == "BSE"

        exch_rate = 0.0000375 if is_bse else 0.0000297
        exchange_charges = round(trade_value * exch_rate, 2)
        brokerage = 0.0 if is_delivery else round(min(20.0, trade_value * 0.0003), 2)
        stt = round(trade_value * 0.001, 2) if is_delivery else (round(trade_value * 0.00025, 2) if not is_buy else 0.0)
        sebi_charges = round(trade_value * 0.000001, 4)
        stamp_duty = round(trade_value * (0.00015 if is_delivery else 0.00003), 2) if is_buy else 0.0
        gst = round((brokerage + exchange_charges + sebi_charges) * 0.18, 2)
        total = round(brokerage + stt + exchange_charges + sebi_charges + stamp_duty + gst, 2)

        return {
            "indicative_total": total,
            "indicative_brokerage": brokerage,
            "indicative_stt": stt,
            "indicative_exchange_charges": exchange_charges,
            "indicative_stamp_duty": stamp_duty,
            "indicative_sebi_charges": sebi_charges,
            "indicative_gst": gst,
            "source": "INDICATIVE_STATUTORY_SCHEDULE",
            "verified": False,
            "is_estimate": True,
            "disclaimer": "Indicative statutory formula estimate per published SEBI/tax rates. Not confirmed by Angel One SmartAPI and cannot authorize live trades."
        }
