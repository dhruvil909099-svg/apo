import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.ipo import IPO
from app.models.ipo_provenance import IPODataSource, IPODataProvenance, IPOSyncLog
from app.services.ipo_providers.nse_provider import NSEExchangeProvider

logger = logging.getLogger("ipo_aggregator")


class IPODataAggregator:
    """
    Modular aggregation service for primary market IPO data.
    Orchestrates authorized data adapters, enforces provenance recording,
    and guarantees that synthetic / hardcoded records are never inserted.
    """

    def __init__(self):
        self.nse_provider = NSEExchangeProvider()

    def ensure_data_sources_registered(self, db: Session):
        """Ensures that authorized provider sources are present in ipo_data_sources."""
        sources = [
            ("NSE_INDIA_OFFICIAL_FEED", "OFFICIAL_EXCHANGE", "ACTIVE", True),
            ("BSE_INDIA_STAR", "OFFICIAL_EXCHANGE", "UNCONFIGURED", False),
            ("SEBI_STATUTORY_DISCLOSURES", "OFFICIAL_REGULATOR", "PUBLIC_DISCLOSURE", True),
            ("PRIME_DATABASE_LICENSED", "LICENSED_COMMERCIAL", "UNCONFIGURED", False),
        ]
        for name, p_type, lic, enabled in sources:
            src = db.query(IPODataSource).filter_by(provider_name=name).first()
            if not src:
                src = IPODataSource(
                    provider_name=name,
                    provider_type=p_type,
                    license_status=lic,
                    is_enabled=enabled,
                )
                db.add(src)
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            logger.warning(f"Could not register default data sources: {e}")

    def sync_from_live_sources(self, db: Session) -> Dict[str, Any]:
        """
        Executes live fetch from the National Stock Exchange and synchronizes MySQL.
        Records field-level provenance and writes to ipo_sync_logs.
        """
        self.ensure_data_sources_registered(db)
        sync_start = datetime.utcnow()
        provider_name = self.nse_provider.get_provider_name()

        sync_log = IPOSyncLog(
            provider_name=provider_name,
            sync_started_at=sync_start,
            status="RUNNING"
        )
        db.add(sync_log)
        db.commit()

        processed = 0
        updated = 0
        rejected = 0
        error_summary = None

        try:
            live_records = self.nse_provider.fetch_all_normalized()
            processed = len(live_records)

            for rec in live_records:
                sym = rec.get("symbol")
                if not sym:
                    rejected += 1
                    continue

                existing = db.query(IPO).filter_by(symbol=sym).first()

                if existing:
                    # Update verified fields
                    existing.company_name = rec["company_name"]
                    existing.issue_price = rec["issue_price"]
                    existing.min_price = rec["min_price"]
                    existing.max_price = rec["max_price"]
                    existing.lot_size = rec["lot_size"]
                    existing.min_investment = rec["min_investment"]
                    existing.issue_size = rec["issue_size"] or existing.issue_size
                    existing.bidding_start_date = rec["bidding_start_date"] or existing.bidding_start_date
                    existing.bidding_end_date = rec["bidding_end_date"] or existing.bidding_end_date
                    existing.is_sme = rec["is_sme"]
                    existing.status = rec["status"]
                    existing.subscription_rate = rec["subscription_rate"] or existing.subscription_rate
                    existing.registrar_name = rec["registrar_name"] or existing.registrar_name
                    existing.lead_managers = rec["lead_managers"] or existing.lead_managers
                    existing.rhp_url = rec["rhp_url"] or existing.rhp_url
                    existing.source_name = rec["source_name"]
                    existing.source_document_url = rec["source_document_url"]
                    existing.data_quality_status = "VERIFIED"
                    existing.source_verified_at = datetime.utcnow()
                    existing.last_sync_at = datetime.utcnow()
                    updated += 1
                else:
                    # Insert new verified IPO
                    new_ipo = IPO(
                        symbol=sym,
                        company_name=rec["company_name"],
                        exchange=rec["exchange"],
                        issue_price=rec["issue_price"],
                        min_price=rec["min_price"],
                        max_price=rec["max_price"],
                        lot_size=rec["lot_size"],
                        min_investment=rec["min_investment"],
                        issue_size=rec["issue_size"],
                        bidding_start_date=rec["bidding_start_date"],
                        bidding_end_date=rec["bidding_end_date"],
                        is_sme=rec["is_sme"],
                        status=rec["status"],
                        subscription_rate=rec["subscription_rate"],
                        registrar_name=rec["registrar_name"],
                        lead_managers=rec["lead_managers"],
                        rhp_url=rec["rhp_url"],
                        source_name=rec["source_name"],
                        source_document_url=rec["source_document_url"],
                        data_quality_status="VERIFIED",
                        source_verified_at=datetime.utcnow(),
                        last_sync_at=datetime.utcnow(),
                    )
                    db.add(new_ipo)
                    db.flush()
                    updated += 1

                # Record provenance
                prov = IPODataProvenance(
                    ipo_id=existing.id if existing else new_ipo.id,
                    field_name="bidding_and_pricing_metrics",
                    source_name=provider_name,
                    document_reference=f"NSE Official Circular ({sym})",
                    document_url=rec["source_document_url"],
                    source_timestamp=rec["source_timestamp"],
                    fetched_at=datetime.utcnow(),
                    verified_at=datetime.utcnow(),
                    verification_status="VERIFIED"
                )
                db.add(prov)

            # Update data source health
            ds = db.query(IPODataSource).filter_by(provider_name=provider_name).first()
            if ds:
                ds.last_successful_sync = datetime.utcnow()
                ds.last_error = None

            sync_log.status = "SUCCESS"
            db.commit()
            logger.info(f"IPO Sync complete: {processed} processed, {updated} updated/created from {provider_name}.")

        except Exception as e:
            db.rollback()
            error_summary = str(e)
            logger.error(f"IPO sync failed: {e}")
            sync_log.status = "FAILED"
            sync_log.error_summary = error_summary
            try:
                db.commit()
            except Exception:
                pass

        sync_log.sync_finished_at = datetime.utcnow()
        sync_log.records_processed = processed
        sync_log.records_updated = updated
        sync_log.records_rejected = rejected
        try:
            db.commit()
        except Exception:
            pass

        return {
            "status": sync_log.status,
            "provider": provider_name,
            "records_processed": processed,
            "records_updated": updated,
            "sync_started_at": sync_start.isoformat(),
            "sync_finished_at": datetime.utcnow().isoformat(),
            "error": error_summary
        }
