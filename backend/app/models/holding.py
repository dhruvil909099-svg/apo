from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from app.core.database import Base


class AccountHoldingSnapshot(Base):
    """
    Dedicated Demat delivery holdings snapshot table.
    Maintains a 1:1 verified representation of ordinary brokerage equity delivery shares
    synced from Angel One SmartAPI, strictly segregated from IPO applications & allotments.
    """
    __tablename__ = "account_holding_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    
    tradingsymbol = Column(String(50), nullable=False, index=True)   # e.g. "HINDCOPPER-EQ", "RELIANCE-EQ"
    symbol = Column(String(50), nullable=False, index=True)          # e.g. "HINDCOPPER", "RELIANCE"
    symbol_token = Column(String(30), nullable=True, index=True)     # e.g. "14428"
    exchange = Column(String(10), default="NSE", nullable=False)     # "NSE" or "BSE"
    isin = Column(String(30), nullable=True, index=True)             # e.g. "INE849A01012"
    product = Column(String(20), default="DELIVERY", nullable=False) # "DELIVERY"
    
    # Quantities
    quantity = Column(Integer, default=0, nullable=False)
    t1_quantity = Column(Integer, default=0, nullable=False)
    realised_quantity = Column(Integer, default=0, nullable=False)
    authorised_quantity = Column(Integer, default=0, nullable=False)
    collateral_quantity = Column(Integer, default=0, nullable=False)
    collateral_type = Column(String(50), nullable=True)
    blocked_in_open_orders = Column(Integer, default=0, nullable=False)
    sellable_quantity = Column(Integer, nullable=True)
    verification_status = Column(String(30), default="VERIFIED", nullable=False)
    verification_timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    
    # Valuation & Pricing
    average_price = Column(Float, default=0.0, nullable=False)       # Weighted acquisition price reported by broker
    ltp = Column(Float, default=0.0, nullable=False)                 # Last traded price
    close_price = Column(Float, default=0.0, nullable=False)         # Previous close
    invested_value = Column(Float, default=0.0, nullable=False)      # qty * average_price (or broker invested)
    market_value = Column(Float, default=0.0, nullable=False)        # qty * ltp
    unrealized_pnl = Column(Float, default=0.0, nullable=False)      # market_value - invested_value
    pnl_percentage = Column(Float, default=0.0, nullable=False)
    day_pnl = Column(Float, default=0.0, nullable=False)             # (ltp - close_price) * qty
    day_pnl_percentage = Column(Float, default=0.0, nullable=False)
    
    # Telemetry & Provenance
    is_broker_reported = Column(Boolean, default=True, nullable=False)
    data_source = Column(String(50), default="ANGEL_ONE_HOLDINGS", nullable=False)
    last_sync_time = Column(DateTime, default=datetime.utcnow, nullable=False)
    raw_payload = Column(JSON, nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    account = relationship("Account", back_populates="holding_snapshots")
