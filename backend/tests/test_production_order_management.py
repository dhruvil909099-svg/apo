import sys
import os
import uuid
import pytest
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.core.database import SessionLocal, Base, engine
from app.models.account import Account
from app.models.order import Order
from app.services.account_eligibility_service import AccountEligibilityService
from app.services.risk_validation_service import RiskValidationService
from app.services.order_intent_service import OrderIntentService
from app.services.broker_reconciliation_service import BrokerReconciliationService
from app.services.smartapi_adapter import SmartAPIAdapter

# Ensure DB schema is up to date
Base.metadata.create_all(bind=engine)


@pytest.fixture
def db_session():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def seed_test_accounts(db_session):
    # Create or update 2 test accounts
    acc1 = db_session.query(Account).filter(Account.client_code == "TEST_ACC1").first()
    if not acc1:
        acc1 = Account(
            client_code="TEST_ACC1",
            nickname="Primary Trader",
            is_enabled=True,
            auth_status="CONNECTED",
            available_cash=50000.0,
            ddpi_status="ACTIVE",
            encrypted_api_key="mock_enc_key",
            encrypted_pin="mock_enc_pin",
            encrypted_totp_secret="mock_enc_totp"
        )
        db_session.add(acc1)
    else:
        acc1.is_enabled = True
        acc1.auth_status = "CONNECTED"
        acc1.available_cash = 50000.0
        acc1.ddpi_status = "ACTIVE"

    acc2 = db_session.query(Account).filter(Account.client_code == "TEST_ACC2").first()
    if not acc2:
        acc2 = Account(
            client_code="TEST_ACC2",
            nickname="Secondary Trader",
            is_enabled=True,
            auth_status="CONNECTED",
            available_cash=100.0,  # low funds
            ddpi_status="INACTIVE",
            encrypted_api_key="mock_enc_key2",
            encrypted_pin="mock_enc_pin2",
            encrypted_totp_secret="mock_enc_totp2"
        )
        db_session.add(acc2)
    else:
        acc2.is_enabled = True
        acc2.auth_status = "CONNECTED"
        acc2.available_cash = 100.0
        acc2.ddpi_status = "INACTIVE"

    acc_blocked = db_session.query(Account).filter(Account.client_code == "TEST_DISCONNECTED").first()
    if not acc_blocked:
        acc_blocked = Account(
            client_code="TEST_DISCONNECTED",
            nickname="Logged Out Account",
            is_enabled=False,
            auth_status="DISCONNECTED",
            available_cash=20000.0,
            ddpi_status="UNKNOWN",
            encrypted_api_key="mock_enc_key3",
            encrypted_pin="mock_enc_pin3",
            encrypted_totp_secret="mock_enc_totp3"
        )
        db_session.add(acc_blocked)
    else:
        acc_blocked.is_enabled = False
        acc_blocked.auth_status = "DISCONNECTED"

    db_session.commit()
    db_session.refresh(acc1)
    db_session.refresh(acc2)
    db_session.refresh(acc_blocked)
    return acc1, acc2, acc_blocked


def test_1_account_eligibility_mode_c_partitioning(db_session, seed_test_accounts):
    """Test Mode C all-eligible accounts partitioning."""
    acc1, acc2, acc_blocked = seed_test_accounts
    
    # Check BUY eligibility where required margin is 5,000 (10 shares * 500.0)
    res = AccountEligibilityService.filter_all_eligible_accounts(
        db=db_session,
        symbol="SBIN-EQ",
        transaction_type="BUY",
        quantity=10,
        price=500.0,
        product_type="DELIVERY"
    )
    
    eligible_ids = [a["account_id"] for a in res["eligible_accounts"]]
    blocked_ids = [b["account_id"] for b in res["blocked_accounts"]]
    
    # acc1 has 50,000 cash, is CONNECTED -> should be eligible
    assert acc1.id in eligible_ids, "acc1 should be eligible for BUY"
    
    # acc2 has only 100 cash, required is 5,000 -> should be blocked due to funds
    assert acc2.id in blocked_ids, "acc2 should be blocked due to insufficient funds"
    
    # acc_blocked is DISCONNECTED and inactive -> should be blocked
    assert acc_blocked.id in blocked_ids, "acc_blocked should be blocked due to session/inactive status"


