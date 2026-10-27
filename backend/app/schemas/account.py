from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class AccountCreate(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=100)
    client_code: str = Field(..., min_length=2, max_length=50)
    account_group: str = Field(default="Family", max_length=50)
    api_key: str = Field(..., min_length=3, description="SmartAPI Application API Key")
    pin: str = Field(..., min_length=4, max_length=20, description="4-digit PIN or password")
    totp_secret: str = Field(..., min_length=8, description="Base32 TOTP QR code secret string")
    is_demo: bool = Field(default=False)


class AccountUpdate(BaseModel):
    nickname: Optional[str] = None
    account_group: Optional[str] = None
    is_enabled: Optional[bool] = None
    api_key: Optional[str] = None
    pin: Optional[str] = None
    totp_secret: Optional[str] = None
    ddpi_status: Optional[str] = None
    edis_authorized_today: Optional[bool] = None


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nickname: str
    masked_client_code: str
    account_group: str
    is_enabled: bool
    is_demo: bool
    auth_status: str
    ddpi_status: str
    edis_authorized_today: bool
    available_cash: float
    last_sync_time: Optional[datetime] = None
    last_auth_error: Optional[str] = None
    created_at: datetime



class AccountTestResult(BaseModel):
    account_id: int
    nickname: str
    masked_client_code: str
    success: bool
    message: str
    auth_status: str
    jwt_acquired: bool
    ddpi_status: str
