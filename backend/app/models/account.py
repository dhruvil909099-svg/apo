from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, Float, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base
from app.core.security import mask_client_id


class Account(Base):
    __tablename__ = "accounts"

    id = Column(Integer, primary_key=True, index=True)
    nickname = Column(String(100), nullable=False)
    client_code = Column(String(50), unique=True, index=True, nullable=False)
    account_group = Column(String(50), default="Family", index=True)
    
    # Encrypted credentials (AES-256-GCM)
    encrypted_api_key = Column(String(512), nullable=False)
    encrypted_pin = Column(String(512), nullable=False)
    encrypted_totp_secret = Column(String(512), nullable=False)
    
    # Flags & Connection State
    is_enabled = Column(Boolean, default=True)
    is_demo = Column(Boolean, default=False)
    auth_status = Column(String(30), default="DISCONNECTED")  # CONNECTED, DISCONNECTED, EXPIRED, ERROR
    
    # Depository & Order Placement Flags
    ddpi_status = Column(String(30), default="UNKNOWN")  # ACTIVE, INACTIVE, UNKNOWN
    edis_authorized_today = Column(Boolean, default=False)
    
    # Metrics & Auto-Sync Telemetry
    available_cash = Column(Float, default=100000.0)  # Default demo balance or synced live balance
    last_sync_time = Column(DateTime, nullable=True)
    last_sync_attempt = Column(DateTime, nullable=True)
    sync_status = Column(String(30), default="IDLE")  # IDLE, REFRESHING, SUCCESS, STALE_FALLBACK, ERROR
    consecutive_errors = Column(Integer, default=0)
    circuit_breaker_until = Column(DateTime, nullable=True)
    last_auth_error = Column(String(500), nullable=True)
    
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    allotments = relationship("Allotment", back_populates="account", cascade="all, delete-orphan")
    orders = relationship("Order", back_populates="account", cascade="all, delete-orphan")

    @property
    def masked_client_code(self) -> str:
        return mask_client_id(self.client_code)
