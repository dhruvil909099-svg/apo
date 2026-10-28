import time
import json
from unittest.mock import patch, MagicMock
import pytest
import requests

from app.models.account import Account
from app.core.security import (
    cipher,
    normalize_base32_secret,
    validate_and_normalize_base32_secret,
    generate_totp_token,
    mask_client_id
)
from app.services.smartapi_adapter import (
    SmartAPIAdapter,
    get_adapter_for_account,
    invalidate_adapter_for_account,
    _adapter_cache
)


def test_base32_normalization_and_otpauth_parsing():
    """Verify that normalize_base32_secret correctly cleans keys and extracts from otpauth URIs."""
    # Plain secret with whitespace, dashes, lowercase
    secret = "  jbsw-y3dp-ehpk-3pxp  "
    assert normalize_base32_secret(secret) == "JBSWY3DPEHPK3PXP"

    # Otpauth QR URI format
    uri = "otpauth://totp/AngelOne:AB1234?secret=JBSWY3DPEHPK3PXP&issuer=AngelOne"
    assert normalize_base32_secret(uri) == "JBSWY3DPEHPK3PXP"

    # Temporary 6-digit numeric OTP code must be preserved intact without character mangling
    assert normalize_base32_secret("583921") == "583921"
    assert normalize_base32_secret(" 184920 ") == "184920"

    # generate_totp_token with 6-digit code directly passes it through
    assert generate_totp_token("583921") == "583921"

    # generate_totp_token with valid base32 key computes 6-digit token
    totp = generate_totp_token("JBSWY3DPEHPK3PXP")
    assert len(totp) == 6
    assert totp.isdigit()


def test_smartapi_adapter_field_mapping_and_headers():
    """
    Verify login request uses official Angel One SmartAPI endpoint, payload schema,
    and never leaks Authorization header during loginByPassword.
    """
    adapter = SmartAPIAdapter(
        api_key=" TEST_API_KEY ",
        client_code=" ab1234 ",
        pin=" 1234 ",
        totp_secret="JBSWY3DPEHPK3PXP",
        account_id=99
    )

    # Inputs must be stripped and client_code uppercased
    assert adapter.api_key == "TEST_API_KEY"
    assert adapter.client_code == "AB1234"
    assert adapter.pin == "1234"

    # Headers for login must NOT contain Authorization
    headers = adapter._get_headers(include_auth=False)
    assert headers["X-PrivateKey"] == "TEST_API_KEY"
    assert "Authorization" not in headers

    # Mock response from Angel One loginByPassword
    mock_response = MagicMock()
    mock_response.json.return_value = {
        "status": True,
        "message": "SUCCESS",
        "errorcode": "",
        "data": {
            "jwtToken": "MOCK_JWT_TOKEN_XYZ",
            "refreshToken": "MOCK_REFRESH_TOKEN_XYZ",
            "feedToken": "MOCK_FEED_TOKEN_XYZ"
        }
    }

    with patch.object(adapter.session, "post", return_value=mock_response) as mock_post:
        result = adapter.authenticate(manual_totp="654321")

        assert result["success"] is True
        assert adapter.jwt_token == "MOCK_JWT_TOKEN_XYZ"
        assert adapter.feed_token == "MOCK_FEED_TOKEN_XYZ"
        assert adapter.is_session_expired is False

        # Verify call arguments
        mock_post.assert_called_once()
        call_args = mock_post.call_args
        url = call_args[0][0]
        assert url == "https://apiconnect.angelone.in/rest/auth/angelbroking/user/v1/loginByPassword"
        
        payload = call_args[1]["json"]
        assert payload["clientcode"] == "AB1234"
        assert payload["password"] == "1234"
        assert payload["totp"] == "654321"

        # Verify login request headers did not leak Authorization
        sent_headers = call_args[1]["headers"]
        assert "Authorization" not in sent_headers
        assert sent_headers["X-PrivateKey"] == "TEST_API_KEY"


