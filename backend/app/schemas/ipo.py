from typing import Optional, List
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class IPOCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=50)
    company_name: str = Field(..., min_length=1, max_length=200)
    exchange: str = Field(default="NSE", max_length=10)
    issue_price: float = Field(..., gt=0)
    lot_size: int = Field(default=1, gt=0)
    listing_date: Optional[str] = None
    isin: Optional[str] = None
    symbol_token: Optional[str] = None
    is_sme: bool = Field(default=False)
    status: str = Field(default="LISTED")


class IPOResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    company_name: str
    exchange: str
    issue_price: float
    lot_size: int
    listing_date: Optional[str] = None
    isin: Optional[str] = None
    symbol_token: Optional[str] = None
    is_sme: bool
    current_ltp: Optional[float] = None
    previous_close: Optional[float] = None
    status: str
    total_allotted_shares: int = 0
    total_accounts_allotted: int = 0
    estimated_current_value: float = 0.0
    estimated_pnl: float = 0.0
    pnl_percentage: float = 0.0
    created_at: datetime


class AllotmentCreate(BaseModel):
    ipo_id: int
    account_id: int
    application_no: Optional[str] = None
    applied_quantity: int = Field(default=0, ge=0)
    allotted_quantity: int = Field(default=0, ge=0)
    acquisition_cost: float = Field(..., gt=0)
    status: str = Field(default="ALLOTTED")  # APPLIED, PENDING, ALLOTTED, NOT_ALLOTTED, DEMAT_CREDITED


class AllotmentUpdate(BaseModel):
    allotted_quantity: Optional[int] = None
    status: Optional[str] = None
    demat_verified: Optional[bool] = None


class AllotmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    ipo_id: int
    account_id: int
    account_nickname: str
    account_masked_code: str
    account_group: str
    ipo_symbol: str
    application_no: Optional[str] = None
    applied_quantity: int
    allotted_quantity: int
    acquisition_cost: float
    current_ltp: Optional[float] = None
    market_value: float = 0.0
    unrealized_pnl: float = 0.0
    pnl_percentage: float = 0.0
    status: str
    demat_verified: bool
    ddpi_status: str
    edis_authorized: bool
    created_at: datetime


class CSVImportSummary(BaseModel):
    imported_count: int
    skipped_count: int
    errors: List[str]

