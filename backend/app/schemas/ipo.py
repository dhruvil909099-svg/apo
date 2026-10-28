from typing import Optional, List, Any, Dict
from datetime import datetime
from pydantic import BaseModel, Field, ConfigDict


class IPOCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=50)
    company_name: str = Field(..., min_length=1, max_length=200)
    exchange: str = Field(default="NSE", max_length=10)
    issue_price: float = Field(..., gt=0)
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    lot_size: int = Field(default=1, gt=0)
    bidding_start_date: Optional[str] = None
    bidding_end_date: Optional[str] = None
    allotment_date: Optional[str] = None
    listing_date: Optional[str] = None
    isin: Optional[str] = None
    symbol_token: Optional[str] = None
    is_sme: bool = Field(default=False)
    status: str = Field(default="LISTED")
    source_name: Optional[str] = "MANUAL"
    subscription_rate: Optional[str] = None
    min_investment: Optional[float] = None
    issue_size: Optional[str] = None
    company_logo_url: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    description: Optional[str] = None
    issue_type: Optional[str] = "Book Built Issue"
    fresh_issue_size: Optional[str] = None
    offer_for_sale_size: Optional[str] = None
    face_value: Optional[float] = None
    retail_quota: Optional[str] = None
    qib_quota: Optional[str] = None
    nii_quota: Optional[str] = None
    listing_price: Optional[float] = None
    listing_gain: Optional[float] = None
    lead_managers: Optional[str] = None
    registrar_name: Optional[str] = None
    registrar_url: Optional[str] = None
    drhp_url: Optional[str] = None
    rhp_url: Optional[str] = None
    financials_json: Optional[Any] = None
    valuation_json: Optional[Any] = None
    strengths_risks_json: Optional[Any] = None
    objects_of_issue_json: Optional[Any] = None
    subscription_details_json: Optional[Any] = None
    timeline_json: Optional[Any] = None


class IPOResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    company_name: str
    exchange: str
    issue_price: float
    min_price: Optional[float] = None
    max_price: Optional[float] = None
    lot_size: int
    bidding_start_date: Optional[str] = None
    bidding_end_date: Optional[str] = None
    allotment_date: Optional[str] = None
    listing_date: Optional[str] = None
    isin: Optional[str] = None
    symbol_token: Optional[str] = None
    is_sme: bool
    current_ltp: Optional[float] = None
    previous_close: Optional[float] = None
    status: str
    subscription_rate: Optional[str] = None
    min_investment: Optional[float] = None
    issue_size: Optional[str] = None
    
    # Comprehensive Fields
    company_logo_url: Optional[str] = None
    sector: Optional[str] = None
    industry: Optional[str] = None
    description: Optional[str] = None
    issue_type: Optional[str] = "Book Built Issue"
    fresh_issue_size: Optional[str] = None
    offer_for_sale_size: Optional[str] = None
    face_value: Optional[float] = None
    retail_quota: Optional[str] = None
    qib_quota: Optional[str] = None
    nii_quota: Optional[str] = None
    listing_price: Optional[float] = None
    listing_gain: Optional[float] = None
    lead_managers: Optional[str] = None
    registrar_name: Optional[str] = None
    registrar_url: Optional[str] = None
    drhp_url: Optional[str] = None
    rhp_url: Optional[str] = None
    financials_json: Optional[Any] = None
    valuation_json: Optional[Any] = None
    strengths_risks_json: Optional[Any] = None
    objects_of_issue_json: Optional[Any] = None
    subscription_details_json: Optional[Any] = None
    timeline_json: Optional[Any] = None

    source_name: str = "MANUAL"
    source_timestamp: Optional[datetime] = None
    last_sync_at: Optional[datetime] = None
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
    category: str = Field(default="RETAIL")
    applied_quantity: int = Field(default=0, ge=0)
    allotted_quantity: int = Field(default=0, ge=0)
    acquisition_cost: float = Field(..., gt=0)
    pan_masked: Optional[str] = None
    upi_id_masked: Optional[str] = None
    mandate_status: str = Field(default="PENDING")
    preparation_status: Optional[str] = "READY_FOR_HANDOFF"
    broker_application_status: Optional[str] = "NOT_SUBMITTED"
    lots: Optional[int] = 1
    bid_price: Optional[float] = None
    total_amount: Optional[float] = 0.0
    upi_mandate_reference: Optional[str] = None
    bid_reference_no: Optional[str] = None
    official_portal_url: Optional[str] = None
    status: str = Field(default="ALLOTTED")  # APPLIED, PENDING, ALLOTTED, NOT_ALLOTTED, DEMAT_CREDITED


