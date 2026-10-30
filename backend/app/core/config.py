import os
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


class Settings(BaseSettings):
    APP_NAME: str = "Angel One SmartAPI Multi-Account IPO Dashboard"
    APP_ENV: str = "development"
    DEBUG: bool = True
    
    # Trading Mode: "PAPER" or "LIVE"
    TRADING_MODE: str = Field(default="PAPER", description="Operational trading mode: PAPER or LIVE")
    
    # Security: AES-256 Fernet Key
    APP_ENCRYPTION_KEY: str = Field(..., description="Master key for encrypting credentials at rest")
    
    # API Authentication & Session Security
    # MASTER_API_KEY is a SERVER-TO-SERVER automation credential only. It must never be shipped
    # to browsers. Empty (the default) disables master-key authentication entirely.
    MASTER_API_KEY: str = Field(
        default="",
        description="Optional server-to-server admin automation key. Empty disables it. Never embed in frontend."
    )
    REQUIRE_AUTH: bool = Field(
        default=True,
        description="Enforces authentication across all protected /api/v1 routes"
    )
    # Signing key for user session JWTs. If empty, a key is derived from APP_ENCRYPTION_KEY with
    # HMAC domain separation (so the raw encryption key is never used directly as a signing key).
    JWT_SECRET_KEY: str = Field(default="", description="HS256 signing secret for user session tokens")
    ACCESS_TOKEN_TTL_MINUTES: int = Field(default=720, description="User session lifetime in minutes")
    ALLOW_SELF_REGISTRATION: bool = Field(
        default=False,
        description="If False, only administrators can create users (recommended for trading systems)"
    )
    # Session Cookie & CSRF Configuration
    SESSION_COOKIE_NAME: str = Field(default="ipopro_session", description="Name of HttpOnly session cookie")
    CSRF_COOKIE_NAME: str = Field(default="ipopro_csrf", description="Name of CSRF token cookie")
    COOKIE_SECURE: bool = Field(default=False, description="Set True in HTTPS production environments")
    COOKIE_SAMESITE: str = Field(default="lax", description="SameSite cookie policy: lax, strict, or none")
    COOKIE_DOMAIN: Optional[str] = Field(default=None, description="Optional domain scope for session cookies")

    # Optional first-run bootstrap of an administrator (only used when no active admin exists)
    BOOTSTRAP_ADMIN_USERNAME: str = Field(default="", description="Initial admin username (first run only)")
    BOOTSTRAP_ADMIN_EMAIL: str = Field(default="", description="Initial admin email (first run only)")
    BOOTSTRAP_ADMIN_PASSWORD: str = Field(default="", description="Initial admin password (first run only, min 12 chars)")
    LOGIN_MAX_FAILURES: int = Field(default=5, description="Failed logins before temporary lockout")
    LOGIN_LOCKOUT_SECONDS: int = Field(default=900, description="Lockout duration after repeated failures")

    # Optional Primary Angel One Credentials (survives ephemeral container reboots)
    SMARTAPI_CLIENT_CODE: str = Field(default="", description="Primary client code from environment")
    SMARTAPI_API_KEY: str = Field(default="", description="Permanent SmartAPI API Key")
    SMARTAPI_PIN: str = Field(default="", description="Permanent MPIN")
    SMARTAPI_TOTP_SECRET: str = Field(default="", description="Permanent Base32 TOTP Secret")
    
    # Database URL (SQLite or PostgreSQL)
    DATABASE_URL: str = Field(default="sqlite:///./angel_dashboard.db", description="Database connection string")
    
    # CORS
    ALLOWED_ORIGINS: str = Field(
        default="http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,https://ipo.emperialcabs.com",
        description="Comma-separated allowed origins"
    )
    
    # Risk Guardrails
    GLOBAL_MAX_ORDER_VALUE: float = 500000.00
    GLOBAL_MAX_QUANTITY_PER_ACCOUNT: int = 5000
    MAX_ORDERS_PER_BULK: int = 50
    RATE_LIMIT_ORDERS_PER_SEC: int = 10
    RATE_LIMIT_PORTFOLIO_PER_SEC: int = 1
    STATIC_IP_CHECK: bool = False
    
    # SmartAPI Network Configuration (Configurable outbound headers; TCP source IP must match registered static IP)
    SMARTAPI_CLIENT_PUBLIC_IP: str = Field(default="", description="Registered Static Public IP for SmartAPI headers")
    SMARTAPI_CLIENT_LOCAL_IP: str = Field(default="127.0.0.1", description="Local IP for SmartAPI headers")
    SMARTAPI_MAC_ADDRESS: str = Field(default="fe80::1", description="Client MAC for SmartAPI headers")

    # Regulatory Gates
    MULTI_CLIENT_LIVE_AUTHORIZED: bool = Field(
        default=False,
        description="Explicit commercial & regulatory broker approval flag for multi-client live orders (SEBI compliant)"
    )
    
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env", os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".env")),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def cors_origins(self) -> List[str]:
        origins = [origin.strip() for origin in self.ALLOWED_ORIGINS.split(",") if origin.strip()]
        if "https://ipo.emperialcabs.com" not in origins:
            origins.append("https://ipo.emperialcabs.com")
        return origins


settings = Settings()
