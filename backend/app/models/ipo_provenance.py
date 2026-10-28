from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, ForeignKey
from app.core.database import Base


class IPODataSource(Base):
    """
    Registry of authorized capital-market data providers.
    Tracks provider licensing, operational health, and connectivity.
    """
    __tablename__ = "ipo_data_sources"

    id = Column(Integer, primary_key=True, index=True)
    provider_name = Column(String(80), unique=True, index=True, nullable=False)
    provider_type = Column(String(50), nullable=False)  # OFFICIAL_EXCHANGE, OFFICIAL_REGULATOR, LICENSED_COMMERCIAL
    license_status = Column(String(50), default="PUBLIC_DISCLOSURE", nullable=False)  # ACTIVE, PUBLIC_DISCLOSURE, UNCONFIGURED
    is_enabled = Column(Boolean, default=True, nullable=False)
    last_successful_sync = Column(DateTime, nullable=True)
    last_error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class IPODataProvenance(Base):
    """
    Field-level audit trail recording the origin and verification status of every IPO metric.
    """
    __tablename__ = "ipo_data_provenance"

    id = Column(Integer, primary_key=True, index=True)
    ipo_id = Column(Integer, ForeignKey("ipos.id", ondelete="CASCADE"), nullable=False, index=True)
    field_name = Column(String(60), nullable=False, index=True)  # price_band, lot_size, subscription_rate, etc.
    source_name = Column(String(80), nullable=False)
    document_reference = Column(String(255), nullable=True)
    document_url = Column(String(255), nullable=True)
    source_timestamp = Column(DateTime, nullable=True)
    fetched_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    verified_at = Column(DateTime, nullable=True)
    verification_status = Column(String(30), default="VERIFIED", nullable=False)  # VERIFIED, STALE, UNAVAILABLE, PENDING_VERIFICATION


class IPOSyncLog(Base):
    """
    Operational audit log capturing execution metrics of background synchronization cycles.
    """
    __tablename__ = "ipo_sync_logs"

    id = Column(Integer, primary_key=True, index=True)
    provider_name = Column(String(80), nullable=False, index=True)
    sync_started_at = Column(DateTime, nullable=False)
    sync_finished_at = Column(DateTime, nullable=True)
    status = Column(String(30), default="PENDING", nullable=False)  # SUCCESS, FAILED, PARTIAL
    records_processed = Column(Integer, default=0, nullable=False)
    records_updated = Column(Integer, default=0, nullable=False)
    records_rejected = Column(Integer, default=0, nullable=False)
    error_summary = Column(Text, nullable=True)