def test_2_risk_validation_service_limits(db_session, seed_test_accounts):
    """Test risk controls: max order value, max quantity, and kill switch."""
    acc1, _, _ = seed_test_accounts

    # Exceeding global max value (e.g. ₹600,000 > ₹500,000)
    res_val = RiskValidationService.validate_order_risk(
        db=db_session,
        account_id=acc1.id,
        quantity=1000,
        price=600.0
    )
    assert not res_val["passed"]
    assert any("₹500,000" in err for err in res_val["errors"])

    # Exceeding global max quantity (e.g. 6,000 > 5,000)
    res_qty = RiskValidationService.validate_order_risk(
        db=db_session,
        account_id=acc1.id,
        quantity=6000,
        price=50.0
    )
    assert not res_qty["passed"]
    assert any("5,000" in err for err in res_qty["errors"])

    # Safe order passes
    res_ok = RiskValidationService.validate_order_risk(
        db=db_session,
        account_id=acc1.id,
        quantity=10,
        price=100.0
    )
    assert res_ok["passed"]


def test_3_single_account_paper_order_execution_and_isolation(db_session, seed_test_accounts):
    """Test single-account paper BUY and verify no live broker call is made."""
    acc1, _, _ = seed_test_accounts
    client_order_id = f"TEST_ORD_{uuid.uuid4().hex[:8]}"

    with patch.object(SmartAPIAdapter, "place_order") as mock_place_order:
        res = OrderIntentService.create_and_execute_order(
            db=db_session,
            account_id=acc1.id,
            tradingsymbol="SBIN-EQ",
            symbol_token="3045",
            exchange="NSE",
            transaction_type="BUY",
            order_type="MARKET",
            product_type="DELIVERY",
            quantity=5,
            price=0.0,
            idempotency_key=client_order_id
        )

        assert res["status"] in ("ACCEPTED", "EXECUTED"), f"Unexpected status: {res['status']}"
        assert res["is_paper_trade"] is True
        assert "Simulated Paper order" in res["message"]
        assert "SIM_" in res["broker_order_id"]

        # Ensure live adapter place_order was NEVER called
        mock_place_order.assert_not_called()

        # Verify durable DB record
        db_order = db_session.query(Order).filter(Order.client_order_id == client_order_id).first()
        assert db_order is not None
        assert db_order.is_paper_trade is True
        assert db_order.account_id == acc1.id
        assert db_order.quantity == 5


def test_4_idempotency_duplicate_order_blocking(db_session, seed_test_accounts):
    """Test that duplicate requests with the same client_order_id are blocked."""
    acc1, _, _ = seed_test_accounts
    idempotent_id = f"IDEM_{uuid.uuid4().hex[:8]}"

    # First attempt: succeeds
    res1 = OrderIntentService.create_and_execute_order(
        db=db_session,
        account_id=acc1.id,
        tradingsymbol="INFY-EQ",
        symbol_token="1594",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=1,
        price=1800.0,
        idempotency_key=idempotent_id
    )
    assert res1["status"] in ("ACCEPTED", "EXECUTED")

    # Second attempt with same client_order_id: immediately returned as duplicate
    res2 = OrderIntentService.create_and_execute_order(
        db=db_session,
        account_id=acc1.id,
        tradingsymbol="INFY-EQ",
        symbol_token="1594",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        quantity=1,
        price=1800.0,
        idempotency_key=idempotent_id
    )
    assert res2["client_order_id"] == idempotent_id
    assert res2["order_id"] == res1["order_id"]


def test_5_broker_status_reconciliation_service(db_session, seed_test_accounts):
    """Test broker reconciliation parses genuine order book and updates orders."""
    acc1, _, _ = seed_test_accounts
    broker_id = f"BRK_{uuid.uuid4().hex[:6]}"

    # Seed an order in 'SUBMITTING' state
    submitting_order = Order(
        account_id=acc1.id,
        broker_order_id=broker_id,
        client_order_id=f"REC_{uuid.uuid4().hex[:8]}",
        tradingsymbol="TATAMOTORS-EQ",
        symbol_token="3456",
        exchange="NSE",
        transaction_type="BUY",
        order_type="MARKET",
        product_type="DELIVERY",
        quantity=10,
        status="SUBMITTING",
        is_paper_trade=False
    )
    db_session.add(submitting_order)
    db_session.commit()

    # Mock SmartAPI order book response
    mock_orderbook = [
        {
            "orderid": broker_id,
            "status": "complete",
            "filledshares": "10",
            "averageprice": "950.50",
            "text": "Traded"
        }
    ]

    mock_adapter = MagicMock()
    mock_adapter.get_order_book.return_value = mock_orderbook

    with patch("app.services.broker_reconciliation_service.get_authenticated_adapter_for_account_id", return_value=mock_adapter):
        reconciled = BrokerReconciliationService.reconcile_account_orders(db=db_session, account_id=acc1.id)
        assert reconciled["success"] is True
        assert reconciled["reconciled_count"] >= 1

        db_session.refresh(submitting_order)
        assert submitting_order.status == "EXECUTED"
        assert submitting_order.filled_quantity == 10
        assert submitting_order.execution_price == 950.50
