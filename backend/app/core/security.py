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


import urllib.parse
import re


def normalize_base32_secret(secret: str) -> str:
    """
    Normalizes a Base32 secret string safely:
    - Extracts secret parameter if an otpauth:// URI was pasted
    - If already a 6-digit numeric TOTP code, preserves it untouched
    - Strips all whitespace, tabs, newlines, and hyphens
    - Converts to uppercase
    - Does NOT alter valid characters or arbitrarily replace digits
    """
    if not secret:
        return ""
    clean = secret.strip()

    # Check if this is an otpauth URI: otpauth://totp/...secret=XXX...
    if "secret=" in clean.lower():
        try:
            parsed = urllib.parse.urlparse(clean)
            qs = urllib.parse.parse_qs(parsed.query)
            if "secret" in qs and qs["secret"]:
                clean = qs["secret"][0]
        except Exception:
            m = re.search(r"secret=([A-Za-z2-7=]+)", clean, re.IGNORECASE)
            if m:
                clean = m.group(1)

    # Check if this is directly a 6-digit TOTP code
    stripped_digits = clean.replace(" ", "").replace("-", "")
    if stripped_digits.isdigit() and len(stripped_digits) == 6:
        return stripped_digits

    # Standard Base32 clean: strip spaces, hyphens, tabs, newlines, and uppercase
    clean = clean.replace(" ", "").replace("-", "").replace("\t", "").replace("\n", "").replace("\r", "").upper()
    return clean


def generate_totp_token(secret: str, digits: int = 6, interval: int = 30) -> str:
    """
    Generates a current 6-digit TOTP code (RFC 6238) from a base32 TOTP secret.
    - If secret is already a 6-digit code, returns it directly without alteration.
    - Uses pyotp where available, with RFC 6238 HMAC-SHA1 fallback.
    - Ensures proper base32 padding.
    """
    if not secret:
        return ""
    clean_secret = normalize_base32_secret(secret)
    if clean_secret.isdigit() and len(clean_secret) == 6:
        return clean_secret

    try:
        import pyotp
        return pyotp.TOTP(clean_secret, digits=digits, interval=interval).now()
    except Exception:
        pass

    try:
        import struct
        import time
        import hmac
        import hashlib

        # Standard base32 padding
        padded = clean_secret
        missing_padding = len(padded) % 8
        if missing_padding != 0:
            padded += "=" * (8 - missing_padding)

        key = base64.b32decode(padded, casefold=True)
        counter = int(time.time() // interval)
        msg = struct.pack(">Q", counter)
        h = hmac.new(key, msg, hashlib.sha1).digest()
        o = h[19] & 15
        token = (struct.unpack(">I", h[o:o+4])[0] & 0x7fffffff) % (10 ** digits)
        return str(token).zfill(digits)
    except Exception:
        return ""


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

