from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class IPO(Base):
    __tablename__ = "ipos"

    id = Column(Integer, primary_key=True, index=True)
    symbol = Column(String(50), unique=True, index=True, nullable=False)  # e.g., "TATATECH", "HYUNDAI"
    company_name = Column(String(200), nullable=False)
    exchange = Column(String(10), default="NSE", nullable=False)  # "NSE" or "BSE"
    issue_price = Column(Float, nullable=False)
    min_price = Column(Float, nullable=True)  # Lower price band
    max_price = Column(Float, nullable=True)  # Upper price band
    lot_size = Column(Integer, default=1, nullable=False)
    
    # Dates
    bidding_start_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    bidding_end_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    allotment_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    listing_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    
    isin = Column(String(30), nullable=True, index=True)
    symbol_token = Column(String(30), nullable=True, index=True)  # Angel One token (e.g., "12345")
    is_sme = Column(Boolean, default=False)
    
    # Market live feed cache
    current_ltp = Column(Float, nullable=True)
    previous_close = Column(Float, nullable=True)
    
    # Status: UPCOMING, OPEN, PRE_OPEN, CLOSED, LISTED
    status = Column(String(20), default="LISTED")
    
    # Financial and Subscription Details (matching Angel One data quality)
    subscription_rate = Column(String(30), nullable=True)  # e.g. "14.89x", "0.5x"
    min_investment = Column(Float, nullable=True)         # e.g. lot_size * min_price
    issue_size = Column(String(50), nullable=True)         # e.g. "₹500 Cr"
    
    # Discovery & Synchronization Attribution
    source_name = Column(String(50), default="MANUAL", nullable=False)
    source_timestamp = Column(DateTime, nullable=True)
    last_sync_at = Column(DateTime, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    allotments = relationship("Allotment", back_populates="ipo", cascade="all, delete-orphan")


class Allotment(Base):
    __tablename__ = "allotments"

    id = Column(Integer, primary_key=True, index=True)
    ipo_id = Column(Integer, ForeignKey("ipos.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    
    application_no = Column(String(100), nullable=True)
    category = Column(String(20), default="RETAIL", nullable=False)  # RETAIL, sNII, bNII, EMPLOYEE
    applied_quantity = Column(Integer, default=0, nullable=False)
    allotted_quantity = Column(Integer, default=0, nullable=False)
    acquisition_cost = Column(Float, nullable=False)  # Usually issue_price
    
    # Application & Mandate lifecycle
    pan_masked = Column(String(20), nullable=True)
    upi_id_masked = Column(String(100), nullable=True)
    mandate_status = Column(String(30), default="PENDING", nullable=False)  # PENDING, APPROVED, REJECTED
    
    # Allotment verification lifecycle
    allotment_status = Column(String(30), default="PENDING", nullable=False)  # PENDING, ALLOTTED, NOT_ALLOTTED, VERIFICATION_REQUIRED
    demat_credit_status = Column(String(30), default="PENDING", nullable=False)  # PENDING, CREDITED, NOT_APPLICABLE
    verification_source = Column(String(50), nullable=True)  # ANGEL_ONE_HOLDINGS, REGISTRAR_CSV, MANUAL
    verification_timestamp = Column(DateTime, nullable=True)
    conflict_note = Column(String(255), nullable=True)
    
    # Status: APPLIED, PENDING, ALLOTTED, NOT_ALLOTTED, DEMAT_CREDITED
    status = Column(String(30), default="ALLOTTED", nullable=False)
    demat_verified = Column(Boolean, default=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    ipo = relationship("IPO", back_populates="allotments")
    account = relationship("Account", back_populates="allotments")
