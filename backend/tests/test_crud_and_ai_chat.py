import pytest
from app.models.user import User
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.services.portfolio_sync_service import reconcile_broker_holdings
from datetime import datetime


def test_user_crud_and_admin_protection(client):
    # 1. Create first admin user
    admin_payload = {
        "username": "superadmin_crud",
        "email": "superadmin_crud@ipopro.internal",
        "password": "SuperSecretPassword123!",
        "role": "ADMIN"
    }
    res = client.post("/api/v1/users", json=admin_payload)
    assert res.status_code == 201, res.text
    admin_data = res.json()
    assert admin_data["username"] == "superadmin_crud"
    assert admin_data["role"] == "ADMIN"
    admin_id = admin_data["id"]
    # Ensure password hash is not exposed
    assert "password" not in admin_data
    assert "password_hash" not in admin_data

    # 2. Create regular user
    user_payload = {
        "username": "analyst1",
        "email": "analyst1@ipopro.internal",
        "password": "AnalystPassword456!",
        "role": "USER"
    }
    res = client.post("/api/v1/users", json=user_payload)
    assert res.status_code == 201
    user_id = res.json()["id"]

    # 3. List users
    res = client.get("/api/v1/users")
    assert res.status_code == 200
    users = res.json()
    assert len(users) >= 2

    # 4. Update user
    update_payload = {"email": "senior_analyst@ipopro.internal"}
    res = client.put(f"/api/v1/users/{user_id}", json=update_payload)
    assert res.status_code == 200
    assert res.json()["email"] == "senior_analyst@ipopro.internal"

    # 5. Delete regular user - should succeed with 204
    res = client.delete(f"/api/v1/users/{user_id}")
    assert res.status_code == 204

    # 6. Delete created admin - succeeds with 204 because default admin still exists
    res = client.delete(f"/api/v1/users/{admin_id}")
    assert res.status_code == 204

    # 7. Admin protection - deleting the last remaining active administrator should fail with 400
    res = client.delete("/api/v1/users/1")
    assert res.status_code == 400
    assert "Cannot delete the last remaining active administrator" in res.json()["detail"]


def test_watchlist_crud(client):
    # 1. Create watchlist
    wl_payload = {
        "name": "High Beta IPOs",
        "description": "Watchlist for high volatility recent listings"
    }
    res = client.post("/api/v1/watchlists", json=wl_payload)
    assert res.status_code == 201, res.text
    wl = res.json()
    wl_id = wl["id"]
    assert wl["name"] == "High Beta IPOs"

    # 2. Add item to watchlist
    item_payload = {
        "symbol": "TATATECH",
        "company_name": "Tata Technologies Ltd",
        "exchange": "NSE",
        "symbol_token": "19326",
        "notes": "Monitor listing day support"
    }
    res = client.post(f"/api/v1/watchlists/{wl_id}/items", json=item_payload)
    assert res.status_code == 201, res.text
    item = res.json()
    item_id = item["id"]
    assert item["symbol"] == "TATATECH"

    # 3. Get watchlist details
    res = client.get(f"/api/v1/watchlists/{wl_id}")
    assert res.status_code == 200
    fetched_wl = res.json()
    assert len(fetched_wl["items"]) == 1
    assert fetched_wl["items"][0]["symbol"] == "TATATECH"

    # 4. Remove item from watchlist
    res = client.delete(f"/api/v1/watchlists/{wl_id}/items/{item_id}")
    assert res.status_code == 204

    # 5. Delete entire watchlist
    res = client.delete(f"/api/v1/watchlists/{wl_id}")
    assert res.status_code == 204


def test_portfolio_notes_and_tags_crud(client):
    # 1. Create note
    note_payload = {
        "account_id": 1,
        "symbol": "TATATECH",
        "tag": "HOLD_LONG_TERM",
        "content": "Strong ER&D pipeline, keep holding through FY26."
    }
    res = client.post("/api/v1/portfolio/notes", json=note_payload)
    assert res.status_code == 201, res.text
    note = res.json()
    note_id = note["id"]
    assert note["tag"] == "HOLD_LONG_TERM"
    assert note["symbol"] == "TATATECH"

    # 2. Filter notes by tag
    res = client.get("/api/v1/portfolio/notes?tag=HOLD_LONG_TERM")
    assert res.status_code == 200
    notes = res.json()
    assert len(notes) >= 1
    assert notes[0]["tag"] == "HOLD_LONG_TERM"

    # 3. Update note
    update_payload = {
        "content": "Updated thesis: quarterly margins expanding."
    }
    res = client.put(f"/api/v1/portfolio/notes/{note_id}", json=update_payload)
    assert res.status_code == 200
    assert res.json()["content"] == "Updated thesis: quarterly margins expanding."

    # 4. Delete note
    res = client.delete(f"/api/v1/portfolio/notes/{note_id}")
    assert res.status_code == 204


def test_notifications_crud(client):
    # 1. Create notification
    notif_payload = {
        "title": "Margin Call Advisory",
        "message": "DEMO_SELF01 available cash is at 250,000 INR",
        "notification_type": "INFO",
        "severity": "NORMAL"
    }
    res = client.post("/api/v1/notifications", json=notif_payload)
    assert res.status_code == 201, res.text
    notif = res.json()
    notif_id = notif["id"]
    assert notif["is_read"] is False

    # 2. List unread
    res = client.get("/api/v1/notifications?unread_only=true")
    assert res.status_code == 200
    unread = res.json()
    assert any(n["id"] == notif_id for n in unread)

    # 3. Mark read
    res = client.post(f"/api/v1/notifications/{notif_id}/read")
    assert res.status_code == 200
    assert res.json()["is_read"] is True

    # 4. Delete notification
    res = client.delete(f"/api/v1/notifications/{notif_id}")
    assert res.status_code == 204


