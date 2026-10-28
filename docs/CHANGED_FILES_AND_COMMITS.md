# Changed Files & Commit Register

**Application:** IPOPro  
**Date:** October 28, 2026  

---

## 1. Modified Source Files

| File Path | Component | Changes Made |
| :--- | :--- | :--- |
| `backend/app/api/endpoints_portfolio.py` | Backend API | Added missing `settings` import; resolved runtime NameError on `/portfolio/consolidated`. |
| `backend/app/services/smartapi_adapter.py` | Broker Adapter | Added `AG8004` detection; implemented fallback to `portfolio/v1/getHolding`; preserved DDPI when unexposed by broker. |
| `backend/app/api/endpoints_accounts.py` | Backend API | Enforced `adapter.last_error` verification during sync; preserved user DDPI status during test. |
| `backend/app/services/account_persistence.py` | Persistence | Removed dummy credential seeding (`AUTO_RESTORED_KEY`); requires clean operator entry. |
| `backend/app/services/scheduler_service.py` | Scheduler | Verified `adapter.last_error` during background automated account sync loop. |
| `frontend/src/views/AccountsView.tsx` | Frontend UI | Added DDPI tooltip and interactive toggle button in Account Drawer & table; updated credential rotation guidance. |
| `backend/tests/test_portfolio_and_chart.py` | Test Suite | Added `test_consolidated_holdings_default_params` regression test. |
| `backend/tests/test_smartapi_auth_regression.py` | Test Suite | Added regression tests for `AG8004` handling, holdings fallback, and DDPI preservation. |
| `hostinger_frontend_upload.zip` | Deployment | Rebuilt production bundle containing compiled frontend assets and `.htaccess`. |
| `index.html` & `assets/` | Deployment | Synchronized distribution bundle at repository root. |

---

## 2. Added Documentation Files

- `docs/FINAL_ENGINEERING_AUDIT_REPORT.md`
- `docs/ACCOUNT_ISOLATION_AND_PERMISSIONS_MATRIX.md`
- `docs/BROKER_API_COVERAGE_AND_DDPI_STATUS.md`
- `docs/HOLDINGS_RECONCILIATION_AND_DATA_INTEGRITY.md`
- `docs/ORDER_AND_PAPER_TRADING_AUDIT.md`
- `docs/SECURITY_AUDIT_AND_REMEDIATION.md`
- `docs/DATABASE_PERSISTENCE_AND_RECOVERY.md`
- `docs/TEST_RESULTS_AND_REPRODUCTION_STEPS.md`
- `docs/KNOWN_ISSUES_AND_RELEASE_BLOCKERS.md`
- `docs/CHANGED_FILES_AND_COMMITS.md`