class AllotmentUpdate(BaseModel):
    allotted_quantity: Optional[int] = None
    applied_quantity: Optional[int] = None
    acquisition_cost: Optional[float] = None
    status: Optional[str] = None
    allotment_status: Optional[str] = None
    demat_credit_status: Optional[str] = None
    demat_verified: Optional[bool] = None
    conflict_note: Optional[str] = None
    preparation_status: Optional[str] = None
    broker_application_status: Optional[str] = None
    mandate_status: Optional[str] = None
    application_no: Optional[str] = None
    upi_mandate_reference: Optional[str] = None
    bid_reference_no: Optional[str] = None
    lots: Optional[int] = None
    bid_price: Optional[float] = None
    total_amount: Optional[float] = None


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
    category: str = "RETAIL"
    applied_quantity: int
    allotted_quantity: int
    acquisition_cost: float
    current_ltp: Optional[float] = None
    market_value: float = 0.0
    unrealized_pnl: float = 0.0
    pnl_percentage: float = 0.0
    pan_masked: Optional[str] = None
    upi_id_masked: Optional[str] = None
    mandate_status: str = "PENDING"
    preparation_status: str = "READY_FOR_HANDOFF"
    broker_application_status: str = "NOT_SUBMITTED"
    lots: int = 1
    bid_price: Optional[float] = None
    total_amount: float = 0.0
    upi_mandate_reference: Optional[str] = None
    bid_reference_no: Optional[str] = None
    official_portal_url: Optional[str] = None
    handoff_timestamp: Optional[datetime] = None
    allotment_status: str = "PENDING"
    demat_credit_status: str = "PENDING"
    status: str
    demat_verified: bool
    verification_source: Optional[str] = None
    verification_timestamp: Optional[datetime] = None
    conflict_note: Optional[str] = None
    ddpi_status: str
    edis_authorized: bool
    created_at: datetime


class CSVImportSummary(BaseModel):
    imported_count: int
    updated_count: int = 0
    conflict_count: int = 0
    skipped_count: int
    conflicts: List[str] = []
    errors: List[str] = []


class IPOPrepareApplicationRequest(BaseModel):
    ipo_id: int
    account_ids: List[int] = Field(..., min_length=1)
    lots: int = Field(default=1, gt=0)
    category: str = Field(default="RETAIL")
    bid_price: Optional[float] = None
    save_drafts: Optional[bool] = False


class IPOApplicationPreparedItem(BaseModel):
    account_id: int
    account_nickname: str
    account_masked_code: str
    ipo_symbol: str
    category: str
    lots: int
    shares: int
    cut_off_price: float
    total_amount: float
    is_valid: bool
    validation_message: Optional[str] = None
    duplicate_warning: Optional[str] = None
    official_portal_url: str = "https://trade.angelone.in/ipo"
    draft_id: Optional[int] = None


class IPOPrepareApplicationResponse(BaseModel):
    ipo_id: int
    ipo_symbol: str
    company_name: str
    lot_size: int
    issue_price: float
    total_accounts: int
    total_shares: int
    total_amount: float
    applications: List[IPOApplicationPreparedItem]
    all_valid: bool
    official_portal_url: str = "https://trade.angelone.in/ipo"


class IPOApplicationHandoffUpdate(BaseModel):
    allotment_id: int
    preparation_status: Optional[str] = None  # e.g., "AWAITING_CONFIRMATION", "SUBMITTED_BROKER_CONFIRMED"
    broker_application_status: Optional[str] = None  # e.g., "CONFIRMED", "PENDING_BROKER_VERIFICATION"
    application_no: Optional[str] = None
    upi_mandate_reference: Optional[str] = None
    mandate_status: Optional[str] = None  # "PENDING", "APPROVED", "REJECTED"
    verification_source: Optional[str] = "ACCOUNT_HOLDER_CONFIRMED"
