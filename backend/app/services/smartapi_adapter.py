import time
import logging
from typing import Dict, Any, Optional, List
import requests
from app.core.security import generate_totp_token, sanitize_dict_for_logging

logger = logging.getLogger("smartapi_adapter")


class SmartAPIAdapter:
    """
    Production broker adapter for Angel One SmartAPI.
    Strictly enforces 1:1 account session isolation.
    Handles TOTP generation, token lifecycle, rate-limiting, and error mapping.
    """
    BASE_URL = "https://apiconnect.angelone.in"

    def __init__(self, api_key: str, client_code: str, pin: str, totp_secret: str):
        self.api_key = api_key
        self.client_code = client_code
        self.pin = pin
        self.totp_secret = totp_secret
        
        self.jwt_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.feed_token: Optional[str] = None
        self.token_expiry_timestamp: float = 0
        self._last_request_time: float = 0

    def _get_headers(self) -> Dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-PrivateKey": self.api_key,
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": "127.0.0.1",
            "X-ClientPublicIP": "106.193.147.1",
            "X-MACAddress": "fe80::1",
        }
        if self.jwt_token:
            headers["Authorization"] = f"Bearer {self.jwt_token}"
        return headers

    def authenticate(self) -> Dict[str, Any]:
        """
        Performs official loginByPassword with freshly computed 6-digit TOTP code.
        """
        totp_code = generate_totp_token(self.totp_secret)
        if not totp_code:
            return {"success": False, "message": "Failed to generate valid TOTP code from secret", "error_code": "INVALID_TOTP"}

        url = f"{self.BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword"
        payload = {
            "clientcode": self.client_code,
            "password": self.pin,
            "totp": totp_code
        }

        try:
            resp = requests.post(url, json=payload, headers=self._get_headers(), timeout=10)
            data = resp.json()
            if data.get("status") and data.get("data"):
                token_data = data["data"]
                self.jwt_token = token_data.get("jwtToken")
                self.refresh_token = token_data.get("refreshToken")
                self.feed_token = token_data.get("feedToken")
                self.token_expiry_timestamp = time.time() + 86400  # Valid for the trading day
                return {
                    "success": True,
                    "message": "Authentication successful",
                    "feed_token": self.feed_token
                }
            else:
                msg = data.get("message", "Authentication rejected by broker")
                err_code = data.get("errorcode", "AUTH_FAILED")
                logger.warning(f"Auth failed for {self.client_code}: {msg} (code: {err_code})")
                return {"success": False, "message": msg, "error_code": err_code}
        except requests.RequestException as e:
            logger.error(f"Network error authenticating {self.client_code}: {str(e)}")
            return {"success": False, "message": f"Connection error: {str(e)}", "error_code": "NETWORK_ERROR"}

    def test_connection(self) -> Dict[str, Any]:
        """
        Tests account connectivity and queries profile information.
        """
        auth_result = self.authenticate()
        if not auth_result["success"]:
            return {
                "success": False,
                "message": auth_result["message"],
                "jwt_acquired": False,
                "ddpi_status": "UNKNOWN"
            }

        # Query profile to check DDPI/account status
        url = f"{self.BASE_URL}/rest/secure/angelbroking/user/v1/getProfile"
        try:
            resp = requests.get(url, headers=self._get_headers(), timeout=10)
            data = resp.json()
            if data.get("status"):
                profile = data.get("data", {})
                dp_type = profile.get("dpType", "CDSL")
                # Angel One profile returns ddpi/poa in various keys (ddpiStatus, poaStatus, ddpi, poa)
                is_ddpi = (
                    str(profile.get("ddpiStatus", "")).upper() in ("ACTIVE", "Y", "YES", "TRUE", "1") or
                    str(profile.get("poaStatus", "")).upper() in ("ACTIVE", "Y", "YES", "TRUE", "1") or
                    str(profile.get("ddpi", "")).upper() in ("ACTIVE", "Y", "YES", "TRUE", "1") or
                    str(profile.get("poa", "")).upper() in ("ACTIVE", "Y", "YES", "TRUE", "1") or
                    profile.get("ddpiStatus") is True or
                    profile.get("poaStatus") is True or
                    profile.get("ddpi") is True or
                    profile.get("poa") is True
                )
                return {
                    "success": True,
                    "message": "Connection verified with Angel One",
                    "jwt_acquired": True,
                    "ddpi_status": "ACTIVE" if is_ddpi else "UNKNOWN",
                    "dp_type": dp_type
                }
            return {
                "success": True,
                "message": "Authenticated (Profile query returned empty)",
                "jwt_acquired": True,
                "ddpi_status": "UNKNOWN"
            }
        except Exception as e:
            return {
                "success": True,
                "message": f"Session created, profile check failed: {str(e)}",
                "jwt_acquired": True,
                "ddpi_status": "UNKNOWN"
            }

    def get_holdings(self) -> List[Dict[str, Any]]:
        """
        Retrieves equity holdings from /portfolio/v1/getAllHolding (Rate limit: 1 req/sec).
        """
        self._enforce_rate_limit(1.0)
        url = f"{self.BASE_URL}/rest/secure/angelbroking/portfolio/v1/getAllHolding"
        try:
            resp = requests.get(url, headers=self._get_headers(), timeout=10)
            data = resp.json()
            if data.get("status") and data.get("data"):
                holdings_data = data["data"].get("holdings", [])
                return holdings_data
            return []
        except Exception as e:
            logger.error(f"Failed to fetch holdings for {self.client_code}: {str(e)}")
            return []

    def get_rms(self) -> Dict[str, Any]:
        """
        Retrieves funds & margin balances from /user/v1/getRMS (Rate limit: 1 req/sec).
        """
        self._enforce_rate_limit(1.0)
        url = f"{self.BASE_URL}/rest/secure/angelbroking/user/v1/getRMS"
        try:
            resp = requests.get(url, headers=self._get_headers(), timeout=10)
            data = resp.json()
            if data.get("status") and data.get("data"):
                return data["data"]
            return {}
        except Exception as e:
            logger.error(f"Failed to fetch RMS margin for {self.client_code}: {str(e)}")
            return {}

    def get_candle_data(
        self,
        exchange: str,
        symbol_token: str,
        interval: str = "ONE_DAY",
        from_date: str = "",
        to_date: str = ""
    ) -> List[Dict[str, Any]]:
        """
        Retrieves historical OHLCV candles from /historical/v1/getCandleData (Rate limit: 3 req/sec).
        Intervals: ONE_MINUTE, THREE_MINUTE, FIVE_MINUTE, TEN_MINUTE, FIFTEEN_MINUTE, THIRTY_MINUTE, ONE_HOUR, ONE_DAY.
        """
        self._enforce_rate_limit(0.34)  # 3 req/sec
        url = f"{self.BASE_URL}/rest/secure/angelbroking/historical/v1/getCandleData"
        payload = {
            "exchange": exchange,
            "symboltoken": str(symbol_token),
            "interval": interval,
            "fromdate": from_date,
            "todate": to_date
        }
        try:
            resp = requests.post(url, json=payload, headers=self._get_headers(), timeout=10)
            data = resp.json()
            if data.get("status") and data.get("data"):
                # Returns [[timestamp, open, high, low, close, volume], ...]
                candles = []
                for row in data["data"]:
                    candles.append({
                        "timestamp": row[0],
                        "open": float(row[1]),
                        "high": float(row[2]),
                        "low": float(row[3]),
                        "close": float(row[4]),
                        "volume": int(row[5])
                    })
                return candles
            logger.warning(f"getCandleData failed for {symbol_token}: {data.get('message')}")
            return []
        except Exception as e:
            logger.error(f"Candle data fetch error for {symbol_token}: {str(e)}")
            return []

    def place_order(self, order_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Places a live order through SmartAPI placeOrder endpoint.
        """
        self._enforce_rate_limit(0.1)  # 10-20 req/s limit
        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder"
        payload = {
            "variety": order_data.get("variety", "NORMAL"),
            "tradingsymbol": order_data["tradingsymbol"],
            "symboltoken": str(order_data["symbol_token"]),
            "transactiontype": order_data["transaction_type"],
            "exchange": order_data.get("exchange", "NSE"),
            "ordertype": order_data.get("order_type", "LIMIT"),
            "producttype": order_data.get("product_type", "DELIVERY"),
            "duration": "DAY",
            "price": str(order_data.get("price", "0.0")),
            "squareoff": "0",
            "stoploss": "0",
            "quantity": str(order_data["quantity"])
        }
        if order_data.get("trigger_price"):
            payload["triggerprice"] = str(order_data["trigger_price"])

        try:
            resp = requests.post(url, json=payload, headers=self._get_headers(), timeout=10)
            data = resp.json()
            if data.get("status") and data.get("data"):
                broker_order_id = data["data"].get("orderid")
                return {
                    "success": True,
                    "broker_order_id": broker_order_id,
                    "message": "Order successfully submitted to broker"
                }
            return {
                "success": False,
                "message": data.get("message", "Order placement rejected"),
                "error_code": data.get("errorcode", "REJECTED")
            }
        except Exception as e:
            logger.error(f"Live order placement error for {self.client_code}: {str(e)}")
            return {"success": False, "message": f"Network exception: {str(e)}", "error_code": "NETWORK_FAIL"}

    def _enforce_rate_limit(self, min_interval_seconds: float):
        elapsed = time.time() - self._last_request_time
        if elapsed < min_interval_seconds:
            time.sleep(min_interval_seconds - elapsed)
        self._last_request_time = time.time()
