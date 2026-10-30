import secrets
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.auth import (
    get_current_user,
    create_access_token,
    UserPrincipal,
    master_key_enabled,
    login_locked_out,
    record_login_failure,
    clear_login_failures,
    validate_password_strength,
    log_audit_event,
)
from app.models.user import User

router = APIRouter(prefix="/auth", tags=["Authentication & Session"])


class LoginRequest(BaseModel):
    api_key: Optional[str] = Field(default=None, description="Master API Key for administrative access")
    username: Optional[str] = Field(default=None, description="Username or email address")
    password: Optional[str] = Field(default=None, description="User password")


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., max_length=100)
    password: str = Field(..., min_length=10, max_length=100)


class SetupAdminRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., max_length=100)
    password: str = Field(..., min_length=10, max_length=100)
    confirm_password: str = Field(..., min_length=10, max_length=100)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=10, max_length=100)
    confirm_password: str = Field(..., min_length=10, max_length=100)


class LoginResponse(BaseModel):
    authenticated: bool
    access_token: str
    csrf_token: Optional[str] = None
    token_type: str = "Bearer"
    user_id: Optional[int] = None
    username: str
    role: str
    trading_mode: str
    app_name: str
    must_change_password: bool = False


def _set_auth_cookies(response: Response, token: str) -> str:
    """Sets secure HttpOnly session cookie and SameSite CSRF token cookie."""
    csrf_token = secrets.token_urlsafe(32)
    ttl_seconds = settings.ACCESS_TOKEN_TTL_MINUTES * 60

    response.set_cookie(
        key=settings.SESSION_COOKIE_NAME,
        value=token,
        max_age=ttl_seconds,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/"
    )
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=csrf_token,
        max_age=ttl_seconds,
        httponly=False,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        path="/"
    )
    return csrf_token


def _clear_auth_cookies(response: Response) -> None:
    """Clears session and CSRF cookies."""
    response.delete_cookie(key=settings.SESSION_COOKIE_NAME, path="/", domain=settings.COOKIE_DOMAIN)
    response.delete_cookie(key=settings.CSRF_COOKIE_NAME, path="/", domain=settings.COOKIE_DOMAIN)


@router.get("/bootstrap-status")
def get_bootstrap_status(db: Session = Depends(get_db)):
    """
    Public diagnostic check for initial onboarding state.
    Returns whether initial administrator provisioning is required.
    """
    admin_count = db.query(User).filter(User.role == "ADMIN", User.is_active == True).count()
    return {
        "initial_setup_required": (admin_count == 0),
        "auth_required": settings.REQUIRE_AUTH,
        "allow_registration": settings.ALLOW_SELF_REGISTRATION,
        "trading_mode": settings.TRADING_MODE,
        "app_name": settings.APP_NAME
    }


