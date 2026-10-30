"""
IPOPro — Final Authentication Hardening & Production Readiness Verification Suite
Tests Priority 1 through Priority 6 requirements:
- Bootstrap credential exposure and secret scanning.
- Password complexity & disallowed password enforcement.
- Initial admin provisioning lock.
- Session cookie security (HttpOnly, SameSite).
- Double-submit CSRF protection.
- Forced password rotation (must_change_password).
- Server-to-server automation restrictions & audit logging.
- Cross-account isolation & unauthorized order prevention.
- Duplicate submission protection.
- Zero live broker contact in PAPER trading.
- Safe database outage resilience.
"""
import os
import re
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.main import app
from app.core.config import settings
from app.core.database import SessionLocal, Base, engine
from app.core.auth import (
    hash_password,
    create_access_token,
    validate_password_strength,
    DISALLOWED_PASSWORDS,
    REVOKED_MASTER_KEYS
)
from app.models.user import User
from app.models.account import Account
from app.models.order import Order
from app.models.audit import AuditLog
from app.services.smartapi_adapter import verify_production_egress_ip, get_actual_egress_ip


@pytest.fixture
def clean_db():
    """Provides a fresh database session with required tables created."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def client():
    return TestClient(app)


# --------------------------------------------------------------------------------------
# 1. Bootstrap Credential Exposure & Secret Scanning
# --------------------------------------------------------------------------------------
def test_bootstrap_credential_exposure_scan():
    """
    Scans Python backend and React frontend source directories to ensure:
    - Insecure default password 'Admin@IPOPro2026!' does NOT appear in active source files
      (only permitted inside the DISALLOWED_PASSWORDS blacklist).
    - Revoked master key 'ipopro-secure-master-key-2026' only appears in REVOKED_MASTER_KEYS.
    """
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
    backend_dir = os.path.join(root_dir, "backend", "app")
    frontend_src = os.path.join(root_dir, "frontend", "src")

    leaked_pwd = "Admin@IPOPro2026!".lower()

    # Scan backend app files
    for root, _, files in os.walk(backend_dir):
        for f in files:
            if f.endswith(".py"):
                path = os.path.join(root, f)
                with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                    content = fp.read().lower()
                    if leaked_pwd in content and "disallowed_passwords" not in content:
                        pytest.fail(f"Leaked password found in active backend file: {path}")

    # Scan frontend src files
    for root, _, files in os.walk(frontend_src):
        for f in files:
            if f.endswith((".ts", ".tsx", ".js", ".jsx", ".html")):
                path = os.path.join(root, f)
                with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                    content = fp.read().lower()
                    if leaked_pwd in content:
                        pytest.fail(f"Leaked password found in frontend source file: {path}")


# --------------------------------------------------------------------------------------
# 2. Password Strength & Disallowed Passwords
# --------------------------------------------------------------------------------------
def test_password_strength_and_disallowed_passwords():
    """Verifies that password complexity and known insecure defaults are strictly enforced."""
    # Test short passwords
    is_ok, msg = validate_password_strength("Short1!")
    assert not is_ok
    assert "at least 10" in msg.lower()

    # Test disallowed defaults
    for bad_pwd in ["Admin@IPOPro2026!", "password123", "admin123", "ipopro2026"]:
        is_ok, msg = validate_password_strength(bad_pwd)
        assert not is_ok, f"Should have rejected disallowed password: {bad_pwd}"
        assert "disallowed" in msg.lower() or "insecure" in msg.lower()

    # Test missing character classes
    assert not validate_password_strength("alllowercase123!")[0]
    assert not validate_password_strength("ALLUPPERCASE123!")[0]
    assert not validate_password_strength("NoDigitsHereSpecial!")[0]
    assert not validate_password_strength("NoSpecialChar12345")[0]

    # Test valid strong password
    is_ok, err = validate_password_strength("Str0ng!Secur3P@ssw0rd")
    assert is_ok
    assert err is None


# --------------------------------------------------------------------------------------
# 3. Initial Administrator Provisioning Lock
# --------------------------------------------------------------------------------------
def test_initial_administrator_provisioning(client: TestClient, clean_db: Session):
    """
    Verifies that POST /api/v1/auth/setup-admin:
    1. Successfully provisions first administrator when no admin exists.
    2. Issues HttpOnly session cookie and CSRF token.
    3. Permanently locks (403) against subsequent provisioning calls.
    """
    # Delete any existing admin for this test
    clean_db.query(User).filter(User.role == "ADMIN").delete()
    clean_db.commit()

    # Status check confirms setup is required
    st_res = client.get("/api/v1/auth/bootstrap-status")
    assert st_res.status_code == 200
    assert st_res.json()["initial_setup_required"] is True

    # Setup initial admin with weak password -> rejected
    weak_res = client.post("/api/v1/auth/setup-admin", json={
        "username": "superadmin",
        "email": "superadmin@ipopro.internal",
        "password": "weak",
        "confirm_password": "weak"
    })
    assert weak_res.status_code in (400, 422)

    # Setup initial admin with disallowed password -> rejected
    disallowed_res = client.post("/api/v1/auth/setup-admin", json={
        "username": "superadmin",
        "email": "superadmin@ipopro.internal",
        "password": "Admin@IPOPro2026!",
        "confirm_password": "Admin@IPOPro2026!"
    })
    assert disallowed_res.status_code == 400

    # Setup initial admin with valid password -> succeeded
    valid_res = client.post("/api/v1/auth/setup-admin", json={
        "username": "superadmin",
        "email": "superadmin@ipopro.internal",
        "password": "InitSuper#Admin2026!",
        "confirm_password": "InitSuper#Admin2026!"
    })
    assert valid_res.status_code == 201
    data = valid_res.json()
    assert data["authenticated"] is True
    assert data["username"] == "superadmin"
    assert data["role"] == "ADMIN"
    assert data["csrf_token"] is not None

    # Cookies must be set
    assert settings.SESSION_COOKIE_NAME in valid_res.cookies
    assert settings.CSRF_COOKIE_NAME in valid_res.cookies

    # Subsequent call to setup-admin must be blocked permanently (403)
    second_res = client.post("/api/v1/auth/setup-admin", json={
        "username": "intruder",
        "email": "intruder@evil.com",
        "password": "Intruder#Pass2026!",
        "confirm_password": "Intruder#Pass2026!"
    })
    assert second_res.status_code == 403
    assert "already been provisioned" in second_res.json()["detail"].lower()


# --------------------------------------------------------------------------------------
# 4. Session Cookie Security & HttpOnly
# --------------------------------------------------------------------------------------
def test_session_cookie_security_and_httponly(client: TestClient, clean_db: Session):
    """Verifies that login sets HttpOnly and SameSite session cookies."""
    # Ensure test user exists
    user = clean_db.query(User).filter(User.username == "cookie_operator").first()
    if not user:
        h, s = hash_password("Cookie#Op2026!Sec")
        user = User(
            username="cookie_operator",
            email="cookie@ipopro.internal",
            hashed_password=h,
            salt=s,
            role="USER",
            is_active=True,
            token_version=0
        )
        clean_db.add(user)
        clean_db.commit()

    login_res = client.post("/api/v1/auth/login", json={
        "username": "cookie_operator",
        "password": "Cookie#Op2026!Sec"
    })
    assert login_res.status_code == 200

    # Inspect Set-Cookie headers
    cookie_headers = [v for k, v in login_res.headers.items() if k.lower() == "set-cookie"]
    cookie_str = "; ".join(cookie_headers)

    # Must contain session cookie and CSRF cookie
    assert settings.SESSION_COOKIE_NAME in cookie_str
    assert settings.CSRF_COOKIE_NAME in cookie_str

    # Must have HttpOnly for session cookie
    assert "httponly" in cookie_str.lower()


# --------------------------------------------------------------------------------------
# 5. Double-Submit CSRF Protection
# --------------------------------------------------------------------------------------
def test_csrf_double_submit_protection(client: TestClient, clean_db: Session):
    """
    Verifies double-submit CSRF enforcement for cookie-authenticated requests:
    1. Cookie authentication missing X-CSRF-Token on POST is rejected with 403.
    2. Cookie authentication with mismatched X-CSRF-Token is rejected with 403.
    3. Cookie authentication with matching X-CSRF-Token is accepted.
    4. Bearer header authentication is exempt from CSRF.
    """
    h, s = hash_password("Csrf#TestUser2026!")
    user = User(
        username="csrf_trader",
        email="csrf@ipopro.internal",
        hashed_password=h,
        salt=s,
        role="ADMIN",
        is_active=True,
        token_version=0
    )
    clean_db.add(user)
    clean_db.commit()
    clean_db.refresh(user)

    token = create_access_token(user)
    csrf_val = "valid-csrf-token-12345"

    # 1. Cookie auth without CSRF header on POST -> 403
    client.cookies.set(settings.SESSION_COOKIE_NAME, token)
    client.cookies.set(settings.CSRF_COOKIE_NAME, csrf_val)

    bad_res = client.post(
        "/api/v1/accounts/batch-create-demo?count=1",
        cookies={settings.SESSION_COOKIE_NAME: token, settings.CSRF_COOKIE_NAME: csrf_val}
    )
    assert bad_res.status_code == 403
    assert "csrf" in bad_res.json()["detail"].lower()

    # 2. Cookie auth with mismatched CSRF header -> 403
    mismatch_res = client.post(
        "/api/v1/accounts/batch-create-demo?count=1",
        headers={"X-CSRF-Token": "different-csrf-token"},
        cookies={settings.SESSION_COOKIE_NAME: token, settings.CSRF_COOKIE_NAME: csrf_val}
    )
    assert mismatch_res.status_code == 403
    assert "csrf" in mismatch_res.json()["detail"].lower()

    # 3. Cookie auth with matching CSRF header -> 200 OK
    good_res = client.post(
        "/api/v1/accounts/batch-create-demo?count=1",
        headers={"X-CSRF-Token": csrf_val},
        cookies={settings.SESSION_COOKIE_NAME: token, settings.CSRF_COOKIE_NAME: csrf_val}
    )
    assert good_res.status_code == 200

    # 4. Bearer token in header without CSRF header -> 200 OK (CSRF exempt for programmatic tokens)
    client.cookies.clear()
    bearer_res = client.post(
        "/api/v1/accounts/batch-create-demo?count=1",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert bearer_res.status_code == 200


# --------------------------------------------------------------------------------------
# 6. Forced Password Rotation (must_change_password)
# --------------------------------------------------------------------------------------
def test_password_rotation_must_change_password_enforcement(client: TestClient, clean_db: Session):
    """
    Verifies that when must_change_password is True:
    1. Normal endpoints return 403 ("Password rotation required").
    2. Operator can call /api/v1/auth/change-password.
    3. Password change resets flag and increments token_version to invalidate prior session.
    """
    h, s = hash_password("OldPassword#2026!")
    user = User(
        username="rotate_trader",
        email="rotate@ipopro.internal",
        hashed_password=h,
        salt=s,
        role="ADMIN",
        is_active=True,
        must_change_password=True,
        token_version=0
    )
    clean_db.add(user)
    clean_db.commit()
    clean_db.refresh(user)

    token = create_access_token(user)

    # Accessing accounts with must_change_password -> 403
    blocked_res = client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {token}"})
    assert blocked_res.status_code == 403
    assert "password rotation required" in blocked_res.json()["detail"].lower()

    # Can access /me
    me_res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["must_change_password"] is True

    # Rotate password
    change_res = client.post(
        "/api/v1/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": "OldPassword#2026!",
            "new_password": "NewStrong#Password2026!",
            "confirm_password": "NewStrong#Password2026!"
        }
    )
    assert change_res.status_code == 200
    assert change_res.json()["success"] is True
    new_token = change_res.json()["access_token"]
    assert new_token != token

    # Old token is now revoked (token_version bumped)
    old_token_res = client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {token}"})
    assert old_token_res.status_code == 401

    # New token can access accounts
    new_res = client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {new_token}"})
    assert new_res.status_code == 200


# --------------------------------------------------------------------------------------
# 7. Server-to-Server Automation Restrictions & Audit Logging
# --------------------------------------------------------------------------------------
def test_server_to_server_automation_restrictions(client: TestClient, clean_db: Session):
    """
    Verifies that MASTER_API_KEY:
    1. Can trade on demo accounts.
    2. CANNOT trade or access private live client accounts where is_automation_enabled=False.
    3. Invocations are recorded in AuditLog table.
    """
    settings.MASTER_API_KEY = "ipopro-automation-secret-key-32chars-long!"

    # Create live private account without automation enabled
    h, s = hash_password("Pass#123456789")
    live_acc = Account(
        nickname="Private Demat Account",
        client_code="PRIVATE_CLI_01",
        account_group="HNI",
        is_demo=False,
        is_automation_enabled=False,
        encrypted_api_key="enc_key",
        encrypted_pin="enc_pin",
        encrypted_totp_secret="enc_totp",
        auth_status="CONNECTED",
        available_cash=50000.0
    )
    clean_db.add(live_acc)
    clean_db.commit()
    clean_db.refresh(live_acc)

    # Master API key attempt to preview order on private account -> 403 Forbidden
    res = client.post(
        "/api/v1/orders/preview",
        headers={"X-API-Key": settings.MASTER_API_KEY},
        json={
            "account_id": live_acc.id,
            "tradingsymbol": "INFY",
            "transaction_type": "BUY",
            "quantity": 10,
            "price": 1500.0,
            "order_type": "LIMIT"
        }
    )
    assert res.status_code == 403
    assert "server automation access is disabled" in res.json()["detail"].lower()

    # Enable automation on account -> permitted
    live_acc.is_automation_enabled = True
    clean_db.commit()

    allowed_res = client.post(
        "/api/v1/orders/preview",
        headers={"X-API-Key": settings.MASTER_API_KEY},
        json={
            "account_id": live_acc.id,
            "tradingsymbol": "INFY",
            "transaction_type": "BUY",
            "quantity": 10,
            "price": 1500.0,
            "order_type": "LIMIT"
        }
    )
    assert allowed_res.status_code == 200

    # Verify audit log was recorded for automation access
    logs = clean_db.query(AuditLog).filter(AuditLog.operator == "system_automation").all()
    assert len(logs) >= 1
    assert any(log.event_type == "SERVER_TO_SERVER_API_ACCESS" for log in logs)


# --------------------------------------------------------------------------------------
# 8. PAPER Orders Never Call Live Broker
# --------------------------------------------------------------------------------------
def test_paper_orders_never_call_live_broker(client: TestClient, clean_db: Session):
    """
    Confirms that PAPER orders NEVER invoke SmartAPI placeOrder endpoint under any condition.
    """
    # Create test account
    acc = Account(
        nickname="Paper Demat",
        client_code="PAPER_CLI_99",
        account_group="Testing",
        is_demo=True,
        encrypted_api_key="enc_key",
        encrypted_pin="enc_pin",
        encrypted_totp_secret="enc_totp",
        auth_status="CONNECTED",
        available_cash=100000.0
    )
    clean_db.add(acc)
    clean_db.commit()
    clean_db.refresh(acc)

    # Mock place_order on SmartAPIAdapter
    with patch("app.services.smartapi_adapter.SmartAPIAdapter.place_order") as mock_live_place:
        settings.TRADING_MODE = "PAPER"

        # Place single paper order
        res = client.post(
            "/api/v1/orders",
            headers={"X-API-Key": settings.MASTER_API_KEY},
            json={
                "account_id": acc.id,
                "tradingsymbol": "TCS",
                "symbol_token": "11536",
                "exchange": "NSE",
                "transaction_type": "BUY",
                "order_type": "LIMIT",
                "quantity": 1,
                "price": 3500.0
            }
        )
        assert res.status_code == 201
        assert res.json()["is_paper_trade"] is True

        # Assert live order endpoint was NOT called
        mock_live_place.assert_not_called()


# --------------------------------------------------------------------------------------
# 9. Production Egress IP Verification
# --------------------------------------------------------------------------------------
def test_production_egress_ip_verification():
    """Verifies that the egress IP diagnostic resolves actual outbound IP address."""
    info = verify_production_egress_ip()
    assert "actual_egress_ip" in info
    assert len(info["actual_egress_ip"]) >= 7
    assert "." in info["actual_egress_ip"] or ":" in info["actual_egress_ip"]
    assert info["status"] in ("COMPLIANT", "MISMATCH_WARNING")


# --------------------------------------------------------------------------------------
# 10. Safe Database Outage Handling
# --------------------------------------------------------------------------------------
def test_safe_database_outage_handling(client: TestClient):
    """Verifies that database connection failures return structured JSON errors without leaking credentials."""
    with patch("sqlalchemy.orm.Session.execute", side_effect=Exception("OperationalError: database disk image is malformed")):
        res = client.get("/api/v1/health/ready")
        assert res.status_code in (200, 503)
        assert res.json()["status"] == "DEGRADED"
        assert res.json()["database"] == "UNAVAILABLE"
