import secrets
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
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
    password: str = Field(..., min_length=6, max_length=100)


class LoginResponse(BaseModel):
    authenticated: bool
    access_token: str
    token_type: str = "Bearer"
    user_id: Optional[int] = None
    username: str
    role: str
    trading_mode: str
    app_name: str


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """
    Authenticates operators or individual traders.
    Accepts:
    1. Username & password for per-user authenticated trading sessions.
    2. Master API key for supervisory administrative access.
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
                    token_version=0
                )
                db.add(admin_user)
                db.commit()
                db.refresh(admin_user)

            token = create_access_token(admin_user)
            return LoginResponse(
                authenticated=True,
                access_token=token,
                token_type="Bearer",
                user_id=admin_user.id,
                username=admin_user.username,
                role=admin_user.role,
                trading_mode=settings.TRADING_MODE,
                app_name=settings.APP_NAME
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
        token = create_access_token(user)
        return LoginResponse(
            authenticated=True,
            access_token=token,
            token_type="Bearer",
            user_id=user.id,
            username=user.username,
            role=user.role,
            trading_mode=settings.TRADING_MODE,
            app_name=settings.APP_NAME
        )

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Please provide either 'username' and 'password', or a valid 'api_key'."
    )


@router.post("/register", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    """
    Registers a new trader account and returns an authenticated JWT session.
    """
    user_count = db.query(User).count()
    if not settings.ALLOW_SELF_REGISTRATION and user_count > 0:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Public registration is disabled. Please contact your system administrator."
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
    # First user registered in a clean system is granted ADMIN role automatically
    role = "ADMIN" if user_count == 0 else "USER"
    new_user = User(
        username=clean_username,
        email=clean_email,
        hashed_password=pwd_hash,
        salt=salt,
        role=role,
        is_active=True,
        token_version=0
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    token = create_access_token(new_user)
    return LoginResponse(
        authenticated=True,
        access_token=token,
        token_type="Bearer",
        user_id=new_user.id,
        username=new_user.username,
        role=new_user.role,
        trading_mode=settings.TRADING_MODE,
        app_name=settings.APP_NAME
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
        "trading_mode": settings.TRADING_MODE
    }


@router.get("/status")
def check_auth_status(current_user: UserPrincipal = Depends(get_current_user)):
    """
    Returns current session status for authenticated operators.
    """
    return {
        "authenticated": True,
        "username": current_user.username,
        "role": current_user.role,
        "trading_mode": settings.TRADING_MODE,
        "auth_required": settings.REQUIRE_AUTH
    }


@router.post("/logout")
def logout(
    current_user: UserPrincipal = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """
    Logs out the current session and invalidates all issued JWT tokens by incrementing token_version.
    """
    if current_user.id is not None:
        user = db.query(User).filter(User.id == current_user.id).first()
        if user:
            user.token_version = (user.token_version or 0) + 1
            db.commit()

    return {
        "authenticated": False,
        "logged_out": True,
        "message": "Session invalidated. Please purge client credentials."
    }
