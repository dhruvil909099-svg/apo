from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict



class OrderSingleCreate(BaseModel):
    account_id: int
    tradingsymbol: str = Field(..., min_length=1)
    symbol_token: str = Field(..., min_length=1)
    exchange: str = Field(default="NSE")
    transaction_type: str = Field(default="SELL")  # BUY or SELL
    order_type: str = Field(default="LIMIT")       # LIMIT, MARKET, STOPLOSS_LIMIT, STOPLOSS_MARKET
    variety: str = Field(default="NORMAL")         # NORMAL or STOPLOSS
    quantity: int = Field(..., gt=0)
    price: float = Field(default=0.0, ge=0.0)
    trigger_price: float = Field(default=0.0, ge=0.0)


class BulkAccountTarget(BaseModel):
    account_id: int
    quantity: int = Field(..., gt=0)
    price_override: Optional[float] = None


class BulkOrderPrepareRequest(BaseModel):
    ipo_id: int
    tradingsymbol: str
    symbol_token: str
    exchange: str = "NSE"
    order_type: str = "LIMIT"
    price: float = Field(..., ge=0.0)
    trigger_price: float = Field(default=0.0, ge=0.0)
    accounts: List[BulkAccountTarget]


class ProposedOrderItem(BaseModel):
    account_id: int
    nickname: str
    masked_client_code: str
    account_group: str
    holding_quantity: int
    proposed_quantity: int
    price: float
    order_type: str
    estimated_value: float
    ddpi_active: bool
    edis_authorized: bool
    is_valid: bool
    message: str


class BulkOrderPreviewResponse(BaseModel):
    batch_id: str
    is_executable: bool
    total_accounts: int
    total_quantity: int
    total_estimated_value: float
    proposed_orders: List[ProposedOrderItem]
    blocking_errors: List[str]
    warnings: List[str]


class BulkOrderExecuteRequest(BaseModel):
    batch_id: str
    operator_confirmed: bool = Field(..., description="Must explicitly be True to initiate submission")


class OrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    client_order_id: str
    account_id: int
    account_nickname: Optional[str] = None
    account_masked_code: Optional[str] = None
    broker_order_id: Optional[str] = None
    batch_id: Optional[str] = None
    tradingsymbol: str
    symbol_token: str
    exchange: str
    transaction_type: str
    order_type: str
    product_type: str
    variety: str
    quantity: int
    filled_quantity: int
    price: float
    trigger_price: float
    execution_price: Optional[float] = None
    status: str
    rejection_reason: Optional[str] = None
    is_paper_trade: bool
    created_at: datetime
    updated_at: datetime

