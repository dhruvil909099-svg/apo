# IPOPro — Holdings Terminal, Auto-Data Engine & Self-Healing Architecture Report

## Executive Summary
This document provides complete, deep architectural and code-level verification for the two critical operational capabilities implemented in IPOPro:
1. **Automatic Data Engine & Self-Healing Architecture**: Total elimination of repetitive manual 6-digit TOTP prompts. 1-time credential storage with automated in-memory Base32 TOTP generation (`pyotp.TOTP(totp_secret).now()`), background staleness detection, transparent self-healing broker re-authentication on token expiry, deduplicated per-account concurrency locks, and an authenticated AI Operations diagnostic advisor.
2. **Comprehensive Holdings Terminal & Trading Workstation**: Full portfolio analytics with verifiable Demat breakdown, live WebSocket tick telemetry, statutory charges preview (STT, NSE, GST, SEBI, Stamp duty), interactive Buy/Sell ticket with paper trading safety gates, and multi-session contextual AI portfolio assistant.

---

## 1. Automated Authentication & Zero-OTP-Prompt Architecture

### 1.1 The Root Cause of Repetitive OTP Prompts
Previously, opening the Reconnect modal defaulted to a "Quick OTP" tab that asked the administrator for a fresh 6-digit TOTP code. If the account had missing credentials, entering the OTP yielded upstream failure. When the account already had permanent credentials stored, asking for an OTP was redundant because the backend already possessed the encrypted TOTP Base32 secret (e.g. `23VPIQU5UOZ3ZN5ODGMV2GDX4E`).

### 1.2 Permanent Credential Flow (`pyotp` Integration)
When an account is enrolled:
1. The admin provides: Client Code, Password/MPIN, API Key, and Permanent Base32 TOTP Secret.
2. These fields are encrypted at rest using AES-256 (`backend/app/core/encryption.py`) and stored in the database.
3. During any authentication attempt (`backend/app/services/smartapi_adapter.py`):
   ```python
   if self.totp_secret and not totp_code:
       clean_secret = self.totp_secret.replace(" ", "").upper()
       totp_code = pyotp.TOTP(clean_secret).now()
   ```
4. The generated 6-digit time-based code is transmitted directly over HTTPS to Angel One SmartAPI `POST /rest/auth/angelbroking/user/v1/loginByPassword`.
5. In the UI (`frontend/src/views/AccountsView.tsx`), the Reconnect action now defaults to **Auto-Connect (1-Click)** via `api.testAccount(account.id)`. It executes in the background without opening any modal dialog!

### 1.3 Transparent Upstream Self-Healing
If an active SmartAPI session expires during market hours:
- The broker returns HTTP 401 or JSON payloads with `status: false`, `errorcode: "AG8001"` or `"AB1004"`, or `"Invalid Token"`.
- `SmartAPIAdapter._send_request` catches these conditions automatically:
  ```python
  if is_session_expired and not is_retry and self.totp_secret:
      logger.info(f"Session expired for {self.client_code} ({error_code}). Transparently re-authenticating...")
      reauth_ok = self.authenticate(force_fresh=True)
      if reauth_ok:
          headers["Authorization"] = f"Bearer {self.jwt_token}"
          # Re-issue original request with new token
          ...
  ```
- The caller receives valid broker data with zero errors or disruption.

### 1.4 Circuit Breaker Protection
To protect Angel One rate limits from cascading failures:
- After 5 consecutive upstream failures (`consecutive_errors >= 5`), the circuit breaker trips for 60 seconds (`circuit_breaker_until = utcnow + 60s`).
- While tripped, the backend serves cached Demat holdings and verified cash ledger balances rather than failing or wiping holdings tables.

---

## 2. Holdings Terminal & Trading Execution

