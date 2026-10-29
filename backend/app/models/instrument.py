from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, Index
from app.core.database import Base


class Instrument(Base):
    """
    Authoritative Angel One SmartAPI Instrument Master catalog.
    Maintains a normalized, searchable registry of NSE/BSE Equity securities,
    NFO/BFO Derivatives (Futures & Options), MCX Commodities, and Major Indices.
    """
    __tablename__ = "instruments"

    id = Column(Integer, primary_key=True, index=True)
    symbol_token = Column(String(30), nullable=False, index=True)
    instrument_token = Column(String(50), nullable=True, index=True)
    tradingsymbol = Column(String(60), nullable=False, index=True)
    name = Column(String(150), nullable=False, index=True)
    exchange = Column(String(10), nullable=False, index=True)            # "NSE", "BSE", "NFO", "BFO", "MCX"
    segment = Column(String(20), nullable=False, index=True)             # "EQUITY", "FUTURES", "OPTIONS", "COMMODITY", "INDEX"
    instrument_type = Column(String(20), nullable=False, index=True)     # "EQUITY", "FUTSTK", "FUTIDX", "OPTSTK", "OPTIDX", "FUTCOM", "OPTCOM", "INDEX"
    underlying_symbol = Column(String(50), nullable=True, index=True)   # "NIFTY", "BANKNIFTY", "HINDCOPPER", "GOLD"
    isin = Column(String(30), nullable=True, index=True)
    
    # Derivative & Commodity specifications
    expiry = Column(String(20), nullable=True, index=True)              # "2026-11-26"
    strike = Column(Float, nullable=True, index=True)
    option_type = Column(String(10), nullable=True, index=True)         # "CE", "PE"
    lot_size = Column(Integer, default=1, nullable=False)
    tick_size = Column(Float, default=0.05, nullable=False)
    
    # Market & Pricing Snapshot
    current_ltp = Column(Float, nullable=True)
    previous_close = Column(Float, nullable=True)
    day_change = Column(Float, nullable=True)
    day_change_percentage = Column(Float, nullable=True)
    high_52week = Column(Float, nullable=True)
    low_52week = Column(Float, nullable=True)
    volume = Column(Integer, default=0)
    open_interest = Column(Integer, default=0)
    
    # Operational status
    is_active = Column(Boolean, default=True, index=True)
    trading_status = Column(String(20), default="ACTIVE")               # "ACTIVE", "EXPIRED", "SUSPENDED"
    data_source = Column(String(50), default="ANGEL_ONE_OPENAPI_MASTER")
    
    last_sync_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_inst_search", "tradingsymbol", "exchange", "segment"),
        Index("idx_inst_underlying", "underlying_symbol", "expiry", "strike"),
    )
