"""
IPOPro authentication & authorisation core.

Security model
--------------
* Browsers authenticate with username + password and receive a short-lived, server-signed
  JWT (HS256). No shared secret is ever embedded in frontend assets.
* MASTER_API_KEY (optional, default disabled) is a server-to-server automation credential.
  It is accepted only via request headers, never issued to browsers, and the previously
  published value is permanently revoked.
* Every Angel One account row may have an owner (accounts.user_id).
    - ADMIN: supervisory access to all accounts.
    - USER : access ONLY to accounts where accounts.user_id == user.id.
    - Unowned accounts (legacy rows, user_id IS NULL) are admin-only.
* Logout / password change bump users.token_version, which invalidates all previously
  issued tokens server-side.
"""
import hashlib
import hmac
import secrets
import threading
import time
from datetime import datetime, timedelta
from typing import Optional, Dict, Tuple

import jwt
from fastapi import Security, HTTPException, status, Depends
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.user import User

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_security = HTTPBearer(auto_error=False)

# Credentials that were published in public frontend bundles / repository files.
# They are rejected unconditionally even if an operator accidentally re-configures them.
REVOKED_MASTER_KEYS = frozenset({"ipopro-secure-master-key-2026"})

JWT_ALGORITHM = "HS256"
JWT_ISSUER = "ipopro"


class UserPrincipal(BaseModel):
    id: Optional[int] = None
    username: str
    role: str = "USER"  # "ADMIN" or "USER"
    is_admin: bool = False
    auth_method: str = "jwt"  # "jwt" | "master_key" | "auth_disabled"


def hash_password(password: str, salt: Optional[str] = None) -> tuple[str, str]:
    """Hashes a password using PBKDF2-HMAC-SHA256 with a secure salt."""
    return User.hash_password(password, salt)


# --------------------------------------------------------------------------------------
# Token helpers
# --------------------------------------------------------------------------------------
def _jwt_secret() -> str:
    if settings.JWT_SECRET_KEY:
        return settings.JWT_SECRET_KEY
    # Domain-separated derivation: the raw encryption key is never used as a signing key.
    return hmac.new(
        settings.APP_ENCRYPTION_KEY.encode("utf-8"),
        b"ipopro-jwt-signing-v1",
        hashlib.sha256,
    ).hexdigest()


def master_key_enabled() -> bool:
    key = (settings.MASTER_API_KEY or "").strip()
    return bool(key) and key not in REVOKED_MASTER_KEYS and len(key) >= 24


def create_access_token(user: User, ttl_minutes: Optional[int] = None) -> str:
    now = datetime.utcnow()
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "tv": int(user.token_version or 0),
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": now + timedelta(minutes=ttl_minutes or settings.ACCESS_TOKEN_TTL_MINUTES),
        "jti": secrets.token_hex(8),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    return jwt.decode(
        token,
        _jwt_secret(),
        algorithms=[JWT_ALGORITHM],
        issuer=JWT_ISSUER,
        options={"require": ["exp", "sub", "iss"]},
    )


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def resolve_principal(provided: Optional[str], db: Session, allow_master_key: bool = True) -> UserPrincipal:
    """Resolves a raw credential (JWT or master key) into a principal. Raises 401 on failure."""
    if not provided:
        raise _unauthorized(
            "UNAUTHORIZED: Missing required authentication. Sign in and provide 'Authorization: Bearer <token>'."
        )

    # Reject known revoked / compromised master keys immediately
    if provided in REVOKED_MASTER_KEYS:
        raise _unauthorized(
            "UNAUTHORIZED: This credential has been permanently revoked due to security compromise. Please sign in."
        )

    # 1. Server-to-server master key (constant-time compare; revoked values always rejected)
    if allow_master_key and master_key_enabled() and secrets.compare_digest(
        provided.encode("utf-8"), settings.MASTER_API_KEY.strip().encode("utf-8")
    ):
        return UserPrincipal(id=None, username="system_automation", role="ADMIN", is_admin=True, auth_method="master_key")

    # 2. User session JWT
    try:
        payload = decode_access_token(provided)
        user_id = int(payload["sub"])
    except jwt.ExpiredSignatureError:
        raise _unauthorized("UNAUTHORIZED: Session expired. Please sign in again.")
    except (jwt.PyJWTError, ValueError, KeyError, TypeError):
        raise _unauthorized("UNAUTHORIZED: Invalid API key or bearer token provided.")

    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise _unauthorized("UNAUTHORIZED: User account is unavailable or deactivated.")
    if int(payload.get("tv", -1)) != int(user.token_version or 0):
        raise _unauthorized("UNAUTHORIZED: Session has been revoked. Please sign in again.")

    return UserPrincipal(id=user.id, username=user.username, role=user.role, is_admin=(user.role == "ADMIN"))


