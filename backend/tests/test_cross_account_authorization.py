import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.user import User
from app.models.account import Account
from app.core.security import cipher
from app.core.auth import hash_password, create_access_token


@pytest.fixture
def users_and_accounts(db_session: Session):
    """Sets up two distinct users and their respective Angel One accounts."""
    # User A (Regular Trader)
    pwd_a, salt_a = hash_password("AliceSecurePass2026!")
    user_a = User(
        username="trader_alice",
        email="alice@ipopro.internal",
        hashed_password=pwd_a,
        salt=salt_a,
        role="USER",
        is_active=True,
        token_version=0
    )
    # User B (Regular Trader)
    pwd_b, salt_b = hash_password("BobSecurePass2026!")
    user_b = User(
        username="trader_bob",
        email="bob@ipopro.internal",
        hashed_password=pwd_b,
        salt=salt_b,
        role="USER",
        is_active=True,
        token_version=0
    )
    db_session.add_all([user_a, user_b])
    db_session.commit()
    db_session.refresh(user_a)
    db_session.refresh(user_b)

    # Account owned by User A
    acc_a = Account(
        user_id=user_a.id,
        nickname="Alice Angel Demat",
        client_code="ALICE01",
        account_group="Personal",
        encrypted_api_key=cipher.encrypt("ALICE_API_KEY_SECRET"),
        encrypted_pin=cipher.encrypt("1122"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=True,
        auth_status="CONNECTED",
        available_cash=100000.0
    )
    # Account owned by User B
    acc_b = Account(
        user_id=user_b.id,
        nickname="Bob Angel Demat",
        client_code="BOB02",
        account_group="Personal",
        encrypted_api_key=cipher.encrypt("BOB_API_KEY_SECRET"),
        encrypted_pin=cipher.encrypt("3344"),
        encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
        is_enabled=True,
        is_demo=True,
        auth_status="CONNECTED",
        available_cash=150000.0
    )
    db_session.add_all([acc_a, acc_b])
    db_session.commit()
    db_session.refresh(acc_a)
    db_session.refresh(acc_b)

    token_a = create_access_token(user_a)
    token_b = create_access_token(user_b)

    return {
        "user_a": user_a,
        "user_b": user_b,
        "acc_a": acc_a,
        "acc_b": acc_b,
        "token_a": token_a,
        "token_b": token_b
    }


def test_cross_account_isolation_forbidden(unauthenticated_client: TestClient, users_and_accounts):
    """User A cannot read, overview, funds, activity-log or delete User B's account."""
    token_a = users_and_accounts["token_a"]
    acc_b_id = users_and_accounts["acc_b"].id
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # 1. Direct account fetch
    res = unauthenticated_client.get(f"/api/v1/accounts/{acc_b_id}", headers=headers_a)
    assert res.status_code == 403
    assert "FORBIDDEN" in res.json()["detail"]

    # 2. Account overview
    res = unauthenticated_client.get(f"/api/v1/accounts/{acc_b_id}/overview", headers=headers_a)
    assert res.status_code == 403

    # 3. Account funds
    res = unauthenticated_client.get(f"/api/v1/accounts/{acc_b_id}/funds", headers=headers_a)
    assert res.status_code == 403

    # 4. Account holdings
    res = unauthenticated_client.get(f"/api/v1/accounts/{acc_b_id}/holdings", headers=headers_a)
    assert res.status_code == 403

    # 5. Account positions
    res = unauthenticated_client.get(f"/api/v1/accounts/{acc_b_id}/positions", headers=headers_a)
    assert res.status_code == 403

    # 6. Account activity log
    res = unauthenticated_client.get(f"/api/v1/accounts/{acc_b_id}/activity-log", headers=headers_a)
    assert res.status_code == 403

    # 7. Delete attempt
    res = unauthenticated_client.delete(f"/api/v1/accounts/{acc_b_id}", headers=headers_a)
    assert res.status_code == 403


def test_user_cannot_place_or_preview_order_on_foreign_account(unauthenticated_client: TestClient, users_and_accounts):
    """User A cannot preview or submit an order using User B's Angel One account."""
    token_a = users_and_accounts["token_a"]
    acc_b_id = users_and_accounts["acc_b"].id
    headers_a = {"Authorization": f"Bearer {token_a}"}

    order_payload = {
        "account_id": acc_b_id,
        "tradingsymbol": "TATAMOTORS",
        "exchange": "NSE",
        "transaction_type": "BUY",
        "order_type": "LIMIT",
        "quantity": 10,
        "price": 950.0,
        "product_type": "DELIVERY",
        "symbol_token": "3456"
    }

    # 1. Preview order
    res_prev = unauthenticated_client.post("/api/v1/orders/preview", json=order_payload, headers=headers_a)
    assert res_prev.status_code == 403
    assert "FORBIDDEN" in res_prev.json()["detail"]

    # 2. Place single order
    res_place = unauthenticated_client.post("/api/v1/orders/single", json=order_payload, headers=headers_a)
    assert res_place.status_code == 403
    assert "FORBIDDEN" in res_place.json()["detail"]


def test_account_listing_scoped_to_owner(unauthenticated_client: TestClient, users_and_accounts):
    """User A's account listing only returns Account A; User B's only returns Account B."""
    token_a = users_and_accounts["token_a"]
    token_b = users_and_accounts["token_b"]
    acc_a_id = users_and_accounts["acc_a"].id
    acc_b_id = users_and_accounts["acc_b"].id

    res_a = unauthenticated_client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {token_a}"})
    assert res_a.status_code == 200
    ids_a = [item["id"] for item in res_a.json()]
    assert acc_a_id in ids_a
    assert acc_b_id not in ids_a

    res_b = unauthenticated_client.get("/api/v1/accounts", headers={"Authorization": f"Bearer {token_b}"})
    assert res_b.status_code == 200
    ids_b = [item["id"] for item in res_b.json()]
    assert acc_b_id in ids_b
    assert acc_a_id not in ids_b


def test_admin_can_access_all_accounts(client: TestClient, users_and_accounts):
    """Admin user has global oversight and can inspect all accounts."""
    acc_a_id = users_and_accounts["acc_a"].id
    acc_b_id = users_and_accounts["acc_b"].id

    res_a = client.get(f"/api/v1/accounts/{acc_a_id}")
    assert res_a.status_code == 200

    res_b = client.get(f"/api/v1/accounts/{acc_b_id}")
    assert res_b.status_code == 200

    res_all = client.get("/api/v1/accounts")
    assert res_all.status_code == 200
    all_ids = [item["id"] for item in res_all.json()]
    assert acc_a_id in all_ids
    assert acc_b_id in all_ids


def test_broker_secrets_never_exposed(unauthenticated_client: TestClient, users_and_accounts):
    """Verifies that API responses never contain raw broker MPIN, TOTP secret or API keys."""
    token_a = users_and_accounts["token_a"]
    acc_a_id = users_and_accounts["acc_a"].id
    headers_a = {"Authorization": f"Bearer {token_a}"}

    res = unauthenticated_client.get(f"/api/v1/accounts/{acc_a_id}", headers=headers_a)
    assert res.status_code == 200
    body = res.json()

    # Plaintext secrets must not be keys
    assert "pin" not in body
    assert "totp_secret" not in body
    assert "api_key" not in body

    # Raw encrypted columns should never leak secret values
    body_str = str(body)
    assert "ALICE_API_KEY_SECRET" not in body_str
    assert "1122" not in body_str
    assert "JBSWY3DPEHPK3PXP" not in body_str


def test_logout_revokes_token(unauthenticated_client: TestClient, users_and_accounts):
    """When a user logs out, their server-side token_version is incremented, immediately revoking the token."""
    token_a = users_and_accounts["token_a"]
    headers_a = {"Authorization": f"Bearer {token_a}"}

    # Verify token works first
    res_before = unauthenticated_client.get("/api/v1/auth/me", headers=headers_a)
    assert res_before.status_code == 200
    assert res_before.json()["authenticated"] is True

    # User logs out
    res_logout = unauthenticated_client.post("/api/v1/auth/logout", headers=headers_a)
    assert res_logout.status_code == 200
    assert res_logout.json()["logged_out"] is True

    # Subsequent request with old token must be rejected with 401
    res_after = unauthenticated_client.get("/api/v1/auth/me", headers=headers_a)
    assert res_after.status_code == 401
    assert "revoked" in res_after.json()["detail"].lower()


def test_brute_force_lockout_after_failed_attempts(unauthenticated_client: TestClient):
    """After 5 consecutive failed login attempts, further attempts are locked out with HTTP 429."""
    username = "attacker_target"
    for i in range(5):
        res = unauthenticated_client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": f"wrong-pass-{i}"}
        )
        assert res.status_code == 401

    # 6th attempt should be blocked by rate limiter lockout
    res_locked = unauthenticated_client.post(
        "/api/v1/auth/login",
        json={"username": username, "password": "any-password"}
    )
    assert res_locked.status_code == 429
    assert "too many" in res_locked.json()["detail"].lower() or "locked" in res_locked.json()["detail"].lower()
