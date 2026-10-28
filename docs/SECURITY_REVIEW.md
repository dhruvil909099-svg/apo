# IPOPro — Comprehensive Security & Cryptographic Review

This document provides a detailed security architecture review of IPOPro, detailing data encryption at rest and in transit, credential isolation, password hashing, API authentication, and defensive safeguards.

---

## 1. Cryptographic Standards & Key Management

### Symmetric Encryption at Rest (Fernet)
All sensitive broker credentials (Angel One API Key, MPIN, and TOTP Secret) are encrypted prior to database insertion using cryptography's `Fernet` specification:
- **Algorithm:** AES-128 in CBC mode with PKCS7 padding.
- **Message Authentication:** HMAC-SHA256 authenticated encryption using a 128-bit signing key.
- **Key Source:** Controlled via the `APP_ENCRYPTION_KEY` environment variable.
- **Fail-Safe Check:** The system verifies `APP_ENCRYPTION_KEY` on startup. If unconfigured, a deterministic developmental key is generated with an explicit security warning logged.

### User Authentication & Password Hashing
Operator and Administrator passwords for the IPOPro dashboard are hashed with PBKDF2-HMAC-SHA256:
- **Algorithm:** PBKDF2 with HMAC-SHA256 pseudo-random function.
- **Iterations:** 100,000 rounds.
- **Salt:** Cryptographically secure 16-byte random salt per user (`os.urandom(16)`).
- **Comparison:** Constant-time comparison using `hmac.compare_digest` to prevent timing attacks.
- **Exposure:** Password hashes and salts are excluded from all Pydantic response models (`UserResponse`, `UserListResponse`).

---

## 2. Angel One SmartAPI Credential Isolation

### Separation of TOTP Secret vs Temporary 6-Digit OTP
A common vulnerability in broker integrations is conflating the permanent Base32 TOTP Secret with the transient 6-digit OTP generated from it:
1. **Permanent Secret:**
   - Base32 encoded string (typically 16-32 alphanumeric characters, e.g. `JBSWY3DPEHPK3PXP`).
   - Cleaned via `re.sub(r'[^A-Z2-7]', '', raw_secret.upper())`.
   - Supports `otpauth://totp/...` URI ingestion with regex extraction.
2. **Transient OTP Code:**
   - 6-digit numeric token generated dynamically per 30-second window via `pyotp.TOTP(secret).now()`.
   - Never stored permanently in the database.
3. **Error Handling (`AB1050`):**
   - If Angel One returns code `AB1050` ("Invalid TOTP and client combination"), the system distinguishes between invalid MPIN/Client Code vs clock drift/improper secret padding, logging a non-sensitive diagnostic advisory.

---

## 3. Secret Redaction & Audit Integrity

### Masking in REST APIs
- All Demat client codes are masked in non-administrative view contexts (`DEMO****01`).
- API keys, PINs, and TOTP secrets are excluded from database queries serving client responses.

### Sanitized Audit Trails
The `sanitize_dict_for_logging()` function recursively inspects all objects before writing to `AuditLog` or server logs:
- Any dictionary key matching `*key*`, `*secret*`, `*pin*`, `*mpin*`, `*password*`, `*token*`, or `*auth*` is replaced with `[REDACTED]`.

---

## 4. Operational Defense Mechanisms

1. **API Rate Limiting:**
   - Implemented via `rate_limit_orders` dependency to throttle rapid repeated requests (30 requests/min).
2. **Emergency Kill Switch:**
   - Stored in the `RiskLimit` entity. When toggled by an administrator, the `emergency_trading_disabled` flag terminates all subsequent order requests before execution.
3. **Single Active Admin Guard:**
   - `DELETE /api/v1/users/{id}` checks the count of active administrators. Deleting the last active admin is rejected with an HTTP 400 Bad Request to prevent permanent lockout.
