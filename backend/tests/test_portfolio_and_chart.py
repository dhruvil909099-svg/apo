import pytest
from fastapi.testclient import TestClient
from app.models.account import Account
from app.models.ipo import IPO, Allotment


def test_get_market_candles(client: TestClient, db_session):
    # Setup or fetch test IPO
    ipo = db_session.query(IPO).filter(IPO.symbol == "TATATECH").first()
    assert ipo is not None

    res = client.get("/api/v1/market/candles?symbol=TATATECH&interval=ONE_DAY&range_period=1M")
    assert res.status_code == 200
    data = res.json()

    assert data["symbol"] == "TATATECH"
    assert data["exchange"] == "NSE"
    assert data["current_ltp"] == ipo.current_ltp
    assert len(data["candles"]) > 0

    # Verify candle mathematical integrity
    first_candle = data["candles"][0]
    assert "timestamp" in first_candle
    assert "open" in first_candle
    assert "high" in first_candle
    assert "low" in first_candle
    assert "close" in first_candle
    assert "volume" in first_candle
    assert first_candle["high"] >= first_candle["low"]
    assert first_candle["high"] >= min(first_candle["open"], first_candle["close"])


def test_get_market_candles_intraday(client: TestClient, db_session):
    res = client.get("/api/v1/market/candles?symbol=TATATECH&interval=FIFTEEN_MINUTE&range_period=1D")
    assert res.status_code == 200
    data = res.json()
    assert data["interval"] == "FIFTEEN_MINUTE"
    assert len(data["candles"]) >= 10


def test_consolidated_holdings_calculation(client: TestClient, db_session):
    # Setup 2 dedicated test accounts
    acc1 = Account(
        client_code="ANGEL_TEST_P1",
        nickname="Self Demat",
        account_group="Family",
        encrypted_api_key="enc",
        encrypted_pin="enc",
        encrypted_totp_secret="enc",
        is_enabled=True,
        auth_status="CONNECTED"
    )
    acc2 = Account(
        client_code="ANGEL_TEST_P2",
        nickname="Spouse Demat",
        account_group="Family",
        encrypted_api_key="enc",
        encrypted_pin="enc",
        encrypted_totp_secret="enc",
        is_enabled=True,
        auth_status="CONNECTED"
    )
    db_session.add_all([acc1, acc2])
    db_session.commit()

    ipo = IPO(
        symbol="PORT_TEST_CORP",
        company_name="Portfolio Test Corporation",
        exchange="NSE",
        issue_price=500.0,
        current_ltp=1200.0,
        lot_size=30,
        status="LISTED"
    )
    db_session.add(ipo)
    db_session.commit()

    # Acc1 has 30 shares @ 500.0 (Cost = 15,000)
    # Acc2 has 60 shares @ 600.0 (Cost = 36,000)
    # Total Qty = 90. Total Cost = 51,000. Avg Cost = 566.67
    # Market Value @ 1200 = 108,000. P&L = 57,000
    allot1 = Allotment(
        ipo_id=ipo.id,
        account_id=acc1.id,
        applied_quantity=30,
        allotted_quantity=30,
        acquisition_cost=500.0,
        status="ALLOTTED"
    )
    allot2 = Allotment(
        ipo_id=ipo.id,
        account_id=acc2.id,
        applied_quantity=60,
        allotted_quantity=60,
        acquisition_cost=600.0,
        status="ALLOTTED"
    )
    db_session.add_all([allot1, allot2])
    db_session.commit()

    # Filter by the 2 test accounts to verify exact math
    res = client.get(f"/api/v1/portfolio/consolidated?account_ids={acc1.id},{acc2.id}")
    assert res.status_code == 200
    data = res.json()

    summary = data["summary"]
    assert summary["total_current_value"] == 108000.0
    assert summary["total_investment_cost"] == 51000.0
    assert summary["unrealized_pnl"] == 57000.0
    assert summary["distinct_instruments_count"] == 1
    assert summary["total_shares_count"] == 90
    assert summary["total_accounts_selected"] == 2

    # Check holding breakdown
    holding = next(h for h in data["holdings"] if h["symbol"] == "PORT_TEST_CORP")
    assert holding["total_quantity"] == 90
    assert holding["average_cost"] == 566.67
    assert holding["market_value"] == 108000.0
    assert holding["unrealized_pnl"] == 57000.0
    assert holding["portfolio_allocation_percent"] == 100.0
    assert len(holding["accounts_breakdown"]) == 2


def test_consolidated_holdings_account_filtering(client: TestClient, db_session):
    acc = Account(
        client_code="ANGEL_TEST_P_FILTER",
        nickname="Filter Test Demat",
        account_group="HNI",
        encrypted_api_key="enc",
        encrypted_pin="enc",
        encrypted_totp_secret="enc",
        is_enabled=True,
        auth_status="CONNECTED"
    )
    db_session.add(acc)
    db_session.commit()

    ipo = IPO(
        symbol="FILTER_CORP",
        company_name="Filter Corporation Ltd",
        exchange="NSE",
        issue_price=500.0,
        current_ltp=1200.0,
        lot_size=30,
        status="LISTED"
    )
    db_session.add(ipo)
    db_session.commit()

    allot = Allotment(
        ipo_id=ipo.id,
        account_id=acc.id,
        applied_quantity=30,
        allotted_quantity=30,
        acquisition_cost=500.0,
        status="ALLOTTED"
    )
    db_session.add(allot)
    db_session.commit()

    # Filter strictly for this Account (should only have 30 shares @ 500 = 15,000 cost, 36,000 val)
    res = client.get(f"/api/v1/portfolio/consolidated?account_ids={acc.id}")
    assert res.status_code == 200
    data = res.json()

    summary = data["summary"]
    assert summary["total_accounts_selected"] == 1
    assert summary["total_shares_count"] == 30
    assert summary["total_investment_cost"] == 15000.0
    assert summary["total_current_value"] == 36000.0
    assert summary["unrealized_pnl"] == 21000.0


def test_portfolio_sync_trigger(client: TestClient, db_session):
    res = client.post("/api/v1/portfolio/sync")
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert "accounts_synced" in data
    assert "timestamp" in data
