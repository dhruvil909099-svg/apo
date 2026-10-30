import pytest
from fastapi.testclient import TestClient
from app.models.account import Account
from app.models.risk import RiskLimit


def test_unauthenticated_request_rejected_401(unauthenticated_client: TestClient):
    """Verifies that all operational endpoints reject unauthenticated requests with HTTP 401."""
    # 1. Accounts
    res = unauthenticated_client.get("/api/v1/accounts")
    assert res.status_code == 401
    assert "UNAUTHORIZED" in res.json()["detail"]

    # 2. Portfolio
    res = unauthenticated_client.get("/api/v1/portfolio/consolidated")
    assert res.status_code == 401

    # 3. Orders
    res = unauthenticated_client.get("/api/v1/orders")
    assert res.status_code == 401

    # 4. Risk
    res = unauthenticated_client.get("/api/v1/risk")
    assert res.status_code == 401

    # 5. Market
    res = unauthenticated_client.get("/api/v1/market/quotes")
    assert res.status_code == 401


def test_invalid_credentials_rejected_401(unauthenticated_client: TestClient):
    """Verifies that wrong API keys or Bearer tokens receive HTTP 401."""
    # Wrong X-API-Key
    res = unauthenticated_client.get(
        "/api/v1/accounts",
        headers={"X-API-Key": "malicious-hacker-key"}
    )
    assert res.status_code == 401
    assert "Invalid API key" in res.json()["detail"]

    # Wrong Bearer token
    res = unauthenticated_client.get(
        "/api/v1/accounts",
        headers={"Authorization": "Bearer wrong-token-123"}
    )
    assert res.status_code == 401
    assert "Invalid API key" in res.json()["detail"]


def test_revoked_master_key_permanently_rejected(unauthenticated_client: TestClient):
    """Verifies that the leaked/revoked master key is rejected with HTTP 401."""
    res = unauthenticated_client.get(
        "/api/v1/accounts",
        headers={"X-API-Key": "ipopro-secure-master-key-2026"}
    )
    assert res.status_code == 401
    assert "compromised" in res.json()["detail"].lower() or "revoked" in res.json()["detail"].lower()


def test_valid_credentials_accepted_200(unauthenticated_client: TestClient):
    """Verifies that valid authenticated session JWT is accepted with HTTP 200."""
    login_res = unauthenticated_client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "TestOperator#SafeKey2026!"}
    )
    assert login_res.status_code == 200
    valid_jwt = login_res.json()["access_token"]
    assert valid_jwt is not None

    # Via X-API-Key header
    res1 = unauthenticated_client.get(
        "/api/v1/accounts",
        headers={"X-API-Key": valid_jwt}
    )
    assert res1.status_code == 200
    assert len(res1.json()) >= 1

    # Via Authorization Bearer header
    res2 = unauthenticated_client.get(
        "/api/v1/accounts",
        headers={"Authorization": f"Bearer {valid_jwt}"}
    )
    assert res2.status_code == 200


def test_public_endpoints_accessible_without_auth(unauthenticated_client: TestClient):
    """Verifies that /health and /auth/login remain accessible without pre-existing auth."""
    # Health endpoint
    res = unauthenticated_client.get("/api/v1/health")
    assert res.status_code == 200
    assert res.json()["status"] == "UP"

    # Root redirect
    res = unauthenticated_client.get("/")
    assert res.status_code == 200

    # Auth Login with valid credentials
    res = unauthenticated_client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "TestOperator#SafeKey2026!"}
    )
    assert res.status_code == 200
    assert res.json()["authenticated"] is True
    assert "access_token" in res.json()

    # Auth Login with invalid password
    res = unauthenticated_client.post(
        "/api/v1/auth/login",
        json={"username": "admin", "password": "WrongPassword123!"}
    )
    assert res.status_code == 401



