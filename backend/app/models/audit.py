from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime
from app.core.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    event_type = Column(String(50), index=True, nullable=False)  # AUTH_SUCCESS, ORDER_SUBMITTED, etc.
    account_id = Column(Integer, nullable=True, index=True)
    operator = Column(String(50), default="OPERATOR", nullable=False)
    details_json = Column(Text, nullable=False)  # Sanitized JSON details without secrets
