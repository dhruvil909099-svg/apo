def test_list_accounts(client):
    response = client.get("/api/v1/accounts")
    assert response.status_code == 200
    data = response.json()
    assert len(data) >= 5
    # Verify client ID is masked in response
    first_acc = data[0]
    assert "***" in first_acc["masked_client_code"]
    assert "pin" not in first_acc
    assert "encrypted_pin" not in first_acc


def test_create_account(client):
    payload = {
        "nickname": "Test Uncle Demat",
        "client_code": "UNCLE9988",
        "account_group": "Family",
        "api_key": "LIVE_API_KEY_999",
        "pin": "9999",
        "totp_secret": "JBSWY3DPEHPK3PXP",
        "is_demo": False
    }
    response = client.post("/api/v1/accounts", json=payload)
    assert response.status_code == 201
    data = response.json()
    assert data["nickname"] == "Test Uncle Demat"
    assert data["masked_client_code"] == "U***988"
    assert "pin" not in data


def test_duplicate_account_rejected(client):
    payload = {
        "nickname": "Self Demat Duplicate",
        "client_code": "DEMO_SELF01",  # Already in seed data
        "account_group": "Family",
        "api_key": "KEY123",
        "pin": "1234",
        "totp_secret": "JBSWY3DPEHPK3PXP",
        "is_demo": True
    }
    response = client.post("/api/v1/accounts", json=payload)
    assert response.status_code == 400
    assert "already exists" in response.json()["detail"]


def test_test_account_connection(client):
    # Test on seeded demo account
    response = client.post("/api/v1/accounts/1/test")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["auth_status"] == "CONNECTED"


def test_update_account_partial_fields_without_rotation(client):
    # Updating nickname or group without touching credentials should succeed without UnboundLocalError
    response = client.put("/api/v1/accounts/1", json={"nickname": "Updated Demo Profile"})
    assert response.status_code == 200
    assert response.json()["nickname"] == "Updated Demo Profile"


def test_update_account_rotate_credentials(client):
    # Rotate demo account credentials
    response = client.put("/api/v1/accounts/1", json={
        "client_code": "DEMO_SELF01_NEW",
        "api_key": "NEW_DEMO_KEY",
        "pin": "5678",
        "totp_secret": "JBSWY3DPEHPK3PXP"
    })
    assert response.status_code == 200
    assert response.json()["masked_client_code"] == "D***NEW"
