# IPOPro — Live Data, Holdings Synchronization & Reconciliation Engine

This document provides a technical walkthrough of the portfolio synchronization engine, the root-cause analysis of historical holdings stagnation, the reconciliation algorithm, and the real-time price streaming pipeline.

---

## 1. Root Cause Analysis: Why Holdings Did Not Update

During initial audits of the system, users observed that Demat holdings were static, did not reflect sales or newly acquired shares, and showed zero updates despite successful login sessions.

Our architectural audit identified three distinct failure points:

### Failure Point 1: Sync Route Skipped Broker Holdings
In `backend/app/api/endpoints_accounts.py`, the `sync_account_data` endpoint only executed:
```python
rms_res = adapter.get_rms()
account.available_cash = rms_res.get("net", 0.0)
```
It **never called** `adapter.get_holdings()`. As a result, trigger-sync actions refreshed cash balances while leaving Demat stock records completely untouched.

### Failure Point 2: Stale Position Retention (No Zeroing Logic)
When manual imports or old sync scripts ran, they only inserted new records. If an investor sold shares in their Angel One terminal, the backend retained the old allotment quantity indefinitely because there was no reconciliation logic comparing the returned set of symbols against previously tracked positions.

### Failure Point 3: Static Frontend Display (No Live Tick Consumption)
`PortfolioView.tsx` fetched holdings once via a REST call on initial page mount. It had no WebSocket listener attached. If prices moved during the trading session, the displayed LTP, market value, and unrealized P&L remained frozen until a full manual browser refresh was triggered.

---

## 2. The Reconciliation Algorithm (`reconcile_broker_holdings`)

Located in `backend/app/services/portfolio_sync_service.py`, `reconcile_broker_holdings()` executes an authoritative four-step reconciliation:

### Step 1: Payload Normalization & Symbol Extraction
Broker responses may contain varied key names (`tradingsymbol`, `symbolname`, `symboltoken`, `totalqty`, `realisedquantity`). The normalizer sanitizes raw strings, strips `-EQ` exchange suffixes, and extracts active symbols into an `active_symbols` set.

### Step 2: Instrument Catalog Maintenance
For every active holding:
- If the symbol is not in the `IPO` catalog, a new catalog entry is created with status `LISTED`, initial issue price set to the acquisition cost, and prevailing LTP recorded.
- If already present, `current_ltp`, `previous_close`, `isin`, and `symbol_token` are updated.

### Step 3: Allotment Position Update
- Locates or instantiates the `Allotment` entity linked to the specific `account_id` and `ipo_id`.
- Sets `allotted_quantity = qty` and `acquisition_cost = avg_price`.
- Flags status as `DEMAT_CREDITED` with `verification_source = "ANGEL_ONE_HOLDINGS"` and updates `verification_timestamp = sync_time`.

### Step 4: Liquidation & Sold Position Zeroing
Positions previously verified via broker holdings that are no longer reported by the broker are recognized as sold.
- If `active_symbols` is non-empty, all allotments with `verification_source == "ANGEL_ONE_HOLDINGS"` whose symbol is **not** in `active_symbols` have their `allotted_quantity` set to `0`.
- If `active_symbols` is completely empty (entire portfolio liquidated), all broker-verified holdings for that account are zeroed out.

---

## 3. Real-Time WebSocket Streaming & Mathematical Formulas

### WebSocket Client Pipeline
In `frontend/src/views/PortfolioView.tsx`:
1. On component mount, an active WebSocket connection is established via `getWebSocketUrl('/api/v1/market/ws')`.
2. When the backend or simulator broadcasts a tick:
   ```json
   {
     "symbol_token": "19326",
     "symbol": "TATATECH",
     "ltp": 1045.50,
     "timestamp": "2026-10-28T15:30:00Z"
   }
   ```
3. The React state updater matches the `symbol` or `symbol_token` and updates `current_ltp` in real time.

### Financial Formulas
For each holding $i$:
$$\text{Investment}_i = \text{Allotted Quantity}_i \times \text{Acquisition Cost}_i$$
$$\text{Market Value}_i = \text{Allotted Quantity}_i \times \text{Current LTP}_i$$
$$\text{Unrealized P\&L}_i = \text{Market Value}_i - \text{Investment}_i$$
$$\text{P\&L \%}_i = \begin{cases} \left(\frac{\text{Unrealized P\&L}_i}{\text{Investment}_i}\right) \times 100 & \text{if } \text{Investment}_i > 0 \\ 0.0 & \text{otherwise} \end{cases}$$

Consolidated totals across all active holdings:
$$\text{Total Investment} = \sum_{i} \text{Investment}_i$$
$$\text{Total Current Value} = \sum_{i} \text{Market Value}_i$$
$$\text{Net Unrealized P\&L} = \text{Total Current Value} - \text{Total Investment}$$
$$\text{Portfolio ROI \%} = \left(\frac{\text{Net Unrealized P\&L}}{\text{Total Investment}}\right) \times 100$$
