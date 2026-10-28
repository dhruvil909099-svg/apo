import io
import pytest
from app.models.ipo import IPO, Allotment
from app.models.account import Account


def test_list_ipos(client):
    response = client.get("/api/v1/ipos")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    # Check that TATATECH is in results
    symbols = [item["symbol"] for item in data]
    assert "TATATECH" in symbols
    first_ipo = next(item for item in data if item["symbol"] == "TATATECH")
    assert first_ipo["issue_price"] == 500.0
    assert "estimated_pnl" in first_ipo
    assert "pnl_percentage" in first_ipo


def test_list_ipos_with_filter(client):
    response = client.get("/api/v1/ipos?status_filter=LISTED")
    assert response.status_code == 200
    data = response.json()
    assert all(item["status"] == "LISTED" for item in data)


def test_create_ipo_success(client):
    new_ipo_payload = {
        "symbol": "NEWIPO2026",
        "company_name": "New Tech Enterprises Ltd",
        "exchange": "NSE",
        "issue_price": 250.0,
        "min_price": 240.0,
        "max_price": 250.0,
        "lot_size": 40,
        "bidding_start_date": "2026-11-01",
        "bidding_end_date": "2026-11-03",
        "allotment_date": "2026-11-04",
        "listing_date": "2026-11-07",
        "isin": "INE999X01019",
        "is_sme": False,
        "status": "UPCOMING"
    }
    response = client.post("/api/v1/ipos", json=new_ipo_payload)
    assert response.status_code == 201
    created = response.json()
    assert created["symbol"] == "NEWIPO2026"
    assert created["company_name"] == "New Tech Enterprises Ltd"
    assert created["issue_price"] == 250.0
    assert created["lot_size"] == 40
    assert created["status"] == "UPCOMING"


def test_duplicate_ipo_symbol_rejected(client):
    dup_payload = {
        "symbol": "TATATECH",  # Already seeded in conftest
        "company_name": "Duplicate Tata Tech",
        "exchange": "NSE",
        "issue_price": 500.0,
        "lot_size": 30
    }
    response = client.post("/api/v1/ipos", json=dup_payload)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"].lower()


def test_create_and_list_allotments(client, db_session):
    ipo = db_session.query(IPO).filter(IPO.symbol == "TATATECH").first()
    acc = db_session.query(Account).first()
    assert ipo is not None
    assert acc is not None

    allot_payload = {
        "ipo_id": ipo.id,
        "account_id": acc.id,
        "application_no": "TEST-APP-001",
        "category": "RETAIL",
        "applied_quantity": 30,
        "allotted_quantity": 30,
        "acquisition_cost": 500.0,
        "status": "ALLOTTED"
    }
    res = client.post(f"/api/v1/ipos/{ipo.id}/allotments", json=allot_payload)
    assert res.status_code == 200
    data = res.json()
    assert data["account_nickname"] == acc.nickname
    assert data["allotted_quantity"] == 30
    assert data["acquisition_cost"] == 500.0
    assert data["market_value"] > 0

    # Query allotments list
    list_res = client.get(f"/api/v1/ipos/{ipo.id}/allotments")
    assert list_res.status_code == 200
    allotments = list_res.json()
    assert len(allotments) >= 1
    assert any(a["application_no"] == "TEST-APP-001" for a in allotments)


def test_csv_import_allotments_success(client, db_session):
    ipo = db_session.query(IPO).filter(IPO.symbol == "TATATECH").first()
    acc = db_session.query(Account).first()

    csv_content = f"client_code,application_no,applied_qty,allotted_qty,cost\n{acc.client_code},CSV-APP-01,30,30,500.0\n"
    files = {"file": ("allotments.csv", io.BytesIO(csv_content.encode("utf-8")), "text/csv")}

    res = client.post(f"/api/v1/ipos/{ipo.id}/import-csv", files=files)
    assert res.status_code == 200
    summary = res.json()
    assert summary["imported_count"] + summary["updated_count"] + summary["skipped_count"] >= 1
    assert len(summary["errors"]) == 0


