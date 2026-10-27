from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class RiskLimitUpdate(BaseModel):
    max_order_value: Optional[float] = Field(None, gt=0)
    max_quantity_per_order: Optional[int] = Field(None, gt=0)
    max_loss_threshold: Optional[float] = Field(None, gt=0)
    stop_loss_percent: Optional[float] = Field(None, ge=0)
    target_profit_percent: Optional[float] = Field(None, ge=0)
    emergency_trading_disabled: Optional[bool] = None
    allow_market_orders_on_listing: Optional[bool] = None


class RiskLimitResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    account_id: Optional[int] = None
    max_order_value: float
    max_quantity_per_order: int
    max_loss_threshold: float
    stop_loss_percent: float
    target_profit_percent: float
    emergency_trading_disabled: bool
    allow_market_orders_on_listing: bool
    updated_at: datetime


class AuditLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    timestamp: datetime
    event_type: str
    account_id: Optional[int] = None
    operator: str
    details: Dict[str, Any]



class DashboardSummaryResponse(BaseModel):
    trading_mode: str
    total_accounts: int
    connected_accounts: int
    disconnected_accounts: int
    error_accounts: int
    total_ipos_monitored: int
    total_allotted_shares: int
    total_portfolio_value: float
    total_unrealized_pnl: float
    pnl_percentage: float
    orders_today_count: int
    orders_filled_count: int
    orders_rejected_count: int
    emergency_trading_disabled: bool
    server_time: datetime