def test_smartapi_ab1050_error_handling():
    """
    Verify AB1050 (Invalid TOTP and Client Combination) produces clear, actionable,
    sanitized diagnostic message and marks account as failed without exposing secrets.
    """
    adapter = SmartAPIAdapter(
        api_key="TEST_KEY",
        client_code="CLIENT99",
        pin="1234",
        totp_secret="JBSWY3DPEHPK3PXP"
    )

    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "status": False,
        "message": "Invalid totp and client combination",
        "errorcode": "AB1050"
    }

    with patch.object(adapter.session, "post", return_value=mock_resp):
        res = adapter.authenticate()
        assert res["success"] is False
        assert res["error_code"] == "AB1050"
        assert "AB1050" in res["message"]
        assert "Invalid TOTP, PIN, or Client Code combination" in res["message"]
        # Ensure raw secrets are absent
        assert "TEST_KEY" not in res["message"]
        assert "1234" not in res["message"]
        assert "JBSWY3DPEHPK3PXP" not in res["message"]


def test_smartapi_session_expiry_classification():
    """Verify expired token responses (AG8001 / AB1004) set is_session_expired flag."""
    adapter = SmartAPIAdapter(
        api_key="TEST_KEY",
        client_code="CLIENT99",
        pin="1234",
        totp_secret="JBSWY3DPEHPK3PXP"
    )

    mock_resp = MagicMock()
    mock_resp.json.return_value = {
        "status": False,
        "message": "Session expired, please login again",
        "errorcode": "AG8001"
    }

    with patch.object(adapter.session, "post", return_value=mock_resp):
        res = adapter.authenticate()
        assert res["success"] is False
        assert adapter.is_session_expired is True
        assert "session expired" in res["message"].lower()


def test_adapter_session_pooling_prevents_duplicate_logins():
    """
    Verify get_adapter_for_account pools adapters so multiple endpoints (holdings, positions)
    reuse the active JWT session without re-calling loginByPassword.
    """
    invalidate_adapter_for_account(101)

    adapter1 = get_adapter_for_account(
        account_id=101,
        api_key="KEY101",
        client_code="CLI101",
        pin="1234",
        totp_secret="JBSWY3DPEHPK3PXP"
    )
    # Simulate established active session
    adapter1.jwt_token = "ACTIVE_JWT_101"
    adapter1.token_expiry_timestamp = time.time() + 3600
    adapter1.is_session_expired = False

    adapter2 = get_adapter_for_account(
        account_id=101,
        api_key="KEY101",
        client_code="CLI101",
        pin="1234",
        totp_secret="JBSWY3DPEHPK3PXP"
    )

    # Must be the exact same object
    assert adapter1 is adapter2

    # Multiple calls to _ensure_authenticated must not call loginByPassword
    with patch.object(adapter1, "authenticate") as mock_auth:
        assert adapter1._ensure_authenticated() is True
        assert adapter2._ensure_authenticated() is True
        mock_auth.assert_not_called()

    # Clean up
    invalidate_adapter_for_account(101)
    assert 101 not in _adapter_cache


def test_multiple_accounts_session_isolation():
    """Verify separate accounts maintain completely isolated credentials and sessions."""
    invalidate_adapter_for_account(201)
    invalidate_adapter_for_account(202)

    ad1 = get_adapter_for_account(201, "KEY_A", "USER_A", "1111", "JBSWY3DPEHPK3PXP")
    ad2 = get_adapter_for_account(202, "KEY_B", "USER_B", "2222", "JBSWY3DPEHPK3PXP")

    assert ad1 is not ad2
    assert ad1.client_code == "USER_A"
    assert ad2.client_code == "USER_B"
    assert ad1.api_key == "KEY_A"
    assert ad2.api_key == "KEY_B"

    ad1.jwt_token = "JWT_USER_A"
    ad2.jwt_token = "JWT_USER_B"

    assert ad1.jwt_token != ad2.jwt_token

    invalidate_adapter_for_account(201)
    invalidate_adapter_for_account(202)


