# IPOPro: Angel One Multi-Account IPO Trading & Monitoring Dashboard

IPOPro is a production-grade, secure, responsive **Multi-Account IPO Monitoring and Order Management Platform for Indian Markets (NSE/BSE)** integrated with **Angel One SmartAPI**.

It solves the operational challenge of managing multiple family demat accounts during IPO listings: monitoring confirmed allotments, tracking listing-day equilibrium prices, evaluating DDPI/eDIS depository authorization status, enforcing risk guardrails, and executing coordinated bulk selling without logging into individual broker accounts.

---

## 1. Verified Official Capabilities & Indian Market Rules

| Rule / Capability | Official Specification | Implementation in IPOPro |
| :--- | :--- | :--- |
| **Multi-Account Access** | Angel One SmartAPI enforces **strict 1:1 account binding**. One API key CANNOT access other client accounts. | Dedicated credential profile & isolated session context per account. No cross-account credential leakage. |
| **Allotment Tracking** | SmartAPI has **no endpoint** for IPO application or allotment verification. | Tracks pre-listing allotments via manual entry & CSV register import. Reconciles with Demat holdings (`getAllHolding`) on listing day. |
| **Pre-Open Session (09:00 - 09:45 IST)** | Indian exchanges (NSE/BSE) permit **ONLY LIMIT orders** during the IPO pre-open session. Market orders are rejected. | System enforces LIMIT order type during pre-open with price-tick validation. |
| **Depository Selling (DDPI vs eDIS)** | Equity delivery selling requires active **DDPI** on file or daily **CDSL TPIN authorization** via eDIS (`verifyDis`). | System checks and displays DDPI status per account, prompting operator to authorize TPIN before 09:00 AM. |
| **Static IP Mandate** | Angel One requires registered static IPv4 for live order placement endpoints. | Paper trading simulation runs completely unrestricted locally; Live trading activates only when static IP is configured. |
| **Rate Limits** | Holdings/OrderBook: **1 req/s**; Place Order: **20 req/s**. | Serialized async request queue with token-bucket rate limiting per account. |

---

## 2. System Architecture

```
+-----------------------------------------------------------------------------------+
|                           Unified Dashboard UI                                    |
|   [ Account Selector / Group Filter: All | Family (3) | Friends (2) | Demo (50) ] |
+-----------------------------------------------------------------------------------+
                                         |
                                (REST / WS Calls)
                                         v
+-----------------------------------------------------------------------------------+
|                         FastAPI Application Core                                  |
|                                                                                   |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|  | Multi-Account      |  | Market Data        |  | Risk Engine &               |  |
|  | Orchestrator       |  | Dispatcher         |  | Validation Pipeline         |  |
|  +--------------------+  +--------------------+  +-----------------------------+  |
|            |                        |                           |                 |
|            v                        v                           v                 |
|  +------------------------------------------------------------------------------+ |
|  |                 Account Session Pool (Isolated Contexts)                     | |
|  |                                                                              | |
|  |  [Account 1 Context]     [Account 2 Context]     [Account N Context]         | |
|  |  - API Key 1             - API Key 2             - API Key N                 | |
|  |  - ClientCode 1          - ClientCode 2          - ClientCode N              | |
|  |  - Active JWT Token      - Active JWT Token      - Active JWT Token          | |
|  |  - Rate-Limit Queue      - Rate-Limit Queue      - Rate-Limit Queue          | |
|  |  - DDPI / eDIS Status    - DDPI / eDIS Status    - DDPI / eDIS Status        | |
|  +------------------------------------------------------------------------------+ |
+-----------------------------------------------------------------------------------+
                               |              |
                               v              v
               +--------------------+    +--------------------+
               | Encrypted SQLite / |    | Angel One SmartAPI |
               | PostgreSQL Storage |    | (Dedicated sessions|
               | (AES-256-GCM)      |    |  per account)      |
               +--------------------+    +--------------------+
```

---

## 3. Project Directory Structure

```
d:/ANGLE ONE/
├── backend/
│   ├── alembic/                 # Database migrations (Alembic)
│   ├── app/
│   │   ├── api/                 # REST & WebSocket endpoints (/api/v1)
│   │   │   ├── endpoints_health.py
│   │   │   ├── endpoints_accounts.py
│   │   │   ├── endpoints_ipos.py
│   │   │   ├── endpoints_market.py
│   │   │   ├── endpoints_portfolio.py
│   │   │   ├── endpoints_orders.py
│   │   │   ├── endpoints_risk.py
│   │   │   └── endpoints_audit.py
│   │   ├── core/                # Configuration, AES-256 cipher, DB session
│   │   ├── models/              # SQLAlchemy models (Account, IPO, Allotment, Order, Risk, Audit)
│   │   ├── schemas/             # Pydantic validation schemas (v2 ConfigDict)
│   │   ├── services/            # SmartAPI adapter, Paper trader, Bulk order engine, Seed fixtures
│   │   └── main.py              # FastAPI application entry point
│   ├── tests/                   # 14 Pytest automated unit and integration tests
│   ├── requirements.txt
│   ├── .env.example
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── components/          # Sidebar, Header
│   │   ├── views/               # All 10 views (Dashboard, Accounts, IPOTracker, MarketWatch,
│   │   │                        # Portfolio, BulkOrders, Orders, Risk, Alerts, Settings)
│   │   ├── types.ts             # TypeScript interfaces
│   │   ├── api.ts               # Typed REST API service
│   │   ├── index.css            # Tailwind & financial monospace styling
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
├── docker-compose.yml           # Full-stack PostgreSQL + FastAPI + Nginx deployment
└── README.md
```

