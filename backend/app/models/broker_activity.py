from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey, Text
from app.core.database import Base


class BrokerTradeSnapshot(Base):
    """
    Dedicated table storing genuine executed trade fills from Angel One Trade Book (/order/v1/getTradeBook).
    Retains original broker fill IDs, execution price, fill quantity, and trade timestamps.
    """
    __tablename__ = "broker_trade_snapshots"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    
    fill_id = Column(String(64), nullable=False, index=True)       # SmartAPI tradeid
    broker_order_id = Column(String(64), nullable=False, index=True) # Associated SmartAPI orderid
    tradingsymbol = Column(String(50), nullable=False, index=True)
    exchange = Column(String(10), default="NSE", nullable=False)
    transaction_type = Column(String(10), default="BUY", nullable=False) # BUY / SELL
    product_type = Column(String(20), default="DELIVERY", nullable=False) # DELIVERY / INTRADAY
    
    fill_quantity = Column(Integer, nullable=False)
    fill_price = Column(Float, nullable=False)
    trade_value = Column(Float, nullable=False)
    trade_time = Column(DateTime, nullable=True)
    
    is_paper_trade = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class BrokerSyncMetadata(Base):
    """
    Telemetry and health tracking for each broker data sync.
    Records timestamp, endpoint, record count, freshness, and errors.
    """
    __tablename__ = "broker_sync_metadata"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True)
    
    endpoint = Column(String(50), nullable=False, index=True) # RMS_FUNDS, HOLDINGS, POSITIONS, ORDER_BOOK, TRADE_BOOK
    status = Column(String(20), default="SUCCESS", nullable=False) # SUCCESS, FAILED, TIMEOUT
    records_count = Column(Integer, default=0, nullable=False)
    freshness = Column(String(20), default="LIVE", nullable=False) # LIVE, CACHED, STALE
    error_message = Column(Text, nullable=True)
    
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)
