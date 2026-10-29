# IPOPro — Buy/Sell Order Terminal Repair Report

## 1. Executive Summary
This document provides the technical autopsy and remediation record for the IPOPro Buy/Sell order terminal repair, addressing the OLAELEC price mismatch bug, authentic SmartAPI quote retrieval, official Brokerage Calculator and Margin Calculator integrations, and reliable order lifecycle state transitions.

---

## 2. Root Cause: Why IPOPro Showed ₹100 for OLAELEC
Investigation revealed multiple layers of hardcoded fallback logic:
1. **Frontend Callers**: In `StockExplorerView.tsx` (line 866-867) and `AccountsView.tsx` (line 2453, 2474, 2495), items were passed to `OrderTicketModal` with `current_ltp: inst.current_ltp || 100` and `average_price: inst.current_ltp || 100`.
2. **Order Ticket Modal Initialization**: In `OrderTicketModal.tsx` (line 40 and 59), `const ltp = holding.current_ltp || holding.average_price || 100` defaulted to ₹100 whenever an instrument was opened before a live tick arrived.
3. **Database State**: The `instruments` table held `current_ltp: None` for un-ticked scrips (including BSE OLAELEC `544225` and NSE OLAELEC `24777`).
4. **Order Value Multiplication**: Because `ltp` defaulted to ₹100, 10 shares calculated an artificial order value of ₹1,000.00 instead of the genuine BSE price of ~₹35.14 (order value: ₹351.40).
5. **Margin Confusion**: The terminal confused notional trade value with required margin. For Intraday (MIS), SEBI regulatory peak margin requires ~20% (~₹71.11 for 10 shares of OLAELEC), not full notional value or arbitrary amounts.

---

## 3. Corrected Quote Mapping & Live Market Data (Agent 1)
- **Token Resolution**: 
  - BSE: Symbol `OLAELEC`, Exchange `BSE`, Token `544225`, Tick Size `0.01`
  - NSE: Symbol `OLAELEC-EQ`, Exchange `NSE`, Token `24777`, Tick Size `0.01`
- **Zero Fallback Enforcement**: Eliminated all `|| 100` fallbacks across frontend and backend.
- **Immediate Quote Resolution**: On modal open, `api.getSingleMarketQuote(sym, exchange, token)` fetches the genuine quote from SmartAPI REST or WebSocket tick cache.
- **Live Feed Connection**: Connects to `/api/v1/market/ws` to stream live ticks for the active scrip.
- **Reference Price vs Limit Price**:
  - For **Market Orders**: LTP is displayed purely as an indicative reference with an explicit disclaimer that execution price is determined at exchange fill.
  - For **Limit Orders**: Initialized once from verified LTP; subsequent market ticks **never** overwrite the user's manually entered limit price.
- **Unavailable State**: If no authorized broker quote is obtainable, displays `Price Unavailable` and blocks execution with `"Waiting for authentic market quote from broker"`.

---

## 4. Official Brokerage Calculator API Integration (Agent 2)
- **Service Created**: `backend/app/services/brokerage_estimate_service.py` (`BrokerageEstimateService`).
- **Endpoint**: `POST https://apiconnect.angelone.in/rest/secure/angelbroking/brokerage/v1/estimateCharges`
- **Method in SmartAPIAdapter**: `adapter.estimate_charges(orders)`.
- **Backend Route**: `POST /api/v1/market/brokerage/estimate`.
- **Itemized Breakdown Supported**:
  - Angel One Brokerage (₹0 on Delivery; min(₹20, 0.03%) on Intraday)
  - Securities Transaction Tax (STT / CTT)
  - Exchange Transaction Charges (NSE 0.00297%, BSE 0.00375%)
  - SEBI Turnover Charges (₹10 / crore)
  - Stamp Duty (0.015% Delivery Buy, 0.003% Intraday Buy)
  - Goods & Services Tax (18% on Brokerage + Exchange + SEBI fees)
  - Depository Participant (DP) Charges (₹15.34 on Delivery Sell)
  - Total Estimated Charges labeled `ESTIMATED`.

---

