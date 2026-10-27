from datetime import datetime
from sqlalchemy import Column, Integer, Float, Boolean, DateTime, ForeignKey
from app.core.database import Base


class RiskLimit(Base):
    __tablename__ = "risk_limits"

    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("accounts.id", ondelete="CASCADE"), nullable=True, unique=True)
    
    max_order_value = Column(Float, default=500000.0, nullable=False)
    max_quantity_per_order = Column(Integer, default=5000, nullable=False)
    max_loss_threshold = Column(Float, default=50000.0, nullable=False)
    
    stop_loss_percent = Column(Float, default=5.0, nullable=False)
    target_profit_percent = Column(Float, default=20.0, nullable=False)
    
    emergency_trading_disabled = Column(Boolean, default=False, nullable=False)
    allow_market_orders_on_listing = Column(Boolean, default=False, nullable=False)  # Pre-open safety guard
    
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
