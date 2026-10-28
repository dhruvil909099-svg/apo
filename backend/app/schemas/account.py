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
    client_code: Optional[str] = None
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


class AccountOverviewResponse(BaseModel):
    account_id: int
    nickname: str
    masked_client_code: str
    account_group: str
    is_enabled: bool
    is_demo: bool
    auth_status: str
    ddpi_status: str
    edis_authorized_today: bool
    available_cash: Optional[float] = None
    total_margin: Optional[float] = None
    utilized_margin: Optional[float] = None
    total_holdings_count: int = 0
    total_holdings_value: float = 0.0
    total_positions_count: int = 0
    last_sync_time: Optional[datetime] = None
    data_source: str = "SMARTAPI"
    stale_data_warning: bool = False


class AccountHoldingItem(BaseModel):
    symbol: str
    company_name: Optional[str] = None
    isin: Optional[str] = None
    symbol_token: Optional[str] = None
    quantity: int
    authorised_quantity: Optional[int] = None
    average_price: float
    current_ltp: Optional[float] = None
    valuation: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    pnl_percentage: Optional[float] = None
    data_source: str = "ANGEL_ONE_HOLDINGS"
    source_timestamp: Optional[str] = None


class AccountPositionItem(BaseModel):
    symbol: str
    symbol_token: Optional[str] = None
    exchange: str = "NSE"
    product_type: str = "INTRADAY"
    net_quantity: int
    buy_quantity: int = 0
    sell_quantity: int = 0
    buy_average_price: float = 0.0
    sell_average_price: float = 0.0
    current_ltp: Optional[float] = None
    unrealized_pnl: Optional[float] = None
    realized_pnl: Optional[float] = None
    data_source: str = "ANGEL_ONE_POSITIONS"
    source_timestamp: Optional[str] = None


class AccountOrderItem(BaseModel):
    order_id: str
    symbol: str
    exchange: str = "NSE"
    transaction_type: str
    order_type: str
    product_type: str
    quantity: int
    filled_quantity: int = 0
    price: float = 0.0
    trigger_price: float = 0.0
    average_price: Optional[float] = None
    status: str
    rejection_reason: Optional[str] = None
    order_timestamp: Optional[str] = None
    is_paper_trade: bool = False


class AccountTradeItem(BaseModel):
    fill_id: str
    order_id: str
    symbol: str
    exchange: str = "NSE"
    transaction_type: str
    product_type: str
    fill_price: float
    fill_quantity: int
    fill_timestamp: Optional[str] = None
    is_paper_trade: bool = False


class AccountSyncResponse(BaseModel):
    account_id: int
    success: bool
    message: str
    holdings_count: int = 0
    positions_count: int = 0
    available_cash: Optional[float] = None
    sync_timestamp: str