def get_current_user(
    key_header: Optional[str] = Security(api_key_header),
    auth_credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_security),
    db: Session = Depends(get_db),
) -> UserPrincipal:
    """FastAPI dependency: authenticated principal for HTTP routes."""
    if not settings.REQUIRE_AUTH:
        return UserPrincipal(id=None, username="auth_disabled", role="ADMIN", is_admin=True, auth_method="auth_disabled")

    provided: Optional[str] = None
    if auth_credentials and auth_credentials.credentials:
        provided = auth_credentials.credentials.strip()
    elif key_header:
        provided = key_header.strip()
    return resolve_principal(provided, db)


def verify_api_key(current_user: UserPrincipal = Depends(get_current_user)) -> bool:
    """Backward-compatible router dependency: any authenticated principal."""
    return True


def require_admin(current_user: UserPrincipal = Depends(get_current_user)) -> UserPrincipal:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="FORBIDDEN: Administrator privileges are required for this operation.",
        )
    return current_user


def get_optional_current_user(
    key_header: Optional[str] = Security(api_key_header),
    auth_credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_security),
    db: Session = Depends(get_db),
) -> Optional[UserPrincipal]:
    """FastAPI dependency: resolves current principal if valid token provided; returns None if omitted."""
    if not settings.REQUIRE_AUTH:
        return UserPrincipal(id=None, username="auth_disabled", role="ADMIN", is_admin=True, auth_method="auth_disabled")

    provided: Optional[str] = None
    if auth_credentials and auth_credentials.credentials:
        provided = auth_credentials.credentials.strip()
    elif key_header:
        provided = key_header.strip()
    if not provided:
        return None
    try:
        return resolve_principal(provided, db)
    except HTTPException:
        return None


# --------------------------------------------------------------------------------------
# Per-account authorisation
# --------------------------------------------------------------------------------------
def can_access_account(account, user: UserPrincipal) -> bool:
    if user.is_admin:
        return True
    return account is not None and account.user_id is not None and user.id is not None and account.user_id == user.id


def authorize_account_access(account, user: UserPrincipal) -> None:
    """
    Enforces the per-account boundary. Non-owners receive 403; the response deliberately
    does not reveal account details.
    """
    if not can_access_account(account, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="FORBIDDEN: You are not authorised to access, modify, or trade on this account.",
        )


def scope_account_query(query, user: UserPrincipal, account_model):
    """Restricts an Account query to accounts the principal may see."""
    if user.is_admin:
        return query
    return query.filter(account_model.user_id == user.id)


# --------------------------------------------------------------------------------------
# Brute-force protection (in-process; per username + client IP)
# --------------------------------------------------------------------------------------
_login_failures: Dict[str, Tuple[int, float]] = {}
_login_lock = threading.Lock()


def _login_key(username: str, client_ip: str) -> str:
    return f"{(username or '').strip().lower()}|{client_ip or '-'}"


def login_locked_out(username: str, client_ip: str) -> int:
    """Returns remaining lockout seconds (0 if not locked)."""
    with _login_lock:
        count, first_ts = _login_failures.get(_login_key(username, client_ip), (0, 0.0))
        if count >= settings.LOGIN_MAX_FAILURES:
            remaining = int(settings.LOGIN_LOCKOUT_SECONDS - (time.time() - first_ts))
            if remaining > 0:
                return remaining
            _login_failures.pop(_login_key(username, client_ip), None)
        return 0


def record_login_failure(username: str, client_ip: str) -> None:
    with _login_lock:
        k = _login_key(username, client_ip)
        count, first_ts = _login_failures.get(k, (0, time.time()))
        if time.time() - first_ts > settings.LOGIN_LOCKOUT_SECONDS:
            count, first_ts = 0, time.time()
        _login_failures[k] = (count + 1, first_ts)


def clear_login_failures(username: str, client_ip: str) -> None:
    with _login_lock:
        _login_failures.pop(_login_key(username, client_ip), None)


def reset_login_throttle() -> None:
    """Test helper."""
    with _login_lock:
        _login_failures.clear()