def test_manual_totp_reconnect_endpoint(client, db_session):
    """
    Test POST /api/v1/accounts/{id}/test accepts a manual 6-digit TOTP code
    and successfully validates with mock broker.
    """
    # Create test live account
    test_acc = Account(
        nickname="Live Test Account",
        client_code="LIVETEST01",
        account_group="Family",
        encrypted_api_key=cipher.encrypt("API_KEY_LIVE"),
        encrypted_pin=cipher.encrypt("4321"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_demo=False,
        auth_status="ERROR",
        last_auth_error="Invalid TOTP"
    )
    db_session.add(test_acc)
    db_session.commit()
    db_session.refresh(test_acc)

    mock_auth_res = {
        "status": True,
        "message": "SUCCESS",
        "data": {
            "jwtToken": "LIVE_JWT_VAL",
            "refreshToken": "LIVE_REFRESH_VAL",
            "feedToken": "LIVE_FEED_VAL"
        }
    }
    mock_profile_res = {
        "status": True,
        "message": "SUCCESS",
        "data": {
            "ddpiStatus": "ACTIVE",
            "dpType": "CDSL"
        }
    }

    with patch("requests.Session.post") as mock_post, patch("requests.Session.get") as mock_get:
        mock_post_resp = MagicMock()
        mock_post_resp.json.return_value = mock_auth_res
        mock_post.return_value = mock_post_resp

        mock_get_resp = MagicMock()
        mock_get_resp.json.return_value = mock_profile_res
        mock_get.return_value = mock_get_resp

        # Call with manual 6-digit TOTP
        response = client.post(
            f"/api/v1/accounts/{test_acc.id}/test",
            json={"totp_code": "583921"}
        )

        assert response.status_code == 200
        data = response.json()
        assert data["success"] is True
        assert data["auth_status"] == "CONNECTED"
        assert data["jwt_acquired"] is True
        assert data["ddpi_status"] == "ACTIVE"

        # Verify login payload used the manual TOTP code
        login_call = mock_post.call_args
        assert login_call[1]["json"]["totp"] == "583921"
        assert login_call[1]["json"]["clientcode"] == "LIVETEST01"
        assert login_call[1]["json"]["password"] == "4321"

    # Verify no secret leaked into response
    resp_text = response.text
    assert "API_KEY_LIVE" not in resp_text
    assert "4321" not in resp_text
    assert "JBSWY3DPEHPK3PXP" not in resp_text


def test_smartapi_ag8004_invalid_api_key_handling(client, db_session):
    """
    Verify that AG8004 (Invalid API Key) on downstream calls fails gracefully
    and informs the user rather than falsely claiming 0 holdings and success.
    """
    acc = Account(
        client_code="AG8004_TEST",
        nickname="Key Test Demat",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("INVALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        auth_status="CONNECTED",
        ddpi_status="ACTIVE",
        available_cash=50000.0
    )
    db_session.add(acc)
    db_session.commit()
    db_session.refresh(acc)

    mock_auth_res = {
        "status": True,
        "message": "SUCCESS",
        "data": {"jwtToken": "JWT", "refreshToken": "REF", "feedToken": "FEED"}
    }
    mock_ag8004_res = {
        "success": False,
        "message": "Invalid API Key",
        "errorCode": "AG8004",
        "data": ""
    }

    with patch("requests.Session.post") as mock_post, patch("requests.Session.get") as mock_get:
        mock_post_resp = MagicMock()
        mock_post_resp.json.return_value = mock_auth_res
        mock_post.return_value = mock_post_resp

        mock_get_resp = MagicMock()
        mock_get_resp.json.return_value = mock_ag8004_res
        mock_get.return_value = mock_get_resp

        # Test sync endpoint
        res = client.post(f"/api/v1/accounts/{acc.id}/sync")
        assert res.status_code == 200
        data = res.json()
        assert data["success"] is False
        assert "AG8004" in data["message"] or "Invalid SmartAPI API Key" in data["message"]

        db_session.refresh(acc)
        assert acc.auth_status == "ERROR"
        assert "AG8004" in acc.last_auth_error or "Invalid SmartAPI API Key" in acc.last_auth_error


def test_smartapi_holdings_fallback_to_get_holding():
    """Verify get_holdings falls back to standard /portfolio/v1/getHolding if getAllHolding returns empty."""
    adapter = SmartAPIAdapter("KEY", "ACC01", "1234", "JBSWY3DPEHPK3PXP")
    adapter.jwt_token = "JWT"
    adapter.token_expiry_timestamp = time.time() + 3600

    def mock_get(url, *args, **kwargs):
        resp = MagicMock()
        if "getAllHolding" in url:
            # Empty summary returned
            resp.json.return_value = {"status": True, "message": "SUCCESS", "data": {"holdings": []}}
        elif "getHolding" in url:
            # Fallback list returned
            resp.json.return_value = {
                "status": True,
                "message": "SUCCESS",
                "data": [{
                    "tradingsymbol": "INFY-EQ",
                    "quantity": 10,
                    "averageprice": 1400.0,
                    "ltp": 1500.0,
                    "isin": "INE009A01021"
                }]
            }
        return resp

    with patch.object(adapter.session, "get", side_effect=mock_get):
        holdings = adapter.get_holdings()
        assert len(holdings) == 1
        assert holdings[0]["tradingsymbol"] == "INFY-EQ"


def test_smartapi_ddpi_preservation_when_unexposed(client, db_session):
    """Verify that when broker profile does not contain DDPI flag, existing DDPI status is preserved."""
    acc = Account(
        client_code="DDPI_TEST",
        nickname="DDPI Preserved",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("VALID_KEY"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        auth_status="DISCONNECTED",
        ddpi_status="ACTIVE",
        available_cash=10000.0
    )
    db_session.add(acc)
    db_session.commit()
    db_session.refresh(acc)

    mock_auth_res = {"status": True, "data": {"jwtToken": "JWT", "refreshToken": "REF", "feedToken": "FEED"}}
    # Standard Angel One profile without DDPI fields
    mock_profile_res = {
        "status": True,
        "data": {
            "clientcode": "DDPI_TEST",
            "name": "TEST USER",
            "email": "",
            "exchanges": ["nse_cm"],
            "products": ["CNC"]
        }
    }
    mock_rms_res = {"status": True, "data": {"availablecash": "15000.0", "net": "15000.0"}}

    with patch("requests.Session.post") as mock_post, patch("requests.Session.get") as mock_get:
        mock_post.return_value = MagicMock(json=lambda: mock_auth_res)

        def mock_get_route(url, *args, **kwargs):
            if "getProfile" in url:
                return MagicMock(json=lambda: mock_profile_res)
            return MagicMock(json=lambda: mock_rms_res)

        mock_get.side_effect = mock_get_route

        res = client.post(f"/api/v1/accounts/{acc.id}/test", json={"totp_code": "123456"})
        assert res.status_code == 200
        db_session.refresh(acc)
        # DDPI status should remain ACTIVE as set by user, NOT overwritten to UNKNOWN
        assert acc.ddpi_status == "ACTIVE"


def test_validate_and_normalize_base32_secret_strict_validation():
    """Verify strict validation of permanent Base32 authenticator secrets."""
    # Valid Base32 secrets
    assert validate_and_normalize_base32_secret("JBSWY3DPEHPK3PXP") == "JBSWY3DPEHPK3PXP"
    assert validate_and_normalize_base32_secret("  jbsw-y3dp-ehpk-3pxp  ") == "JBSWY3DPEHPK3PXP"
    assert validate_and_normalize_base32_secret("otpauth://totp/AngelOne:AB1234?secret=JBSWY3DPEHPK3PXP") == "JBSWY3DPEHPK3PXP"

    # Reject 6-digit numeric OTPs
    with pytest.raises(ValueError, match="6-digit OTP is not accepted"):
        validate_and_normalize_base32_secret("123456")

    with pytest.raises(ValueError, match="6-digit OTP is not accepted"):
        validate_and_normalize_base32_secret(" 654321 ")

    # Reject too short
    with pytest.raises(ValueError, match="too short"):
        validate_and_normalize_base32_secret("TOOSHORT")

    # Reject empty
    with pytest.raises(ValueError, match="cannot be empty"):
        validate_and_normalize_base32_secret("")

    # Reject invalid characters
    with pytest.raises(ValueError, match="Invalid Base32 secret string"):
        validate_and_normalize_base32_secret("INVALID!@#$12345678")


def test_create_and_update_account_rejects_six_digit_otp(client, db_session):
    """Verify create and update account endpoints reject 6-digit OTP codes in totp_secret."""
    # Create with 6-digit OTP should fail with 400
    create_payload = {
        "nickname": "Test OTP Demat",
        "client_code": "TESTOTP01",
        "account_group": "Family",
        "api_key": "VALID_API_KEY_123",
        "pin": "1234",
        "totp_secret": "123456",  # 6-digit OTP!
        "is_demo": False
    }
    resp = client.post("/api/v1/accounts", json=create_payload)
    assert resp.status_code == 400
    assert "6-digit OTP is not accepted" in resp.json()["detail"]

    # Valid account creation
    create_payload["totp_secret"] = "JBSWY3DPEHPK3PXP"
    resp = client.post("/api/v1/accounts", json=create_payload)
    assert resp.status_code == 201
    created_id = resp.json()["id"]

    # Update with 6-digit OTP should fail with 400
    update_payload = {"totp_secret": "654321"}
    resp = client.put(f"/api/v1/accounts/{created_id}", json=update_payload)
    assert resp.status_code == 400
    assert "6-digit OTP is not accepted" in resp.json()["detail"]


def test_readonly_endpoints_raise_502_on_broker_failure(client, db_session):
    """
    Verify read-only endpoints (holdings, positions, orders, trades) raise HTTP 502
    Bad Gateway when upstream broker call fails, rather than silently fabricating empty data.
    """
    live_acc = Account(
        nickname="Broker Error Demat",
        client_code="BROKER_ERR_01",
        account_group="Test",
        encrypted_api_key=cipher.encrypt("KEY_ERR"),
        encrypted_pin=cipher.encrypt("1234"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=False,
        auth_status="CONNECTED",
        available_cash=50000.0
    )
    db_session.add(live_acc)
    db_session.commit()
    db_session.refresh(live_acc)

    mock_adapter = MagicMock()
    mock_adapter.is_session_expired = False
    mock_adapter.last_error = "Broker gateway timeout or connection reset"
    mock_adapter.get_holdings.return_value = []
    mock_adapter.get_positions.return_value = []
    mock_adapter.get_order_book.return_value = []
    mock_adapter.get_trade_book.return_value = []

    with patch("app.api.endpoints_accounts.get_adapter_for_account", return_value=mock_adapter):
        # 1. Holdings
        resp = client.get(f"/api/v1/accounts/{live_acc.id}/holdings")
        assert resp.status_code == 502
        assert "Broker gateway timeout" in resp.json()["detail"]

        # 2. Positions
        resp = client.get(f"/api/v1/accounts/{live_acc.id}/positions")
        assert resp.status_code == 502
        assert "Broker gateway timeout" in resp.json()["detail"]

        # 3. Orders
        resp = client.get(f"/api/v1/accounts/{live_acc.id}/orders")
        assert resp.status_code == 502
        assert "Broker gateway timeout" in resp.json()["detail"]

        # 4. Trades
        resp = client.get(f"/api/v1/accounts/{live_acc.id}/trades")
        assert resp.status_code == 502
        assert "Broker gateway timeout" in resp.json()["detail"]


def test_smartapi_adapter_rejects_six_digit_otp_in_authenticate():
    """Verify SmartAPIAdapter.authenticate rejects 6-digit numeric OTPs passed as totp_secret."""
    adapter = SmartAPIAdapter(
        api_key="API_KEY",
        client_code="CLIENT01",
        pin="1234",
        totp_secret="123456"  # 6-digit numeric OTP passed as secret
    )
    res = adapter.authenticate()
    assert res["success"] is False
    assert "temporary 6-digit code is stored instead of a permanent Base32 secret" in res["message"]


def test_account_persistence_scrubs_six_digit_otp_and_serializes_ipo_metadata(tmp_path):
    """
    Verify backup persistence serializes IPO metadata inside allotment records,
    and restore scrubs legacy 6-digit OTP secrets to require re-authentication.
    """
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from app.core.database import Base
    from app.models.ipo import IPO, Allotment
    from app.models.risk import RiskLimit
    import app.services.account_persistence as persistence

    temp_backup_file = str(tmp_path / "metadata_test_backup.json")
    original_backup_path = persistence.BACKUP_FILE_PATH
    persistence.BACKUP_FILE_PATH = temp_backup_file

    try:
        db_path = str(tmp_path / "metadata_test.db")
        engine = create_engine(f"sqlite:///{db_path}")
        Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        Base.metadata.create_all(bind=engine)
        session = Session()

        acc = Account(
            nickname="Metadata Test Demat",
            client_code="META_TEST_01",
            account_group="Test",
            encrypted_api_key=cipher.encrypt("TEST_KEY"),
            encrypted_pin=cipher.encrypt("1234"),
            encrypted_totp_secret=cipher.encrypt("654321"),  # legacy 6-digit OTP in DB
            is_enabled=True,
            is_demo=False,
            auth_status="CONNECTED"
        )
        session.add(acc)

        ipo = IPO(
            symbol="TESTIPO",
            company_name="Test IPO Company Limited",
            exchange="NSE",
            issue_price=250.0,
            lot_size=60,
            listing_date="2026-10-28",
            isin="INE999A01099",
            symbol_token="99999",
            status="LISTED"
        )
        session.add(ipo)
        session.flush()

        allotment = Allotment(
            ipo_id=ipo.id,
            account_id=acc.id,
            application_no="APP-META-001",
            applied_quantity=60,
            allotted_quantity=60,
            acquisition_cost=250.0,
            status="ALLOTTED"
        )
        session.add(allotment)
        session.commit()

        # Persist backup
        assert persistence.persist_accounts_backup(session) is True

        # Inspect backup JSON structure
        with open(temp_backup_file, "r") as f:
            data = json.load(f)

        assert isinstance(data, list)
        assert len(data) == 1
        acc_data = data[0]
        assert len(acc_data["allotments"]) == 1
        allot_data = acc_data["allotments"][0]
        assert allot_data["symbol"] == "TESTIPO"
        assert allot_data["company_name"] == "Test IPO Company Limited"
        assert allot_data["issue_price"] == 250.0
        assert allot_data["lot_size"] == 60
        assert allot_data["isin"] == "INE999A01099"

        session.close()

        # Re-create fresh database and restore
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        session_fresh = Session()

        restored_count = persistence.restore_accounts_backup(session_fresh)
        assert restored_count == 1

        restored_acc = session_fresh.query(Account).filter(Account.client_code == "META_TEST_01").first()
        assert restored_acc is not None
        # 6-digit OTP should have been scrubbed to placeholder and auth_status set to REAUTHENTICATION_REQUIRED
        assert restored_acc.auth_status == "REAUTHENTICATION_REQUIRED"
        decrypted_secret = cipher.decrypt(restored_acc.encrypted_totp_secret)
        assert decrypted_secret != "654321"

        # IPO reconstructed and allotment linked
        restored_ipo = session_fresh.query(IPO).filter(IPO.symbol == "TESTIPO").first()
        assert restored_ipo is not None
        assert restored_ipo.company_name == "Test IPO Company Limited"
        assert restored_ipo.issue_price == 250.0

        restored_allot = session_fresh.query(Allotment).filter(Allotment.application_no == "APP-META-001").first()
        assert restored_allot is not None
        assert restored_allot.ipo_id == restored_ipo.id
        assert restored_allot.account_id == restored_acc.id

        session_fresh.close()
    finally:
        persistence.BACKUP_FILE_PATH = original_backup_path

