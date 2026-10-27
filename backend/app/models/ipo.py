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
    lot_size = Column(Integer, default=1, nullable=False)
    listing_date = Column(String(20), nullable=True)  # YYYY-MM-DD
    isin = Column(String(30), nullable=True, index=True)
    symbol_token = Column(String(30), nullable=True, index=True)  # Angel One token (e.g., "12345")
    is_sme = Column(Boolean, default=False)
    
    # Market live feed cache
    current_ltp = Column(Float, nullable=True)
    previous_close = Column(Float, nullable=True)
    
    # Status: UPCOMING, PRE_OPEN, LISTED, CLOSED
    status = Column(String(20), default="LISTED")
    created_at = Column(DateTime, default=datetime.utcnow)

    # Relationships
    allotments = relationship("Allotment", back_populates="ipo", cascade="all, delete-orphan")


class Allotment(Base):
    __tablename__ = "allotments"

    id = Column(Integer, primary_key=True, index=True)
    ipo_id = Column(Integer, ForeignKey("ipos.id", ondelete="CASCADE"), nullable=False)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    
    application_no = Column(String(100), nullable=True)
    applied_quantity = Column(Integer, default=0, nullable=False)
    allotted_quantity = Column(Integer, default=0, nullable=False)
    acquisition_cost = Column(Float, nullable=False)  # Usually issue_price
    
    # Status: APPLIED, PENDING, ALLOTTED, NOT_ALLOTTED, DEMAT_CREDITED
    status = Column(String(30), default="ALLOTTED", nullable=False)
    demat_verified = Column(Boolean, default=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    ipo = relationship("IPO", back_populates="allotments")
    account = relationship("Account", back_populates="allotments")
