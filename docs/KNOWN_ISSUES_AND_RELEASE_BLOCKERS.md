# Known Issues & Release Blockers

**Application:** IPOPro  
**Date:** October 28, 2026  
**Status:** PASS WITH OPERATIONAL LIMITATIONS  

---

## 1. Upstream Broker Constraints (Non-Code Blockers)

1. **Angel One SmartAPI Does Not Return DDPI Programmatically**:
   - **Constraint**: Angel One does not provide an API route to query DDPI consent.
   - **Workaround / Workflow**: IPOPro treats DDPI as an App-Managed setting. Users verify their DDPI status inside the official Angel One mobile app (`Account -> Profile -> DDPI Status`) and toggle **"Mark Active"** in IPOPro.
2. **User API Key Reconnection Required**:
   - **Constraint**: For account `dhruvil` (`AAAD986778`), Angel One returned `AG8004 Invalid API Key` when attempting to fetch funds and Demat holdings because the account originally had an unconfigured/placeholder key.
   - **Required Operator Action**: Click **"Rotate Credentials"** or **"Reconnect"** in the UI and enter your actual SmartAPI API key from `smartapi.angelbroking.com`, along with your 4-digit PIN and TOTP secret (`23VPIQU5UOZ3ZN5ODGMV2GDX4E`).

---

## 2. Resolved Defects

- **FIXED**: Missing `settings` import in `endpoints_portfolio.py`.
- **FIXED**: Overwriting DDPI status with `UNKNOWN`.
- **FIXED**: Silent error swallowing on `AG8004` invalid API keys.
- **FIXED**: Hardcoded placeholder credentials in `account_persistence.py`.
- **FIXED**: Missing fallback to standard `/portfolio/v1/getHolding`.
