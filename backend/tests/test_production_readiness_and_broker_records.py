import uuid
import json
import time
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from datetime import datetime

from app.models.account import Account
from app.models.order import Order
from app.models.holding import AccountHoldingSnapshot
from app.models.broker_activity import BrokerTradeSnapshot
from app.models.audit import AuditLog
from app.models.user import User
from app.core.security import cipher
from app.core.config import settings
from app.services.order_intent_service import OrderIntentService
from app.services.bulk_order_service import BulkOrderService
from app.services.production_readiness_gate import ProductionReadinessGate


def create_test_trader(
    db_session: Session,
    client_code: str,
    nickname: str,
    is_demo: bool = False,
    cash: float = 100000.0,
    is_adult_verified: bool = False,
    transaction_permission_verified: bool = False
) -> Account:
    acc = db_session.query(Account).filter(Account.client_code == client_code).first()
    if not acc:
        acc = Account(
            client_code=client_code,
            nickname=nickname,
            is_enabled=True,
            auth_status="CONNECTED",
            available_cash=cash,
            ddpi_status="ACTIVE",
            encrypted_api_key=cipher.encrypt("test_smartapi_key"),
            encrypted_pin=cipher.encrypt("4321"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_demo=is_demo,
            is_adult_verified=is_adult_verified,
            transaction_permission_verified=transaction_permission_verified
        )
        db_session.add(acc)
        db_session.commit()
        db_session.refresh(acc)
    else:
        acc.auth_status = "CONNECTED"
        acc.is_enabled = True
        acc.available_cash = cash
        acc.is_demo = is_demo
        acc.is_adult_verified = is_adult_verified
        acc.transaction_permission_verified = transaction_permission_verified
        db_session.commit()
    return acc


# 1. Simulated orders do not appear in production records
def test_simulated_orders_excluded_from_production_records(client: TestClient, db_session: Session):
    acc = create_test_trader(db_session, "PROD_ACC_01", "Production Trader 1", is_demo=False)
    acc.auth_status = "DISCONNECTED"
    db_session.commit()

    # 1 Live order
    live_ord = Order(
        client_order_id=str(uuid.uuid4()),
        broker_order_id="BROKER_LIVE_1001",
        account_id=acc.id,
        tradingsymbol="TCS",
        symbol_token="11536",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=10,
        price=3500.0,
        status="COMPLETE",
        is_paper_trade=False
    )
    # 1 Simulated paper order
    paper_ord = Order(
        client_order_id=str(uuid.uuid4()),
        broker_order_id="SIM_PAPER_9999",
        account_id=acc.id,
        tradingsymbol="INFY",
        symbol_token="1594",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=25,
        price=1800.0,
        status="COMPLETE",
        is_paper_trade=True
    )
    db_session.add_all([live_ord, paper_ord])
    db_session.commit()

    # Query account orders default view (production view)
    res = client.get(f"/api/v1/accounts/{acc.id}/orders")
    assert res.status_code == 200
    orders = res.json()
    order_ids = [o["order_id"] for o in orders]
    assert "BROKER_LIVE_1001" in order_ids
    assert "SIM_PAPER_9999" not in order_ids

    # Query global orders endpoint default view
    res_global = client.get("/api/v1/orders/")
    assert res_global.status_code == 200
    global_orders = res_global.json()
    global_order_ids = [o.get("broker_order_id") or o.get("order_id") for o in global_orders]
    assert "BROKER_LIVE_1001" in global_order_ids
    assert "SIM_PAPER_9999" not in global_order_ids

    # When test archive is explicitly requested
    res_archive = client.get(f"/api/v1/accounts/{acc.id}/orders?include_simulated=true")
    assert res_archive.status_code == 200
    archive_orders = res_archive.json()
    archive_ids = [o["order_id"] for o in archive_orders]
    assert "SIM_PAPER_9999" in archive_ids
    assert "BROKER_LIVE_1001" in archive_ids


# 2. Genuine broker records remain intact
def test_genuine_broker_records_remain_intact(client: TestClient, db_session: Session):
    acc = create_test_trader(db_session, "PROD_ACC_02", "Production Trader 2", is_demo=False)
    acc.auth_status = "DISCONNECTED"
    db_session.commit()

    genuine_fill = BrokerTradeSnapshot(
        account_id=acc.id,
        fill_id="FILL_GENUINE_7788",
        broker_order_id="ORD_ANGEL_4455",
        tradingsymbol="RELIANCE-EQ",
        exchange="NSE",
        transaction_type="BUY",
        fill_price=2950.0,
        fill_quantity=15,
        trade_value=44250.0
    )
    db_session.add(genuine_fill)
    db_session.commit()

    res = client.get(f"/api/v1/accounts/{acc.id}/trades")
    assert res.status_code == 200
    trades = res.json()
    fill_ids = [t["fill_id"] for t in trades]
    assert "FILL_GENUINE_7788" in fill_ids
    trade_item = next(t for t in trades if t["fill_id"] == "FILL_GENUINE_7788")
    assert trade_item["symbol"] == "RELIANCE-EQ"
    assert trade_item["fill_quantity"] == 15
    assert trade_item["fill_price"] == 2950.0


# 3. Production totals exclude demo balances
def test_production_totals_exclude_demo_balances(client: TestClient, db_session: Session):
    live_acc = create_test_trader(db_session, "LIVE_FUND_ACC", "Real Demat Trader", is_demo=False, cash=45000.0)
    demo_acc = create_test_trader(db_session, "DEMO_FUND_ACC", "Simulation Demo Trader", is_demo=True, cash=900000.0)

    # 1. Accounts list with live capital filter
    res_accs = client.get("/api/v1/accounts?capital_type=live")
    assert res_accs.status_code == 200
    live_list = res_accs.json()
    live_ids = [a["id"] for a in live_list]
    assert live_acc.id in live_ids
    assert demo_acc.id not in live_ids

    # 2. Consolidated portfolio query defaults to non-demo accounts
    res = client.get("/api/v1/portfolio/consolidated")
    assert res.status_code == 200
    data = res.json()
    summary = data.get("summary", {})
    assert summary.get("total_accounts_selected", 0) >= 1

    # 3. Real account funds endpoint never returns DEMAT_SIMULATOR
    res_funds = client.get(f"/api/v1/accounts/{live_acc.id}/funds")
    assert res_funds.status_code == 200
    funds = res_funds.json()
    assert funds["data_source"] != "DEMAT_SIMULATOR"


# 4. Single-account navigation works and production readiness gate enforces strict checks
def test_single_account_navigation_readiness(client: TestClient, db_session: Session):
    # 4.1 Enabled, non-demo account alone is NOT evidence of adult eligibility or permission (blocked)
    unverified_acc = create_test_trader(db_session, "UNVERIFIED_ACC", "Unverified Trader", is_demo=False, is_adult_verified=False, transaction_permission_verified=False)
    gate_unverified = ProductionReadinessGate.evaluate_account_readiness(
        db=db_session,
        account_id=unverified_acc.id
    )
    assert gate_unverified["ready"] is False
    assert gate_unverified["checks"]["eligible_account_holder"]["passed"] is False
    assert gate_unverified["checks"]["transaction_permission"]["passed"] is False

    # 4.2 Verified account with adult KYC, active broker session, and transaction permission passes
    acc = create_test_trader(db_session, "NAV_ACC_01", "Navigation Trader", is_demo=False, is_adult_verified=True, transaction_permission_verified=True)

    mock_adapter = MagicMock()
    mock_adapter.jwt_token = "mock_valid_jwt"
    mock_adapter.token_expiry_timestamp = time.time() + 3600
    mock_adapter.is_session_expired = False

    with patch("app.services.smartapi_adapter.get_adapter_for_account", return_value=mock_adapter):
        gate_eval = ProductionReadinessGate.evaluate_account_readiness(
            db=db_session,
            account_id=acc.id
        )
        assert "account_id" in gate_eval
        assert "checks" in gate_eval
        assert gate_eval["account_id"] == acc.id
        assert gate_eval["checks"]["eligible_account_holder"]["passed"] is True
        assert gate_eval["checks"]["broker_authorisation"]["passed"] is True
        assert gate_eval["checks"]["transaction_permission"]["passed"] is True
        assert gate_eval["checks"]["official_trading_apis"]["passed"] is True

        res = client.get(f"/api/v1/orders/production-readiness-gate?account_id={acc.id}&tradingsymbol=SBIN-EQ&quantity=5&price=800")
        assert res.status_code == 200
        data = res.json()
        assert data["account_id"] == acc.id


# 5. Multi-account selection works
def test_multi_account_selection_and_preparation(db_session: Session):
    acc1 = create_test_trader(db_session, "MULTI_01", "Multi Trader 1", is_demo=False, cash=50000.0)
    acc2 = create_test_trader(db_session, "MULTI_02", "Multi Trader 2", is_demo=False, cash=60000.0)

    req_data = {
        "tradingsymbol": "ITC-EQ",
        "symbol_token": "4249",
        "exchange": "NSE",
        "order_type": "LIMIT",
        "transaction_type": "BUY",
        "product_type": "DELIVERY",
        "price": 450.0,
        "accounts": [
            {"account_id": acc1.id, "quantity": 10},
            {"account_id": acc2.id, "quantity": 20}
        ]
    }
    preview = BulkOrderService.prepare_and_validate(db_session, req_data)
    assert preview["batch_id"] is not None
    assert preview["total_accounts"] == 2
    assert preview["total_quantity"] == 30
    assert len(preview["proposed_orders"]) == 2

    # Different accounts have separate instructions
    q1 = next(p["proposed_quantity"] for p in preview["proposed_orders"] if p["account_id"] == acc1.id)
    q2 = next(p["proposed_quantity"] for p in preview["proposed_orders"] if p["account_id"] == acc2.id)
    assert q1 == 10
    assert q2 == 20


# 6. Unauthorised accounts remain excluded
def test_unauthorised_accounts_remain_excluded(client: TestClient, db_session: Session):
    foreign_acc = create_test_trader(db_session, "FOREIGN_ACC", "Foreign Client Account", is_demo=False)

    regular_user = User(
        username="isolated_operator",
        email="isolated@trader.io",
        hashed_password="dummy_hash_for_test",
        salt="test_salt",
        role="USER",
        is_active=True,
        token_version=0
    )
    db_session.add(regular_user)
    db_session.commit()

    from app.core.auth import authorize_account_access, UserPrincipal
    from fastapi import HTTPException

    principal = UserPrincipal(id=regular_user.id, username=regular_user.username, role="USER")
    with pytest.raises(HTTPException) as exc_info:
        authorize_account_access(foreign_acc, principal)
    assert exc_info.value.status_code == 403


# 7. Broker data cannot be fabricated
def test_broker_data_cannot_be_fabricated(db_session: Session):
    acc = create_test_trader(db_session, "NO_FAB_01", "Truth Trader", is_demo=False)

    order_intent = OrderIntentService.create_and_execute_order(
        db=db_session,
        account_id=acc.id,
        tradingsymbol="INFY-EQ",
        symbol_token="1594",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=10,
        price=1800.0
    )
    db_order = db_session.query(Order).filter(Order.id == order_intent["order_id"]).first()
    assert db_order is not None

    # Order in prepared/paper mode does not invent a fake Angel One live trade fill
    snapshots = db_session.query(BrokerTradeSnapshot).filter(
        BrokerTradeSnapshot.account_id == acc.id,
        BrokerTradeSnapshot.broker_order_id == db_order.broker_order_id
    ).all()
    assert len(snapshots) == 0


# 8. Unfilled orders do not create settled holdings
def test_unfilled_orders_do_not_create_settled_holdings(db_session: Session):
    acc = create_test_trader(db_session, "UNFILLED_ACC", "Pending Order Trader", is_demo=False)

    unfilled = Order(
        client_order_id=str(uuid.uuid4()),
        broker_order_id="ANGEL_OPEN_8899",
        account_id=acc.id,
        tradingsymbol="WIPRO",
        symbol_token="3787",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=50,
        price=520.0,
        status="OPEN",  # Unfilled / Trigger Pending
        is_paper_trade=False
    )
    db_session.add(unfilled)
    db_session.commit()

    holding = db_session.query(AccountHoldingSnapshot).filter(
        AccountHoldingSnapshot.account_id == acc.id,
        AccountHoldingSnapshot.tradingsymbol == "WIPRO-EQ"
    ).first()
    assert holding is None or holding.quantity == 0


# 9. Duplicate requests do not create duplicate orders (Idempotency)
def test_duplicate_requests_do_not_create_duplicate_orders(db_session: Session):
    acc = create_test_trader(db_session, "IDEMP_ACC_01", "Idempotent Trader", is_demo=False)
    idempotency_key = f"IDEMP_TEST_KEY_{uuid.uuid4().hex[:12]}"

    res1 = OrderIntentService.create_and_execute_order(
        db=db_session,
        account_id=acc.id,
        tradingsymbol="TATASTEEL",
        symbol_token="3499",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=100,
        price=145.0,
        idempotency_key=idempotency_key
    )
    order1_id = res1["order_id"]

    res2 = OrderIntentService.create_and_execute_order(
        db=db_session,
        account_id=acc.id,
        tradingsymbol="TATASTEEL",
        symbol_token="3499",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=100,
        price=145.0,
        idempotency_key=idempotency_key
    )
    order2_id = res2["order_id"]

    assert order1_id == order2_id
    assert "already processed" in res2["message"]

    matching_orders = db_session.query(Order).filter(Order.client_order_id == idempotency_key).all()
    assert len(matching_orders) == 1


# 10. Database outages fail safely
def test_database_outages_fail_safely(db_session: Session):
    mock_failing_db = MagicMock(spec=Session)
    mock_failing_db.query.side_effect = Exception("Database Connection Lost")

    res = OrderIntentService.create_and_execute_order(
        db=mock_failing_db,
        account_id=99999,
        tradingsymbol="HDFCBANK",
        symbol_token="1333",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=10,
        price=1600.0
    )
    # Failed safely: no exception leaked and no order dispatched
    assert res.get("success") is False
    assert res.get("status") == "DB_PERSISTENCE_FAILED"


# 11. Broker timeouts retain uncertain states
def test_broker_timeouts_retain_uncertain_states(db_session: Session):
    acc = create_test_trader(db_session, "TIMEOUT_ACC_01", "Timeout Trader", is_demo=False)

    mock_adapter = MagicMock()
    mock_adapter.jwt_token = "valid_token"
    mock_adapter.token_expiry_timestamp = 9999999999
    mock_adapter.is_session_expired = False
    mock_adapter.place_order.return_value = {
        "success": False,
        "status": "SUBMISSION_UNKNOWN",
        "message": "Gateway Timeout contacting exchange. Check Order Book for confirmation."
    }

    original_trading_mode = settings.TRADING_MODE
    settings.TRADING_MODE = "LIVE"
    try:
        with patch("app.services.smartapi_adapter.get_adapter_for_account", return_value=mock_adapter):
            res = OrderIntentService.create_and_execute_order(
                db=db_session,
                account_id=acc.id,
                tradingsymbol="ASIANPAINT",
                symbol_token="236",
                exchange="NSE",
                transaction_type="BUY",
                order_type="LIMIT",
                product_type="DELIVERY",
                quantity=5,
                price=2900.0
            )
            assert res["status"] == "UNKNOWN_SUBMISSION"
            ord_record = db_session.query(Order).filter(Order.id == res["order_id"]).first()
            assert ord_record.status == "UNKNOWN_SUBMISSION"
    finally:
        settings.TRADING_MODE = original_trading_mode


# 12. Multi-client live submission remains blocked without required approvals
def test_multi_client_live_submission_remains_blocked(db_session: Session):
    acc1 = create_test_trader(db_session, "CLIENT_A", "Client A", is_demo=False)
    acc2 = create_test_trader(db_session, "CLIENT_B", "Client B", is_demo=False)

    prep_data = {
        "tradingsymbol": "KOTAKBANK-EQ",
        "symbol_token": "1922",
        "exchange": "NSE",
        "order_type": "LIMIT",
        "transaction_type": "BUY",
        "product_type": "DELIVERY",
        "price": 1750.0,
        "accounts": [
            {"account_id": acc1.id, "quantity": 10},
            {"account_id": acc2.id, "quantity": 10}
        ]
    }
    preview = BulkOrderService.prepare_and_validate(db_session, prep_data)
    batch_id = preview["batch_id"]

    # Even in LIVE trading mode, multi-client batch execution falls back to paper/simulation
    # unless multi-client live authorization license is explicitly granted
    original_mode = settings.TRADING_MODE
    settings.TRADING_MODE = "LIVE"
    try:
        exec_res = BulkOrderService.execute_batch(db_session, batch_id, operator_confirmed=True)
        assert len(exec_res["results"]) == 2
        for r in exec_res["results"]:
            assert r["status"] in ("ACCEPTED", "EXECUTED")
            # Orders are isolated and executed safely
            ord_obj = db_session.query(Order).filter(Order.client_order_id == r["client_order_id"]).first()
            assert ord_obj.is_paper_trade is True
    finally:
        settings.TRADING_MODE = original_mode


# 13. All Activity Log entries are correctly source-labelled
def test_activity_log_source_labelling(client: TestClient, db_session: Session):
    acc = create_test_trader(db_session, "LABEL_ACC_01", "Labelling Trader", is_demo=False)

    # Add audit log
    audit = AuditLog(
        account_id=acc.id,
        event_type="SESSION_ESTABLISHED",
        operator="SYSTEM",
        details_json='{"status": "OK"}'
    )
    # Add broker trade snapshot
    trade_snap = BrokerTradeSnapshot(
        account_id=acc.id,
        fill_id="FILL_LABEL_11",
        broker_order_id="ORD_LABEL_11",
        tradingsymbol="HINDUNILVR-EQ",
        exchange="NSE",
        transaction_type="BUY",
        fill_price=2400.0,
        fill_quantity=5,
        trade_value=12000.0
    )
    db_session.add_all([audit, trade_snap])
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
        activities = data["activities"]
        assert len(activities) >= 2

        valid_sources = {
            "LIVE BROKER",
            "BROKER-SYNCED SNAPSHOT",
            "OFFICIAL STATEMENT IMPORT",
            "IPOPRO SYSTEM AUDIT",
            "TEST SIMULATION"
        }
        for act in activities:
            assert act["origin"] in valid_sources, f"Invalid activity origin: {act['origin']}"


# 14. Existing login and security protections remain operational
def test_login_and_security_protections_operational(client: TestClient, db_session: Session):
    # Verify login endpoint accepts valid operator credentials
    login_res = client.post("/api/v1/auth/login", json={
        "username": "admin",
        "password": "TestOperator#SafeKey2026!"
    })
    assert login_res.status_code == 200
    token_data = login_res.json()
    assert "access_token" in token_data
    assert token_data["token_type"].lower() == "bearer"
    # HttpOnly cookie is set or bearer token provided
    assert "access_token" in login_res.cookies or "access_token" in token_data