@router.post("/setup-admin", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def setup_initial_admin(
    payload: SetupAdminRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Secure one-time initial administrator provisioning endpoint.
    Locks permanently (403) once an active administrator has been provisioned.
    """
    client_ip = request.client.host if request.client else "unknown"
    existing_admin = db.query(User).filter(User.role == "ADMIN", User.is_active == True).first()
    if existing_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Initial administrator has already been provisioned. Please sign in via /auth/login."
        )

    if payload.password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match."
        )

    is_strong, err_msg = validate_password_strength(payload.password)
    if not is_strong:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_msg
        )

    clean_uname = payload.username.strip()
    clean_email = payload.email.strip().lower()

    if db.query(User).filter((User.username == clean_uname) | (User.email == clean_email)).first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this username or email already exists."
        )

    pwd_hash, salt = User.hash_password(payload.password)
    new_admin = User(
        username=clean_uname,
        email=clean_email,
        hashed_password=pwd_hash,
        salt=salt,
        role="ADMIN",
        is_active=True,
        token_version=0,
        must_change_password=False,
        password_changed_at=datetime.utcnow(),
        last_login_at=datetime.utcnow()
    )
    db.add(new_admin)
    db.commit()
    db.refresh(new_admin)

    log_audit_event(
        db,
        event_type="ADMIN_INITIAL_SETUP_COMPLETED",
        operator=clean_uname,
        account_id=None,
        details={"client_ip": client_ip, "username": clean_uname, "email": clean_email}
    )

    token = create_access_token(new_admin)
    csrf_token = _set_auth_cookies(response, token)

    return LoginResponse(
        authenticated=True,
        access_token=token,
        csrf_token=csrf_token,
        token_type="Bearer",
        user_id=new_admin.id,
        username=new_admin.username,
        role=new_admin.role,
        trading_mode=settings.TRADING_MODE,
        app_name=settings.APP_NAME,
        must_change_password=False
    )


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Authenticates operators or individual traders.
    Accepts:
    1. Username & password for per-user authenticated trading sessions.
    2. Master API key for server-to-server automation access.
    Sets HttpOnly session cookie and anti-CSRF token cookie upon successful authentication.
    """
    client_ip = request.client.host if request.client else "unknown"

    # 1. Master API Key authentication (server-to-server only)
    if payload.api_key and payload.api_key.strip():
        raw_key = payload.api_key.strip()
        if master_key_enabled() and secrets.compare_digest(raw_key.encode("utf-8"), settings.MASTER_API_KEY.strip().encode("utf-8")):
            admin_user = db.query(User).filter(User.role == "ADMIN", User.is_active == True).first()
            if not admin_user:
                pwd_hash, salt = User.hash_password(secrets.token_urlsafe(16))
                admin_user = User(
                    username="system_admin",
                    email="admin@ipopro.internal",
                    hashed_password=pwd_hash,
                    salt=salt,
                    role="ADMIN",
                    is_active=True,
                    token_version=0,
                    must_change_password=False
                )
                db.add(admin_user)
                db.commit()
                db.refresh(admin_user)

            token = create_access_token(admin_user)
            csrf_token = _set_auth_cookies(response, token)
            log_audit_event(
                db,
                event_type="SERVER_MASTER_KEY_LOGIN",
                operator="system_automation",
                account_id=None,
                details={"client_ip": client_ip}
            )
            return LoginResponse(
                authenticated=True,
                access_token=token,
                csrf_token=csrf_token,
                token_type="Bearer",
                user_id=admin_user.id,
                username=admin_user.username,
                role=admin_user.role,
                trading_mode=settings.TRADING_MODE,
                app_name=settings.APP_NAME,
                must_change_password=False
            )
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication failed: Invalid API key provided."
            )

    # 2. Username / password authentication
    if payload.username and payload.password:
        ident = payload.username.strip()

        # Brute force protection check
        lockout_sec = login_locked_out(ident, client_ip)
        if lockout_sec > 0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Too many failed login attempts. Please wait {lockout_sec} seconds before retrying."
            )

        user = db.query(User).filter(
            (User.username == ident) | (User.email == ident.lower())
        ).first()

        if not user or not user.verify_password(payload.password):
            record_login_failure(ident, client_ip)
            log_audit_event(
                db,
                event_type="LOGIN_FAILED",
                operator=ident,
                account_id=None,
                details={"client_ip": client_ip}
            )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication failed: Invalid username or password."
            )

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: User account is inactive."
            )

        clear_login_failures(ident, client_ip)
        user.last_login_at = datetime.utcnow()
        db.commit()

        token = create_access_token(user)
        csrf_token = _set_auth_cookies(response, token)

        log_audit_event(
            db,
            event_type="LOGIN_SUCCESS",
            operator=user.username,
            account_id=None,
            details={"client_ip": client_ip}
        )

        return LoginResponse(
            authenticated=True,
            access_token=token,
            csrf_token=csrf_token,
            token_type="Bearer",
            user_id=user.id,
            username=user.username,
            role=user.role,
            trading_mode=settings.TRADING_MODE,
            app_name=settings.APP_NAME,
            must_change_password=bool(getattr(user, "must_change_password", False))
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Please provide either 'username' and 'password', or a valid 'api_key'."
    )


