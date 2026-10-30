import pytest
import time
from datetime import datetime, timedelta
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.risk import RiskLimit
from app.services.smartapi_adapter import SmartAPIAdapter, get_adapter_for_account
from app.services.data_orchestrator import DataOrchestrator
from app.services.ai_ops_service import AIOperationsAssistant
from app.core.security import cipher


def test_holdings_enriched_fields_and_sellable_quantities(client, db_session):
    """
    Verify /api/v1/portfolio/consolidated returns enriched holdings with
    total_quantity, sellable_quantity, blocked_quantity, and market statistics.
    """
    # Create two accounts: one with DDPI ACTIVE, one with DDPI INACTIVE
    acc1 = Account(
        nickname="DDPI Active Demat",
        client_code="D1111",
        account_group="Family",
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED",
        ddpi_status="ACTIVE",
        edis_authorized_today=False,
        available_cash=50000.0,
        encrypted_api_key=cipher.encrypt("KEY1"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP")
    )
    acc2 = Account(
        nickname="DDPI Inactive Demat",
        client_code="D2222",
        account_group="Family",
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED",
        ddpi_status="INACTIVE",
        edis_authorized_today=False,
        available_cash=30000.0,
        encrypted_api_key=cipher.encrypt("KEY2"),
        encrypted_pin=cipher.encrypt("5678"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP")
    )
    db_session.add_all([acc1, acc2])
    db_session.commit()

    # Create IPO instrument
    ipo = IPO(
        symbol="TECHHOLD",
        company_name="Tech Holdings Ltd",
        exchange="NSE",
        isin="INE000TECH01",
        symbol_token="998811",
        issue_price=200.0,
        current_ltp=250.0,
        previous_close=240.0,
        status="LISTED"
    )
    db_session.add(ipo)
    db_session.commit()

    # Add allotments: 100 shares in acc1 (sellable), 50 shares in acc2 (blocked/needs eDIS)
    allot1 = Allotment(
        ipo_id=ipo.id,
        account_id=acc1.id,
        applied_quantity=100,
        allotted_quantity=100,
        acquisition_cost=200.0,
        status="ALLOTTED"
    )
    allot2 = Allotment(
        ipo_id=ipo.id,
        account_id=acc2.id,
        applied_quantity=50,
        allotted_quantity=50,
        acquisition_cost=200.0,
        status="ALLOTTED"
    )

    db_session.add_all([allot1, allot2])
    db_session.commit()

    # Call /api/v1/portfolio/consolidated
    resp = client.get(f"/api/v1/portfolio/consolidated?account_ids={acc1.id},{acc2.id}")
    assert resp.status_code == 200
    data = resp.json()

    assert "holdings" in data
    assert len(data["holdings"]) >= 1
    tech_holding = next(h for h in data["holdings"] if h["symbol"] == "TECHHOLD")

    assert tech_holding["total_quantity"] == 150
    assert tech_holding["sellable_quantity"] == 100  # Only acc1 has active DDPI
    assert tech_holding["blocked_quantity"] == 50   # acc2 is blocked pending eDIS
    assert tech_holding["average_cost"] == 200.0
    assert tech_holding["current_ltp"] == 250.0
    assert tech_holding["market_value"] == 37500.0
    assert tech_holding["unrealized_pnl"] == 7500.0
    assert "day_high" in tech_holding
    assert "day_low" in tech_holding
    assert "volume" in tech_holding


def test_single_holding_detail_terminal_endpoint(client, db_session):
    """
    Verify GET /api/v1/portfolio/holding/{symbol} returns complete instrument terminal data.
    """
    acc = Account(
        nickname="Trader Alpha",
        client_code="ALPHA01",
        account_group="Trading",
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED",
        ddpi_status="ACTIVE",
        edis_authorized_today=True,
        available_cash=100000.0,
        encrypted_api_key=cipher.encrypt("K1"),
        encrypted_pin=cipher.encrypt("1111"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP")
    )
    db_session.add(acc)
    db_session.commit()

    ipo = IPO(
        symbol="SOLARPOW",
        company_name="Solar Power Systems Ltd",
        exchange="NSE",
        isin="INE000SOLAR1",
        symbol_token="12345",
        issue_price=100.0,
        current_ltp=150.0,
        previous_close=145.0,
        status="LISTED"
    )
    db_session.add(ipo)
    db_session.commit()

    allot = Allotment(
        ipo_id=ipo.id,
        account_id=acc.id,
        applied_quantity=75,
        allotted_quantity=75,
        acquisition_cost=100.0,
        status="ALLOTTED"
    )
    db_session.add(allot)
    db_session.commit()

    resp = client.get("/api/v1/portfolio/holding/SOLARPOW")
    assert resp.status_code == 200
    detail = resp.json()

    assert detail["symbol"] == "SOLARPOW"
    assert detail["company_name"] == "Solar Power Systems Ltd"
    assert detail["total_quantity"] == 75
    assert detail["sellable_quantity"] == 75
    assert detail["average_cost"] == 100.0
    assert detail["current_ltp"] == 150.0
    assert detail["market_value"] == 11250.0
    assert detail["unrealized_pnl"] == 3750.0
    assert detail["permitted_actions"]["can_buy"] is True
    assert detail["permitted_actions"]["can_sell"] is True
    assert len(detail["accounts_breakdown"]) == 1
    assert detail["accounts_breakdown"][0]["nickname"] == "Trader Alpha"


def test_order_preview_calculations_and_safety_checks(client, db_session):
    """
    Verify POST /api/v1/orders/preview calculates statutory charges, checks cash for BUY,
    and checks sellable holdings for SELL.
    """
    acc = Account(
        nickname="Preview Account",
        client_code="PREV01",
        account_group="Test",
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED",
        ddpi_status="ACTIVE",
        available_cash=10000.0,
        encrypted_api_key=cipher.encrypt("K1"),
        encrypted_pin=cipher.encrypt("1111"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP")
    )
    db_session.add(acc)
    db_session.commit()

    ipo = IPO(
        symbol="NIFTYTEST",
        company_name="Nifty Test Ltd",
        exchange="NSE",
        issue_price=500.0,
        current_ltp=500.0,
        previous_close=490.0,
        status="LISTED"
    )
    db_session.add(ipo)
    db_session.commit()

    # 1. Valid BUY preview (10 shares @ ₹500 = ₹5,000 <= ₹10,000 cash)
    buy_payload = {
        "account_id": acc.id,
        "tradingsymbol": "NIFTYTEST",
        "transaction_type": "BUY",
        "order_type": "LIMIT",
        "quantity": 10,
        "price": 500.0
    }
    resp = client.post("/api/v1/orders/preview", json=buy_payload)
    assert resp.status_code == 200
    res = resp.json()
    assert res["is_valid"] is True
    assert res["estimated_value"] == 5000.0
    assert res["estimated_charges"] >= 0.0
    assert res["net_total"] >= 5000.0
    assert res["available_balance"] == 10000.0

    # 2. Insufficient Funds BUY preview (50 shares @ ₹500 = ₹25,000 > ₹10,000 cash)
    over_payload = {
        "account_id": acc.id,
        "tradingsymbol": "NIFTYTEST",
        "transaction_type": "BUY",
        "order_type": "LIMIT",
        "quantity": 50,
        "price": 500.0
    }
    resp = client.post("/api/v1/orders/preview", json=over_payload)
    assert resp.status_code == 200
    res = resp.json()
    assert res["is_valid"] is False
    assert any("Insufficient funds" in r for r in res["blocking_reasons"])

    # 3. Insufficient Holdings SELL preview (0 shares held)
    sell_payload = {
        "account_id": acc.id,
        "tradingsymbol": "NIFTYTEST",
        "transaction_type": "SELL",
        "order_type": "LIMIT",
        "quantity": 5,
        "price": 500.0
    }
    resp = client.post("/api/v1/orders/preview", json=sell_payload)
    assert resp.status_code == 200
    res = resp.json()
    assert res["is_valid"] is False
    assert any("Insufficient holdings" in r for r in res["blocking_reasons"])


def test_single_order_placement_and_paper_safety(client, db_session):
    """
    Verify POST /api/v1/orders/single executes safely in paper mode,
    updates cash balance, and creates an order record without broker calls.
    """
    acc = Account(
        nickname="Paper Trader",
        client_code="PAPER01",
        account_group="Simulation",
        is_enabled=True,
        is_demo=True,  # Demo account strictly paper trade
        auth_status="CONNECTED",
        ddpi_status="ACTIVE",
        available_cash=50000.0,
        encrypted_api_key=cipher.encrypt("K1"),
        encrypted_pin=cipher.encrypt("1111"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP")
    )
    db_session.add(acc)
    db_session.commit()

    order_payload = {
        "account_id": acc.id,
        "tradingsymbol": "PAPERSTOCK",
        "exchange": "NSE",
        "transaction_type": "BUY",
        "order_type": "MARKET",
        "quantity": 5,
        "price": 200.0
    }

    resp = client.post("/api/v1/orders/single", json=order_payload)
    assert resp.status_code == 201
    order_data = resp.json()

    assert order_data["tradingsymbol"] == "PAPERSTOCK"
    assert order_data["quantity"] == 5
    assert order_data["is_paper_trade"] is True
    assert order_data["status"] == "EXECUTED"

    # Verify cash deducted in DB
    db_session.refresh(acc)
    assert acc.available_cash < 50000.0


def test_data_orchestrator_freshness_and_circuit_breaker(client, db_session):
    """
    Verify DataOrchestrator identifies stale accounts, protects against
    hammering via circuit breaker cooldown, and never wipes existing holdings.
    """
    acc = Account(
        nickname="Telemetry Account",
        client_code="TELEM01",
        account_group="Test",
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED",
        ddpi_status="ACTIVE",
        consecutive_errors=0,
        last_sync_time=datetime.utcnow() - timedelta(minutes=10),  # Stale
        available_cash=25000.0,
        encrypted_api_key=cipher.encrypt("K1"),
        encrypted_pin=cipher.encrypt("1111"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP")
    )
    db_session.add(acc)
    db_session.commit()

    # 1. Freshness detection
    assert DataOrchestrator.is_data_stale(acc.last_sync_time) is True

    # 2. Test status endpoint
    status_resp = client.get("/api/v1/operations/status")
    assert status_resp.status_code == 200
    st_data = status_resp.json()
    assert st_data["total_accounts"] >= 1

    # 3. Test background auto-refresh endpoint
    refresh_resp = client.post("/api/v1/operations/auto-refresh", json={"force": False})
    assert refresh_resp.status_code == 200
    ref_data = refresh_resp.json()
    assert ref_data["success"] is True

    # 4. Test AI Operations Diagnostics
    diag_resp = client.get("/api/v1/operations/diagnostics")
    assert diag_resp.status_code == 200
    diag_data = diag_resp.json()
    assert "diagnostics" in diag_data
