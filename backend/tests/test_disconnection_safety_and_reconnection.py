import pytest
from unittest.mock import patch, MagicMock
from datetime import datetime
from app.models.account import Account
from app.models.order import Order
from app.models.ipo import IPO, Allotment
from app.core.security import cipher, normalize_base32_secret
from app.services.portfolio_sync_service import reconcile_broker_holdings
from app.services.bulk_order_service import BulkOrderService
from app.services.data_orchestrator import DataOrchestrator


def test_disconnected_account_blocks_single_order(client, db_session):
    """
    Requirements 3 & 8:
    Verify that a disconnected non-demo account cannot place single broker orders.
    Returns HTTP 409 Conflict with BROKER_ACCOUNT_DISCONNECTED error code.
    """
    account = Account(
        nickname="Disconnected Trader",
        client_code="DISC_TEST_01",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("VALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="DISCONNECTED",
        available_cash=50000.0
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    payload = {
        "account_id": account.id,
        "tradingsymbol": "TATATECH",
        "symbol_token": "19326",
        "exchange": "NSE",
        "transaction_type": "BUY",
        "order_type": "LIMIT",
        "variety": "NORMAL",
        "quantity": 5,
        "price": 1000.0,
        "trigger_price": 0.0
    }

    resp = client.post("/api/v1/orders/single", json=payload)
    assert resp.status_code == 409
    data = resp.json()
    detail = data.get("detail", {})
    assert detail.get("error_code") == "BROKER_ACCOUNT_DISCONNECTED"
    assert "disabled until reconnection" in detail.get("message", "")


def test_disconnected_account_blocks_order_preview(client, db_session):
    """
    Requirement 3:
    Order preview for a disconnected account must report is_valid: False
    and list the disconnection in blocking_reasons.
    """
    account = Account(
        nickname="Disconnected Preview Test",
        client_code="DISC_TEST_02",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("VALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="REAUTHENTICATION_REQUIRED",
        available_cash=50000.0
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    resp = client.post("/api/v1/orders/preview", json={
        "account_id": account.id,
        "tradingsymbol": "TATATECH",
        "transaction_type": "BUY",
        "order_type": "LIMIT",
        "quantity": 5,
        "price": 1000.0
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["is_valid"] is False
    assert any("disabled until reconnection" in r for r in data["blocking_reasons"])


def test_disconnected_account_blocks_order_cancel(client, db_session):
    """
    Requirement 3:
    Mutating order operations such as cancellation must be blocked with HTTP 409 Conflict.
    """
    account = Account(
        nickname="Disconnected Cancel Test",
        client_code="DISC_TEST_03",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("VALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="DISCONNECTED",
        available_cash=50000.0
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    order = Order(
        client_order_id="TEST-ORD-001",
        account_id=account.id,
        tradingsymbol="TATATECH",
        symbol_token="19326",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        product_type="DELIVERY",
        variety="NORMAL",
        quantity=10,
        price=1000.0,
        status="ACCEPTED",
        is_paper_trade=False
    )
    db_session.add(order)
    db_session.commit()
    db_session.refresh(order)

    resp = client.post(f"/api/v1/orders/{order.id}/cancel")
    assert resp.status_code == 409
    detail = resp.json().get("detail", {})
    assert detail.get("error_code") == "BROKER_ACCOUNT_DISCONNECTED"


def test_disconnected_account_blocks_bulk_orders(db_session):
    """
    Requirement 3 & 4:
    Bulk order prepare and execute must reject disconnected accounts server-side.
    """
    account = Account(
        nickname="Disconnected Bulk Test",
        client_code="DISC_TEST_04",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("VALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="DISCONNECTED",
        available_cash=50000.0
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    ipo = db_session.query(IPO).first()
    if not ipo:
        ipo = IPO(symbol="TESTIPO", company_name="Test IPO Ltd", issue_price=100.0, current_ltp=120.0, isin="INE000A01001", symbol_token="9999")
        db_session.add(ipo)
        db_session.commit()
        db_session.refresh(ipo)

    allotment = Allotment(account_id=account.id, ipo_id=ipo.id, allotted_quantity=50, applied_quantity=50, acquisition_cost=100.0)
    db_session.add(allotment)
    db_session.commit()

    # Bulk prepare
    prep_res = BulkOrderService.prepare_and_validate(db_session, {
        "ipo_id": ipo.id,
        "accounts": [{"account_id": account.id, "quantity": 10}],
        "price": 120.0,
        "order_type": "LIMIT",
        "tradingsymbol": ipo.symbol,
        "symbol_token": ipo.symbol_token
    })

    assert prep_res["is_executable"] is False
    assert any("BROKER_ACCOUNT_DISCONNECTED" in err for err in prep_res["blocking_errors"])


def test_disconnected_account_blocks_live_sync(client, db_session):
    """
    Requirement 3:
    Triggering live synchronization while disconnected must return HTTP 409 Conflict.
    """
    account = Account(
        nickname="Disconnected Sync Test",
        client_code="DISC_TEST_05",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("VALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="DISCONNECTED",
        available_cash=50000.0
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    resp = client.post(f"/api/v1/accounts/{account.id}/sync")
    assert resp.status_code == 409
    detail = resp.json().get("detail", {})
    assert detail.get("error_code") == "BROKER_ACCOUNT_DISCONNECTED"


def test_empty_holdings_response_preserves_historical_data(db_session):
    """
    Requirements 1 & 8:
    A failed or empty broker holdings response must NEVER wipe previously saved allotments.
    """
    account = Account(
        nickname="Holdings Preservation Test",
        client_code="DISC_TEST_06",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("VALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="CONNECTED",
        available_cash=50000.0
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    ipo = db_session.query(IPO).filter(IPO.symbol == "PRESERVE").first()
    if not ipo:
        ipo = IPO(symbol="PRESERVE", company_name="Preserve Corp", issue_price=200.0, current_ltp=250.0, isin="INE000B02002", symbol_token="8888")
        db_session.add(ipo)
        db_session.commit()
        db_session.refresh(ipo)

    allotment = Allotment(
        account_id=account.id,
        ipo_id=ipo.id,
        allotted_quantity=100,
        applied_quantity=100,
        acquisition_cost=200.0,
        verification_source="ANGEL_ONE_HOLDINGS",
        demat_verified=True
    )
    db_session.add(allotment)
    db_session.commit()
    db_session.refresh(allotment)

    # Simulate an empty broker response
    reconcile_broker_holdings(db_session, account, [], datetime.utcnow())

    # Verify that the allotment was NOT wiped to 0
    refreshed_allotment = db_session.query(Allotment).filter(Allotment.id == allotment.id).first()
    assert refreshed_allotment.allotted_quantity == 100


def test_reconnect_rejects_six_digit_otp(client, db_session):
    """
    Requirement 2 & 8:
    Reconnection endpoint must reject manual 6-digit OTP codes and require the permanent Base32 key.
    """
    account = Account(
        nickname="OTP Rejection Test",
        client_code="DISC_TEST_07",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("VALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="REAUTHENTICATION_REQUIRED",
        available_cash=50000.0
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    resp = client.post(f"/api/v1/accounts/{account.id}/reconnect", json={
        "client_code": "DISC_TEST_07",
        "api_key": "VALID_KEY_2",
        "pin": "1234",
        "totp_secret": "654321"  # 6-digit numeric OTP!
    })
    assert resp.status_code == 400
    assert "6-digit OTP is not accepted" in resp.json().get("detail", "")


def test_reconnect_success_with_full_credentials(client, db_session):
    """
    Requirement 6:
    Submitting valid full credentials authenticates against SmartAPI, sets CONNECTED,
    and updates RMS funds.
    """
    account = Account(
        nickname="Full Reconnect Test",
        client_code="DISC_TEST_08",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("OLD_KEY"),
        encrypted_pin=cipher.encrypt("0000"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_demo=False,
        is_enabled=True,
        auth_status="DISCONNECTED",
        available_cash=0.0
    )
    db_session.add(account)
    db_session.commit()
    db_session.refresh(account)

    mock_auth = {"success": True, "message": "Authentication successful", "feed_token": "FEED_123"}
    mock_rms = {"availablecash": 125000.0, "net": 125000.0}

    with patch("app.api.endpoints_accounts.get_adapter_for_account") as mock_get_adapter:
        mock_adapter = MagicMock()
        mock_adapter.authenticate.return_value = mock_auth
        mock_adapter.get_rms.return_value = mock_rms
        mock_adapter.get_holdings.return_value = []
        mock_get_adapter.return_value = mock_adapter

        resp = client.post(f"/api/v1/accounts/{account.id}/reconnect", json={
            "client_code": "DISC_TEST_08",
            "api_key": "FRESH_SMARTAPI_KEY",
            "pin": "1234",
            "totp_secret": "23VPIQU5UOZ3ZN5ODGMV2GDX4E"
        })

        assert resp.status_code == 200
        data = resp.json()
        assert data["auth_status"] == "CONNECTED"
        assert data["available_cash"] == 125000.0

        # Verify decrypted credentials in DB
        db_session.refresh(account)
        assert account.auth_status == "CONNECTED"
        assert cipher.decrypt(account.encrypted_api_key) == "FRESH_SMARTAPI_KEY"
        assert cipher.decrypt(account.encrypted_pin) == "1234"
        assert cipher.decrypt(account.encrypted_totp_secret) == "23VPIQU5UOZ3ZN5ODGMV2GDX4E"


def test_mobile_prefix_totp_normalization():
    """
    User Screenshot Issue Fix:
    User accidentally pasted their 10-digit phone number prepended to their Base32 key.
    Ensure normalize_base32_secret extracts the clean 26-character Base32 key.
    """
    raw_with_mobile = "757506636423VPIQU5UOZ3ZN5ODGMV2GDX4E"
    normalized = normalize_base32_secret(raw_with_mobile)
    assert normalized == "23VPIQU5UOZ3ZN5ODGMV2GDX4E"
    assert len(normalized) == 26


def test_data_orchestrator_skips_disconnected_accounts(db_session):
    """
    Requirement 1 & 4:
    Background orchestrator must not poll or retry authentication in a tight loop
    for accounts in DISCONNECTED or REAUTHENTICATION_REQUIRED status.
    """
    acc_disc = Account(
        nickname="Orchestrator Disc Test",
        client_code="DISC_TEST_09",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="DISCONNECTED",
        last_sync_time=None
    )
    acc_reauth = Account(
        nickname="Orchestrator Reauth Test",
        client_code="DISC_TEST_10",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("23VPIQU5UOZ3ZN5ODGMV2GDX4E"),
        is_demo=False,
        is_enabled=True,
        auth_status="REAUTHENTICATION_REQUIRED",
        last_sync_time=None
    )
    db_session.add_all([acc_disc, acc_reauth])
    db_session.commit()

    import asyncio
    orchestrator = DataOrchestrator()
    res = asyncio.run(orchestrator.auto_refresh_stale_accounts(db_session))

    assert res["success"] is True
    # Neither disconnected account should have been polled
    db_session.refresh(acc_disc)
    db_session.refresh(acc_reauth)
    assert acc_disc.sync_status != "REFRESHING"
    assert acc_reauth.sync_status != "REFRESHING"
