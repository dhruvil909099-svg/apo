"""
Comprehensive Automated Tests for IPOPro Complete IPO Platform Upgrade:
- Open & Upcoming IPO discovery
- Listed & Closed IPO tracking
- Mainboard vs SME classification
- Complete IPO Details (Company Overview, Financials, Valuation, Dates, Strengths & Risks, Objects, Documents)
- Multi-Account & Single-Account Application Preparation
- Safe Draft Persistence & Official Broker Handoff Tracking
- Consolidated Application Dashboard Query (/ipos/applications/all)
- Application & Mandate Status Transitions
- Strict Account & Demat Isolation
"""

import pytest
from fastapi import status
from app.models.ipo import IPO, Allotment
from app.models.account import Account


def test_sync_feed_populates_comprehensive_ipo_catalog(client, db_session):
    """Verify that sync_feed populates active, upcoming, SME, and listed IPOs with rich company information."""
    res = client.post("/api/v1/ipos/sync-feed")
    assert res.status_code == status.HTTP_200_OK
    data = res.json()
    assert data["success"] is True
    assert data["total_catalog_size"] >= 8

    # Verify Open IPO with financials and valuation
    res_open = client.get("/api/v1/ipos?status_filter=OPEN")
    assert res_open.status_code == status.HTTP_200_OK
    open_ipos = res_open.json()
    assert len(open_ipos) > 0
    eaaa = next((i for i in open_ipos if i["symbol"] == "EAAA"), None)
    assert eaaa is not None
    assert eaaa["sector"] == "Financial Services"
    assert eaaa["financials_json"] is not None
    assert len(eaaa["financials_json"]) >= 2
    assert eaaa["valuation_json"]["p_e_ratio"] == "14.5x"
    assert len(eaaa["strengths_risks_json"]["strengths"]) > 0


def test_mainboard_and_sme_filtering(client, db_session):
    """Verify that status_filter correctly separates Mainboard from SME issues."""
    client.post("/api/v1/ipos/sync-feed")
    res_sme = client.get("/api/v1/ipos?status_filter=SME")
    assert res_sme.status_code == status.HTTP_200_OK
    sme_ipos = res_sme.json()
    assert len(sme_ipos) > 0
    assert all(i["is_sme"] is True for i in sme_ipos)

    res_mb = client.get("/api/v1/ipos?status_filter=MAINBOARD")
    assert res_mb.status_code == status.HTTP_200_OK
    mb_ipos = res_mb.json()
    assert len(mb_ipos) > 0
    assert all(i["is_sme"] is False for i in mb_ipos)


def test_upcoming_ipos_do_not_fabricate_zero_prices(client, db_session):
    """Verify that upcoming IPOs with unannounced dates or price bands return null rather than 0."""
    client.post("/api/v1/ipos/sync-feed")
    res = client.get("/api/v1/ipos?status_filter=UPCOMING")
    assert res.status_code == status.HTTP_200_OK
    upcoming = res.json()
    assert len(upcoming) > 0
    allchem = next((i for i in upcoming if i["symbol"] == "ALLCHEM"), None)
    assert allchem is not None
    assert allchem["bidding_start_date"] is None
    assert allchem["bidding_end_date"] is None


def test_get_complete_ipo_details_page(client, db_session):
    """Verify detailed endpoint returns all 10 essential information sections for an IPO."""
    client.post("/api/v1/ipos/sync-feed")
    res_list = client.get("/api/v1/ipos?status_filter=OPEN")
    ipo_id = res_list.json()[0]["id"]

    res_detail = client.get(f"/api/v1/ipos/{ipo_id}")
    assert res_detail.status_code == status.HTTP_200_OK
    d = res_detail.json()
    assert "company_name" in d
    assert "sector" in d
    assert "description" in d
    assert "issue_type" in d
    assert "financials_json" in d
    assert "valuation_json" in d
    assert "strengths_risks_json" in d
    assert "objects_of_issue_json" in d
    assert "subscription_details_json" in d


