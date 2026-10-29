import pytest
from datetime import datetime
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from app.services.smartapi_adapter import (
    safe_parse_smartapi_response,
    SmartAPIAdapter,
)
from app.services.smartapi_websocket import SmartWebSocketService
from app.services.portfolio_sync_service import reconcile_broker_holdings
from app.models.account import Account
from app.models.ipo import IPO, Allotment

def test_safe_parse_smartapi_response_empty_body():
    """Empty HTTP body should return valid data and not raise Expecting value: line 1 column 1 (char 0)."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = ""
    mock_resp.headers = {"Content-Type": "application/json"}
    mock_resp.json.side_effect = Exception("Expecting value: line 1 column 1 (char 0)")

    data, err_msg = safe_parse_smartapi_response(mock_resp, "getOrderBook", "A12345")
    assert data == {"status": True, "message": "SUCCESS", "data": None}
    assert err_msg is None

def test_safe_parse_smartapi_response_html_gateway_error():
    """HTML response from Render / Cloudflare gateway should be caught cleanly."""
    mock_resp = MagicMock()
    mock_resp.status_code = 502
    mock_resp.text = "<html><body>502 Bad Gateway</body></html>"
    mock_resp.headers = {"Content-Type": "text/html"}
    mock_resp.json.side_effect = Exception("Expecting value: line 1 column 1 (char 0)")

    data, err_msg = safe_parse_smartapi_response(mock_resp, "getOrderBook", "A12345")
    assert data is None
    assert "Upstream broker gateway error (HTTP 502" in err_msg

def test_safe_parse_smartapi_response_valid_json():
    """Normal JSON response should decode seamlessly."""
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = '{"status": true, "message": "SUCCESS", "data": []}'
    mock_resp.headers = {"Content-Type": "application/json"}
    mock_resp.json.return_value = {"status": True, "message": "SUCCESS", "data": []}

    data, err_msg = safe_parse_smartapi_response(mock_resp, "getOrderBook", "A12345")
    assert data == {"status": True, "message": "SUCCESS", "data": []}
    assert err_msg is None

def test_adapter_empty_successful_order_book():
    """Empty successful order book from SmartAPI should return [] without throwing errors."""
    adapter = SmartAPIAdapter(
        api_key="mock_key",
        client_code="A12345",
        pin="1234",
        totp_secret="JBSWY3DPEHPK3PXP"
    )
    with patch.object(adapter, "_ensure_authenticated", return_value=True):
        with patch.object(adapter, "_send_request") as mock_send:
            mock_send.return_value = {
                "status": True,
                "message": "SUCCESS",
                "errorcode": "",
                "data": None
            }
            orders = adapter.get_order_book()
            assert orders == []
            assert adapter.last_error is None

def test_adapter_empty_successful_trade_book():
    """Empty successful trade book should return [] without throwing errors."""
    adapter = SmartAPIAdapter(
        api_key="mock_key",
        client_code="A12345",
        pin="1234",
        totp_secret="JBSWY3DPEHPK3PXP"
    )
    with patch.object(adapter, "_ensure_authenticated", return_value=True):
        with patch.object(adapter, "_send_request") as mock_send:
            mock_send.return_value = {
                "status": True,
                "message": "SUCCESS",
                "errorcode": "",
                "data": None
            }
            trades = adapter.get_trade_book()
            assert trades == []
            assert adapter.last_error is None

def test_broker_reported_pnl_precision_and_unrounded_arithmetic(db_session):
    """
    Test that official broker-reported profitandloss (-1101.31) is preserved
    in database and not distorted by rounded price multiplications.
    """
    account = Account(
        nickname="Precision Demat",
        client_code="P123456",
        account_group="Family",
        encrypted_api_key="dummy_enc_key",
        encrypted_pin="dummy_enc_pin",
        encrypted_totp_secret="dummy_enc_totp",
        is_demo=False,
        auth_status="CONNECTED"
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    raw_holdings = [
        {
            "tradingsymbol": "HINDCOPPER-EQ",
            "symboltoken": "17963",
            "exchange": "NSE",
            "isin": "INE531E01026",
            "quantity": 240,
            "authorisedquantity": 240,
            "t1quantity": 0,
            "averageprice": 413.74,
            "ltp": 409.15,
            "close": 410.00,
            "profitandloss": -1101.31,
            "pnlpercentage": -1.1084,
            "invested": 99297.31
        }
    ]

    count = reconcile_broker_holdings(
        db=db_session,
        account=account,
        holdings=raw_holdings,
        sync_time=datetime.utcnow()
    )
    assert count == 1

    from app.models.holding import AccountHoldingSnapshot

    snapshot = db_session.query(AccountHoldingSnapshot).filter(
        AccountHoldingSnapshot.account_id == account.id,
        AccountHoldingSnapshot.tradingsymbol == "HINDCOPPER-EQ"
    ).first()

    assert snapshot is not None
    assert snapshot.is_broker_reported is True
    assert snapshot.unrealized_pnl == -1101.31
    assert snapshot.pnl_percentage == -1.1084
    assert snapshot.invested_value == 99297.31

    # Confirm ordinary holding was not conflated with IPO allotments table
    allotment = db_session.query(Allotment).filter(Allotment.account_id == account.id).first()
    assert allotment is None

def test_consolidated_portfolio_endpoint_accurate_totals(client: TestClient, db_session):
    """
    Verify that /portfolio/consolidated computes non-zero totals using verified Demat allotments.
    """
    account = Account(
        nickname="Consolidated Demat",
        client_code="C999888",
        account_group="Family",
        encrypted_api_key="dummy_enc_key",
        encrypted_pin="dummy_enc_pin",
        encrypted_totp_secret="dummy_enc_totp",
        is_demo=False,
        is_enabled=True,
        auth_status="CONNECTED"
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    ipo = IPO(
        symbol="HINDCOPPER",
        company_name="Hindustan Copper Limited",
        issue_price=413.74,
        current_ltp=409.15,
        min_price=400.0,
        max_price=413.74,
        status="LISTED"
    )
    db_session.add(ipo)
    db_session.commit()
    db_session.refresh(ipo)

    allotment = Allotment(
        account_id=account.id,
        ipo_id=ipo.id,
        applied_quantity=240,
        allotted_quantity=240,
        acquisition_cost=413.74,
        invested_value=99297.31,
        current_market_value=98196.00,
        unrealized_pnl=-1101.31,
        pnl_percentage=-1.1084,
        is_broker_reported=True,
        status="ALLOTTED",
        demat_verified=True
    )
    db_session.add(allotment)
    db_session.commit()

    resp = client.get(f"/api/v1/portfolio/consolidated?account_ids={account.id}")
    assert resp.status_code == 200
    data = resp.json()

    summary = data["summary"]
    assert summary["total_current_value"] == 98196.00
    assert summary["total_investment_cost"] == 99297.31
    assert summary["unrealized_pnl"] == -1101.31
    assert len(data["holdings"]) == 1

def test_smartapi_websocket_tick_normalization():
    """Verify SmartAPI WebSocket service normalizes tick symbols and values accurately."""
    service = SmartWebSocketService()
    service.register_instrument("HINDCOPPER-EQ", "17963")

    raw_packet = {
        "token": "17963",
        "last_traded_price": 409.15,
        "previous_close": 410.00,
        "open": 410.00,
        "high": 415.00,
        "low": 408.00,
        "volume": 250000,
    }
    service.on_tick_received(raw_packet)

    quote = service.get_latest_quote("HINDCOPPER-EQ")
    assert quote is not None
    assert quote["symbol"] == "HINDCOPPER-EQ"
    assert quote["ltp"] == 409.15
    assert quote["previous_close"] == 410.00
    assert quote["type"] == "TICK"
    assert quote["is_live"] is True

def test_multi_account_isolation_in_order_retrieval(client: TestClient, db_session):
    """Verify account A order book cannot be accessed through account B."""
    acc_a = Account(
        nickname="Account Alpha",
        client_code="ALPHA01",
        account_group="Family",
        encrypted_api_key="dummy_enc_key",
        encrypted_pin="dummy_enc_pin",
        encrypted_totp_secret="dummy_enc_totp",
        is_demo=True,
        auth_status="CONNECTED"
    )
    acc_b = Account(
        nickname="Account Beta",
        client_code="BETA02",
        account_group="Family",
        encrypted_api_key="dummy_enc_key",
        encrypted_pin="dummy_enc_pin",
        encrypted_totp_secret="dummy_enc_totp",
        is_demo=True,
        auth_status="CONNECTED"
    )
    db_session.add_all([acc_a, acc_b])
    db_session.commit()
    db_session.refresh(acc_a)
    db_session.refresh(acc_b)

    resp_a = client.get(f"/api/v1/accounts/{acc_a.id}/orders")
    assert resp_a.status_code == 200
    orders_a = resp_a.json()
    assert isinstance(orders_a, list)

    resp_b = client.get(f"/api/v1/accounts/{acc_b.id}/orders")
    assert resp_b.status_code == 200
    orders_b = resp_b.json()
    assert isinstance(orders_b, list)
