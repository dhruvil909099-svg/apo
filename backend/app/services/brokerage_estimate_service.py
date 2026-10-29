import time
import math
from typing import Dict, Any, Optional, List
from sqlalchemy.orm import Session
from app.services.smartapi_adapter import get_any_active_market_adapter


class BrokerageEstimateService:
    """
    Authoritative Brokerage and Statutory Charges Estimator for IPOPro.
    Integrates Angel One SmartAPI Brokerage Calculator API:
    POST /rest/secure/angelbroking/brokerage/v1/estimateCharges

    With robust statutory formula fallback following SEBI, Exchange, and Government tax schedules:
    - Securities Transaction Tax (STT / CTT)
    - Exchange Transaction Charges (NSE / BSE / MCX)
    - SEBI Turnover Charges
    - Stamp Duty (Indian Stamp Act)
    - Goods & Services Tax (GST 18%)
    - Depository Participant (DP) Charges on delivery sales
    """

    # In-memory LRU-style cache with 60s TTL
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
        Checks cache, queries live SmartAPI adapter, or applies verified statutory schedules.
        """
        exchange = (exchange or "NSE").upper().strip()
        transaction_type = (transaction_type or "BUY").upper().strip()
        product_type = (product_type or "DELIVERY").upper().strip()
        # Normalize product type: DELIVERY / CNC vs INTRADAY / MIS
        if product_type in ("CNC", "DELIVERY"):
            norm_product = "DELIVERY"
        elif product_type in ("MIS", "INTRADAY"):
            norm_product = "INTRADAY"
        else:
            norm_product = product_type

        quantity = max(1, int(quantity))
        price = max(0.0, float(price))
        trade_value = round(quantity * price, 2)

        cache_key = cls._make_cache_key(exchange, symbol_token, transaction_type, norm_product, quantity, price)
        cached = cls._cache.get(cache_key)
        if cached:
            ts, val = cached
            if time.time() - ts < cls.CACHE_TTL_SECONDS:
                return val

        # 1. Attempt official SmartAPI Brokerage Calculator API if DB session provided
        if db:
            adapter = get_any_active_market_adapter(db)
            if adapter and symbol_token and symbol_token != "0":
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
                except Exception:
                    pass

        # 2. Verified Statutory Fallback Calculation
        calc = cls._compute_statutory_charges(
            exchange=exchange,
            transaction_type=transaction_type,
            product_type=norm_product,
            quantity=quantity,
            price=price,
            trade_value=trade_value
        )
        cls._cache[cache_key] = (time.time(), calc)
        return calc

    @classmethod
    def _parse_smartapi_brokerage_response(cls, data: Dict[str, Any], expected_trade_value: float) -> Optional[Dict[str, Any]]:
        """Parses the nested charges breakup returned by official SmartAPI Brokerage Calculator."""
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

            return {
                "trade_value": round(trade_val, 2),
                "brokerage": round(brokerage, 2),
                "stt_ctt": round(stt, 2),
                "exchange_charges": round(exchange_charges, 2),
                "sebi_charges": round(sebi_charges, 4),
                "stamp_duty": round(stamp_duty, 2),
                "gst": round(gst, 2),
                "dp_charges": 0.0,
                "total_charges": round(total_charges, 2),
                "is_broker_verified": True,
                "data_source": "SMARTAPI_BROKERAGE_CALCULATOR",
                "disclaimer": "Official Angel One Brokerage Calculator estimate. Actual exchange execution fees may vary slightly based on final tick round-off."
            }
        except Exception:
            return None

    @classmethod
    def _compute_statutory_charges(
        cls,
        exchange: str,
        transaction_type: str,
        product_type: str,
        quantity: int,
        price: float,
        trade_value: float
    ) -> Dict[str, Any]:
        """
        Verified SEBI, Exchange, and Angel One tariff schedule:
        Equity Delivery (CNC):
          - Angel One Brokerage: ₹0
          - STT: 0.1% on Buy and 0.1% on Sell
          - Exchange Charges: NSE 0.00297%, BSE 0.00375%
          - GST: 18% on (Brokerage + Exchange Charges + SEBI Fees)
          - SEBI Charges: ₹10 per crore (0.0001%)
          - Stamp Duty: 0.015% on Buy only
          - DP Charges: ₹15.34 (₹13 + 18% GST) on Delivery Sell only
        Equity Intraday (MIS):
          - Angel One Brokerage: Min(₹20, 0.03% of trade value)
          - STT: 0.025% on Sell only (0 on Buy)
          - Exchange Charges: NSE 0.00297%, BSE 0.00375%
          - GST: 18% on (Brokerage + Exchange Charges + SEBI Fees)
          - SEBI Charges: 0.0001%
          - Stamp Duty: 0.003% on Buy only
        """
        is_buy = transaction_type == "BUY"
        is_delivery = product_type == "DELIVERY"
        is_bse = exchange == "BSE"

        # Exchange transaction charges
        exch_rate = 0.0000375 if is_bse else 0.0000297
        exchange_charges = round(trade_value * exch_rate, 2)

        # Brokerage
        if is_delivery:
            brokerage = 0.0  # Zero brokerage on delivery
        else:
            # Intraday: lower of ₹20 or 0.03%
            brokerage = round(min(20.0, trade_value * 0.0003), 2)

        # STT
        if is_delivery:
            stt = round(trade_value * 0.001, 2)  # 0.1% on buy and sell
        else:
            stt = round(trade_value * 0.00025, 2) if not is_buy else 0.0  # 0.025% on sell only

        # SEBI Turnover Charges (₹10/crore = 0.0001%)
        sebi_charges = round(trade_value * 0.000001, 4)

        # Stamp duty
        if is_buy:
            stamp_rate = 0.00015 if is_delivery else 0.00003
            stamp_duty = round(trade_value * stamp_rate, 2)
        else:
            stamp_duty = 0.0

        # GST: 18% on (Brokerage + Exchange Charges + SEBI Fees)
        taxable_services = brokerage + exchange_charges + sebi_charges
        gst = round(taxable_services * 0.18, 2)

        # DP Charges (₹13 + 18% GST = ₹15.34 on Delivery Sell)
        dp_charges = 15.34 if (not is_buy and is_delivery) else 0.0

        total_charges = round(brokerage + stt + exchange_charges + sebi_charges + stamp_duty + gst + dp_charges, 2)

        return {
            "trade_value": trade_value,
            "brokerage": brokerage,
            "stt_ctt": stt,
            "exchange_charges": exchange_charges,
            "sebi_charges": sebi_charges,
            "stamp_duty": stamp_duty,
            "gst": gst,
            "dp_charges": dp_charges,
            "total_charges": total_charges,
            "is_broker_verified": False,
            "data_source": "STATUTORY_SCHEDULE_ESTIMATE",
            "disclaimer": "Estimated statutory charges per SEBI, Exchange and Stamp Duty schedules. Live broker charges will apply on execution."
        }