---

## 4. Local Quick Start Guide (Windows PowerShell)

### Prerequisites
- Python 3.11+
- Node.js v18+ & npm

### Step 1: Initialize Backend & Seed Database
Open a PowerShell terminal in `d:\ANGLE ONE\backend`:
```powershell
cd "d:\ANGLE ONE\backend"

# 1. Install dependencies
pip install -r requirements.txt

# 2. Apply database migrations
alembic upgrade head

# 3. Run automated test suite (verifies 14 tests pass)
python -m pytest -v

# 4. Start the FastAPI backend server
uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```
The backend API is now running at `http://127.0.0.1:8000`. Interactive OpenAPI documentation is available at `http://127.0.0.1:8000/docs`.

### Step 2: Start Frontend Application
Open a second PowerShell terminal in `d:\ANGLE ONE\frontend`:
```powershell
cd "d:\ANGLE ONE\frontend"

# 1. Install packages (if not already installed)
npm install

# 2. Validate TypeScript production build
npm run build

# 3. Start the Vite development server
npm run dev
```
Open `http://localhost:5173` in your browser to access the IPOPro dashboard.

---

## 5. How It Works: Client / Operator Perspective (A to Z)

1. **Dashboard Overview**:
   - The operator logs in and immediately sees total family accounts connected, active IPOs, confirmed allotments, total portfolio market value, and unrealized profit/loss.
   - The top banner clearly shows **PAPER TRADING** mode so no live capital is risked.
2. **Account Management**:
   - Operator views all family demat accounts with **masked client codes** (e.g. `A***567`) to maintain privacy.
   - The operator checks the **DDPI / eDIS** column. If DDPI is `INACTIVE`, the operator instructs that family member to complete their CDSL TPIN pre-authorization before 09:00 AM.
   - Clicking **Test** tests the connection and verifies whether the session token is active.
3. **IPO Tracking & Allotment Register**:
   - View IPOs in `Pre-Open`, `Listed`, or `Upcoming` status.
   - Click **Allotments** to view the exact account-wise breakdown.
   - Use **Import CSV** to upload the allotment registrar file or **Add Entry** for manual additions.
4. **Listing-Day Coordinated Bulk Selling**:
   - Navigate to the **Bulk Order Workspace**.
   - Select the listing IPO (e.g., `TATATECH`).
   - The system automatically loads all family accounts holding that stock and checks their sellable quantities.
   - Choose **Sell 100%** or **Sell 50%**, and enter the target Limit Price.
   - Click **Validate & Preview Orders**. The system verifies that no account's order exceeds the max risk value and that holding quantities are sufficient.
   - Click **Confirm & Dispatch Orders**. An explicit double-confirmation modal appears.
   - Upon confirmation, orders are dispatched sequentially to respect broker rate limits. A real-time result summary shows which accounts succeeded, which were filled, and any rejection reasons.
5. **Safety Controls**:
   - In case of abnormal market volatility or exchange outages, click the **EMERGENCY KILL SWITCH** in the sidebar to halt all trading instantly.

---

## 6. How It Works: Developer Perspective (A to Z)

1. **Secret Zero Security Architecture**:
   - Credentials (`api_key`, `pin`, `totp_secret`) are encrypted at the field level using authenticated **AES-256 Fernet** symmetric encryption (`SecretCipher` in `backend/app/core/security.py`).
   - The encryption key is sourced strictly from `APP_ENCRYPTION_KEY` in `.env`.
   - The API layer **never** serializes secrets back to the frontend; only `masked_client_code` is returned.
   - Audit logs recursively redact all sensitive keys (`password`, `pin`, `totp`, `jwtToken`, `refreshToken`).
2. **Official SmartAPI Integration**:
   - SmartAPI enforces a 1:1 client mapping. `SmartAPIAdapter` initializes an isolated session per account using `clientcode`, `password`/PIN, and dynamic TOTP generated via standard RFC 6238 (`generate_totp_token`).
   - Rate limiters throttle holding queries to 1 req/sec and order placements to 20 req/sec to prevent broker IP blacklisting.
3. **Isolated Paper Trading Simulation Engine**:
   - `PaperTradingService` provides a faithful simulation of the Indian exchange matching engine.
   - LIMIT sell orders execute when market LTP >= limit price; MARKET orders execute at current LTP.
   - Insufficient holdings, emergency halt activation, or duplicate submission idempotency keys trigger structured rejections matching broker response schemas.
4. **Pre-Flight Bulk Order Validation Pipeline**:
   - `BulkOrderService.prepare_and_validate` creates a unique batch UUID, checks holding balances, validates limit prices, verifies risk limits, and persists drafts in `PREPARED` status.
   - `BulkOrderService.execute_batch` requires `operator_confirmed=True`, runs each account in an isolated try-catch block, commits state transitions (`SUBMITTED` -> `EXECUTED` / `REJECTED`), and records audit events.
5. **Real-Time Market Streaming**:
   - FastAPI provides a WebSocket endpoint at `/api/v1/market/ws`.
   - When prices move or when simulated via `/api/v1/market/update-price`, `MarketFeedManager` broadcasts tick updates to all active browser connections.
