# Test Results & Reproduction Steps

**Application:** IPOPro  
**Date:** October 28, 2026  
**Total Tests:** 87  
**Passing:** 87 (100%)  
**Failing:** 0  

---

## 1. Test Execution Command & Summary

```bash
pytest backend/tests
```

```text
============================= test session starts =============================
platform win32 -- Python 3.11.9, pytest-8.4.2, pluggy-1.6.0
rootdir: D:\ANGLE ONE
plugins: anyio-4.13.0, langsmith-0.10.6, asyncio-1.4.1, docker-3.2.5
asyncio: mode=Mode.STRICT, debug=False
collected 87 items

backend\tests\test_account_readonly_endpoints.py ............            [ 13%]
backend\tests\test_accounts.py ......                                    [ 20%]
backend\tests\test_bulk_orders.py .                                      [ 21%]
backend\tests\test_crud_and_ai_chat.py .......                           [ 29%]
backend\tests\test_encryption.py ....                                    [ 34%]
backend\tests\test_health.py ..                                          [ 36%]
backend\tests\test_ipos.py ..................                            [ 57%]
backend\tests\test_paper_trading.py ...                                  [ 60%]
backend\tests\test_persistence_gate.py .......                           [ 68%]
backend\tests\test_portfolio_and_chart.py ......                         [ 75%]
backend\tests\test_risk_controls.py ..                                   [ 78%]
backend\tests\test_security_remediation.py .........                     [ 88%]
backend\tests\test_smartapi_auth_regression.py ..........                [100%]

============================= 87 passed in 30.48s =============================
```

---

## 2. Defect Reproduction & Verification Evidence

### Defect 1: `NameError: name 'settings' is not defined` on `/portfolio/consolidated`
- **Reproduction**: Calling `GET /api/v1/portfolio/consolidated` with no query parameters branched to `elif settings.TRADING_MODE == 'LIVE':` where `settings` was unimported.
- **Fix**: Imported `settings` in `endpoints_portfolio.py`.
- **Verification**: Added `test_consolidated_holdings_default_params` in `test_portfolio_and_chart.py`. Response: HTTP 200 OK.

### Defect 2: DDPI Always Showing "UNKNOWN"
- **Reproduction**: When syncing or testing accounts, `SmartAPIAdapter` queried `getProfile`. Since Angel One SmartAPI does not return DDPI flags, it set `ddpi_status = "UNKNOWN"`, overwriting user settings.
- **Fix**: `test_connection()` now detects DDPI only if explicitly provided by broker, returning `None` otherwise to preserve the user's stored/manual setting. Added interactive toggle in `AccountsView.tsx`.
- **Verification**: Verified via `test_smartapi_ddpi_preservation_when_unexposed`.

### Defect 3: Silent Failure on Invalid API Key (`AG8004`) Resulting in ₹0.00 Balances
- **Reproduction**: When an account had a placeholder key (`AUTO_RESTORED_KEY`), `getRMS` returned `AG8004 Invalid API Key`. `SmartAPIAdapter` caught this without setting `last_error`, leading to false success reports.
- **Fix**: Added explicit `AG8004` handling in `_send_request`, `get_rms()`, and `get_holdings()`. Enforced error checking in `sync_account_data`.
- **Verification**: Verified via `test_smartapi_ag8004_invalid_api_key_handling`.
