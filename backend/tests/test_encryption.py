from app.core.security import cipher, mask_client_id, generate_totp_token, sanitize_dict_for_logging


def test_encryption_roundtrip():
    secret = "TopSecretPassword123!"
    encrypted = cipher.encrypt(secret)
    assert encrypted != secret
    assert len(encrypted) > len(secret)
    decrypted = cipher.decrypt(encrypted)
    assert decrypted == secret


def test_mask_client_id():
    assert mask_client_id("A1234567") == "A***567"
    assert mask_client_id("DEMO_CLI_01") == "D***_01"
    assert mask_client_id("X99") == "X***"
    assert mask_client_id("") == ""


def test_generate_totp_token():
    # Standard base32 test key (JBSWY3DPEHPK3PXP)
    totp = generate_totp_token("JBSWY3DPEHPK3PXP")
    assert len(totp) == 6
    assert totp.isdigit()


def test_sanitize_dict_for_logging():
    raw_log = {
        "client_code": "A1234567",
        "pin": "1234",
        "totp_secret": "JBSWY3DPEHPK3PXP",
        "order": {
            "jwtToken": "eyJhbGciOi...",
            "symbol": "TATATECH",
            "quantity": 30
        }
    }
    sanitized = sanitize_dict_for_logging(raw_log)
    assert sanitized["client_code"] == "A1234567"
    assert sanitized["pin"] == "[REDACTED]"
    assert sanitized["totp_secret"] == "[REDACTED]"
    assert sanitized["order"]["jwtToken"] == "[REDACTED]"
    assert sanitized["order"]["symbol"] == "TATATECH"
    assert sanitized["order"]["quantity"] == 30
