import time
import logging
import threading
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

    def __init__(self, api_key: str, client_code: str, pin: str, totp_secret: str, account_id: Optional[int] = None):
        self.account_id = account_id
        self.api_key = (api_key or "").strip()
        self.client_code = (client_code or "").strip().upper()
        self.pin = (pin or "").strip()
        self.totp_secret = (totp_secret or "").strip()
        
        self.jwt_token: Optional[str] = None
        self.refresh_token: Optional[str] = None
        self.feed_token: Optional[str] = None
        self.token_expiry_timestamp: float = 0
        self._last_request_time: float = 0
        self.last_sync_time: Optional[float] = None
        self.is_session_expired: bool = False
        self.consecutive_errors: int = 0
        self.circuit_open_until: Optional[float] = None
        self.session = requests.Session()
        self._auth_lock = threading.RLock()

    def _get_headers(self, include_auth: bool = True) -> Dict[str, str]:
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
        if include_auth and self.jwt_token:
            headers["Authorization"] = f"Bearer {self.jwt_token}"
        return headers

    def _send_request(
        self,
        method: str,
        url: str,
        json_payload: Optional[Dict[str, Any]] = None,
        timeout: float = 10.0,
        rate_limit_seconds: float = 1.0,
        max_retries: int = 2,
        _is_reauth_attempt: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Executes an HTTP request against SmartAPI with per-endpoint rate-limiting,
        bounded retries on transient errors, circuit breaker, and automatic self-healing re-auth.
        """
        if self.circuit_open_until and time.time() < self.circuit_open_until:
            wait_left = int(self.circuit_open_until - time.time())
            self.last_error = f"Upstream broker temporarily throttled (Circuit breaker open for {wait_left}s). Serving last verified data."
            return None

        self._enforce_rate_limit(rate_limit_seconds)
        endpoint_name = url.split("/")[-1]
        
        for attempt in range(1, max_retries + 1):
            try:
                headers = self._get_headers()
                if method.upper() == "GET":
                    resp = self.session.get(url, headers=headers, timeout=timeout)
                else:
                    resp = self.session.post(url, json=json_payload, headers=headers, timeout=timeout)

                # Session expired: Attempt transparent self-healing re-authentication
                if resp.status_code == 401:
                    if not _is_reauth_attempt and self.totp_secret and self.api_key and self.pin and self.api_key != "AUTO_RESTORED_KEY":
                        logger.info(f"SmartAPI session expired (HTTP 401) for {self.client_code}. Self-healing re-auth triggered...")
                        self.is_session_expired = True
                        reauth = self.authenticate(force_fresh=True)
                        if reauth.get("success"):
                            logger.info(f"Self-healing re-auth succeeded for {self.client_code}. Retrying {endpoint_name}...")
                            return self._send_request(
                                method=method, url=url, json_payload=json_payload,
                                timeout=timeout, rate_limit_seconds=rate_limit_seconds,
                                max_retries=1, _is_reauth_attempt=True
                            )
                    self.is_session_expired = True
                    self.last_error = "Angel One session expired (HTTP 401)"
                    return None

                # Transient server error or rate-limit throttle -> retry if attempts remain
                if resp.status_code in (429, 502, 503, 504) and attempt < max_retries:
                    logger.warning(
                        f"Transient HTTP {resp.status_code} from SmartAPI ({endpoint_name}) for {self.client_code}, retrying ({attempt}/{max_retries})..."
                    )
                    time.sleep(1.0)
                    continue

                try:
                    data = resp.json()
                except Exception:
                    logger.warning(f"Malformed non-JSON response from SmartAPI ({endpoint_name}) for {self.client_code}")
                    self.last_error = f"Malformed non-JSON response from SmartAPI ({endpoint_name})"
                    return None

                err_code = str(data.get("errorcode", "") or data.get("errorCode", ""))
                if err_code in ("AG8001", "AB1004", "SESSION_EXPIRED"):
                    if not _is_reauth_attempt and self.totp_secret and self.api_key and self.pin and self.api_key != "AUTO_RESTORED_KEY":
                        logger.info(f"SmartAPI session expired ({err_code}) for {self.client_code}. Self-healing re-auth triggered...")
                        self.is_session_expired = True
                        reauth = self.authenticate(force_fresh=True)
                        if reauth.get("success"):
                            logger.info(f"Self-healing re-auth succeeded for {self.client_code}. Retrying {endpoint_name}...")
                            return self._send_request(
                                method=method, url=url, json_payload=json_payload,
                                timeout=timeout, rate_limit_seconds=rate_limit_seconds,
                                max_retries=1, _is_reauth_attempt=True
                            )
                    self.is_session_expired = True
                    self.last_error = data.get("message", "Broker session expired")
                elif err_code == "AG8004":
                    self.last_error = "Angel One rejected request: Invalid SmartAPI API Key (AG8004). Please verify your API Key from smartapi.angelbroking.com."
                    logger.error(f"Invalid API Key (AG8004) for {self.client_code}")
                elif not (data.get("status") is True or data.get("success") is True):
                    self.last_error = data.get("message") or f"Broker API error ({err_code})"

                if data.get("status") is True or data.get("success") is True:
                    self.last_sync_time = time.time()
                    self.last_error = None
                    self.consecutive_errors = 0
                    self.circuit_open_until = None
                else:
                    self.consecutive_errors += 1
                    if self.consecutive_errors >= 5:
                        self.circuit_open_until = time.time() + 60.0
                        logger.warning(f"Circuit breaker tripped for {self.client_code} after 5 failures.")
                return data

            except requests.exceptions.Timeout:
                logger.warning(f"SmartAPI timeout for {self.client_code} on {endpoint_name} (attempt {attempt}/{max_retries})")
                self.last_error = f"SmartAPI timeout on {endpoint_name}"
                self.consecutive_errors += 1
                if self.consecutive_errors >= 5:
                    self.circuit_open_until = time.time() + 60.0
                if attempt < max_retries:
                    time.sleep(1.0)
                    continue
                return None
            except requests.exceptions.RequestException as e:
                logger.error(f"Network error calling {endpoint_name} for {self.client_code}: {str(e)}")
                self.last_error = f"Network error on {endpoint_name}: {str(e)}"
                self.consecutive_errors += 1
                if self.consecutive_errors >= 5:
                    self.circuit_open_until = time.time() + 60.0
                if attempt < max_retries:
                    time.sleep(1.0)
                    continue
                return None
            except Exception as e:
                logger.error(f"Unexpected error in SmartAPI call {endpoint_name} for {self.client_code}: {str(e)}")
                self.last_error = f"Unexpected error: {str(e)}"
                return None
        return None

    def authenticate(self, manual_totp: Optional[str] = None, force_fresh: bool = False) -> Dict[str, Any]:
        """
        Performs official loginByPassword with freshly computed 6-digit TOTP code
        or caller-supplied manual 6-digit TOTP code.
        Thread-safe: acquires _auth_lock and re-checks for existing active session.
        """
        with self._auth_lock:
            # Re-check if valid active session already exists (unless forced with manual_totp or force_fresh)
            if not force_fresh and not manual_totp and self.jwt_token and time.time() < self.token_expiry_timestamp and not self.is_session_expired:
                return {
                    "success": True,
                    "message": "Authentication successful (reused active session)",
                    "feed_token": self.feed_token
                }

            if not self.api_key or not self.client_code or not self.pin or not self.totp_secret:
                self.last_error = "Angel One credentials incomplete. Please configure your API Key, Client Code, PIN, and TOTP Secret."
                return {"success": False, "message": self.last_error, "error_code": "CREDENTIALS_INCOMPLETE"}

            if self.api_key == "AUTO_RESTORED_KEY":
                self.last_error = "Placeholder API key detected. Please rotate or enter your real Angel One SmartAPI API Key from smartapi.angelbroking.com."
                return {"success": False, "message": self.last_error, "error_code": "PLACEHOLDER_KEY"}

            if manual_totp:
                clean_code = str(manual_totp).strip().replace(" ", "").replace("-", "")
                if not (clean_code.isdigit() and len(clean_code) == 6):
                    self.last_error = "Manual TOTP code must be exactly 6 numeric digits."
                    return {"success": False, "message": self.last_error, "error_code": "INVALID_TOTP"}
                totp_code = clean_code
            else:
                if self.totp_secret.isdigit() and len(self.totp_secret) == 6:
                    totp_code = self.totp_secret
                else:
                    totp_code = generate_totp_token(self.totp_secret)
                    if not totp_code:
                        self.last_error = "Failed to generate valid TOTP code from secret key. Ensure your permanent Base32 secret is correct."
                        return {"success": False, "message": self.last_error, "error_code": "INVALID_TOTP"}

            url = f"{self.BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword"
            payload = {
                "clientcode": self.client_code,
                "password": self.pin,
                "totp": totp_code
            }

            self._enforce_rate_limit(1.0)
            try:
                # Login must NEVER send Authorization header
                resp = self.session.post(url, json=payload, headers=self._get_headers(include_auth=False), timeout=10)
                data = resp.json()
                if data.get("status") and data.get("data"):
                    token_data = data["data"]
                    self.jwt_token = token_data.get("jwtToken")
                    self.refresh_token = token_data.get("refreshToken")
                    self.feed_token = token_data.get("feedToken")
                    self.token_expiry_timestamp = time.time() + 86400  # Valid for the trading day
                    self.last_sync_time = time.time()
                    self.last_error = None
                    self.is_session_expired = False
                    return {
                        "success": True,
                        "message": "Authentication successful",
                        "feed_token": self.feed_token
                    }
                else:
                    msg = data.get("message", "Authentication rejected by broker")
                    err_code = data.get("errorcode", "AUTH_FAILED")
                    self.last_error = msg
                    if err_code in ("AG8001", "AB1004", "SESSION_EXPIRED") or "expired" in msg.lower():
                        self.is_session_expired = True

                    # Provide clear, sanitized diagnostic feedback based on broker response
                    if err_code == "AB1050" or "invalid totp" in msg.lower():
                        diag_message = (
                            "Angel One authentication rejected: Invalid TOTP, PIN, or Client Code combination (AB1050). "
                            "Verify your 4-digit Account PIN and enter a fresh 6-digit TOTP code or check your Base32 secret."
                        )
                    elif err_code in ("AG8001", "AB1004", "SESSION_EXPIRED"):
                        diag_message = f"Angel One broker session expired ({err_code}). Re-authentication required."
                    elif "password" in msg.lower() or "pin" in msg.lower():
                        diag_message = f"Angel One authentication rejected: Incorrect Account PIN ({err_code})."
                    elif "client" in msg.lower():
                        diag_message = f"Angel One authentication rejected: Unknown or invalid client code ({err_code})."
                    else:
                        diag_message = f"Angel One rejected login: {msg} (code: {err_code})"

                    logger.warning(f"Auth failed for {self.client_code}: {msg} (code: {err_code})")
                    return {"success": False, "message": diag_message, "error_code": err_code, "raw_message": msg}
            except requests.RequestException as e:
                logger.error(f"Network error authenticating {self.client_code}: {str(e)}")
                self.last_error = f"Connection error: {str(e)}"
                return {"success": False, "message": self.last_error, "error_code": "NETWORK_ERROR"}

    def test_connection(self, manual_totp: Optional[str] = None) -> Dict[str, Any]:
        """
        Tests account connectivity, validates credentials against downstream RMS, and queries profile.
        """
        auth_result = self.authenticate(manual_totp=manual_totp)
        if not auth_result["success"]:
            return {
                "success": False,
                "message": auth_result["message"],
                "error_code": auth_result.get("error_code", "AUTH_FAILED"),
                "jwt_acquired": False,
                "ddpi_status": None
            }

        # Query profile to check account profile access
        url = f"{self.BASE_URL}/rest/secure/angelbroking/user/v1/getProfile"
        data = self._send_request("GET", url, rate_limit_seconds=1.0)
        dp_type = "CDSL"
        detected_ddpi: Optional[str] = None
        if data and (data.get("status") is True or data.get("success") is True):
            profile = data.get("data", {})
            dp_type = profile.get("dpType", "CDSL")
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
            if is_ddpi:
                detected_ddpi = "ACTIVE"
            elif profile.get("ddpiStatus") in ("INACTIVE", "N", "NO", "FALSE", "0"):
                detected_ddpi = "INACTIVE"

        # Verify downstream API key authorization via RMS
        self.get_rms()
        if self.last_error and "AG8004" in self.last_error:
            return {
                "success": False,
                "message": self.last_error,
                "error_code": "AG8004",
                "jwt_acquired": True,
                "ddpi_status": detected_ddpi
            }

        return {
            "success": True,
            "message": "Connection and SmartAPI credentials verified with Angel One",
            "jwt_acquired": True,
            "ddpi_status": detected_ddpi,
            "dp_type": dp_type
        }

    def _ensure_authenticated(self) -> bool:
        """Verifies active session or re-authenticates if token expired."""
        if self.jwt_token and time.time() < self.token_expiry_timestamp and not self.is_session_expired:
            return True
        with self._auth_lock:
            # Re-check inside critical section
            if self.jwt_token and time.time() < self.token_expiry_timestamp and not self.is_session_expired:
                return True
            auth_res = self.authenticate()
            if not auth_res.get("success", False):
                self.last_error = auth_res.get("message", "Authentication failed")
                if auth_res.get("error_code") in ("AG8001", "AB1004", "SESSION_EXPIRED") or "expired" in self.last_error.lower():
                    self.is_session_expired = True
                return False
        return True

    def get_holdings(self) -> List[Dict[str, Any]]:
        """
        Retrieves equity delivery holdings with multi-tier fallback:
        1. /portfolio/v1/getAllHolding (aggregating summary + holdings array)
        2. /portfolio/v1/getHolding (standard Demat holdings list)
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for holdings fetch ({self.client_code})")
            return []

        # 1. Primary: getAllHolding
        url_all = f"{self.BASE_URL}/rest/secure/angelbroking/portfolio/v1/getAllHolding"
        data = self._send_request("GET", url_all, rate_limit_seconds=1.0)
        if data and (data.get("status") is True or data.get("success") is True) and data.get("data"):
            raw = data["data"]
            if isinstance(raw, dict) and "holdings" in raw:
                h_list = raw.get("holdings", [])
                if isinstance(h_list, list) and len(h_list) > 0:
                    return h_list
            elif isinstance(raw, list) and len(raw) > 0:
                return raw

        # Stop if an authorization or broker error occurred
        if self.last_error and ("AG8004" in self.last_error or "expired" in self.last_error.lower()):
            return []

        # 2. Fallback: getHolding
        url_std = f"{self.BASE_URL}/rest/secure/angelbroking/portfolio/v1/getHolding"
        data_std = self._send_request("GET", url_std, rate_limit_seconds=1.0)
        if data_std and (data_std.get("status") is True or data_std.get("success") is True) and data_std.get("data"):
            raw_std = data_std["data"]
            if isinstance(raw_std, list):
                return raw_std
            elif isinstance(raw_std, dict) and "holdings" in raw_std:
                return raw_std.get("holdings", [])

        return []

    def get_rms(self) -> Dict[str, Any]:
        """
        Retrieves funds & margin balances from /user/v1/getRMS (Rate limit: 1 req/sec).
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for RMS margin fetch ({self.client_code})")
            return {}

        url = f"{self.BASE_URL}/rest/secure/angelbroking/user/v1/getRMS"
        data = self._send_request("GET", url, rate_limit_seconds=1.0)
        if data and (data.get("status") is True or data.get("success") is True) and data.get("data"):
            return data["data"] if isinstance(data["data"], dict) else {}
        return {}

    def get_positions(self) -> List[Dict[str, Any]]:
        """
        Retrieves open and closed intraday/F&O positions from /order/v1/getPosition (Rate limit: 1 req/sec).
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for positions fetch ({self.client_code})")
            return []

        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/getPosition"
        data = self._send_request("GET", url, rate_limit_seconds=1.0)
        if data and data.get("status") and data.get("data"):
            raw_positions = data["data"]
            if isinstance(raw_positions, list):
                return raw_positions
            elif isinstance(raw_positions, dict):
                return raw_positions.get("positions", [])
        return []

    def get_order_book(self) -> List[Dict[str, Any]]:
        """
        Retrieves the day's order book from /order/v1/getOrderBook (Rate limit: 1 req/sec).
        Returns status of all submitted, executed, rejected, and open orders.
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for order book fetch ({self.client_code})")
            return []

        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/getOrderBook"
        data = self._send_request("GET", url, rate_limit_seconds=1.0)
        if data and data.get("status") and data.get("data"):
            raw_orders = data["data"]
            return raw_orders if isinstance(raw_orders, list) else []
        return []

    def get_trade_book(self) -> List[Dict[str, Any]]:
        """
        Retrieves confirmed executed trades from /order/v1/getTradeBook (Rate limit: 1 req/sec).
        Never misrepresents an acknowledged order as an executed trade.
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for trade book fetch ({self.client_code})")
            return []

        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/getTradeBook"
        data = self._send_request("GET", url, rate_limit_seconds=1.0)
        if data and data.get("status") and data.get("data"):
            raw_trades = data["data"]
            return raw_trades if isinstance(raw_trades, list) else []
        return []

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


# In-memory session pool maintaining 1:1 active broker sessions across endpoints
_adapter_cache: Dict[int, SmartAPIAdapter] = {}
_adapter_lock = threading.Lock()


def get_adapter_for_account(
    account_id: int,
    api_key: str,
    client_code: str,
    pin: str,
    totp_secret: str,
    force_new: bool = False
) -> SmartAPIAdapter:
    """
    Retrieves an existing authenticated SmartAPIAdapter from the session pool,
    or initializes and returns an adapter for the account.
    Reuses existing valid JWT session tokens to prevent multiple loginByPassword
    calls, rate-limiting, and TOTP replay rejections.
    Thread-safe: guarded by _adapter_lock.
    """
    clean_code = (client_code or "").strip().upper()
    clean_key = (api_key or "").strip()
    clean_pin = (pin or "").strip()
    clean_totp = (totp_secret or "").strip()

    with _adapter_lock:
        existing = _adapter_cache.get(account_id)
        if (
            not force_new
            and existing is not None
            and existing.client_code == clean_code
            and existing.api_key == clean_key
            and existing.pin == clean_pin
            and existing.jwt_token is not None
            and time.time() < existing.token_expiry_timestamp
            and not existing.is_session_expired
        ):
            return existing

        # Create or replace adapter instance cleanly
        if existing is not None:
            try:
                existing.session.close()
            except Exception:
                pass

        adapter = SmartAPIAdapter(
            api_key=clean_key,
            client_code=clean_code,
            pin=clean_pin,
            totp_secret=clean_totp,
            account_id=account_id
        )
        _adapter_cache[account_id] = adapter
        return adapter


def invalidate_adapter_for_account(account_id: int) -> None:
    """Invalidates and cleans up the cached session when credentials are rotated or explicitly disconnected."""
    with _adapter_lock:
        if account_id in _adapter_cache:
            try:
                _adapter_cache[account_id].session.close()
            except Exception:
                pass
            del _adapter_cache[account_id]

