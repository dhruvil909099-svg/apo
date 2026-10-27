def test_get_and_update_risk_limits(client):
    get_res = client.get("/api/v1/risk")
    assert get_res.status_code == 200
    risk = get_res.json()
    assert risk["max_order_value"] == 500000.0

    update_payload = {
        "max_order_value": 750000.0,
        "max_quantity_per_order": 8000,
        "stop_loss_percent": 7.5
    }
    put_res = client.put("/api/v1/risk", json=update_payload)
    assert put_res.status_code == 200
    updated = put_res.json()
    assert updated["max_order_value"] == 750000.0
    assert updated["max_quantity_per_order"] == 8000
    assert updated["stop_loss_percent"] == 7.5


def test_dashboard_summary_kpi(client):
    res = client.get("/api/v1/audit/summary")
    assert res.status_code == 200
    summary = res.json()
    assert summary["total_accounts"] >= 5
    assert summary["total_ipos_monitored"] >= 4
    assert summary["trading_mode"] == "PAPER"
    assert summary["total_portfolio_value"] > 0