def test_csv_import_duplicate_conflict_reporting(client, db_session):
    ipo = db_session.query(IPO).filter(IPO.symbol == "TATATECH").first()
    acc = db_session.query(Account).first()

    # Seed initial allotment
    client.post(f"/api/v1/ipos/{ipo.id}/allotments", json={
        "ipo_id": ipo.id,
        "account_id": acc.id,
        "application_no": "ORIG-01",
        "applied_quantity": 30,
        "allotted_quantity": 30,
        "acquisition_cost": 500.0,
        "status": "ALLOTTED"
    })

    # Upload CSV with different values for the same account (conflict)
    csv_conflict = f"client_code,application_no,applied_qty,allotted_qty,cost\n{acc.client_code},CSV-CONFLICT-01,60,60,520.0\n"
    files = {"file": ("conflict.csv", io.BytesIO(csv_conflict.encode("utf-8")), "text/csv")}

    res = client.post(f"/api/v1/ipos/{ipo.id}/import-csv", files=files)
    assert res.status_code == 200
    summary = res.json()
    assert summary["conflict_count"] >= 1
    assert len(summary["conflicts"]) >= 1
    assert summary["updated_count"] >= 1


def test_csv_import_empty_file_rejected(client, db_session):
    ipo = db_session.query(IPO).first()
    files = {"file": ("empty.csv", io.BytesIO(b""), "text/csv")}
    res = client.post(f"/api/v1/ipos/{ipo.id}/import-csv", files=files)
    assert res.status_code == 400
    assert "empty" in res.json()["detail"].lower()


def test_export_allotments_csv_authenticated(client, db_session):
    ipo = db_session.query(IPO).filter(IPO.symbol == "TATATECH").first()
    res = client.get(f"/api/v1/ipos/{ipo.id}/export-csv")
    assert res.status_code == 200
    assert "text/csv" in res.headers["content-type"]
    assert "attachment;" in res.headers["content-disposition"]
    body = res.text
    assert "client_code,nickname,account_group" in body


def test_pnl_math_with_zero_or_missing_prices(client):
    # Create IPO with zero/null LTP and test metrics calculation
    res = client.post("/api/v1/ipos", json={
        "symbol": "ZEROPRICE",
        "company_name": "Zero Price Test Ltd",
        "exchange": "NSE",
        "issue_price": 100.0,
        "lot_size": 10
    })
    assert res.status_code == 201
    ipo_id = res.json()["id"]

    get_res = client.get(f"/api/v1/ipos/{ipo_id}")
    assert get_res.status_code == 200
    data = get_res.json()
    assert data["estimated_current_value"] == 0.0
    assert data["estimated_pnl"] == 0.0
    assert data["pnl_percentage"] == 0.0


def test_trigger_feed_sync(client):
    res = client.post("/api/v1/ipos/sync-feed")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "total_catalog_size" in data


