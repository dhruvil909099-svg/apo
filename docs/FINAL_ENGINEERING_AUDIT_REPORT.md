# IPOPro — Final Independent Verification & Release Gate Audit Report

**Application:** IPOPro (Multi-Account Angel One SmartAPI Dashboard)  
**Date:** October 28, 2026  
**Auditor:** Senior Full-Stack & Financial Platform QA Team  
**Repository:** [https://github.com/dhruvil909099-svg/apo](https://github.com/dhruvil909099-svg/apo)  
**Branch:** `main`  
**Latest Git HEAD:** `75982ec` (Prior commit) -> Final verification release commit pending  
**Overall Decision:** **READY FOR STAGING ONLY**  
*(Live production release is BLOCKED pending migration to managed PostgreSQL and operator API key rotation)*

---

## 1. Executive Summary

This report delivers the final independent release gate audit for IPOPro. Every feature, database configuration, security guardrail, error-handling mechanism, and paper-trading path was subjected to direct source code inspection, live read-only verification, and automated regression testing.

### Key Verification Metrics
- **Backend Automated Test Suite:** **102 / 102 Tests Passed (100%)** in 25.73s.
- **Frontend TypeScript / Vite Build:** **0 Type Errors, 0 Build Errors** in 11.38s.
- **Production Bundle Artifact:** `hostinger_frontend_upload.zip` (236,592 bytes) updated with latest asset hashes (`index-rjnXfoi-.js`, `index-BpNjkYn9.css`, `.htaccess`).
- **Render Production Backend:** Verified live at `https://apo-wubq.onrender.com/api/v1/health/ready` (Running in `PAPER` mode on `sqlite` with `EPHEMERAL_LOCAL` storage).

---

## 2. Release Gate Decision

```
================================================================================
FINAL RELEASE GATE DECISION: READY FOR STAGING ONLY
================================================================================
[✓] STAGING STATUS: READY FOR OPERATOR EVALUATION & PAPER TRADING
[!] PRODUCTION STATUS: BLOCKED — CRITICAL PRODUCTION BLOCKERS IDENTIFIED BELOW
================================================================================
```

### Critical Release Blockers for Live Production
1. **Durable Database Persistence (Requirement 6 Blocker):**
   - **Verification:** Direct query to `https://apo-wubq.onrender.com/api/v1/health/ready` confirmed:
     `{"status":"READY","database_engine":"sqlite","storage_type":"EPHEMERAL_LOCAL","trading_mode":"PAPER"}`
   - **Risk:** Render free/standard Web Services run on ephemeral container disks. Local SQLite files (`angel_dashboard.db`) are lost on restart, crash, or redeployment. Although JSON snapshot backup logic exists (`accounts_backup.json`), snapshots do not guarantee atomic point-in-time recovery for financial orders.
   - **Required Remediation:** Production persistence is classified as **BLOCKED** until a managed PostgreSQL instance (e.g., Render Managed PostgreSQL or Supabase) is provisioned, `DATABASE_URL` is configured, and a disaster recovery restore test is verified.
2. **Operator SmartAPI Application Key Rotation:**
   - **Verification:** The live production Demat account `dhruvil` (`AAAD986778`) was originally seeded with a placeholder key. Downstream broker endpoints rejected requests with `AG8004 Invalid API Key`.
   - **Required Remediation:** The operator must click **"Rotate Credentials"** in the dashboard and input their official 32-character API key from [smartapi.angelbroking.com](https://smartapi.angelbroking.com), 4-digit Account PIN, and Base32 TOTP secret.

---

## 3. Claim-by-Claim Evidence Matrix

The table below provides direct claim-by-claim verification across source code, automated test suites, live environment probes, and remaining limitations.

| # | Claim | Source Implementation | Test File & Function | Verification Type & Steps | Actual Result | Remaining Limitation |
| :- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | **`AG8004` Invalid API Key Detection** | `backend/app/services/smartapi_adapter.py:270-285` | `backend/tests/test_smartapi_auth_regression.py::<br>test_smartapi_ag8004_invalid_api_key_handling` | Automated mock test + source inspection: simulated Angel One `{"status": false, "errorcode": "AG8004"}` on `getRMS`. | **VERIFIED** — `auth_status` transitions to `ERROR`, actionable diagnostic is surfaced, and false ₹0.00 balance reports are prevented. | Requires operator to rotate credentials with genuine key from broker portal. |
| **2** | **Multi-Tier Holdings Fallback** | `backend/app/services/smartapi_adapter.py:348-385` | `backend/tests/test_smartapi_auth_regression.py::<br>test_smartapi_holdings_fallback_to_get_holding` | Automated test: simulated failure on `/portfolio/v1/getAllHolding` and success on standard `/portfolio/v1/getHolding`. | **VERIFIED** — Automatically falls back to standard endpoint and parses holdings seamlessly. | If both broker endpoints fail, falls back to internal Demat allotment ledger. |
| **3** | **Holdings Preservation on Failed Sync** | `backend/app/api/endpoints_accounts.py:435-460` | `backend/tests/test_account_readonly_endpoints.py::<br>test_sync_account_failure_handling` | Automated test: initiated sync on account with simulated broker error. | **VERIFIED** — Preserved previously verified Demat holdings; zero-out wipe is prevented. | Stored ledger reflects last verified state until next successful sync. |
| **4** | **DDPI Status Preservation** | `backend/app/services/smartapi_adapter.py:165-175`, `endpoints_accounts.py:240-250` | `backend/tests/test_smartapi_auth_regression.py::<br>test_smartapi_ddpi_preservation_when_unexposed` | Automated test: verified that broker returning `None` for DDPI leaves stored status untouched. | **VERIFIED** — Existing user status (`ACTIVE` or `INACTIVE`) is preserved. | SmartAPI provides no live DDPI API; relies on user record. |
| **5** | **Consolidated Portfolio Runtime Error Fix** | `backend/app/api/endpoints_portfolio.py:43` | `backend/tests/test_portfolio_and_chart.py::<br>test_consolidated_holdings_default_params` | Source inspection & automated test: called `GET /api/v1/portfolio/consolidated` with default parameters. | **VERIFIED** — Returns HTTP 200 with aggregated valuation. `NameError: settings` resolved. | Aggregation reflects active accounts in database session. |
| **6** | **Demat Account & Resource Isolation** | `backend/app/api/endpoints_accounts.py`, `endpoints_notes.py`, `endpoints_chat.py`, `endpoints_orders.py` | `backend/tests/test_account_isolation.py` (6 dedicated tests) | Automated testing with synthetic Demat accounts: tested holdings isolation (Account 1 vs 2 vs 3), orders isolation, note isolation, chat session isolation, and credential masking. | **VERIFIED** — Account 1 holdings/orders/notes never leak into Account 2. Chat sessions isolated by `session_id`. Credential fields never returned in JSON. | System uses single-tenant Master API key authentication; per-user multi-tenant login sessions with distinct user accounts share access to the authorized operator dashboard. |
| **7** | **Paper-Trading Safe Isolation (No Broker Routing)** | `backend/app/api/endpoints_orders.py:114-116`, `backend/app/services/bulk_order_service.py:213-215`, `paper_trading_service.py` | `backend/tests/test_paper_trading_safety_gate.py` (4 dedicated tests) | Automated mock tests: patched `SmartAPIAdapter.place_order` and `requests.Session.post` with spies. Executed single orders, bulk orders, and demo accounts under `TRADING_MODE="LIVE"`. | **VERIFIED** — Exactly 0 broker calls made. Orders assigned `is_paper_trade=True` and `broker_order_id.startswith("SIM_")`. | Non-demo accounts under `TRADING_MODE="LIVE"` will attempt live broker routing. |
| **8** | **Production Database Persistence** | `backend/app/core/config.py:28`, `app/core/database.py` | Live readiness probe (`https://apo-wubq.onrender.com/api/v1/health/ready`) | Live HTTP probe to Render production backend. | **BLOCKED** — Confirmed `database_engine: sqlite`, `storage_type: EPHEMERAL_LOCAL`. | Container redeployment causes loss of SQLite database file. PostgreSQL migration required. |
| **9** | **Encryption Fails Closed on Missing / Invalid Key** | `backend/app/core/security.py:13-18`, `backend/app/core/config.py:15` | `backend/tests/test_encryption_safety.py::<br>test_encryption_fails_closed_on_invalid_key`,<br>`test_encryption_fails_closed_when_key_missing` | Automated tests: initialized `SecretCipher` with invalid/short keys (raised `ValueError`); instantiated `Settings` with missing key (raised `ValidationError`). | **VERIFIED** — System fails closed immediately and refuses insecure operation. | Encryption key must be provided via `APP_ENCRYPTION_KEY` env var. |
| **10** | **Secrets Redaction in Repo & Docs** | `docs/BROKER_API_COVERAGE_AND_DDPI_STATUS.md`, `docs/KNOWN_ISSUES_AND_RELEASE_BLOCKERS.md` | `git grep -i "23VPI"` across workspace | Scanned entire git tree, frontend bundle, and documentation for hardcoded keys or TOTP seeds. | **VERIFIED** — Discovered TOTP seed redacted to `[REDACTED_TOTP_SECRET]`. Frontend bundle scanned clean. | Operator must store personal TOTP secrets securely. |
| **11** | **DDPI User-Recorded Status Labeling** | `frontend/src/views/AccountsView.tsx:1165,1339` | TypeScript compiler + UI inspection | Inspected UI table and Drawer controls in `AccountsView.tsx`. | **VERIFIED** — Badge explicitly displays `(User-Recorded)` with tooltip explaining status is not verified by live broker API. | None. |
| **12** | **Deployable Frontend Artifact** | `frontend/dist/`, `hostinger_frontend_upload.zip` | `npm run build`, `powershell Compress-Archive` | Executed production build and packaged zip file with `.htaccess`. | **VERIFIED** — 0 TypeScript errors, bundle generated in 11.38s, zip file verified (236,592 bytes). | Static zip package must be uploaded and extracted in Hostinger File Manager (`public_html/`). |

---

## 4. Test Execution Summary

### Backend Pytest Suite
- **Command:** `pytest backend/tests -v`
- **Total Test Files:** 17 test modules
- **Total Tests:** 102
- **Passed:** 102
- **Failed:** 0
- **Duration:** 25.73s
- **Key Modules Tested:**
  - `test_account_isolation.py` (6 tests: holdings, orders, notes, chat, credential security, unauthenticated rejection)
  - `test_paper_trading_safety_gate.py` (4 tests: single paper, bulk paper, live-mode demo interception, insufficient holding rejection)
  - `test_encryption_safety.py` (5 tests: invalid key fail-closed, missing key fail-closed, cipher roundtrip, TOTP generation, sensitive field redaction)
  - `test_smartapi_auth_regression.py` (12 tests: AG8004, holdings fallback, DDPI preservation, AB1050 session expiry, token pooling)
  - `test_persistence_gate.py` (4 tests: encryption key survival, disposable DB restore, plaintext secret absence, relationship persistence)
  - `test_security_remediation.py` (8 tests: 401 rejection, security headers, rate limiting, bulk validation)
  - `test_portfolio_and_chart.py` (8 tests: consolidated portfolio, OHLCV charts, zero balance handling)

### Frontend Build
- **Command:** `npm run build` (in `frontend/`)
- **Type Checker:** `tsc` (0 errors)
- **Bundler:** Vite v5.4.21
- **Duration:** 11.38s
- **Output Artifacts:**
  - `dist/index.html` (0.88 kB)
  - `dist/assets/index-BpNjkYn9.css` (38.27 kB)
  - `dist/assets/index-rjnXfoi-.js` (926.51 kB)
  - `dist/.htaccess` (Server rewrite and security headers configuration)
- **Hostinger Deploy Package:** `hostinger_frontend_upload.zip` (236,592 bytes)

---

## 5. Deployment Verification Status

| Component | Target URL | Verified Deployment Status | Notes / Evidence |
| :--- | :--- | :--- | :--- |
| **Backend API** | `https://apo-wubq.onrender.com/api/v1` | **Live & Operational (Staging)** | Probed `https://apo-wubq.onrender.com/api/v1/health/ready`. Returns `status: READY`, `trading_mode: PAPER`. Storage is ephemeral SQLite. |
| **Frontend UI** | `https://ipo.emperialcabs.com` | **Live & Operational (Hostinger)** | Static hosting. Latest bundle compiled to `hostinger_frontend_upload.zip`. Requires operator extraction in Hostinger File Manager to serve latest asset hashes. |

---

## 6. Action Items Prior to Live Release

To advance this system from `READY FOR STAGING ONLY` to `READY FOR RELEASE`:

1. **Migrate Backend Storage to Managed PostgreSQL:**
   - Create a Managed PostgreSQL instance on Render or Supabase.
   - Set `DATABASE_URL=postgresql://user:pass@host:port/dbname` in Render Environment Variables.
   - Run migration script or allow `Base.metadata.create_all` to initialize PostgreSQL tables.
   - Perform a container restart and verify data persistence without JSON restores.
2. **Rotate Live Credentials:**
   - Log into the IPOPro Dashboard at `https://ipo.emperialcabs.com`.
   - On the `Connected Accounts` screen, locate account `dhruvil` (`AAAD986778`) and click **"Rotate Credentials"**.
   - Input your valid 32-character API key from `smartapi.angelbroking.com`, 4-digit Account PIN, and Base32 TOTP Secret.
   - Click **"Test Connection"** to establish an active SmartAPI session.
3. **Verify DDPI Status in Angel One Mobile App:**
   - Open Angel One mobile app -> `Account -> Profile -> DDPI Status`.
   - In IPOPro, toggle **"Mark Active"** if DDPI is enabled to permit one-click pre-market IPO exits without daily CDSL TPIN authorization.
