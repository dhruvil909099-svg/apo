import secrets
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from app.core.config import settings
from app.core.auth import verify_api_key

router = APIRouter(prefix="/auth", tags=["Authentication & Session"])


class LoginRequest(BaseModel):
    api_key: str


class LoginResponse(BaseModel):
    authenticated: bool
    access_token: str
    token_type: str
    trading_mode: str
    app_name: str


@router.post("/login", response_model=LoginResponse)
def login_with_key(payload: LoginRequest):
    """
    Authenticates operator with the master API key and returns an authorized bearer token.
    """
    if not secrets.compare_digest(payload.api_key.strip(), settings.MASTER_API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed: Invalid API key provided."
        )

    return LoginResponse(
        authenticated=True,
        access_token=settings.MASTER_API_KEY,
        token_type="Bearer",
        trading_mode=settings.TRADING_MODE,
        app_name=settings.APP_NAME
    )


@router.get("/status")
def check_auth_status(authenticated: bool = Depends(verify_api_key)):
    """
    Returns current session status for authenticated operators.
    """
    return {
        "authenticated": True,
        "trading_mode": settings.TRADING_MODE,
        "auth_required": settings.REQUIRE_AUTH
    }


@router.post("/logout")
def logout(authenticated: bool = Depends(verify_api_key)):
    """
    Logs out the current session and instructs client to purge stored tokens.
    """
    return {
        "authenticated": False,
        "message": "Session invalidated. Please purge client credentials."
    }