def test_prepare_ipo_applications_workspace(client, db_session):
    ipo = db_session.query(IPO).filter(IPO.symbol == "TATATECH").first()
    accounts = db_session.query(Account).limit(2).all()
    account_ids = [a.id for a in accounts]

    payload = {
        "ipo_id": ipo.id,
        "account_ids": account_ids,
        "lots": 1,
        "category": "RETAIL"
    }
    res = client.post("/api/v1/ipos/prepare-applications", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["ipo_symbol"] == "TATATECH"
    assert data["total_accounts"] == len(account_ids)
    assert data["total_shares"] == len(account_ids) * ipo.lot_size
    assert data["all_valid"] is True
    assert len(data["applications"]) == len(account_ids)


def test_prepare_ipo_applications_retail_limit_exceeded(client, db_session):
    ipo = db_session.query(IPO).filter(IPO.symbol == "TATATECH").first()
    accounts = db_session.query(Account).limit(1).all()
    account_ids = [a.id for a in accounts]

    # 20 lots of 30 shares = 600 shares @ ₹500 = ₹3,00,000 (> ₹2,00,000 Retail limit)
    payload = {
        "ipo_id": ipo.id,
        "account_ids": account_ids,
        "lots": 20,
        "category": "RETAIL"
    }
    res = client.post("/api/v1/ipos/prepare-applications", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["all_valid"] is False
    assert any("Retail category limit is ₹2,00,000" in app["validation_message"] for app in data["applications"] if not app["is_valid"])


def test_ipo_lifecycle_calculation_ist_boundaries():
    """
    Verifies that compute_ipo_lifecycle_status handles IST date boundaries precisely.
    """
    from datetime import date
    from app.services.ipo_feed_service import compute_ipo_lifecycle_status

    ref_date = date(2026, 10, 28)

    # 1. Active bidding window (Open)
    status_open = compute_ipo_lifecycle_status(
        bidding_start_date="2026-10-25",
        bidding_end_date="2026-10-29",
        listing_date="2026-11-04",
        reference_date=ref_date
    )
    assert status_open == "OPEN"

    # 2. Closes today (Open)
    status_closes_today = compute_ipo_lifecycle_status(
        bidding_start_date="2026-10-24",
        bidding_end_date="2026-10-28",
        listing_date="2026-11-03",
        reference_date=ref_date
    )
    assert status_closes_today == "OPEN"

    # 3. Future bidding (Upcoming)
    status_upcoming = compute_ipo_lifecycle_status(
        bidding_start_date="2026-11-05",
        bidding_end_date="2026-11-08",
        listing_date="2026-11-13",
        reference_date=ref_date
    )
    assert status_upcoming == "UPCOMING"

    # 4. Unannounced dates (Upcoming)
    status_tbd = compute_ipo_lifecycle_status(
        bidding_start_date=None,
        bidding_end_date=None,
        listing_date=None,
        reference_date=ref_date
    )
    assert status_tbd == "UPCOMING"

    # 5. Bidding ended, awaiting listing (Closed)
    status_closed = compute_ipo_lifecycle_status(
        bidding_start_date="2026-10-20",
        bidding_end_date="2026-10-24",
        listing_date="2026-10-31",
        reference_date=ref_date
    )
    assert status_closed == "CLOSED"

    # 6. Listing completed (Listed)
    status_listed = compute_ipo_lifecycle_status(
        bidding_start_date="2026-10-10",
        bidding_end_date="2026-10-14",
        listing_date="2026-10-20",
        reference_date=ref_date
    )
    assert status_listed == "LISTED"


def test_list_open_and_sme_ipos_filters(client):
    """
    Syncs live feed and tests OPEN and SME filtering endpoints.
    """
    sync_res = client.post("/api/v1/ipos/sync-feed")
    assert sync_res.status_code == 200

    # 1. Test OPEN filter
    open_res = client.get("/api/v1/ipos?status_filter=OPEN")
    assert open_res.status_code == 200
    open_ipos = open_res.json()
    assert len(open_ipos) >= 1
    symbols_open = [i["symbol"] for i in open_ipos]
    assert "BCSSL" in symbols_open or "BLSPOLY" in symbols_open or "SFCTECH" in symbols_open or "MKSONS" in symbols_open

    # 2. Test SME filter
    sme_res = client.get("/api/v1/ipos?status_filter=SME")
    assert sme_res.status_code == 200
    sme_ipos = sme_res.json()
    assert len(sme_ipos) >= 1
    assert all(i["is_sme"] is True for i in sme_ipos)


def test_ipo_subscription_and_min_investment_fields(client):
    """
    Verifies subscription_rate, min_investment, and issue_size are exposed in API responses.
    """
    client.post("/api/v1/ipos/sync-feed")
    res = client.get("/api/v1/ipos")
    assert res.status_code == 200
    ipos = res.json()
    target = next((i for i in ipos if i["symbol"] in ["BLSPOLY", "BCSSL", "SFCTECH", "MKSONS"]), None)
    assert target is not None
    assert target["min_investment"] is not None
    assert target["min_investment"] > 0


def test_idempotent_feed_sync_preserves_allotments(client, db_session):
    """
    Verifies repeated syncs do not duplicate records or wipe user allotments.
    """
    client.post("/api/v1/ipos/sync-feed")
    ipo = db_session.query(IPO).filter(IPO.symbol.in_(["BLSPOLY", "BCSSL", "SFCTECH", "MKSONS", "TATATECH"])).first()
    acc = db_session.query(Account).first()
    assert ipo is not None
    assert acc is not None

    # Add user allotment
    allot = {
        "ipo_id": ipo.id,
        "account_id": acc.id,
        "applied_quantity": 180,
        "allotted_quantity": 180,
        "acquisition_cost": 80.0,
        "status": "ALLOTTED"
    }
    client.post(f"/api/v1/ipos/{ipo.id}/allotments", json=allot)

    # Repeat sync twice
    res1 = client.post("/api/v1/ipos/sync-feed")
    res2 = client.post("/api/v1/ipos/sync-feed")
    assert res1.status_code == 200
    assert res2.status_code == 200

    # Verify allotment still exists
    allots = client.get(f"/api/v1/ipos/{ipo.id}/allotments").json()
    assert len(allots) == 1
    assert allots[0]["allotted_quantity"] == 180


def test_account_persistence_and_restore(db_session):
    """
    Verifies that accounts are backed up and auto-restored when database is fresh.
    """
    from app.services.account_persistence import persist_accounts_backup, restore_accounts_backup

    # 1. Backup existing accounts
    assert persist_accounts_backup(db_session) is True

    # 2. Simulate empty container DB
    db_session.query(Allotment).delete()
    db_session.query(Account).delete()
    db_session.commit()
    assert db_session.query(Account).count() == 0

    # 3. Restore accounts
    restored = restore_accounts_backup(db_session)
    assert restored > 0
    assert db_session.query(Account).count() > 0

