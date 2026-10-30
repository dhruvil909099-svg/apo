import time
from datetime import datetime
import logging
import threading
import random
from typing import Dict, Any, Optional, List
import requests
from app.core.security import generate_totp_token, sanitize_dict_for_logging
from app.core.config import settings

logger = logging.getLogger("smartapi_adapter")


def safe_parse_smartapi_response(
    resp: Optional[requests.Response],
    endpoint_name: str,
    client_code: str = ""
) -> tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Safely parses an upstream SmartAPI HTTP response.
    Returns (parsed_dict, error_message).
    - Checks resp.json() first.
    - If resp.json() raises JSONDecodeError / ValueError, checks for empty body or HTML gateway error.
    - Robust against real requests.Response objects and MagicMock unit tests.
    """
    if resp is None:
        return None, f"No response received from SmartAPI ({endpoint_name})"

    # 1. Try standard JSON decoding first
    try:
        data = resp.json()
        if isinstance(data, dict):
            return data, None
        elif isinstance(data, list):
            return {"status": True, "message": "SUCCESS", "data": data}, None
    except Exception:
        pass

    # 2. JSON decoding failed or returned non-dict: safely inspect text/status
    status_code = getattr(resp, "status_code", 200)
    if not isinstance(status_code, int):
        status_code = 200

    raw_text = getattr(resp, "text", "")
    if not isinstance(raw_text, str):
        raw_text = ""

    # Check for empty body on 200/204
    if not raw_text.strip():
        if status_code in (200, 204):
            return {"status": True, "message": "SUCCESS", "data": None}, None
        return None, f"SmartAPI returned empty HTTP {status_code} on {endpoint_name}"

    # Check for HTML gateway errors
    headers = getattr(resp, "headers", None)
    content_type = ""
    if isinstance(headers, dict) or (headers and hasattr(headers, "get")):
        ct = headers.get("Content-Type", "")
        if isinstance(ct, str):
            content_type = ct.lower()

    if "text/html" in content_type or raw_text.startswith("<!DOCTYPE") or raw_text.startswith("<html"):
        clean_snip = raw_text[:180].replace("\n", " ").strip()
        logger.warning(
            f"SmartAPI gateway returned HTML on {endpoint_name} (HTTP {status_code}) for {client_code}: {clean_snip}"
        )
        return None, f"Upstream broker gateway error (HTTP {status_code} on {endpoint_name})"

    return None, f"Broker returned unparseable response on {endpoint_name} (HTTP {status_code})"


class SmartAPIAdapter:
    """
    Production broker adapter for Angel One SmartAPI.
    Strictly enforces 1:1 account session isolation.
    Handles TOTP generation, token lifecycle, rate-limiting, and error mapping.
    """
    BASE_URL = "https://apiconnect.angelone.in"

    # Documented Angel One SmartAPI endpoint rate limits (minimum inter-request spacing)
    DEFAULT_RATE_LIMITS: Dict[str, float] = {
        "orders": 0.10,          # 10 req/s for order placement / modification / cancellation
        "order_book": 1.0,       # 1 req/s for order book
        "trade_book": 1.0,       # 1 req/s for trade executions
        "positions": 1.0,        # 1 req/s for open / closed positions
        "holdings": 1.0,         # 1 req/s for demat delivery portfolio
        "rms": 1.0,              # 1 req/s for funds and limits
        "profile": 1.0,          # 1 req/s for user profile & DP type
        "quote": 0.34,           # 3 req/s for market quotes / LTP
        "candles": 0.34,         # 3 req/s for historical candle data
        "auth": 1.5,             # Spacing to prevent TOTP replay / rate limit rejection
        "default": 1.0,
    }

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
        self._endpoint_last_request_time: Dict[str, float] = {}
        self.last_sync_time: Optional[float] = None
        self.is_session_expired: bool = False
        self.consecutive_errors: int = 0
        self.circuit_open_until: Optional[float] = None
        self.session = requests.Session()
        self._auth_lock = threading.RLock()
        self._rate_limit_lock = threading.Lock()

    def _get_headers(self, include_auth: bool = True) -> Dict[str, str]:
        pub_ip = getattr(settings, "SMARTAPI_CLIENT_PUBLIC_IP", "") or "106.193.147.1"
        local_ip = getattr(settings, "SMARTAPI_CLIENT_LOCAL_IP", "127.0.0.1") or "127.0.0.1"
        mac_addr = getattr(settings, "SMARTAPI_MAC_ADDRESS", "fe80::1") or "fe80::1"
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-PrivateKey": self.api_key,
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": local_ip,
            "X-ClientPublicIP": pub_ip,
            "X-MACAddress": mac_addr,
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
        rate_limit_category: str = "default",
        max_retries: int = 2,
        _is_reauth_attempt: bool = False
    ) -> Optional[Dict[str, Any]]:
        """
        Executes an HTTP request against SmartAPI with thread-safe rate-limiting,
        safe JSON validation, bounded retries on transient errors, and circuit breaker.
        """
        if self.circuit_open_until and time.time() < self.circuit_open_until:
            wait_left = int(self.circuit_open_until - time.time())
            self.last_error = f"Upstream broker temporarily throttled (Circuit breaker open for {wait_left}s). Serving last verified data."
            return None

        self._enforce_rate_limit(rate_limit_seconds, category=rate_limit_category)
        endpoint_name = url.split("/")[-1]
        
        for attempt in range(1, max_retries + 1):
            correlation_id = f"corr-{self.account_id or 'anon'}-{int(time.time()*1000)}"
            start_t = time.time()
            try:
                headers = self._get_headers()
                if method.upper() == "GET":
                    resp = self.session.get(url, headers=headers, timeout=timeout)
                else:
                    resp = self.session.post(url, json=json_payload, headers=headers, timeout=timeout)

                req_duration = round(time.time() - start_t, 3)

                # Session expired: Attempt transparent self-healing re-authentication
                if resp.status_code == 401:
                    if not _is_reauth_attempt and self.totp_secret and self.api_key and self.pin and self.api_key != "AUTO_RESTORED_KEY":
                        logger.info(f"[{correlation_id}] SmartAPI session expired (HTTP 401) for {self.client_code}. Self-healing re-auth triggered...")
                        self.is_session_expired = True
                        reauth = self.authenticate(force_fresh=True)
                        if reauth.get("success"):
                            logger.info(f"[{correlation_id}] Self-healing re-auth succeeded for {self.client_code}. Retrying {endpoint_name}...")
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
                        f"[{correlation_id}] Transient HTTP {resp.status_code} from SmartAPI ({endpoint_name}) for {self.client_code}, retrying ({attempt}/{max_retries})..."
                    )
                    time.sleep(1.0 + random.uniform(0.1, 0.4))
                    continue

                data, parse_err = safe_parse_smartapi_response(resp, endpoint_name, self.client_code)
                if parse_err:
                    self.last_error = parse_err
                    logger.warning(f"[{correlation_id}] {parse_err} (HTTP {resp.status_code}, duration {req_duration}s, attempt {attempt}/{max_retries})")
                    if resp.status_code in (429, 502, 503, 504) and attempt < max_retries:
                        time.sleep(1.0 + random.uniform(0.1, 0.4))
                        continue
                    return None

                if not data:
                    self.last_error = f"Empty data structure from SmartAPI ({endpoint_name})"
                    return None

                err_code = str(data.get("errorcode", "") or data.get("errorCode", ""))
                if err_code in ("AG8001", "AB1004", "SESSION_EXPIRED"):
                    if not _is_reauth_attempt and self.totp_secret and self.api_key and self.pin and self.api_key != "AUTO_RESTORED_KEY":
                        logger.info(f"[{correlation_id}] SmartAPI session expired ({err_code}) for {self.client_code}. Self-healing re-auth triggered...")
                        self.is_session_expired = True
                        reauth = self.authenticate(force_fresh=True)
                        if reauth.get("success"):
                            logger.info(f"[{correlation_id}] Self-healing re-auth succeeded for {self.client_code}. Retrying {endpoint_name}...")
                            return self._send_request(
                                method=method, url=url, json_payload=json_payload,
                                timeout=timeout, rate_limit_seconds=rate_limit_seconds,
                                max_retries=1, _is_reauth_attempt=True
                            )
                    self.is_session_expired = True
                    self.last_error = data.get("message", "Broker session expired")
                elif err_code == "AG8004":
                    self.last_error = "Angel One rejected request: Invalid SmartAPI API Key (AG8004). Please verify your API Key from smartapi.angelbroking.com."
                    logger.error(f"[{correlation_id}] Invalid API Key (AG8004) for {self.client_code}")
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
                    time.sleep(1.0 + random.uniform(0.1, 0.3))
                    continue
                return None
            except requests.exceptions.RequestException as e:
                logger.error(f"Network error calling {endpoint_name} for {self.client_code}: {str(e)}")
                self.last_error = f"Network error on {endpoint_name}: {str(e)}"
                self.consecutive_errors += 1
                if self.consecutive_errors >= 5:
                    self.circuit_open_until = time.time() + 60.0
                if attempt < max_retries:
                    time.sleep(1.0 + random.uniform(0.1, 0.3))
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
                    self.last_error = (
                        "Invalid authenticator secret: A temporary 6-digit code is stored instead of a permanent Base32 secret. "
                        "Please update your account credentials with the permanent Base32 key from Angel One setup."
                    )
                    return {"success": False, "message": self.last_error, "error_code": "INVALID_TOTP_SECRET"}
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

            self._enforce_rate_limit(1.5, category="auth")
            try:
                # Login must NEVER send Authorization header
                resp = self.session.post(url, json=payload, headers=self._get_headers(include_auth=False), timeout=10)
                data, parse_err = safe_parse_smartapi_response(resp, "loginByPassword", self.client_code)
                if parse_err or not data:
                    self.last_error = parse_err or "Authentication response unparseable"
                    logger.warning(f"Auth failed for {self.client_code}: {self.last_error}")
                    return {"success": False, "message": self.last_error, "error_code": "RESPONSE_ERROR"}

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
                self.last_error = f"Network connection error: {str(e)}"
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

    def get_holdings(self) -> Optional[List[Dict[str, Any]]]:
        """
        Retrieves equity delivery holdings with multi-tier fallback:
        1. /portfolio/v1/getAllHolding (aggregating summary + holdings array)
        2. /portfolio/v1/getHolding (standard Demat holdings list)
        Returns:
        - List of holding dicts if successful (empty list [] if no delivery holdings)
        - None if session failed or upstream broker returned an error
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for holdings fetch ({self.client_code})")
            return None

        # 1. Primary: getAllHolding
        url_all = f"{self.BASE_URL}/rest/secure/angelbroking/portfolio/v1/getAllHolding"
        data = self._send_request("GET", url_all, rate_limit_seconds=1.0, rate_limit_category="holdings")
        if data and (data.get("status") is True or data.get("success") is True):
            self.last_error = None
            raw = data.get("data")
            if isinstance(raw, dict) and "holdings" in raw:
                h_list = raw.get("holdings", [])
                if isinstance(h_list, list) and len(h_list) > 0:
                    return h_list
            elif isinstance(raw, list) and len(raw) > 0:
                return raw

        # Stop if an authorization or broker error occurred
        if self.last_error and ("AG8004" in self.last_error or "expired" in self.last_error.lower()):
            return None

        # 2. Fallback: getHolding
        url_std = f"{self.BASE_URL}/rest/secure/angelbroking/portfolio/v1/getHolding"
        data_std = self._send_request("GET", url_std, rate_limit_seconds=1.0, rate_limit_category="holdings")
        if data_std and (data_std.get("status") is True or data_std.get("success") is True):
            self.last_error = None
            raw_std = data_std.get("data")
            if isinstance(raw_std, list):
                return raw_std
            elif isinstance(raw_std, dict) and "holdings" in raw_std:
                return raw_std.get("holdings", [])
            return []

        if self.last_error:
            return None
        return []

    def get_rms(self) -> Dict[str, Any]:
        """
        Retrieves funds & margin balances from /user/v1/getRMS (Rate limit: 1 req/sec).
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for RMS margin fetch ({self.client_code})")
            return {}

        url = f"{self.BASE_URL}/rest/secure/angelbroking/user/v1/getRMS"
        data = self._send_request("GET", url, rate_limit_seconds=1.0, rate_limit_category="rms")
        if data and (data.get("status") is True or data.get("success") is True) and data.get("data"):
            return data["data"] if isinstance(data["data"], dict) else {}
        return {}

    def get_positions(self) -> Optional[List[Dict[str, Any]]]:
        """
        Retrieves open and closed intraday/F&O positions from /order/v1/getPosition (Rate limit: 1 req/sec).
        Returns:
        - List of positions if successful (empty list [] if 0 positions today)
        - None if an upstream error or network failure occurred.
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for positions fetch ({self.client_code})")
            return None

        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/getPosition"
        data = self._send_request("GET", url, rate_limit_seconds=1.0, rate_limit_category="positions")
        if data is None:
            return None

        if data.get("status") is True or data.get("success") is True:
            self.last_error = None
            raw_positions = data.get("data")
            if raw_positions is None:
                return []
            if isinstance(raw_positions, list):
                return raw_positions
            elif isinstance(raw_positions, dict):
                return raw_positions.get("positions", [])
            return []

        self.last_error = data.get("message") or "Broker returned error fetching positions"
        return None

    def get_order_book(self) -> Optional[List[Dict[str, Any]]]:
        """
        Retrieves the day's order book from /order/v1/getOrderBook (Rate limit: 1 req/sec).
        Returns status of all submitted, executed, rejected, and open orders.
        Returns:
        - List of orders if successful (empty list [] if 0 orders placed today)
        - None if an upstream error or network failure occurred.
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for order book fetch ({self.client_code})")
            return None

        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/getOrderBook"
        data = self._send_request("GET", url, rate_limit_seconds=1.0, rate_limit_category="order_book")
        if data is None:
            return None

        if data.get("status") is True or data.get("success") is True:
            self.last_error = None
            raw_orders = data.get("data")
            if raw_orders is None:
                # Documented SmartAPI response: data is null when no orders exist today
                return []
            if isinstance(raw_orders, list):
                return raw_orders
            elif isinstance(raw_orders, dict) and "orders" in raw_orders:
                return raw_orders.get("orders", [])
            return []

        self.last_error = data.get("message") or "Broker returned error fetching order book"
        return None

    def get_trade_book(self) -> Optional[List[Dict[str, Any]]]:
        """
        Retrieves confirmed executed trades from /order/v1/getTradeBook (Rate limit: 1 req/sec).
        Never misrepresents an acknowledged order as an executed trade.
        Returns:
        - List of confirmed trades if successful (empty list [] if 0 trades executed today)
        - None if an upstream error or network failure occurred.
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for trade book fetch ({self.client_code})")
            return None

        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/getTradeBook"
        data = self._send_request("GET", url, rate_limit_seconds=1.0, rate_limit_category="trade_book")
        if data is None:
            return None

        if data.get("status") is True or data.get("success") is True:
            self.last_error = None
            raw_trades = data.get("data")
            if raw_trades is None:
                return []
            if isinstance(raw_trades, list):
                return raw_trades
            elif isinstance(raw_trades, dict) and "trades" in raw_trades:
                return raw_trades.get("trades", [])
            return []

        self.last_error = data.get("message") or "Broker returned error fetching trade book"
        return None

    def get_individual_order_details(self, order_id: str) -> Optional[Dict[str, Any]]:
        """
        Retrieves lifecycle details of a specific order from /order/v1/details/{orderid}.
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for order details fetch ({self.client_code})")
            return None

        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/details/{order_id}"
        data = self._send_request("GET", url, rate_limit_seconds=1.0, rate_limit_category="order_details")
        if data is None:
            return None

        if data.get("status") is True or data.get("success") is True:
            self.last_error = None
            raw = data.get("data")
            return raw if isinstance(raw, dict) else (data if isinstance(data, dict) else {})

        self.last_error = data.get("message") or "Broker returned error fetching order details"
        return None

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
        data = self._send_request("POST", url, json_payload=payload, rate_limit_seconds=0.34)
        if data and (data.get("status") is True or data.get("success") is True) and data.get("data"):
            candles = []
            for row in data["data"]:
                try:
                    candles.append({
                        "timestamp": row[0],
                        "open": float(row[1]),
                        "high": float(row[2]),
                        "low": float(row[3]),
                        "close": float(row[4]),
                        "volume": int(row[5])
                    })
                except (IndexError, ValueError, TypeError):
                    continue
            return candles
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
            resp = self.session.post(url, json=payload, headers=self._get_headers(), timeout=10)
            data, parse_err = safe_parse_smartapi_response(resp, "placeOrder", self.client_code)
            if parse_err:
                logger.error(f"Live order response unparseable ({parse_err}) for {self.client_code} on {order_data.get('tradingsymbol')}")
                return {
                    "success": False,
                    "status": "SUBMISSION_UNKNOWN",
                    "error_code": "GATEWAY_UNCERTAIN",
                    "message": "Order was dispatched, but broker gateway returned an unparseable response. Status unknown. Do not retry live order without reconciliation."
                }

            if data and (data.get("status") is True or data.get("success") is True):
                res_data = data.get("data") or {}
                broker_order_id = res_data.get("orderid") or data.get("orderid")
                unique_order_id = res_data.get("uniqueorderid") or data.get("uniqueorderid")
                return {
                    "success": True,
                    "broker_order_id": str(broker_order_id) if broker_order_id else None,
                    "unique_order_id": str(unique_order_id) if unique_order_id else None,
                    "status": "ACKNOWLEDGED",
                    "message": "Order successfully submitted to broker"
                }

            msg = data.get("message") if data else "Order placement rejected"
            err_code = str(data.get("errorcode") or data.get("errorCode") or "REJECTED") if data else "REJECTED"
            return {
                "success": False,
                "status": "REJECTED",
                "message": msg,
                "error_code": err_code
            }
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as e:
            logger.error(f"Live order transmission/read timeout for {self.client_code} on {order_data.get('tradingsymbol')}: {str(e)}")
            return {
                "success": False,
                "status": "SUBMISSION_UNKNOWN",
                "error_code": "GATEWAY_TIMEOUT",
                "message": "Order submission timed out or connection dropped. Status unknown. Do not retry live order without reconciliation."
            }
        except Exception as e:
            logger.error(f"Unexpected exception during order submission for {self.client_code}: {str(e)}")
            return {
                "success": False,
                "status": "SUBMISSION_UNKNOWN",
                "message": f"Network exception: {str(e)}. Status uncertain. Reconcile via Order Book.",
                "error_code": "NETWORK_FAIL"
            }

    def modify_order(self, order_id: str, modify_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Modifies an open order through SmartAPI modifyOrder endpoint.
        POST /rest/secure/angelbroking/order/v1/modifyOrder
        """
        self._enforce_rate_limit(0.1)
        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/modifyOrder"
        payload = {
            "variety": modify_data.get("variety", "NORMAL"),
            "orderid": str(order_id),
            "ordertype": modify_data.get("order_type", "LIMIT"),
            "producttype": modify_data.get("product_type", "DELIVERY"),
            "duration": "DAY",
            "price": str(modify_data.get("price", "0.0")),
            "quantity": str(modify_data["quantity"])
        }
        if modify_data.get("trigger_price"):
            payload["triggerprice"] = str(modify_data["trigger_price"])

        try:
            resp = requests.post(url, json=payload, headers=self._get_headers(), timeout=10)
            data = resp.json()
            if data.get("status") and data.get("data"):
                return {"success": True, "broker_order_id": data["data"].get("orderid", order_id), "message": "Order modified successfully"}
            return {"success": False, "message": data.get("message", "Order modification rejected")}
        except Exception as e:
            return {"success": False, "message": f"Exception modifying order: {str(e)}"}

    def cancel_order(self, order_id: str, variety: str = "NORMAL") -> Dict[str, Any]:
        """
        Cancels an open order through SmartAPI cancelOrder endpoint.
        POST /rest/secure/angelbroking/order/v1/cancelOrder
        """
        self._enforce_rate_limit(0.1)
        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/cancelOrder"
        payload = {
            "variety": variety,
            "orderid": str(order_id)
        }
        try:
            resp = requests.post(url, json=payload, headers=self._get_headers(), timeout=10)
            data = resp.json()
            if data.get("status"):
                return {"success": True, "broker_order_id": order_id, "message": "Order cancelled successfully"}
            return {"success": False, "message": data.get("message", "Order cancellation rejected")}
        except Exception as e:
            return {"success": False, "message": f"Exception cancelling order: {str(e)}"}

    def get_individual_order_details(self, order_id: str) -> Optional[Dict[str, Any]]:
        """
        Fetches individual order details through SmartAPI order details endpoint.
        GET /rest/secure/angelbroking/order/v1/details/{orderid}
        """
        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/details/{order_id}"
        data = self._send_request("GET", url, rate_limit_seconds=1.0, rate_limit_category="order_book")
        if data and (data.get("status") is True or data.get("success") is True):
            return data.get("data")
        return None

    def estimate_charges(self, orders: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Calls official Angel One SmartAPI Brokerage Calculator API:
        POST /rest/secure/angelbroking/brokerage/v1/estimateCharges
        Rate limit: 10 req/s.
        """
        if not self._ensure_authenticated():
            return {"status": False, "message": "Session not authenticated", "data": None}

        url = f"{self.BASE_URL}/rest/secure/angelbroking/brokerage/v1/estimateCharges"
        formatted_orders = []
        for o in orders:
            formatted_orders.append({
                "product_type": str(o.get("product_type", "DELIVERY")).upper(),
                "transaction_type": str(o.get("transaction_type", "BUY")).upper(),
                "quantity": str(o.get("quantity", "1")),
                "price": str(o.get("price", "0.0")),
                "exchange": str(o.get("exchange", "NSE")).upper(),
                "symbol_name": str(o.get("symbol_name") or o.get("tradingsymbol", "")),
                "token": str(o.get("token") or o.get("symbol_token", ""))
            })
        payload = {"orders": formatted_orders}
        data = self._send_request("POST", url, json_payload=payload, rate_limit_seconds=0.1)
        return data or {"status": False, "message": self.last_error or "Brokerage calculation failed", "data": None}

    def get_margin_batch(self, positions: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Calls official Angel One SmartAPI Margin Calculator API:
        POST /rest/secure/angelbroking/margin/v1/batch
        Rate limit: 10 req/s.
        """
        if not self._ensure_authenticated():
            return {"status": False, "message": "Session not authenticated", "data": None}

        url = f"{self.BASE_URL}/rest/secure/angelbroking/margin/v1/batch"
        formatted_positions = []
        for p in positions:
            prod = str(p.get("productType") or p.get("product_type", "DELIVERY")).upper()
            if prod in ("CNC", "DELIVERY"):
                prod = "DELIVERY"
            elif prod in ("MIS", "INTRADAY"):
                prod = "INTRADAY"
            elif prod in ("NRML", "CARRYFORWARD"):
                prod = "CARRYFORWARD"
            elif prod in ("MTF", "MARGIN"):
                prod = "MARGIN"

            ot = str(p.get("orderType") or p.get("order_type", "LIMIT")).upper()
            if ot not in ("LIMIT", "MARKET", "STOPLOSS_LIMIT", "STOPLOSS_MARKET"):
                ot = "LIMIT"

            formatted_positions.append({
                "exchange": str(p.get("exchange", "NSE")).upper(),
                "qty": int(p.get("qty") or p.get("quantity", 1)),
                "price": float(p.get("price", 0.0)),
                "productType": prod,
                "token": str(p.get("token") or p.get("symbol_token", "")),
                "tradeType": str(p.get("tradeType") or p.get("trade_type") or p.get("transaction_type", "BUY")).upper(),
                "orderType": ot
            })
        payload = {"positions": formatted_positions}
        data = self._send_request("POST", url, json_payload=payload, rate_limit_seconds=0.1)
        return data or {"status": False, "message": self.last_error or "Margin calculation failed", "data": None}


    def get_ltp_data(self, exchange: str, tradingsymbol: str, symbol_token: str) -> Optional[float]:
        """
        Retrieves live Last Traded Price (LTP) from Angel One SmartAPI.
        Used for shared authorized market data feeds across client demat accounts.
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for market data LTP fetch ({self.client_code})")
            return None

        # Try market quote endpoint
        url = f"{self.BASE_URL}/rest/secure/angelbroking/market/v1/quote"
        payload = {
            "mode": "LTP",
            "exchangeTokens": {
                exchange: [str(symbol_token)]
            }
        }
        data = self._send_request("POST", url, json_payload=payload, rate_limit_seconds=0.2)
        if data and (data.get("status") is True or data.get("success") is True) and data.get("data"):
            fetched = data["data"].get("fetched", [])
            if fetched and isinstance(fetched, list) and len(fetched) > 0:
                try:
                    return float(fetched[0].get("ltp", 0.0))
                except (ValueError, TypeError):
                    pass

        # Fallback to getLtpData endpoint
        url_ltp = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/getLtpData"
        payload_ltp = {
            "exchange": exchange,
            "tradingsymbol": tradingsymbol,
            "symboltoken": str(symbol_token)
        }
        data_ltp = self._send_request("POST", url_ltp, json_payload=payload_ltp, rate_limit_seconds=0.2)
        if data_ltp and (data_ltp.get("status") is True or data_ltp.get("success") is True) and data_ltp.get("data"):
            try:
                return float(data_ltp["data"].get("ltp", 0.0))
            except (ValueError, TypeError):
                pass

        return None

    def get_market_quotes_batch(
        self,
        exchange_tokens: Dict[str, List[str]],
        mode: str = "FULL"
    ) -> Dict[str, Any]:
        """
        Retrieves official SmartAPI Live Market Data for a batch of instruments.
        Supports documented quote modes: 'LTP', 'OHLC', 'FULL'.
        Enforces rate limiting (3 req/s) and batches max 50 tokens per upstream call.
        """
        if not self._ensure_authenticated():
            logger.warning(f"Session not authenticated for market quote batch ({self.client_code})")
            return {"fetched": [], "unfetched": [], "error": "NOT_AUTHENTICATED"}

        valid_modes = {"LTP", "OHLC", "FULL"}
        target_mode = mode.upper() if mode.upper() in valid_modes else "FULL"
        url = f"{self.BASE_URL}/rest/secure/angelbroking/market/v1/quote"

        # Deduplicate tokens per exchange
        clean_exchange_tokens: Dict[str, List[str]] = {}
        for exch, tokens in exchange_tokens.items():
            if exch and tokens:
                unique_toks = list(dict.fromkeys(str(t).strip() for t in tokens if str(t).strip()))
                if unique_toks:
                    clean_exchange_tokens[exch.upper()] = unique_toks

        if not clean_exchange_tokens:
            return {"fetched": [], "unfetched": []}

        all_fetched = []
        all_unfetched = []

        # Split into batches of at most 50 tokens per request (SmartAPI limit)
        for exch, tokens in clean_exchange_tokens.items():
            batch_size = 50
            for i in range(0, len(tokens), batch_size):
                chunk = tokens[i:i + batch_size]
                payload = {
                    "mode": target_mode,
                    "exchangeTokens": {
                        exch: chunk
                    }
                }
                
                try:
                    data = self._send_request("POST", url, json_payload=payload, rate_limit_seconds=0.34)
                    if data and (data.get("status") is True or data.get("success") is True) and data.get("data"):
                        res_data = data["data"]
                        fetched = res_data.get("fetched") or []
                        unfetched = res_data.get("unfetched") or []
                        
                        for item in fetched:
                            ltp = float(item.get("ltp") or 0.0)
                            prev_close = float(item.get("close") or 0.0)
                            chg = round(ltp - prev_close, 2)
                            chg_pct = round((chg / prev_close) * 100, 2) if prev_close > 0 else 0.0
                            
                            all_fetched.append({
                                "exchange": item.get("exchange") or exch,
                                "trading_symbol": item.get("tradingSymbol", ""),
                                "symbol_token": str(item.get("symbolToken", "")),
                                "ltp": ltp,
                                "open": float(item.get("open") or 0.0),
                                "high": float(item.get("high") or 0.0),
                                "low": float(item.get("low") or 0.0),
                                "close": prev_close,
                                "volume": int(item.get("totalTradedVolume") or 0),
                                "last_traded_qty": int(item.get("lastTradedQty") or 0),
                                "total_traded_value": float(item.get("totalTradedValue") or 0.0),
                                "high_52week": float(item.get("52WeekHigh") or 0.0),
                                "low_52week": float(item.get("52WeekLow") or 0.0),
                                "depth": item.get("depth"),
                                "exchange_feed_time": item.get("exchFeedTime") or "",
                                "net_change": chg,
                                "percent_change": chg_pct,
                                "data_source": "ANGEL_ONE_SMARTAPI_LIVE",
                                "freshness_status": "LIVE",
                                "received_at": datetime.utcnow().isoformat()
                            })
                        
                        all_unfetched.extend(unfetched)
                    else:
                        all_unfetched.extend([{"exchange": exch, "symbolToken": t} for t in chunk])
                except Exception as ex:
                    logger.error(f"Error fetching quote batch for {exch} tokens {chunk[:5]}: {ex}")
                    all_unfetched.extend([{"exchange": exch, "symbolToken": t} for t in chunk])

        return {
            "mode": target_mode,
            "fetched": all_fetched,
            "unfetched": all_unfetched,
            "fetched_count": len(all_fetched),
            "unfetched_count": len(all_unfetched)
        }

    def _enforce_rate_limit(self, min_interval_seconds: float = 1.0, category: str = "default"):
        """
        Enforces endpoint-specific per-client rate limiting based on documented SmartAPI limits.
        Thread-safe: acquires _rate_limit_lock to record per-category request timestamps.
        """
        interval = min_interval_seconds
        if category in self.DEFAULT_RATE_LIMITS:
            interval = max(min_interval_seconds, self.DEFAULT_RATE_LIMITS[category])

        with self._rate_limit_lock:
            last_t = self._endpoint_last_request_time.get(category, 0.0)
            elapsed = time.time() - last_t
            if elapsed < interval:
                jitter = random.uniform(0.01, 0.04)
                time.sleep((interval - elapsed) + jitter)
            now = time.time()
            self._endpoint_last_request_time[category] = now
            self._last_request_time = now


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


def get_any_active_market_adapter(db, exclude_account_id: Optional[int] = None) -> Optional[SmartAPIAdapter]:
    """
    Finds any currently connected and authorized live demat account to provide
    shared market data pricing feeds for historical holdings of disconnected clients.
    Guarantees that private client data (orders, positions, holdings) is never accessed.
    """
    from app.models.account import Account
    from app.core.security import cipher

    query = db.query(Account).filter(
        Account.is_enabled == True,
        Account.is_demo == False,
        Account.auth_status == "CONNECTED"
    )
    if exclude_account_id:
        query = query.filter(Account.id != exclude_account_id)

    active_accounts = query.all()
    for acc in active_accounts:
        try:
            raw_key = cipher.decrypt(acc.encrypted_api_key)
            raw_pin = cipher.decrypt(acc.encrypted_pin)
            raw_totp = cipher.decrypt(acc.encrypted_totp_secret)
            if raw_key and raw_pin and raw_totp:
                adapter = get_adapter_for_account(acc.id, raw_key, acc.client_code, raw_pin, raw_totp)
                if adapter._ensure_authenticated():
                    return adapter
        except Exception:
            continue
    return None


def get_authenticated_adapter_for_account_id(db, account_id: int) -> Optional[SmartAPIAdapter]:
    """
    Retrieves an authenticated SmartAPIAdapter specifically for the specified account ID.
    Enforces account isolation: queries credentials strictly for account_id and verifies downstream RMS.
    """
    from app.models.account import Account
    from app.core.security import cipher

    acc = db.query(Account).filter(Account.id == account_id).first()
    if not acc or acc.is_demo or not acc.is_enabled:
        return None
    try:
        raw_key = cipher.decrypt(acc.encrypted_api_key)
        raw_pin = cipher.decrypt(acc.encrypted_pin)
        raw_totp = cipher.decrypt(acc.encrypted_totp_secret)
        if raw_key and raw_pin and raw_totp:
            adapter = get_adapter_for_account(acc.id, raw_key, acc.client_code, raw_pin, raw_totp)
            if adapter._ensure_authenticated():
                return adapter
    except Exception as e:
        logger.warning(f"Failed to get authenticated adapter for account {account_id}: {e}")
    return None



