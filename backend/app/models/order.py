from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    client_order_id = Column(String(64), unique=True, index=True, nullable=False)  # Idempotency key
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False)
    broker_order_id = Column(String(64), nullable=True, index=True)
    batch_id = Column(String(64), nullable=True, index=True)  # Bulk order group identifier
    
    tradingsymbol = Column(String(50), nullable=False)
    symbol_token = Column(String(30), nullable=False)
    exchange = Column(String(10), default="NSE", nullable=False)
    transaction_type = Column(String(10), default="SELL", nullable=False)  # BUY / SELL
    order_type = Column(String(20), default="LIMIT", nullable=False)      # LIMIT / MARKET / STOPLOSS_LIMIT / STOPLOSS_MARKET
    product_type = Column(String(20), default="DELIVERY", nullable=False)  # DELIVERY
    variety = Column(String(20), default="NORMAL", nullable=False)        # NORMAL / STOPLOSS
    
    quantity = Column(Integer, nullable=False)
    filled_quantity = Column(Integer, default=0, nullable=False)
    price = Column(Float, default=0.0, nullable=False)
    trigger_price = Column(Float, default=0.0, nullable=False)
    execution_price = Column(Float, nullable=True)
    
    # Status: PREPARED, SUBMITTED, ACCEPTED, EXECUTED, REJECTED, CANCELLED
    status = Column(String(20), default="PREPARED", nullable=False, index=True)
    rejection_reason = Column(String(500), nullable=True)
    is_paper_trade = Column(Boolean, default=True, nullable=False)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    account = relationship("Account", back_populates="orders")