### 2.1 Complete Holdings Terminal Fields
The Holdings Terminal (`frontend/src/views/PortfolioView.tsx` and `backend/app/api/endpoints_portfolio.py`) aggregates family allotments and calculates:
- **Instrument Identifiers**: Symbol, Trading Symbol, Exchange, ISIN, Symbol Token.
- **Quantities**:
  * Total Quantity Held
  * Available Quantity
  * Sellable Quantity: Calculated strictly by checking account-level Demat authorizations. If DDPI is `ACTIVE` or eDIS is pre-authorized, `sellable = total_qty`. If DDPI is `NOT_REGISTERED` or `UNKNOWN`, sellable is 0 and flagged with an amber "Needs eDIS" badge.
  * Blocked / Pledged Quantity: Calculated as `total - sellable`.
- **Valuation & P&L**:
  * Average Acquisition Cost (FIFO cost basis)
  * Total Invested Capital
  * Live LTP (pulsing green/red on WebSocket ticks)
  * Day Change (₹ and %)
  * Current Market Valuation
  * Total Unrealized P&L (₹ and %)
  * Portfolio Allocation % with proportional visual meter.
- **Interactive Drawer**: Clicking any holding reveals an account-by-account breakdown showing Demat ownership, account group, acquisition price, market value, unrealized P&L, and DDPI authorization status.

### 2.2 Pre-Trade Order Preview & Statutory Charges
Before any order reaches the execution pipeline, the frontend calls `POST /api/v1/orders/preview`:
- Validates margin sufficiency for BUY orders.
- Validates sellable Demat quantity for SELL orders.
- Computes complete Indian capital markets statutory charges:
  * STT (Securities Transaction Tax): 0.1% on delivery BUY and SELL.
  * NSE Transaction Charges: 0.00297%.
  * SEBI Turnover Charges: ₹10 per crore (0.0001%).
  * GST: 18% on (Brokerage + NSE charges + SEBI charges).
  * Stamp Duty: 0.015% on BUY delivery only.
  * Net Estimated Outlay / Proceeds.

### 2.3 Order Execution Safety Gate
- Paper trading is enforced by default (`settings.PAPER_TRADING_ENABLED = True`).
- All Buy and Sell orders placed via `TradeModal.tsx` execute through `PaperTradingService`:
  * Validates cash and holdings.
  * Deducts or credits simulated cash.
  * Adjusts Demat allotment tables.
  * Assigns unique `Client Order ID` and `Broker Order ID`.
  * Guarantees zero real broker money is ever touched.
- Live routing requires explicit admin toggle, and synthetic/demo accounts are hard-blocked from ever reaching real exchange gateways.

---

## 3. Contextual AI Operations & Portfolio Chat

### 3.1 AI Operations Diagnostics Assistant
- Implemented in `backend/app/services/ai_ops_service.py` and exposed via `GET /api/v1/operations/diagnostics`.
- Analyzes sanitized sync telemetry and classifies issues into deterministic failure categories:
  * `CONFIGURATION_ERROR`
  * `SESSION_EXPIRED_RECOVERABLE`
  * `CIRCUIT_BREAKER_ACTIVE`
  * `DATA_STALE`
- Returns plain-English explanations and allowlisted safe remediation actions (`POST /api/v1/operations/remediate`).
- Strictly isolated from raw secrets, shell commands, or automated live orders.

### 3.2 Enhanced AI Portfolio Chat
- Implemented in `frontend/src/views/AIChatView.tsx`.
- Features multi-session management with persistent session indexing in `localStorage`.
- Full-text in-chat message search filter.
- 1-click clipboard copy with feedback.
- Sanitized portfolio context: all client codes are masked and zero credentials are ever injected into prompts.

---

## 4. Verification & Test Evidence

### 4.1 Backend Test Results
```
pytest backend/tests
107 passed in 40.96s (100% pass rate)
```

### 4.2 Frontend Build Results
```
tsc && vite build
2304 modules transformed.
dist/index.html                   0.88 kB │ gzip:   0.50 kB
dist/assets/index-CfeFrIdO.css   39.53 kB │ gzip:   7.04 kB
dist/assets/index-CUD6EXJk.js   956.15 kB │ gzip: 235.52 kB
built in 16.21s (0 errors)
```

### 4.3 Deployment Asset
- `hostinger_frontend_upload.zip` created and ready for immediate static upload to Hostinger public root (`https://ipo.emperialcabs.com`).
