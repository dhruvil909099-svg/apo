from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Index, UniqueConstraint
from app.core.database import Base


class HistoricalCandle(Base):
    """
    Authoritative Historical Candle Storage for IPOPro.
    Caches verified SmartAPI getCandleData records for NSE, BSE, NFO, BFO, and MCX.
    Prevents duplicate API calls and supports instant chart backfilling.
    """
    __tablename__ = "historical_candles"

    id = Column(Integer, primary_key=True, index=True)
    exchange = Column(String(10), nullable=False, index=True)          # NSE, BSE, NFO, BFO, MCX
    symbol_token = Column(String(30), nullable=False, index=True)      # e.g. "1406" (HINDCOPPER)
    tradingsymbol = Column(String(60), nullable=False, index=True)     # e.g. "HINDCOPPER"
    interval = Column(String(20), nullable=False, index=True)          # ONE_MINUTE, FIVE_MINUTE, ONE_DAY...
    timestamp = Column(String(30), nullable=False, index=True)         # "2026-10-29T09:15:00+05:30" or "yyyy-MM-dd HH:mm"
    epoch_time = Column(Integer, nullable=False, index=True)           # Unix epoch seconds in IST for fast range queries
    
    open = Column(Float, nullable=False)
    high = Column(Float, nullable=False)
    low = Column(Float, nullable=False)
    close = Column(Float, nullable=False)
    volume = Column(Integer, default=0, nullable=False)
    
    is_complete = Column(Boolean, default=True, index=True)            # False for the current active/incomplete candle
    data_source = Column(String(50), default="SMARTAPI_HISTORICAL_API")
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("exchange", "symbol_token", "interval", "epoch_time", name="uq_candle_record"),
        Index("idx_candle_lookup", "exchange", "symbol_token", "interval", "epoch_time"),
    )
