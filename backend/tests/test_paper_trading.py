def test_paper_market_sell_order(client):
    # Account 1 has 30 shares of TATATECH in seed data
    payload = {
        "account_id": 1,
        "tradingsymbol": "TATATECH-EQ",
        "symbol_token": "19326",
        "exchange": "NSE",
        "transaction_type": "SELL",
        "order_type": "MARKET",
        "variety": "NORMAL",
        "quantity": 10,
        "price": 0.0,
        "trigger_price": 0.0
    }
    response = client.post("/api/v1/orders/single", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "EXECUTED"
    assert data["filled_quantity"] == 10
    assert data["is_paper_trade"] is True
    assert data["broker_order_id"].startswith("SIM_")


def test_paper_insufficient_holdings_rejected(client):
    # Account 1 only has 30 shares of TATATECH. Try selling 100 shares.
    payload = {
        "account_id": 1,
        "tradingsymbol": "TATATECH-EQ",
        "symbol_token": "19326",
        "exchange": "NSE",
        "transaction_type": "SELL",
        "order_type": "MARKET",
        "variety": "NORMAL",
        "quantity": 100,
        "price": 0.0,
        "trigger_price": 0.0
    }
    response = client.post("/api/v1/orders/single", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "REJECTED"
    assert "Insufficient holdings" in data["rejection_reason"]


def test_emergency_halt_blocks_orders(client):
    # Activate Emergency Kill Switch
    halt_res = client.post("/api/v1/risk/emergency-halt")
    assert halt_res.status_code == 200
    assert halt_res.json()["emergency_trading_disabled"] is True

    # Attempt to place order while halted
    payload = {
        "account_id": 1,
        "tradingsymbol": "TATATECH-EQ",
        "symbol_token": "19326",
        "exchange": "NSE",
        "transaction_type": "SELL",
        "order_type": "MARKET",
        "variety": "NORMAL",
        "quantity": 5,
        "price": 0.0,
        "trigger_price": 0.0
    }
    try:
        response = client.post("/api/v1/orders/single", json=payload)
        assert response.status_code == 400
        assert "emergency" in response.json()["detail"].lower() or "kill switch" in response.json()["detail"].lower()
    finally:
        # Deactivate Emergency Kill Switch
        client.post("/api/v1/risk/emergency-halt")