def test_paper_trading_buy_flow_and_cash_verification(client, db_session):
    # Initial state: Account 1 has 250,000 cash
    acc = db_session.query(Account).filter(Account.id == 1).first()
    initial_cash = acc.available_cash
    assert initial_cash == 250000.0

    # Place a paper BUY order for 10 shares of TATATECH with limit price 1050.0 (above LTP 1042.80, so executes immediately)
    order_payload = {
        "account_id": 1,
        "tradingsymbol": "TATATECH-EQ",
        "symbol_token": "19326",
        "transaction_type": "BUY",
        "exchange": "NSE",
        "order_type": "LIMIT",
        "variety": "NORMAL",
        "price": 1050.0,
        "quantity": 10
    }
    res = client.post("/api/v1/orders/single", json=order_payload)
    assert res.status_code == 201, res.text
    order = res.json()
    assert order["status"] == "EXECUTED"
    assert order["filled_quantity"] == 10
    assert order["execution_price"] == 1050.0

    # Refresh account from db and check cash balance deduction
    db_session.refresh(acc)
    assert acc.available_cash == initial_cash - (10 * 1050.0)

    # Check holding was created or updated in Allotment
    allotment = db_session.query(Allotment).join(IPO).filter(
        Allotment.account_id == 1,
        IPO.symbol == "TATATECH"
    ).first()
    assert allotment is not None
    assert allotment.allotted_quantity >= 10

    # Try order exceeding cash balance: 450,000 > available cash -> Order rejected
    excess_payload = {
        "account_id": 1,
        "tradingsymbol": "TATATECH-EQ",
        "symbol_token": "19326",
        "transaction_type": "BUY",
        "exchange": "NSE",
        "order_type": "LIMIT",
        "variety": "NORMAL",
        "price": 4500.0,
        "quantity": 100
    }
    res = client.post("/api/v1/orders/single", json=excess_payload)
    assert res.status_code == 201
    excess_order = res.json()
    assert excess_order["status"] == "REJECTED"
    assert "Insufficient simulated cash balance" in excess_order["rejection_reason"]


def test_ai_chat_assistant_flow(client):
    # 1. Post a query to the AI chat assistant
    session_id = "test_audit_session_001"
    chat_payload = {
        "session_id": session_id,
        "message": "What is the total value and risk exposure of my current portfolio?"
    }
    res = client.post("/api/v1/chat/message", json=chat_payload)
    assert res.status_code == 200, res.text
    chat_resp = res.json()
    assert "content" in chat_resp
    assert len(chat_resp["content"]) > 0

    # Verify context meta does NOT leak secrets
    meta = chat_resp.get("context_meta", {})
    meta_str = str(meta).lower()
    assert "totp_secret" not in meta_str
    assert "pin" not in meta_str
    assert "password" not in meta_str
    assert "jwt_token" not in meta_str

    # 2. Get chat history
    res = client.get(f"/api/v1/chat/history?session_id={session_id}")
    assert res.status_code == 200
    history = res.json()
    assert len(history["messages"]) >= 2  # At least user message + assistant response

    # 3. Clear chat history
    res = client.delete(f"/api/v1/chat/history?session_id={session_id}")
    assert res.status_code == 204


def test_broker_holdings_reconciliation(db_session):
    account = db_session.query(Account).filter(Account.id == 1).first()
    sync_time = datetime.utcnow()

    # Case 1: Initial holdings from broker
    mock_broker_holdings = [
        {
            "tradingsymbol": "TATATECH-EQ",
            "symboltoken": "19326",
            "isin": "INE142M01025",
            "exchange": "NSE",
            "quantity": 30,
            "averageprice": 500.0,
            "ltp": 1042.80,
            "pnl": 16284.0
        },
        {
            "tradingsymbol": "NEWSTOCK-EQ",
            "symboltoken": "99999",
            "isin": "INE999999999",
            "exchange": "NSE",
            "quantity": 50,
            "averageprice": 100.0,
            "ltp": 120.0,
            "pnl": 1000.0
        }
    ]

    valid_count = reconcile_broker_holdings(db_session, account, mock_broker_holdings, sync_time)
    assert valid_count == 2

    from app.models.holding import AccountHoldingSnapshot

    # Check holdings exist
    tatatech = db_session.query(AccountHoldingSnapshot).filter(
        AccountHoldingSnapshot.account_id == account.id,
        AccountHoldingSnapshot.symbol == "TATATECH"
    ).first()
    assert tatatech is not None
    assert tatatech.quantity == 30

    newstock = db_session.query(AccountHoldingSnapshot).filter(
        AccountHoldingSnapshot.account_id == account.id,
        AccountHoldingSnapshot.symbol == "NEWSTOCK"
    ).first()
    assert newstock is not None
    assert newstock.quantity == 50

    # Case 2: Broker reports that NEWSTOCK was sold (not in holdings response)
    mock_sold_holdings = [
        {
            "tradingsymbol": "TATATECH-EQ",
            "symboltoken": "19326",
            "isin": "INE142M01025",
            "exchange": "NSE",
            "quantity": 30,
            "averageprice": 500.0,
            "ltp": 1045.0,
            "pnl": 16350.0
        }
    ]
    reconcile_broker_holdings(db_session, account, mock_sold_holdings, datetime.utcnow())

    # NEWSTOCK snapshot must now be zeroed out
    db_session.refresh(newstock)
    assert newstock.quantity == 0
