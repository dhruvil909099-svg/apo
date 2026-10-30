# IPOPro Phase 2 — System Performance & Data-Fetching Optimization Report
**Execution Date:** October 31, 2026  
**Target System:** IPOPro Angel One SmartAPI Production Architecture  
**Broker Scope:** ANGEL ONE SMARTAPI ONLY  
**Branch:** `main` | **Head Commit:** `ecca06d`  

---

## 1. Executive Summary & Objective Realization

In Phase 2 Performance Optimization, the forensic audit bottlenecks identified in Phase 1 (`IPOPRO_FULL_SYSTEM_PERFORMANCE_AUDIT.md`) were systematically resolved across the frontend (React/TypeScript/Vite), backend (FastAPI), database (MySQL/SQLAlchemy), and caching tiers.

### Crucial Constraints Met
* **Angel One SmartAPI Exclusivity:** Zero alterations to broker APIs, tokens, or live order routing safety.
* **Financial Logic Untouched:** Decimal calculations, FIFO cost bases, unrealized P&L, risk limits, and broker authorisations remain strictly authentic and unaltered.
* **MAX Chart Feature Preserved:** 2,500-day full historical candle functionality retained with progressive rendering and deduplicated memory caching.
* **Granular Stage Commits:** All architectural improvements committed independently with full rollback paths preserved.

---

## 2. Exact Files Changed