def test_security_headers_enforced(client: TestClient):
    """Verifies that security headers and cache prevention are attached to responses."""
    res = client.get("/api/v1/accounts")
    assert res.status_code == 200
    assert res.headers.get("X-Content-Type-Options") == "nosniff"
    assert res.headers.get("X-Frame-Options") == "DENY"
    assert res.headers.get("X-XSS-Protection") == "1; mode=block"
    assert "no-store" in res.headers.get("Cache-Control", "")


def test_bulk_order_rejects_unauthorized_nonexistent_account(client: TestClient):
    """Verifies that requesting an invalid or tampered account ID in bulk prepare halts execution."""
    payload = {
        "ipo_id": 1,
        "price": 1050.0,
        "order_type": "LIMIT",
        "exchange": "NSE",
        "symbol_token": "19326",
        "tradingsymbol": "TATATECH",
        "accounts": [
            {"account_id": 99999, "quantity": 30}  # Non-existent tampered account ID
        ]
    }
    res = client.post("/api/v1/orders/bulk-prepare", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["is_executable"] is False
    assert any("Account ID 99999 does not exist" in err for err in data["blocking_errors"])


def test_disabled_account_order_rejected(client: TestClient, db_session):
    """Verifies that an order cannot be placed on a disabled account."""
    acc = db_session.query(Account).first()
    acc.is_enabled = False
    db_session.commit()

    order_payload = {
        "account_id": acc.id,
        "tradingsymbol": "TATATECH",
        "symbol_token": "19326",
        "exchange": "NSE",
        "transaction_type": "SELL",
        "order_type": "LIMIT",
        "variety": "NORMAL",
        "quantity": 30,
        "price": 1050.0,
        "trigger_price": 0.0
    }
    res = client.post("/api/v1/orders/single", json=order_payload)
    assert res.status_code == 400
    assert "disabled" in res.json()["detail"].lower()


def test_emergency_halt_blocks_orders_and_bulk_execution(client: TestClient, db_session):
    """Verifies that active emergency kill switch immediately stops single and bulk orders."""
    risk = db_session.query(RiskLimit).filter(RiskLimit.account_id == None).first()
    risk.emergency_trading_disabled = True
    db_session.commit()

    # 1. Single order placement attempt
    acc = db_session.query(Account).filter(Account.is_enabled == True).first()
    order_payload = {
        "account_id": acc.id,
        "tradingsymbol": "TATATECH",
        "symbol_token": "19326",
        "exchange": "NSE",
        "transaction_type": "SELL",
        "order_type": "LIMIT",
        "variety": "NORMAL",
        "quantity": 30,
        "price": 1050.0,
        "trigger_price": 0.0
    }
    res = client.post("/api/v1/orders/single", json=order_payload)
    assert res.status_code == 400
    assert "emergency" in res.json()["detail"].lower() or "kill switch" in res.json()["detail"].lower()

    # 2. Bulk execution attempt
    bulk_res = client.post("/api/v1/orders/bulk-execute", json={
        "batch_id": "test-batch-uuid",
        "operator_confirmed": True
    })
    assert bulk_res.status_code == 200
    assert bulk_res.json()["success"] is False
    assert "EMERGENCY_HALT_ACTIVE" in bulk_res.json()["message"]


def test_rate_limiter_triggers_429(client: TestClient, db_session):
    """Verifies that rapid requests exceeding the 10 req/s rate limit receive HTTP 429."""
    acc = db_session.query(Account).filter(Account.is_enabled == True).first()
    order_payload = {
        "account_id": acc.id,
        "tradingsymbol": "TATATECH",
        "symbol_token": "19326",
        "exchange": "NSE",
        "transaction_type": "SELL",
        "order_type": "LIMIT",
        "variety": "NORMAL",
        "quantity": 30,
        "price": 1050.0,
        "trigger_price": 0.0
    }
    
    responses = []
    # Rapidly fire 15 requests in immediate succession
    for _ in range(15):
        responses.append(client.post("/api/v1/orders/single", json=order_payload))

    status_codes = [r.status_code for r in responses]
    assert 429 in status_codes
    rate_limited_response = next(r for r in responses if r.status_code == 429)
    assert "RATE_LIMIT_EXCEEDED" in rate_limited_response.json()["detail"]