## 5. Official Margin Calculator API Integration (Agent 2)
- **Service Created**: `backend/app/services/margin_estimate_service.py` (`MarginEstimateService`).
- **Endpoint**: `POST https://apiconnect.angelone.in/rest/secure/angelbroking/margin/v1/batch`
- **Method in SmartAPIAdapter**: `adapter.get_margin_batch(positions)`.
- **Backend Route**: `POST /api/v1/market/margin/batch`.
- **Separate Financial Metrics**:
  - Reference LTP (e.g. ₹35.14)
  - Quantity (10 shares)
  - Full Notional Trade Value: ₹351.40
  - Required Margin: ₹71.11 (MIS Intraday ~5x leverage) vs ₹351.40 (CNC Delivery 1x leverage)
  - Available Account Funds (e.g. ₹100.23)
  - Estimated Remaining Funds: ₹29.12
  - Margin Sufficiency: Verified `True` (₹100.23 > ₹71.11).

---

## 6. Holdings & Sell Validation (Agent 3)
- Evaluates total owned quantity vs available sellable quantity (excluding blocked shares in open orders).
- Inspects account DDPI status and CDSL eDIS daily authorization.
- Blocks delivery sell submission if unverified shares exceed sellable holdings.

---

## 7. Order Lifecycle & Timeout Handling (Agent 4)
- **13-State Lifecycle**: `DRAFT`, `VALIDATING`, `READY_FOR_REVIEW`, `AWAITING_AUTHORIZATION`, `SUBMISSION_PENDING`, `SUBMISSION_UNKNOWN`, `ACKNOWLEDGED`, `OPEN`, `PARTIALLY_FILLED`, `FILLED`, `REJECTED`, `CANCEL_PENDING`, `CANCELLED`, `EXPIRED`.
- **Timeout Protection**: If a broker live order request times out (`requests.exceptions.Timeout`), status transitions to `SUBMISSION_UNKNOWN`. Automated blind retries are blocked to prevent duplicate broker executions.
- **Duplicate Prevention**: `client_order_id` acts as an idempotency key.
- **Default Paper Mode**: Safe paper simulation remains default (`is_paper_trade: true`) clearly marked `SIMULATED`.

---

## 8. Focused Verification Results
Automated test suite `backend/tests/test_order_ticket_repair.py` verified:
- [x] OLAELEC BSE token resolved to `544225` and NSE token to `24777`.
- [x] Zero fabricated ₹100 LTP on missing quotes (`freshness_status: UNAVAILABLE`).
- [x] Quantity 10 calculates correct trade value (₹351.40) from genuine reference price (₹35.14).
- [x] Intraday required margin calculates to ~₹71.11 (not ₹1,000 or full ₹351.40).
- [x] Delivery required margin calculates to full notional ₹351.40.
- [x] Brokerage calculator returns full 7-item breakdown.
- [x] Frontend TypeScript production build (`tsc && vite build`) passed with zero errors.

---

## 9. Modified Files
- `backend/app/services/smartapi_adapter.py`: Added `estimate_charges`, `get_margin_batch`, timeout handling.
- `backend/app/services/brokerage_estimate_service.py`: Reusable Brokerage Calculator service.
- `backend/app/services/margin_estimate_service.py`: Reusable Margin Calculator service.
- `backend/app/api/endpoints_market.py`: Added `/market/brokerage/estimate`, `/market/margin/batch`, updated `/market/quote`.
- `backend/app/api/endpoints_orders.py`: Removed ₹100 preview fallback, added `SUBMISSION_UNKNOWN` handling.
- `backend/tests/test_order_ticket_repair.py`: Automated verification suite.
- `frontend/src/api.ts`: Added `estimateBrokerage`, `calculateMargin`, updated `getSingleMarketQuote`.
- `frontend/src/components/OrderTicketModal.tsx`: Comprehensive UI overhaul with live quotes, charges drawer, margin cards.
- `frontend/src/views/StockExplorerView.tsx`: Removed `|| 100` fallbacks, passed genuine `symbol_token`.
- `frontend/src/views/AccountsView.tsx`: Removed `|| 100` fallbacks, passed genuine `symbol_token`.
- `index.html` & `assets/`: Synced production bundle `index-DvouQamp.js`.
