import io
import pytest
from app.models.ipo import IPO
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
