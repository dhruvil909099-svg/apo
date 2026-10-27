def test_bulk_order_prepare_and_execute(client):
    # Tata Tech (IPO id 1) is allotted to Account 1 (30 shares) and Account 2 (30 shares)
    prep_payload = {
        "ipo_id": 1,
        "tradingsymbol": "TATATECH-EQ",
        "symbol_token": "19326",
        "exchange": "NSE",
        "order_type": "LIMIT",
        "price": 1050.0,
        "trigger_price": 0.0,
        "accounts": [
            {"account_id": 1, "quantity": 15, "price_override": None},
            {"account_id": 2, "quantity": 20, "price_override": None}
        ]
    }
    prep_res = client.post("/api/v1/orders/bulk-prepare", json=prep_payload)
    assert prep_res.status_code == 200
    preview = prep_res.json()
    assert preview["is_executable"] is True
    assert preview["total_accounts"] == 2
    assert preview["total_quantity"] == 35
    batch_id = preview["batch_id"]

    # Test Execution without confirmation fails
    fail_exec = client.post("/api/v1/orders/bulk-execute", json={"batch_id": batch_id, "operator_confirmed": False})
    assert fail_exec.json()["success"] is False

    # Execute with operator confirmation
    exec_res = client.post("/api/v1/orders/bulk-execute", json={"batch_id": batch_id, "operator_confirmed": True})
    assert exec_res.status_code == 200
    data = exec_res.json()
    assert data["total_submitted"] == 2
    assert data["successful_count"] == 2
    assert data["failed_count"] == 0
    assert len(data["results"]) == 2
