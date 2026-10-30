import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.order import Order
from app.models.ipo import Allotment, IPO
from app.models.portfolio_note import PortfolioNote
from app.models.notification import Notification
from app.models.chat import ChatMessage
from app.models.user import User


def test_account_holdings_isolation(client: TestClient, db_session: Session):
    """
    Verifies that Account A's holdings cannot be accessed or mixed when querying Account B.
    """
    # In test fixtures:
    # Account 1 has 2 holdings (TATATECH, SWIGGY)
    # Account 2 has 1 holding (TATATECH)
    # Account 3 has 0 holdings
    res1 = client.get("/api/v1/accounts/1/holdings")
    assert res1.status_code == 200
    holdings1 = res1.json()
    symbols1 = {h["symbol"] for h in holdings1}
    assert "TATATECH" in symbols1
    assert "SWIGGY" in symbols1
    assert len(holdings1) == 2

    res2 = client.get("/api/v1/accounts/2/holdings")
    assert res2.status_code == 200
    holdings2 = res2.json()
    symbols2 = {h["symbol"] for h in holdings2}
    assert "TATATECH" in symbols2
    assert "SWIGGY" not in symbols2
    assert len(holdings2) == 1

    res3 = client.get("/api/v1/accounts/3/holdings")
    assert res3.status_code == 200
    holdings3 = res3.json()
    assert len(holdings3) == 0


def test_account_orders_isolation(client: TestClient, db_session: Session):
    """
    Verifies that querying orders for Account 1 never returns orders for Account 2.
    """
    # Create distinct orders for Account 1 and Account 2
    order1 = Order(
        client_order_id="user_a_order_001",
        account_id=1,
        tradingsymbol="TATATECH-EQ",
        symbol_token="19326",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        quantity=15,
        price=1050.0,
        status="EXECUTED",
        is_paper_trade=False
    )
    order2 = Order(
        client_order_id="user_b_order_002",
        account_id=2,
        tradingsymbol="IREDA-EQ",
        symbol_token="19327",
        exchange="NSE",
        transaction_type="BUY",
        order_type="LIMIT",
        quantity=25,
        price=120.0,
        status="EXECUTED",
        is_paper_trade=False
    )
    db_session.add_all([order1, order2])
    db_session.commit()

    # Query Account 1 orders
    res1 = client.get("/api/v1/orders?account_id=1&include_simulated=true")
    assert res1.status_code == 200
    data1 = res1.json()
    assert any(o["client_order_id"] == "user_a_order_001" for o in data1)
    assert not any(o["client_order_id"] == "user_b_order_002" for o in data1)

    # Query Account 2 orders
    res2 = client.get("/api/v1/orders?account_id=2&include_simulated=true")
    assert res2.status_code == 200
    data2 = res2.json()
    assert any(o["client_order_id"] == "user_b_order_002" for o in data2)
    assert not any(o["client_order_id"] == "user_a_order_001" for o in data2)


def test_portfolio_notes_account_isolation(client: TestClient, db_session: Session):
    """
    Verifies that notes scoped to Account 1 are isolated from Account 2.
    """
    note1_payload = {
        "account_id": 1,
        "symbol": "TATATECH",
        "tag": "EXIT_STRATEGY",
        "content": "Confidential target: Sell 50% at 1200."
    }
    create_res1 = client.post("/api/v1/portfolio/notes", json=note1_payload)
    assert create_res1.status_code == 201

    note2_payload = {
        "account_id": 2,
        "symbol": "IREDA",
        "tag": "BUY_DIP",
        "content": "Account 2 note: Hold long-term."
    }
    create_res2 = client.post("/api/v1/portfolio/notes", json=note2_payload)
    assert create_res2.status_code == 201

    # Fetch notes filtered by Account 2
    list_res = client.get("/api/v1/portfolio/notes?account_id=2")
    assert list_res.status_code == 200
    notes = list_res.json()
    assert all(n["account_id"] == 2 for n in notes)
    assert not any(n["content"] == "Confidential target: Sell 50% at 1200." for n in notes)


def test_chat_session_isolation(client: TestClient, db_session: Session):
    """
    Verifies that Chat Session A cannot access or leak messages to Chat Session B.
    """
    session_a = "synthetic_session_alpha_123"
    session_b = "synthetic_session_beta_456"

    # User A sends a message in Session A
    msg_a = client.post("/api/v1/chat/message", json={
        "session_id": session_a,
        "message": "What is my portfolio valuation for Family account?"
    })
    assert msg_a.status_code == 200

    # User B queries history for Session B
    hist_b = client.get(f"/api/v1/chat/history?session_id={session_b}")
    assert hist_b.status_code == 200
    assert len(hist_b.json()["messages"]) == 0

    # User B sends a message in Session B
    msg_b = client.post("/api/v1/chat/message", json={
        "session_id": session_b,
        "message": "Show me upcoming IPOs."
    })
    assert msg_b.status_code == 200

    # Verify Session A history contains only Session A messages
    hist_a = client.get(f"/api/v1/chat/history?session_id={session_a}")
    assert hist_a.status_code == 200
    assert len(hist_a.json()["messages"]) >= 2
    assert all(m["session_id"] == session_a for m in hist_a.json()["messages"])
    assert not any("upcoming IPOs" in m["content"] for m in hist_a.json()["messages"])

    # Clear Session B and verify Session A remains intact
    del_res = client.delete(f"/api/v1/chat/history?session_id={session_b}")
    assert del_res.status_code == 204

    hist_a_after = client.get(f"/api/v1/chat/history?session_id={session_a}")
    assert hist_a_after.status_code == 200
    assert len(hist_a_after.json()["messages"]) >= 2


def test_credentials_never_exposed_in_api(client: TestClient):
    """
    Verifies that raw or encrypted credentials (API key, PIN, TOTP secret)
    are strictly absent from all account API responses.
    """
    forbidden_keys = {
        "api_key", "pin", "totp_secret", "encrypted_api_key",
        "encrypted_pin", "encrypted_totp_secret", "password"
    }

    # 1. Accounts list
    res_list = client.get("/api/v1/accounts")
    assert res_list.status_code == 200
    accounts = res_list.json()
    assert len(accounts) > 0
    for acc in accounts:
        keys = set(acc.keys())
        assert keys.isdisjoint(forbidden_keys), f"Exposed forbidden keys: {keys.intersection(forbidden_keys)}"
        assert "masked_client_code" in acc
        assert "***" in acc["masked_client_code"]

    # 2. Account overview
    res_ov = client.get(f"/api/v1/accounts/{accounts[0]['id']}/overview")
    assert res_ov.status_code == 200
    ov_keys = set(res_ov.json().keys())
    assert ov_keys.isdisjoint(forbidden_keys)


def test_unauthenticated_user_access_blocked(unauthenticated_client: TestClient):
    """
    Verifies that requests without valid master authentication cannot access any
    accounts, holdings, notes, notifications, or orders.
    """
    endpoints = [
        ("GET", "/api/v1/accounts"),
        ("GET", "/api/v1/accounts/1/holdings"),
        ("GET", "/api/v1/accounts/1/overview"),
        ("GET", "/api/v1/orders"),
        ("GET", "/api/v1/portfolio/notes"),
        ("GET", "/api/v1/notifications"),
        ("GET", "/api/v1/users"),
    ]

    for method, endpoint in endpoints:
        if method == "GET":
            res = unauthenticated_client.get(endpoint)
        assert res.status_code == 401, f"Endpoint {endpoint} was not blocked: status {res.status_code}"
        assert "UNAUTHORIZED" in res.json().get("detail", "")
