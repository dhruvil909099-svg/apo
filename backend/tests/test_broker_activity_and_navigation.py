import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from datetime import datetime

from app.models.account import Account
from app.models.order import Order
from app.models.broker_activity import BrokerTradeSnapshot, BrokerSyncMetadata
from app.models.audit import AuditLog
from app.core.security import cipher


def create_or_get_account(db_session: Session, client_code: str = "ANGEL_ACT_1", nickname: str = "Test Trader 1") -> Account:
    acc = db_session.query(Account).filter(Account.client_code == client_code).first()
    if not acc:
        acc = Account(
            client_code=client_code,
            nickname=nickname,
            is_enabled=True,
            auth_status="CONNECTED",
            available_cash=100000.0,
            ddpi_status="ACTIVE",
            encrypted_api_key=cipher.encrypt("mock_api_key"),
            encrypted_pin=cipher.encrypt("1234"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_demo=False
        )
        db_session.add(acc)
        db_session.commit()
        db_session.refresh(acc)
    else:
        acc.auth_status = "CONNECTED"
        acc.is_enabled = True
        acc.available_cash = 100000.0
        acc.encrypted_api_key = cipher.encrypt("mock_api_key")
        acc.encrypted_pin = cipher.encrypt("1234")
        acc.encrypted_totp_secret = cipher.encrypt("JBSWY3DPEHPK3PXP")
        db_session.commit()
    return acc


def test_broker_order_book_data_mapping(client: TestClient, db_session: Session):
    """Verify SmartAPI order book payload correctly maps all fields including unique_order_id and pending_quantity."""
    acc = create_or_get_account(db_session, "ANGEL_ACT_OB", "OrderBook Trader")

    mock_smartapi_orders = [
        {
            "orderid": "2410300001",
            "uniqueorderid": "UID_ANGEL_998877",
            "tradingsymbol": "INFY-EQ",
            "exchange": "NSE",
            "transactiontype": "BUY",
            "ordertype": "LIMIT",
            "producttype": "DELIVERY",
            "quantity": "50",
            "filledshares": "20",
            "unfilledshares": "30",
            "price": "1850.50",
            "averageprice": "1850.25",
            "status": "OPEN",
            "updatetime": "30-Oct-2026 10:15:00",
            "text": ""
        },
        {
            "orderid": "2410300002",
            "uniqueorderid": "UID_ANGEL_998878",
            "tradingsymbol": "TCS-EQ",
            "exchange": "NSE",
            "transactiontype": "SELL",
            "ordertype": "MARKET",
            "producttype": "INTRADAY",
            "quantity": "10",
            "filledshares": "0",
            "unfilledshares": "10",
            "price": "0.00",
            "averageprice": "0.00",
            "status": "REJECTED",
            "updatetime": "30-Oct-2026 10:20:00",
            "text": "RMS: Margin Insufficient"
        }
    ]

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_order_book.return_value = mock_smartapi_orders

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        res = client.get(f"/api/v1/accounts/{acc.id}/orders")
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 2

        order1 = next((o for o in data if o["order_id"] == "2410300001"), None)
        assert order1 is not None
        assert order1["unique_order_id"] == "UID_ANGEL_998877"
        assert order1["symbol"] == "INFY-EQ"
        assert order1["transaction_type"] == "BUY"
        assert order1["quantity"] == 50
        assert order1["filled_quantity"] == 20
        assert order1["pending_quantity"] == 30
        assert order1["average_price"] == 1850.25
        assert order1["status"] == "OPEN"

        order2 = next((o for o in data if o["order_id"] == "2410300002"), None)
        assert order2 is not None
        assert order2["status"] == "REJECTED"
        assert "Margin Insufficient" in (order2["rejection_reason"] or "")


def test_broker_trade_book_data_mapping(client: TestClient, db_session: Session):
    """Verify SmartAPI trade book response parses verified fills into AccountTradeItem."""
    acc = create_or_get_account(db_session, "ANGEL_ACT_TB", "TradeBook Trader")

    mock_tradebook = [
        {
            "fillid": "TB_FILL_101",
            "orderid": "2410300001",
            "tradingsymbol": "RELIANCE-EQ",
            "exchange": "NSE",
            "transactiontype": "BUY",
            "producttype": "DELIVERY",
            "fillprice": "2950.00",
            "fillsize": "25",
            "filltime": "30-Oct-2026 11:00:00"
        }
    ]

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_trade_book.return_value = mock_tradebook

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        res = client.get(f"/api/v1/accounts/{acc.id}/trades")
        assert res.status_code == 200
        data = res.json()
        assert len(data) >= 1
        trade = next((t for t in data if t["fill_id"] == "TB_FILL_101"), None)
        assert trade is not None
        assert trade["order_id"] == "2410300001"
        assert trade["symbol"] == "RELIANCE-EQ"
        assert trade["fill_price"] == 2950.0
        assert trade["fill_quantity"] == 25
        assert trade["trade_value"] == 2950.0 * 25


def test_account_funds_endpoint_rms_limits(client: TestClient, db_session: Session):
    """Verify GET /{account_id}/funds maps Angel One /user/v1/getRMS into RMS components."""
    acc = create_or_get_account(db_session, "ANGEL_ACT_RMS", "RMS Trader")

    mock_rms = {
        "net": "75000.50",
        "availablecash": "75000.50",
        "collateral": "25000.00",
        "utiliseddebits": "12000.00",
        "m2munrealized": "1500.00",
        "m2mrealized": "850.00",
        "spanmargin": "5000.00",
        "varmargin": "3500.00",
        "elmmargin": "1500.00"
    }

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_rms.return_value = mock_rms

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        res = client.get(f"/api/v1/accounts/{acc.id}/funds")
        assert res.status_code == 200
        funds = res.json()
        assert funds["account_id"] == acc.id
        assert funds["available_cash"] == 75000.50
        assert funds["net_available_margin"] == 75000.50
        assert funds["collateral_margin"] == 25000.00
        assert funds["utilized_margin"] == 12000.00
        assert funds["unrealized_m2m"] == 1500.00
        assert funds["realized_m2m"] == 850.00
        assert funds["span_margin"] == 5000.00
        assert funds["var_margin"] == 3500.00
        assert funds["elm_margin"] == 1500.00
        assert funds["status"] == "LIVE"
        assert "ANGEL_ONE" in funds["data_source"]


def test_account_activity_log_endpoint_with_disclaimer(client: TestClient, db_session: Session):
    """Verify GET /{account_id}/activity-log returns unified events with origins and historical disclaimer."""
    acc = create_or_get_account(db_session, "ANGEL_ACT_LOG", "Log Trader")

    # Add an audit log event
    audit = AuditLog(
        account_id=acc.id,
        event_type="SESSION_LOGIN",
        operator="SYSTEM",
        details_json='{"status": "CONNECTED", "description": "SmartAPI authenticated session initiated"}'
    )
    db_session.add(audit)

    # Add a broker trade snapshot
    trade = BrokerTradeSnapshot(
        account_id=acc.id,
        fill_id="TRD_LOG_99",
        broker_order_id="ORD_LOG_99",
        tradingsymbol="SBIN-EQ",
        exchange="NSE",
        transaction_type="BUY",
        fill_price=780.0,
        fill_quantity=50,
        trade_value=39000.0
    )
    db_session.add(trade)
    db_session.commit()

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_order_book.return_value = []
    mock_adapter.get_trade_book.return_value = []

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        res = client.get(f"/api/v1/accounts/{acc.id}/activity-log")
        assert res.status_code == 200
        data = res.json()
        assert data["account_id"] == acc.id
        assert "historical_notice" in data
        assert "SmartAPI" in data["historical_notice"]
        assert len(data["activities"]) >= 2

        origins = [item["origin"] for item in data["activities"]]
        assert "LIVE_BROKER" in origins or "AUDIT_EVENT" in origins


def test_account_refresh_endpoint(client: TestClient, db_session: Session):
    """Verify POST /{account_id}/refresh triggers broker refresh and returns counts."""
    acc = create_or_get_account(db_session, "ANGEL_ACT_REF", "Refresh Trader")

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_rms.return_value = {"net": "50000.0", "availablecash": "50000.0"}
    mock_adapter.get_holdings.return_value = []
    mock_adapter.get_positions.return_value = []
    mock_adapter.get_order_book.return_value = []
    mock_adapter.get_trade_book.return_value = []

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        res = client.post(f"/api/v1/accounts/{acc.id}/refresh")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is True
        assert data["account_id"] == acc.id
        assert "Synchronized" in data["message"]


def test_paper_mode_cannot_call_smartapi_place_order(client: TestClient, db_session: Session):
    """Verify paper order submission never invokes live SmartAPI place_order method."""
    acc = create_or_get_account(db_session, "ANGEL_ACT_PAPER", "Paper Safety Trader")

    with patch("app.services.smartapi_adapter.SmartAPIAdapter.place_order") as mock_place_order:
        payload = {
            "account_id": acc.id,
            "tradingsymbol": "INFY-EQ",
            "symbol_token": "1594",
            "exchange": "NSE",
            "transaction_type": "BUY",
            "quantity": 10,
            "order_type": "MARKET",
            "product_type": "DELIVERY",
            "price": 1800.0,
            "is_paper_trade": True
        }
        res = client.post("/api/v1/orders/single", json=payload)
        assert res.status_code in (200, 201)
        # CRITICAL ASSERTION: SmartAPIAdapter.place_order must NEVER be called for paper trades
        mock_place_order.assert_not_called()
        res_data = res.json()
        assert res_data.get("is_paper_trade") is True or "SIMULATED" in str(res_data)


def test_empty_order_and_trade_book_handling(client: TestClient, db_session: Session):
    """Verify empty broker books return clean empty lists and never fabricate orders or fills."""
    acc = create_or_get_account(db_session, "ANGEL_ACT_EMPTY", "Empty Trader")

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_order_book.return_value = []
    mock_adapter.get_trade_book.return_value = []

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        # Orders
        res_orders = client.get(f"/api/v1/accounts/{acc.id}/orders")
        assert res_orders.status_code == 200
        assert isinstance(res_orders.json(), list)

        # Trades
        res_trades = client.get(f"/api/v1/accounts/{acc.id}/trades")
        assert res_trades.status_code == 200
        assert isinstance(res_trades.json(), list)


def test_account_isolation_in_activity_log(client: TestClient, db_session: Session):
    """Verify Account A's activity log never leaks Account B's records."""
    accA = create_or_get_account(db_session, "ISO_ACC_A", "Account A")
    accB = create_or_get_account(db_session, "ISO_ACC_B", "Account B")

    # Insert trade specific to B
    tradeB = BrokerTradeSnapshot(
        account_id=accB.id,
        fill_id="TRD_EXCLUSIVE_B",
        broker_order_id="ORD_EXCLUSIVE_B",
        tradingsymbol="WIPRO-EQ",
        exchange="NSE",
        transaction_type="BUY",
        fill_price=550.0,
        fill_quantity=100,
        trade_value=55000.0
    )
    db_session.add(tradeB)
    db_session.commit()

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_order_book.return_value = []
    mock_adapter.get_trade_book.return_value = []

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        resA = client.get(f"/api/v1/accounts/{accA.id}/activity-log")
        assert resA.status_code == 200
        activitiesA = resA.json()["activities"]

        for item in activitiesA:
            assert item.get("symbol") != "WIPRO-EQ"
            if item.get("details"):
                assert item["details"].get("order_id") != "ORD_EXCLUSIVE_B"


def test_order_intent_idempotency_prevents_duplicate_submission(client: TestClient, db_session: Session):
    """Verify duplicate submission with the same idempotency key is blocked."""
    acc = create_or_get_account(db_session, "IDEMP_ACC_1", "Idempotency Trader")
    from app.services.order_intent_service import OrderIntentService

    res1 = OrderIntentService.create_and_execute_order(
        db=db_session,
        account_id=acc.id,
        tradingsymbol="INFY",
        symbol_token="1594",
        exchange="NSE",
        transaction_type="BUY",
        order_type="MARKET",
        product_type="DELIVERY",
        quantity=5,
        price=1800.0,
        idempotency_key="UNIQUE_KEY_XYZ_123"
    )
    assert res1["order_id"] is not None

    # Resubmit with same idempotency key
    res2 = OrderIntentService.create_and_execute_order(
        db=db_session,
        account_id=acc.id,
        tradingsymbol="INFY",
        symbol_token="1594",
        exchange="NSE",
        transaction_type="BUY",
        order_type="MARKET",
        product_type="DELIVERY",
        quantity=5,
        price=1800.0,
        idempotency_key="UNIQUE_KEY_XYZ_123"
    )
    assert res2["order_id"] == res1["order_id"]
    assert "Duplicate submission prevented" in res2["message"]


def test_unfilled_order_does_not_fabricate_holdings(client: TestClient, db_session: Session):
    """Verify an unfilled order does not create fabricated settled demat holding rows."""
    acc = create_or_get_account(db_session, "HOLD_ACC_1", "Holdings Safety Trader")
    from app.models.holding import AccountHoldingSnapshot

    # Count initial holdings
    initial_count = db_session.query(AccountHoldingSnapshot).filter(AccountHoldingSnapshot.account_id == acc.id).count()

    # Create an open order
    open_ord = Order(
        client_order_id="UNFILLED_ORD_101",
        account_id=acc.id,
        tradingsymbol="BAJFINANCE",
        symbol_token="317",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=10,
        price=6800.0,
        status="OPEN",
        is_paper_trade=False
    )
    db_session.add(open_ord)
    db_session.commit()

    # Query holdings endpoint
    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_holdings.return_value = []

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        res = client.get(f"/api/v1/accounts/{acc.id}/holdings")
        assert res.status_code == 200
        holdings = res.json()
        assert not any(h["symbol"] == "BAJFINANCE" for h in holdings)

    after_count = db_session.query(AccountHoldingSnapshot).filter(AccountHoldingSnapshot.account_id == acc.id).count()
    assert after_count == initial_count


def test_broker_order_lifecycle_details_endpoint(client: TestClient, db_session: Session):
    """Verify GET /{account_id}/orders/{broker_order_id}/details queries SmartAPI order details."""
    acc = create_or_get_account(db_session, "ORD_DET_ACC", "Order Details Trader")

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = None
    mock_adapter.get_individual_order_details.return_value = {
        "status": True,
        "data": {
            "orderid": "241030009999",
            "status": "complete",
            "averageprice": "2950.50",
            "filledshares": "50"
        }
    }

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        res = client.get(f"/api/v1/accounts/{acc.id}/orders/241030009999/details")
        assert res.status_code == 200
        data = res.json()
        assert data.get("status") is True
        assert data["data"]["orderid"] == "241030009999"
        assert data["data"]["status"] == "complete"


def test_uncertain_network_drop_marks_unknown_submission_never_retried(client: TestClient, db_session: Session):
    """Verify that a network timeout or connection drop during order placement sets status UNKNOWN_SUBMISSION and never blindly retries."""
    acc = create_or_get_account(db_session, "UNCERTAIN_ACC_1", "Uncertain Network Trader")
    from app.services.order_intent_service import OrderIntentService
    import requests

    mock_adapter = MagicMock()
    mock_adapter.jwt_token = "mock_jwt"
    mock_adapter.token_expiry_timestamp = 9999999999
    mock_adapter.is_session_expired = False
    mock_adapter.place_order.return_value = {
        "success": False,
        "status": "SUBMISSION_UNKNOWN",
        "error_code": "GATEWAY_TIMEOUT",
        "message": "Order submission timed out. Status unknown. Do not retry live order without reconciliation."
    }

    with patch("app.core.config.settings.TRADING_MODE", "LIVE"):
        with patch("app.services.smartapi_adapter.get_adapter_for_account", return_value=mock_adapter):
            res = OrderIntentService.create_and_execute_order(
                db=db_session,
                account_id=acc.id,
                tradingsymbol="INFY",
                symbol_token="1594",
                exchange="NSE",
                transaction_type="BUY",
                order_type="MARKET",
                product_type="DELIVERY",
                quantity=10,
                price=1850.0
            )
            assert res["status"] == "UNKNOWN_SUBMISSION"
            assert res["success"] is False
            assert "unknown" in res["message"].lower()

            # Check DB record
            order_in_db = db_session.query(Order).filter(Order.id == res["order_id"]).first()
            assert order_in_db is not None
            assert order_in_db.status == "UNKNOWN_SUBMISSION"


def test_multi_client_live_batch_blocked_under_sebi_mode_c(client: TestClient, db_session: Session):
    """Verify that multi-client live batch execution is strictly paper-mode unless MULTI_CLIENT_LIVE_AUTHORIZED is set."""
    acc1 = create_or_get_account(db_session, "BATCH_SEBI_1", "Batch Account 1")
    acc2 = create_or_get_account(db_session, "BATCH_SEBI_2", "Batch Account 2")
    from app.services.bulk_order_service import BulkOrderService

    prep = BulkOrderService.prepare_and_validate(db_session, {
        "tradingsymbol": "TCS-EQ",
        "symbol_token": "11536",
        "exchange": "NSE",
        "transaction_type": "BUY",
        "order_type": "LIMIT",
        "product_type": "DELIVERY",
        "price": 3800.0,
        "accounts": [
            {"account_id": acc1.id, "quantity": 1},
            {"account_id": acc2.id, "quantity": 1}
        ]
    })
    assert prep["is_executable"] is True

    # Even in LIVE trading mode, multi-client batch must remain paper-simulated unless commercial dealer flag is enabled
    with patch("app.core.config.settings.TRADING_MODE", "LIVE"):
        with patch("app.core.config.settings.MULTI_CLIENT_LIVE_AUTHORIZED", False):
            exec_res = BulkOrderService.execute_batch(db_session, prep["batch_id"], operator_confirmed=True)
            assert exec_res["total_submitted"] == 2
            # All orders should be simulated (is_paper_trade=True)
            for r in exec_res["results"]:
                ord_rec = db_session.query(Order).filter(Order.client_order_id == r["client_order_id"]).first()
                assert ord_rec.is_paper_trade is True


def test_configurable_outbound_ip_headers():
    """Verify smartapi_adapter._get_headers uses configured static IP and local IP from settings."""
    from app.services.smartapi_adapter import SmartAPIAdapter
    from app.core.config import settings

    with patch.object(settings, "SMARTAPI_CLIENT_PUBLIC_IP", "203.0.113.50"):
        with patch.object(settings, "SMARTAPI_CLIENT_LOCAL_IP", "192.168.1.100"):
            adapter = SmartAPIAdapter(
                api_key="TEST_KEY",
                client_code="TEST_USER",
                pin="1234",
                totp_secret="JBSWY3DPEHPK3PXP"
            )
            headers = adapter._get_headers()
            assert headers["X-ClientPublicIP"] == "203.0.113.50"
            assert headers["X-ClientLocalIP"] == "192.168.1.100"
            assert headers["X-PrivateKey"] == "TEST_KEY"


