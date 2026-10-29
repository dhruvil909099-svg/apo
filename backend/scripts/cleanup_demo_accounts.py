import sys
import os

# Ensure backend root is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.database import SessionLocal, engine, run_safe_migrations
from app.models.account import Account
from app.models.order import Order
from app.models.ipo import Allotment
from app.models.holding import AccountHoldingSnapshot
from app.services.account_persistence import persist_accounts_backup

def main():
    run_safe_migrations(engine)
    db = SessionLocal()
    try:
        # Find all accounts that are not the user's OG account (AAAD986778)
        demo_accounts = db.query(Account).filter(Account.client_code != "AAAD986778").all()
        demo_ids = [a.id for a in demo_accounts]
        print(f"Found {len(demo_accounts)} demo/non-OG accounts to remove:")
        for a in demo_accounts:
            print(f"  - ID: {a.id}, Nickname: {a.nickname}, Client Code: {a.client_code}")

        if demo_ids:
            # Delete dependent records
            db.query(Order).filter(Order.account_id.in_(demo_ids)).delete(synchronize_session=False)
            db.query(Allotment).filter(Allotment.account_id.in_(demo_ids)).delete(synchronize_session=False)
            try:
                db.query(AccountHoldingSnapshot).filter(AccountHoldingSnapshot.account_id.in_(demo_ids)).delete(synchronize_session=False)
            except Exception:
                pass

            for da in demo_accounts:
                db.delete(da)

            db.commit()
            print("Successfully deleted demo accounts and associated records.")

        # Verify only the user's OG account remains
        remaining = db.query(Account).all()
        print(f"\nRemaining accounts in database: {len(remaining)}")
        for r in remaining:
            print(f"  - ID: {r.id}, Nickname: {r.nickname}, Client Code: {r.client_code}, IsDemo: {r.is_demo}, Status: {r.auth_status}")

        # Update backup file to persist ONLY the remaining OG account
        persist_accounts_backup(db)
        print("Updated accounts_backup.json with OG account only.")

    finally:
        db.close()

if __name__ == "__main__":
    main()