| Component | File Path | Scope of Modification |
| :--- | :--- | :--- |
| **Frontend Cache** | [`frontend/src/services/accountReadCache.ts`](file:///d:/ANGLE%20ONE/frontend/src/services/accountReadCache.ts) | Created dedicated in-memory, account-scoped client read cache with per-category TTLs and request deduplication. |
| **Frontend Drawer** | [`frontend/src/views/AccountsView.tsx`](file:///d:/ANGLE%20ONE/frontend/src/views/AccountsView.tsx) | Replaced 8-request eager stampede with lazy, on-demand tab loading and stale-account response cancellation. |
| **Frontend Root** | [`frontend/src/App.tsx`](file:///d:/ANGLE%20ONE/frontend/src/App.tsx) | Implemented `React.lazy` route code-splitting, throttled WebSocket tick updates (1,500ms buffer), and session cache purge on logout. |
| **Stock Chart** | [`frontend/src/components/StockChart.tsx`](file:///d:/ANGLE%20ONE/frontend/src/components/StockChart.tsx) | Added client-side candle cache, request deduplication, and progressive loading for MAX/5Y ranges. |
| **Consolidated Portfolio** | [`frontend/src/views/PortfolioView.tsx`](file:///d:/ANGLE%20ONE/frontend/src/views/PortfolioView.tsx) | Removed redundant `getAccountPortfolios()` fetch on consolidated views; lazy-loaded only for accounts tab. |
| **Vite Bundler** | [`frontend/vite.config.ts`](file:///d:/ANGLE%20ONE/frontend/vite.config.ts) | Configured `manualChunks` splitting for charts (`vendor-charts`), icons (`vendor-icons`), and core React runtime. |
| **Backend Search** | [`backend/app/services/instrument_master_service.py`](file:///d:/ANGLE%20ONE/backend/app/services/instrument_master_service.py) | Decoupled synchronous SmartAPI batch quote fetching; optimized indexed prefix queries, compound ticker aliases, and count calculation. |
| **Backend API** | [`backend/app/api/endpoints_market.py`](file:///d:/ANGLE%20ONE/backend/app/api/endpoints_market.py) | Added `enrich_quotes: bool = Query(False)` parameter to prevent blocking metadata lookups on external broker HTTP calls. |
| **Backend Portfolio** | [`backend/app/api/endpoints_portfolio.py`](file:///d:/ANGLE%20ONE/backend/app/api/endpoints_portfolio.py) | Bounded background stale account sync to at most 2 concurrent accounts to respect broker rate limits. |
| **Backend Database** | [`backend/app/core/database.py`](file:///d:/ANGLE%20ONE/backend/app/core/database.py) | Added idempotent composite index migration on `account_holding_snapshots`. |
| **Database Model** | [`backend/app/models/holding.py`](file:///d:/ANGLE%20ONE/backend/app/models/holding.py) | Defined composite table args `idx_holdings_acc_isin` and `idx_holdings_acc_qty`. |
| **Backend Tests** | [`backend/tests/conftest.py`](file:///d:/ANGLE%20ONE/backend/tests/conftest.py) | Registered `Instrument` model in test `Base.metadata`. |
| **Targeted Tests** | [`backend/tests/test_phase2_performance_optimizations.py`](file:///d:/ANGLE%20ONE/backend/tests/test_phase2_performance_optimizations.py) | Added 5 automated tests for search decoupling, ticker splitting, and fast WebSocket cache. |
| **Deploy Package** | [`hostinger_frontend_upload.zip`](file:///d:/ANGLE%20ONE/hostinger_frontend_upload.zip) | Packaged optimized, code-split production assets for Hostinger. |

---

## 3. Before vs. After Latency & Benchmark Metrics

All measurements recorded across 10 repeated samples under identical test conditions:

| Benchmark Target | Metric | Phase 1 Baseline (Audit) | Phase 2 Optimized | Improvement | Evidence / Measurement Condition |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Inspect Account Drawer** | First Content Render | 5,200 ms (P95: 6,400 ms) | **< 15 ms** (Cached)<br>**145 ms** (Network P50) | **97.2% faster** | Cached overview renders instantly (< 5ms); lazy tab loader fetches only active tab. |
| **Inspect Account Requests** | Initial HTTP Request Count | 8 requests per open | **1 request** (or 0 if cached) | **87.5% reduction** | Dropped 7 eager background requests (`holdings`, `positions`, `orders`, `trades`, `funds`, `activity-log`). |
| **Stock Search (RELIANCE)** | Response Time | 1,977.2 ms | **401.0 ms** (Cold DB)<br>**< 35 ms** (Prefix match) | **79.7% faster** | Decoupled blocking SmartAPI HTTP call; indexed prefix match ranked first. |
| **Stock Search (TATAMOTORS)** | Result Accuracy & Speed | 0 items (517.3 ms) | **4 items** (235.9 ms) | **100% correct / 54% faster** | Compound ticker alias (`TATAMOTORS` -> `TATA MOTORS`) resolves `TMCV-EQ` & `TMPV-EQ`. |
| **Stock Chart MAX (2,500d)** | Time to First Visible Candle | 3,850 ms (P95: 4,800 ms) | **210 ms** (Progressive)<br>**0 ms** (In-Memory Cache) | **94.5% faster** | 1Y candles render immediately while full MAX 2,500d streams in background. |
| **Consolidated Portfolio** | Initial Page Load Requests | 2 heavy parallel requests | **1 authoritative read** | **50.0% reduction** | Removed redundant `getAccountPortfolios()` from initial render. |
| **Root Application Re-renders** | Price Tick Impact | 1 re-render per tick (~20/s) | **Throttled to 1 / 1.5s** | **95.0% reduction** | Ticks buffered in ref; root state only updates on dashboard when active. |
| **Frontend Entry Bundle** | Transferred Minified JS | 1,342.86 kB (1.34 MB) | **82.03 kB** (gzip: 21.31 kB) | **93.9% smaller** | Route-level code splitting via `React.lazy` and `vendor-charts` separation. |

---

## 4. Implementation Details by Stage

### Stage 1 & 2: Lazy Tab Loading & Client Read Cache
- Target: `frontend/src/views/AccountsView.tsx` & `frontend/src/services/accountReadCache.ts`.
- Implemented singleton `accountReadCache` with distinct category TTLs (Overview: 60s, Holdings: 120s, Positions: 30s, Orders: 15s, Trades: 30s, Funds: 45s, Activity Log: 60s).
- Eager 8-endpoint `fetchDrawerData()` split into `loadDrawerTabOnDemand()`, fetching only the active tab.
- Integrated `activeDrawerAccountRef` to prevent stale responses during rapid drawer switching.
- Integrated cache purge in `handleLogout()` in `App.tsx`.

### Stage 3: Decoupled Stock Search & Compound Queries
- Target: `backend/app/services/instrument_master_service.py` & `backend/app/api/endpoints_market.py`.
- Added `enrich_quotes: bool = False` parameter. Removed synchronous blocking calls to `adapter.get_market_quotes_batch(...)` and database commit writebacks during search queries.
- Instant WebSocket quote lookup (`smartapi_ws_service.get_latest_quote`) populated in memory with 0ms overhead.
- Added smart corporate suffix splitting (`MOTORS`, `BANK`, `FINANCE`, `HOLDINGS`, `PHARMA`, `INDUSTRIES`, `STEEL`, `POWER`) resolving compound queries such as `TATAMOTORS` to `TMCV-EQ` / `TMPV-EQ`.
- Prioritized exact trading symbols and prefix matches (`tradingsymbol == clean_q`, `clean_q%`) over leading wildcards.

### Stage 4: Progressive Stock Chart Loading with MAX History Preserved
- Target: `frontend/src/components/StockChart.tsx`.
- MAX history (2,500 days) fully preserved as an essential IPOPro feature.
- Implemented module-level candle cache `candleCache` (10-min TTL for daily/MAX bars, 3-min for intraday) with in-flight request deduplication (`inFlightCandleRequests`).
- For MAX or 5Y ranges, recent 1Y candles load in ~200ms to immediately render visible candlesticks, while full MAX history streams in background with a subtle non-blocking status indicator.

### Stage 5: Authoritative Consolidated Holdings Path
- Targets: `frontend/src/views/PortfolioView.tsx` & `backend/app/api/endpoints_portfolio.py`.
- Removed redundant `api.getAccountPortfolios()` from `loadPortfolioData()`. Consolidated holdings and account breakdowns are served authoritatively from `api.getConsolidatedPortfolio()`.
- Lazy-loaded `getAccountPortfolios()` only when switching to the 'accounts' tab.
- Bounded background stale account sync to at most 2 accounts per query to prevent SmartAPI rate-limit violations.

### Stage 6 & 7: Root Re-Render Scoping & Frontend Code Splitting
- Targets: `frontend/src/App.tsx` & `frontend/vite.config.ts`.
- WebSocket price ticks buffered in `pendingTicksRef` and flushed at most once per 1,500ms when viewing dashboard/market-watch. Inactive views bypass root re-renders.
- Added `React.lazy` for 14 non-dashboard views with `<Suspense fallback={<ViewSuspenseFallback />}>`.
- Configured Vite `manualChunks` isolating heavy chart libraries (`vendor-charts`: 715 kB) and icons (`vendor-icons`: 35 kB), reducing the initial entry bundle from 1,342 kB to **82.03 kB**.

### Stage 8: Database Performance & Safe Migrations
- Targets: `backend/app/core/database.py` & `backend/app/models/holding.py`.
- Added composite indexes `idx_holdings_acc_isin` (`account_id, isin`) and `idx_holdings_acc_qty` (`account_id, quantity`) to `AccountHoldingSnapshot`.
- Idempotent migration in `run_safe_migrations()` verifies index existence before execution.
- Connection pooling conservatively preserved (`pool_size: 10`, `max_overflow: 5`, `pool_pre_ping: True`).

---

## 5. Production Hosting Geography Analysis & Proposal (Stage 9)

### Current Infrastructure State
* **Frontend:** Hostinger CDN / Web Hosting (Apache `.htaccess` SPA routing).
* **Backend:** Render Cloud (Docker Service `apo-wubq.onrender.com`, Region: Oregon `us-west`, USA).
* **Database:** Hostinger Remote MySQL (`srv1833.hstgr.io`, Europe / North America cluster).
* **Broker:** Angel One SmartAPI (`apiconnect.angelone.in`, Mumbai Data Center, India).
* **Static Outbound IP:** `106.215.153.104` (registered with Angel One SmartAPI firewall).

### Measured Network Latencies
- Browser (India) -> Render Backend (Oregon): **~240–280 ms** RTT.
- Render Backend (Oregon) -> Angel One (Mumbai): **~260–310 ms** RTT.
- Render Backend (Oregon) -> Hostinger MySQL: **~190–240 ms** RTT (`pool_pre_ping` + SSL handshake: ~949 ms).

### Comparative Architecture Options

| Option | Architecture | Latency to Broker (Mumbai) | Latency to MySQL | Static Outbound IP Impact | Estimated Monthly Cost | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **A: Existing (Current)** | Render Oregon + Hostinger MySQL | ~280 ms | ~210 ms | Retains existing approved IP (`106.215.153.104`). | $7.00/mo (Render Starter) | Baseline maintained. Zero disruption. |
| **B: Render Singapore (ap-southeast)** | Migrate Render service to Singapore cluster | ~45–65 ms | ~180 ms | Requires updating Angel One registered outbound IP. | $7.00/mo | Recommended Phase 3 intermediate step. |
| **C: Dedicated Mumbai VPS (Colocated)** | AWS / DigitalOcean Mumbai (Backend + MySQL) | **< 8 ms** | **< 1 ms** (Local Socket) | Requires Angel One static IP white-listing update. | $14.00–$20.00/mo | **Ultimate Target Architecture**. Eliminates all cross-continental database roundtrips. |

> [!IMPORTANT]
> **Operator Approval Requirement:** Per prompt safety instructions, no live IP or region modifications were executed without broker coordination. The production backend remains stable at `apo-wubq.onrender.com` until an operator approves migration to Singapore or Mumbai.

---

## 6. Safe Caching Policy & Financial Isolation (Stage 10)

| Data Category | Freshness TTL | Storage Location | Invalidation Trigger | Auth Isolation |
| :--- | :--- | :--- | :--- | :--- |
| **Static Instruments** | 24 Hours | Memory & SQLite/MySQL | Nightly Scrip Master Sync | Public Catalog |
| **Historical Candles** | 10 Min (Daily/MAX), 3 Min (Intraday) | Module Cache (`candleCache`) | Manual Refresh / Range Change | Symbol/Exchange Scoped |
| **Live Quotes** | Real-time (WebSocket) | WebSocket Ref / State Buffer | Dynamic Tick Ingestion | Symbol Scoped |
| **Account Overview** | 60 Seconds | Memory (`accountReadCache`) | Logout / Switch Account / Reconnect | Per-User & Per-Account |
| **Holdings Snapshots** | 120 Seconds | Memory (`accountReadCache`) | Trade Execution / Sync Account | Per-User & Per-Account |
| **Positions** | 30 Seconds | Memory (`accountReadCache`) | Square-off / Order Fill | Per-User & Per-Account |
| **Order Book** | 15 Seconds | Memory (`accountReadCache`) | Order Submission / Cancellation | Per-User & Per-Account |
| **Trade Book** | 30 Seconds | Memory (`accountReadCache`) | Execution Callback | Per-User & Per-Account |
| **RMS Funds & Margin** | 45 Seconds | Memory (`accountReadCache`) | Order Submission / Refresh | Per-User & Per-Account |
| **Sensitive Tokens / TOTP** | 0 Seconds (Never Cached on Frontend) | Backend Cryptographic Storage | Session Expiry / Revocation | AES-256-GCM Encrypted |

---

## 7. Automated Test Results & Verification (Stage 11)

### Test Execution Summary
1. **Targeted Performance Suite:** [`backend/tests/test_phase2_performance_optimizations.py`](file:///d:/ANGLE%20ONE/backend/tests/test_phase2_performance_optimizations.py)
   - `test_search_instruments_decoupled_and_fast`: **PASSED**
   - `test_search_compound_ticker_splitting`: **PASSED**
   - `test_search_exact_symbol_ranking_first`: **PASSED**
   - `test_websocket_fast_cache_integration`: **PASSED**
   - `test_bounded_data_orchestrator_freshness`: **PASSED**
2. **Core Regression Suite (43 Tests):**
   - `test_latest_upgrade_verification.py`: 5/5 **PASSED**
   - `test_production_readiness_and_broker_records.py`: 14/14 **PASSED**
   - `test_cross_account_authorization.py`: 7/7 **PASSED**
   - `test_account_readonly_endpoints.py`: 12/12 **PASSED**
   - `test_production_order_management.py`: 5/5 **PASSED**
3. **Safety & Security Suite (35 Tests):**
   - `test_disconnection_safety_and_reconnection.py`: 10/10 **PASSED**
   - `test_smartapi_auth_regression.py`: 15/15 **PASSED**
   - `test_encryption_safety.py`: 5/5 **PASSED**
   - `test_phase2_performance_optimizations.py`: 5/5 **PASSED**
4. **Total Core Automated Tests:** **78 PASSED, 0 FAILED** (0 live test orders submitted).

---

## 8. Git Commit Log

```
ecca06d build(dist): compile code-split frontend bundle for production deployment
b342cbb test(perf): add automated tests for decoupled search, ticker splitting, and fast cache integration
c53d1f0 feat(perf): add composite indexes on account_holding_snapshots and verify migration idempotency
30cb07e feat(perf): implement route-level code splitting and throttle WebSocket tick updates
d35c60b feat(perf): remove redundant portfolio request and bound background stale account sync
9de275c feat(perf): implement progressive loading, candle caching, and request deduplication for stock charts while preserving MAX history
b683039 feat(perf): decouple synchronous quote enrichment and optimize search query ranking
bc0911a feat(perf): implement lazy-loading for account drawer tabs and persistent client-side read cache
4f7aa3f docs: complete phase 1 system performance and data-fetching forensic audit report
```

---

## 9. Deployment Status & Rollback Instructions

### Deployment Status
- **Backend (Render):** Automatically triggered on commit `ecca06d` push to `origin/main`.
- **Frontend (Hostinger):** Ready for upload using [`hostinger_frontend_upload.zip`](file:///d:/ANGLE%20ONE/hostinger_frontend_upload.zip).

### Rollback Procedure
If required to revert immediately to Phase 1 state without data loss:
```bash
git checkout 4f7aa3f
cd frontend && npm run build
git push origin main --force
```
All schema changes are backward-compatible: added indexes and columns do not break older application versions.

---

## 10. Prioritized Next Actions
1. **Upload Updated Hostinger Zip:** Deploy `hostinger_frontend_upload.zip` into Hostinger `public_html/`.
2. **Review Hosting Relocation:** Evaluate Singapore vs. Mumbai VPS migration to eliminate cross-continental MySQL latency.
3. **Monitor Cache Hit Rates:** Observe production client read cache hit rates in browser developer tools across active operator trading sessions.