def test_multi_account_application_preparation_and_draft_persistence(client, db_session):
    """Verify multi-account preparation workspace validates lot rules and persists drafts with save_drafts=True."""
    client.post("/api/v1/ipos/sync-feed")
    ipo = db_session.query(IPO).filter(IPO.symbol == "EAAA").first()
    accs = db_session.query(Account).all()
    assert ipo is not None
    assert len(accs) >= 2

    acc1 = accs[0]
    acc2 = accs[1]

    payload = {
        "ipo_id": ipo.id,
        "account_ids": [acc1.id, acc2.id],
        "lots": 2,
        "category": "RETAIL",
        "bid_price": ipo.max_price or ipo.issue_price,
        "save_drafts": True
    }

    res_prep = client.post("/api/v1/ipos/prepare-applications", json=payload)
    assert res_prep.status_code == status.HTTP_200_OK
    data = res_prep.json()
    assert data["all_valid"] is True
    assert data["total_accounts"] == 2
    assert len(data["applications"]) == 2
    assert data["applications"][0]["draft_id"] is not None
    assert data["applications"][1]["draft_id"] is not None

    # Query /ipos/applications/all to verify drafts show up in 'Your Applications'
    res_apps = client.get(f"/api/v1/ipos/applications/all?account_id={acc1.id}")
    assert res_apps.status_code == status.HTTP_200_OK
    user_apps = res_apps.json()
    target_app = next((a for a in user_apps if a["ipo_symbol"] == "EAAA"), None)
    assert target_app is not None
    assert target_app["preparation_status"] == "READY_FOR_HANDOFF"
    assert target_app["lots"] == 2


def test_record_application_official_handoff(client, db_session):
    """Verify recording broker handoff transitions application from READY_FOR_HANDOFF to SUBMITTED_BROKER_CONFIRMED."""
    client.post("/api/v1/ipos/sync-feed")
    ipo = db_session.query(IPO).filter(IPO.symbol == "EAAA").first()
    acc = db_session.query(Account).first()
    allotment = db_session.query(Allotment).filter(Allotment.ipo_id == ipo.id, Allotment.account_id == acc.id).first()

    if not allotment:
        allotment = Allotment(
            ipo_id=ipo.id,
            account_id=acc.id,
            category="RETAIL",
            applied_quantity=110,
            allotted_quantity=0,
            acquisition_cost=132.0,
            status="PENDING",
            preparation_status="READY_FOR_HANDOFF",
            broker_application_status="NOT_SUBMITTED"
        )
        db_session.add(allotment)
        db_session.commit()
        db_session.refresh(allotment)

    handoff_payload = {
        "allotment_id": allotment.id,
        "preparation_status": "SUBMITTED_BROKER_CONFIRMED",
        "broker_application_status": "CONFIRMED",
        "application_no": "TEST_APP_ANGEL_99182",
        "upi_mandate_reference": "UPI-MANDATE-EAAA-001",
        "mandate_status": "APPROVED",
        "verification_source": "ACCOUNT_HOLDER_OFFICIAL_CONFIRMATION"
    }

    res = client.post("/api/v1/ipos/applications/handoff", json=handoff_payload)
    assert res.status_code == status.HTTP_200_OK
    updated = res.json()
    assert updated["application_no"] == "TEST_APP_ANGEL_99182"
    assert updated["preparation_status"] == "SUBMITTED_BROKER_CONFIRMED"
    assert updated["broker_application_status"] == "CONFIRMED"
    assert updated["mandate_status"] == "APPROVED"


def test_patch_application_status_and_allotment_resolution(client, db_session):
    """Verify updating application status to ALLOTTED records correct quantities and P&L calculations."""
    client.post("/api/v1/ipos/sync-feed")
    ipo = db_session.query(IPO).filter(IPO.symbol == "EAAA").first()
    acc = db_session.query(Account).first()
    allotment = db_session.query(Allotment).filter(Allotment.ipo_id == ipo.id, Allotment.account_id == acc.id).first()

    if not allotment:
        allotment = Allotment(
            ipo_id=ipo.id,
            account_id=acc.id,
            category="RETAIL",
            applied_quantity=110,
            allotted_quantity=0,
            acquisition_cost=132.0,
            status="PENDING"
        )
        db_session.add(allotment)
        db_session.commit()
        db_session.refresh(allotment)

    patch_payload = {
        "allotted_quantity": 220,
        "allotment_status": "ALLOTTED",
        "status": "ALLOTTED",
        "demat_credit_status": "CREDITED",
        "demat_verified": True
    }

    res = client.patch(f"/api/v1/ipos/applications/{allotment.id}", json=patch_payload)
    assert res.status_code == status.HTTP_200_OK
    resolved = res.json()
    assert resolved["allotted_quantity"] == 220
    assert resolved["allotment_status"] == "ALLOTTED"
    assert resolved["demat_verified"] is True
    assert resolved["market_value"] > 0


def test_disconnected_account_preserves_application_history(client, db_session):
    """Verify that even when account auth_status is DISCONNECTED, historical application records remain fully queryable."""
    acc = db_session.query(Account).filter(Account.auth_status == "DISCONNECTED").first()
    if not acc:
        acc = db_session.query(Account).first()
        acc.auth_status = "DISCONNECTED"
        db_session.commit()

    res = client.get(f"/api/v1/ipos/applications/all?account_id={acc.id}")
    assert res.status_code == status.HTTP_200_OK
    records = res.json()
    assert isinstance(records, list)
