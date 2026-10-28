# Holdings Reconciliation & Data Integrity

**Application:** IPOPro  
**Date:** October 28, 2026  
**Status:** PRODUCTION-GRADE / RECONCILED  

---

## 1. Architecture of Holdings Synchronization

IPOPro maintains an authoritative local ledger of verified equity delivery holdings synchronized against Angel One SmartAPI:

```
[Angel One SmartAPI]
        │
        ├──> GET /portfolio/v1/getAllHolding (Primary)
        └──> GET /portfolio/v1/getHolding (Fallback)
        │
[SmartAPIAdapter.get_holdings()]
        │
[portfolio_sync_service.reconcile_broker_holdings()]
        │
        ├──> Matches by verified ISIN (or NSE/BSE Trading Symbol)
        ├──> Updates / inserts instrument into IPO catalog with current LTP & previous close
        ├──> Calculates FIFO weighted-average acquisition cost
        └──> Commits verified Demat Allotment records with atomic transaction boundary
```

---

## 2. Multi-Tier Holdings Retrieval & Fail-Safe Fallback

To prevent data gaps across different Angel One SmartAPI account configurations:
1. **Primary Request:** `GET /rest/secure/angelbroking/portfolio/v1/getAllHolding`  
   Fetches comprehensive portfolio breakdown including total holding value, invested value, and stock-by-stock array.
2. **Fallback Request:** `GET /rest/secure/angelbroking/portfolio/v1/getHolding`  
   If `getAllHolding` returns empty or encounters gateway throttling, the adapter automatically queries standard Demat holdings.
3. **Data-Integrity Guard:** If an upstream broker authentication error (such as `AG8004 Invalid API Key` or `AG8001 Session Expired`) is detected:
   - **Never Zero Out Holdings**: Previous verified holdings are strictly preserved.
   - **Flag Error State**: Account is marked `auth_status = "ERROR"` with diagnostic error.
   - **Stale Data Warning**: The UI displays a warning banner and preserves the last successful sync timestamp.

---

## 3. Strict Separation: Delivery Holdings vs Derivative Positions

1. **Equity Delivery Holdings (`/accounts/{id}/holdings` & `/portfolio/consolidated`):**
   - Strictly populated from Demat allotments and settled delivery shares.
   - Unaffected by intraday squaring-off or option expiry.
2. **Open Positions (`/accounts/{id}/positions`):**
   - Queried in real-time from `/rest/secure/angelbroking/order/v1/getPosition`.
   - Displays intraday, MIS, and derivative open positions with separate MTM P&L.
   - Kept completely separate from the delivery portfolio.
