from typing import List
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
    MASTER_API_KEY: str = Field(
        default="ipopro-secure-master-key-2026",
        description="Master API authentication key for securing all internal endpoints"
    )
    REQUIRE_AUTH: bool = Field(
        default=True,
        description="Enforces API key authentication across all /api/v1 routes"
    )
    
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
    
    model_config = SettingsConfigDict(
        env_file=".env",
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