@router.post("/change-password")
def change_password(
    payload: ChangePasswordRequest,
    response: Response,
    request: Request,
    current_user: UserPrincipal = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Changes current user password and revokes old sessions by incrementing token_version.
    Enforces password complexity, prevents reuse of the current password, and issues fresh session cookies.
    """
    client_ip = request.client.host if request.client else "unknown"
    if current_user.id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password rotation is not supported for server-to-server automation credentials."
        )

    user = db.query(User).filter(User.id == current_user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User account not found.")

    if not user.verify_password(payload.current_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password verification failed."
        )

    if payload.new_password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password and confirmation do not match."
        )

    if payload.new_password == payload.current_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password cannot be identical to the current password."
        )

    is_strong, err_msg = validate_password_strength(payload.new_password)
    if not is_strong:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_msg
        )

    new_hash, new_salt = User.hash_password(payload.new_password)
    user.hashed_password = new_hash
    user.salt = new_salt
    user.must_change_password = False
    user.password_changed_at = datetime.utcnow()
    user.token_version = (user.token_version or 0) + 1
    db.commit()
    db.refresh(user)

    # Issue fresh token and update cookies
    new_token = create_access_token(user)
    new_csrf = _set_auth_cookies(response, new_token)

    log_audit_event(
        db,
        event_type="PASSWORD_ROTATION_SUCCESS",
        operator=user.username,
        account_id=None,
        details={"client_ip": client_ip}
    )

    return {
        "success": True,
        "message": "Password changed successfully. All previous sessions have been invalidated.",
        "access_token": new_token,
        "csrf_token": new_csrf,
        "must_change_password": False
    }


@router.post("/register", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def register(
    payload: RegisterRequest,
    response: Response,
    request: Request,
    db: Session = Depends(get_db)
):
    """
    Registers a new trader account and returns an authenticated JWT session.
    """
    client_ip = request.client.host if request.client else "unknown"
    user_count = db.query(User).count()
    if not settings.ALLOW_SELF_REGISTRATION and user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is disabled. Please contact your system administrator."
        )

    is_strong, err_msg = validate_password_strength(payload.password)
    if not is_strong:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err_msg
        )

    clean_username = payload.username.strip()
    clean_email = payload.email.strip().lower()

    existing = db.query(User).filter(
        (User.username == clean_username) | (User.email == clean_email)
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this username or email already exists."
        )

    pwd_hash, salt = User.hash_password(payload.password)
    role = "ADMIN" if user_count == 0 else "USER"
    new_user = User(
        username=clean_username,
        email=clean_email,
        hashed_password=pwd_hash,
        salt=salt,
        role=role,
        is_active=True,
        token_version=0,
        must_change_password=False,
        password_changed_at=datetime.utcnow(),
        last_login_at=datetime.utcnow()
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    log_audit_event(
        db,
        event_type="USER_REGISTERED",
        operator=clean_username,
        account_id=None,
        details={"client_ip": client_ip, "role": role}
    )

    token = create_access_token(new_user)
    csrf_token = _set_auth_cookies(response, token)

    return LoginResponse(
        authenticated=True,
        access_token=token,
        csrf_token=csrf_token,
        token_type="Bearer",
        user_id=new_user.id,
        username=new_user.username,
        role=new_user.role,
        trading_mode=settings.TRADING_MODE,
        app_name=settings.APP_NAME,
        must_change_password=False
    )


@router.get("/me")
def get_current_user_info(current_user: UserPrincipal = Depends(get_current_user)):
    """
    Returns current authenticated principal information.
    """
    return {
        "authenticated": True,
        "user_id": current_user.id,
        "username": current_user.username,
        "role": current_user.role,
        "is_admin": current_user.is_admin,
        "auth_method": current_user.auth_method,
        "must_change_password": current_user.must_change_password,
        "trading_mode": settings.TRADING_MODE
    }


@router.get("/status")
def check_auth_status(
    current_user: UserPrincipal = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Returns current session status for authenticated operators.
    """
    admin_count = db.query(User).filter(User.role == "ADMIN", User.is_active == True).count()
    return {
        "authenticated": True,
        "username": current_user.username,
        "role": current_user.role,
        "trading_mode": settings.TRADING_MODE,
        "auth_required": settings.REQUIRE_AUTH,
        "must_change_password": current_user.must_change_password,
        "initial_setup_required": (admin_count == 0)
    }


@router.post("/logout")
def logout(
    response: Response,
    request: Request,
    current_user: UserPrincipal = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Logs out the current session, clears HttpOnly cookies, and invalidates all issued JWT tokens
    by incrementing token_version.
    """
    client_ip = request.client.host if request.client else "unknown"
    _clear_auth_cookies(response)

    if current_user.id is not None:
        user = db.query(User).filter(User.id == current_user.id).first()
        if user:
            user.token_version = (user.token_version or 0) + 1
            db.commit()

    log_audit_event(
        db,
        event_type="LOGOUT",
        operator=current_user.username,
        account_id=None,
        details={"client_ip": client_ip}
    )

    return {
        "authenticated": False,
        "logged_out": True,
        "message": "Session invalidated. Please purge client credentials."
    }
