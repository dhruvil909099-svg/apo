import logging
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.audit import AuditLog
from app.models.risk import RiskLimit

logger = logging.getLogger("seed_data")


def wipe_all_data(db: Session):
    """
    Completely wipes all accounts, IPOs, allotments, orders, and audit logs.
    Leaves a clean, empty production database.
    """
    logger.info("Wiping all existing database records...")
    db.query(Order).delete()
    db.query(Allotment).delete()
    db.query(IPO).delete()
    db.query(Account).delete()
    db.query(AuditLog).delete()
    
    # Ensure default global risk limit exists
    if db.query(RiskLimit).count() == 0:
        risk = RiskLimit(
            account_id=None,
            max_order_value=500000.0,
            max_quantity_per_order=5000,
            max_loss_threshold=50000.0,
            stop_loss_percent=5.0,
            target_profit_percent=20.0,
            emergency_trading_disabled=False,
            allow_market_orders_on_listing=False
        )
        db.add(risk)

    db.commit()
    logger.info("All data wiped. Database is clean and ready for production use.")


from app.services.account_persistence import restore_accounts_backup
from app.services.ipo_feed_service import IPOFeedService


def seed_demo_data(db: Session):
    """
    Guarantees container restart resilience:
    - Restores registered accounts if database was wiped on container reboot.
    - Synchronizes verified market IPO feed if IPO catalog is empty.
    """
    restored = restore_accounts_backup(db)
    if restored > 0:
        logger.info(f"Auto-restored {restored} accounts on system boot.")

    if db.query(IPO).count() == 0:
        logger.info("Fresh database detected. Initializing authoritative IPO catalog...")
        IPOFeedService.sync_feed(db)

