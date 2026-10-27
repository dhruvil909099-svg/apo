import base64
import json
from typing import Any, Dict
from cryptography.fernet import Fernet
from app.core.config import settings


class SecretCipher:
    """
    AES-256 field-level encryption handler for sensitive credentials (PIN, TOTP seed, API key).
    Uses Fernet (AES-128-CBC + HMAC-SHA256 authenticated symmetric encryption).
    """
    def __init__(self, key: str = None):
        self.key = key or settings.APP_ENCRYPTION_KEY
        try:
            self.cipher = Fernet(self.key.encode() if isinstance(self.key, str) else self.key)
        except Exception as e:
            raise ValueError(f"Invalid APP_ENCRYPTION_KEY provided: {str(e)}")

    def encrypt(self, plain_text: str) -> str:
        if not plain_text:
            return ""
        encrypted_bytes = self.cipher.encrypt(plain_text.encode("utf-8"))
        return encrypted_bytes.decode("utf-8")

    def decrypt(self, cipher_text: str) -> str:
        if not cipher_text:
            return ""
        decrypted_bytes = self.cipher.decrypt(cipher_text.encode("utf-8"))
        return decrypted_bytes.decode("utf-8")


cipher = SecretCipher()


def mask_client_id(client_id: str) -> str:
    """
    Masks client ID for safe frontend presentation.
    Example: 'A1234567' -> 'A***567'
             'DEMO01' -> 'D***01'
    """
    if not client_id:
        return ""
    clean = client_id.strip()
    if len(clean) <= 4:
        return clean[0] + "***"
    return f"{clean[:1]}***{clean[-3:]}"


SENSITIVE_KEYS = {
    "password", "pin", "totp", "totp_secret", "totp_key", "secret",
    "api_key", "private_key", "jwttoken", "refreshtoken", "feedtoken",
    "auth_token", "access_token"
}


def generate_totp_token(secret: str, digits: int = 6, interval: int = 30) -> str:
    """
    Generates a current 6-digit TOTP code (RFC 6238) from a base32 TOTP secret.
    Works independently using standard library hmac/hashlib, with pyotp fallback.
    """
    if not secret:
        return ""
    try:
        import pyotp
        return pyotp.TOTP(secret).now()
    except Exception:
        import struct
        import time
        import hmac
        import hashlib
        
        # Strip spaces and ensure padding
        clean_secret = secret.replace(" ", "").upper()
        missing_padding = len(clean_secret) % 8
        if missing_padding != 0:
            clean_secret += "=" * (8 - missing_padding)
            
        key = base64.b32decode(clean_secret, casefold=True)
        counter = int(time.time() // interval)
        msg = struct.pack(">Q", counter)
        h = hmac.new(key, msg, hashlib.sha1).digest()
        o = h[19] & 15
        token = (struct.unpack(">I", h[o:o+4])[0] & 0x7fffffff) % (10 ** digits)
        return str(token).zfill(digits)


def sanitize_dict_for_logging(data: Any) -> Any:
    """
    Recursively redacts sensitive keys from dictionaries or lists before audit logging.
    """
    if isinstance(data, dict):
        sanitized = {}
        for k, v in data.items():
            if str(k).lower() in SENSITIVE_KEYS:
                sanitized[k] = "[REDACTED]"
            else:
                sanitized[k] = sanitize_dict_for_logging(v)
        return sanitized
    elif isinstance(data, list):
        return [sanitize_dict_for_logging(item) for item in data]
    return data

