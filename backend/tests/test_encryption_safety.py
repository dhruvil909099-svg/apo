import os
import pytest
from pydantic import ValidationError
from app.core.security import SecretCipher, sanitize_dict_for_logging, generate_totp_token, normalize_base32_secret
from app.core.config import Settings


def test_encryption_fails_closed_on_invalid_key():
    """
    Verifies that SecretCipher fails closed and raises ValueError when provided with an invalid key.
    """
    # 1. Invalid non-base64 key
    with pytest.raises(ValueError) as exc1:
        SecretCipher(key="not-a-valid-fernet-key")
    assert "Invalid APP_ENCRYPTION_KEY provided" in str(exc1.value)

    # 2. Too short key
    with pytest.raises(ValueError) as exc2:
        SecretCipher(key="c2hvcnQ=")
    assert "Invalid APP_ENCRYPTION_KEY provided" in str(exc2.value)


def test_encryption_fails_closed_when_key_missing(monkeypatch):
    """
    Verifies that Settings fails closed with a ValidationError if APP_ENCRYPTION_KEY is omitted.
    """
    # Clear environment variables
    monkeypatch.delenv("APP_ENCRYPTION_KEY", raising=False)

    with pytest.raises(ValidationError):
        # Must fail because APP_ENCRYPTION_KEY has no default and is required Field(...)
        Settings(_env_file=None)


def test_cipher_roundtrip_and_tamper_resistance():
    """
    Verifies authenticated symmetric encryption and tamper detection.
    """
    valid_key = "UOq2vBkYP1PnplztDgeVbfI3UTQvdREy-EsbYI0g3C4="
    cipher = SecretCipher(key=valid_key)

    plaintext = "SuperSecretBrokerPassword2026!"
    ciphertext = cipher.encrypt(plaintext)
    assert ciphertext != plaintext

    decrypted = cipher.decrypt(ciphertext)
    assert decrypted == plaintext

    # Tampered ciphertext fails closed
    tampered = ciphertext[:-4] + "AAAA"
    with pytest.raises(Exception):
        cipher.decrypt(tampered)


def test_totp_normalization_and_generation():
    """
    Verifies RFC 6238 TOTP computation and secret normalization from otpauth URLs.
    """
    raw_otpauth = "otpauth://totp/AngelOne:AAAD986778?secret=JBSWY3DPEHPK3PXP&issuer=AngelOne"
    clean = normalize_base32_secret(raw_otpauth)
    assert clean == "JBSWY3DPEHPK3PXP"

    code = generate_totp_token(clean)
    assert len(code) == 6
    assert code.isdigit()


def test_sensitive_field_redaction():
    """
    Verifies that all credential fields are recursively redacted from audit logs.
    """
    sample_payload = {
        "client_code": "AAAD986778",
        "api_key": "raw_smartapi_secret_key",
        "pin": "1234",
        "totp_secret": "JBSWY3DPEHPK3PXP",
        "nested": {
            "jwtToken": "eyJhbGciOi...",
            "refreshToken": "ref_12345",
            "safe_metric": 42
        }
    }
    sanitized = sanitize_dict_for_logging(sample_payload)
    assert sanitized["api_key"] == "[REDACTED]"
    assert sanitized["pin"] == "[REDACTED]"
    assert sanitized["totp_secret"] == "[REDACTED]"
    assert sanitized["nested"]["jwtToken"] == "[REDACTED]"
    assert sanitized["nested"]["refreshToken"] == "[REDACTED]"
    assert sanitized["nested"]["safe_metric"] == 42
