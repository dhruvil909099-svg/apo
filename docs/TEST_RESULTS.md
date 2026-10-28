# IPOPro — Test Results & Build Verification Report

This document records the exact test execution metrics, automated testing logs, and frontend build verification outputs executed during the final production audit.

---

## 1. Backend Automated Pytest Suite Summary

- **Total Test Cases Collected:** 83
- **Passed:** 83 (100.0%)
- **Failed:** 0
- **Duration:** 25.25 seconds
- **Test Command:** `python -m pytest backend/tests/ -v`

### Detailed Test Execution by Module

| Test Module | Tests | Result | Primary Coverage Area |
|---|---|---|---|
| `test_account_readonly_endpoints.py` | 12 | **12 PASSED** | Read-only holdings, RMS cash, isolation, error handling, rate limiting |
| `test_accounts.py` | 6 | **6 PASSED** | Account creation, client code masking, credential encryption, rotation |
| `test_bulk_orders.py` | 1 | **1 PASSED** | Bulk order preparation and batch validation |
| `test_crud_and_ai_chat.py` | 7 | **7 PASSED** | User CRUD & RBAC, Watchlists, Notes, Notifications, Paper Buy flow, AI Chat, Broker Sync |
| `test_encryption.py` | 4 | **4 PASSED** | Fernet AES-128 roundtrip, masking, TOTP generation, secret sanitization |
| `test_health.py` | 2 | **2 PASSED** | Unauthenticated liveness probe, database readiness check |
| `test_ipos.py` | 17 | **17 PASSED** | IPO listing, allotment CSV import/export, subscription math, IST boundaries |
| `test_paper_trading.py` | 3 | **3 PASSED** | Paper market sell order, insufficient holdings, emergency halt enforcement |
| `test_persistence_gate.py` | 7 | **7 PASSED** | Encryption key survival, backup/restore, broker session expired, live vs demo |
| `test_portfolio_and_chart.py` | 5 | **5 PASSED** | Candle charts, consolidated holdings math, account filtering, sync trigger |
| `test_risk_controls.py` | 2 | **2 PASSED** | Risk limits configuration, dashboard KPI calculations |
| `test_security_remediation.py` | 9 | **9 PASSED** | 401 unauthenticated rejection, security headers, rate limiting (429) |
| `test_smartapi_auth_regression.py` | 8 | **8 PASSED** | Base32 normalization, SmartAPI headers, AB1050 handling, session pooling |
| **Total** | **83** | **83 PASSED** | **100% Pass Rate** |

---

## 2. Frontend Build & TypeScript Type-Check

- **Build Command:** `npm run build` (`tsc && vite build`)
- **Working Directory:** `frontend/`
- **Result:** **PASSED (0 TypeScript Errors, 0 Build Failures)**
- **Build Duration:** 21.29 seconds
- **Modules Transformed:** 2,303 modules

### Artifact Output

```text
dist/index.html                   0.88 kB │ gzip:   0.50 kB
dist/assets/index-BpNjkYn9.css   38.27 kB │ gzip:   6.81 kB
dist/assets/index-BjEGgJFo.js   924.22 kB │ gzip: 228.82 kB
✓ built in 21.29s
```

All distribution bundles have been synchronized with the repository root `assets/` and `index.html` and archived into `hostinger_frontend_upload.zip`.

---

## 3. Production Endpoint Health Probes

### Render Live Backend (`apo-wubq.onrender.com`)
```bash
curl -s -i "https://apo-wubq.onrender.com/api/v1/health"
HTTP/1.1 200 OK
content-type: application/json
{"status":"UP"}
```

```bash
curl -s -i "https://apo-wubq.onrender.com/api/v1/health/ready"
HTTP/1.1 200 OK
content-type: application/json
{
  "status": "UP",
  "database_engine": "sqlite",
  "storage_type": "EPHEMERAL_LOCAL",
  "database_url_configured": false,
  "app_encryption_key_configured": true,
  "trading_mode": "PAPER"
}
```

### Hostinger Live Frontend (`ipo.emperialcabs.com`)
```bash
curl -s -I "https://ipo.emperialcabs.com"
HTTP/2 200
content-type: text/html
```
