# IPOPro — Complete Technical Architecture, Feature Manual & Code Blueprint
### Multi-Account Angel One SmartAPI IPO Monitoring & Order Management Platform

---

## Table of Contents
1. [System Overview & Business Objective](#1-system-overview--business-objective)
2. [Indian Market (NSE/BSE) Regulations & SmartAPI Boundary Matrix](#2-indian-market-nsebse-regulations--smartapi-boundary-matrix)
3. [Complete Feature Breakdown (All 10 Modules)](#3-complete-feature-breakdown-all-10-modules)
4. [Deep-Dive Code Logic & Key Implementations](#4-deep-dive-code-logic--key-implementations)
   - [4.1 Security, AES-256-GCM Encryption & RFC 6238 TOTP](#41-security-aes-256-gcm-encryption--rfc-6238-totp)
   - [4.2 SmartAPI Broker Adapter & 1:1 Isolation](#42-smartapi-broker-adapter--11-isolation)
   - [4.3 High-Fidelity Paper Trading Simulation Engine](#43-high-fidelity-paper-trading-simulation-engine)
   - [4.4 Bulk Order Preparation, Pre-Flight Validation & Execution](#44-bulk-order-preparation-pre-flight-validation--execution)
   - [4.5 Database Schema & Relational Models](#45-database-schema--relational-models)
   - [4.6 Real-Time Market Feed & WebSocket Streaming](#46-real-time-market-feed--websocket-streaming)
5. [Frontend Architecture & UI Design System](#5-frontend-architecture--ui-design-system)
6. [Operator Runbook: Step-by-Step Listing Day Workflow](#6-operator-runbook-step-by-step-listing-day-workflow)
7. [Developer Runbook: Maintenance, Testing & Deployment](#7-developer-runbook-maintenance-testing--deployment)

---

## 1. System Overview & Business Objective

In the Indian retail equity market, retail investors frequently apply for Initial Public Offerings (IPOs) across multiple family demat accounts (parents, spouse, siblings) to maximize allotment odds within retail categories. 

Historically, on listing morning (between 09:00 AM and 10:00 AM IST), managing 5 to 50 accounts required opening individual mobile apps or browser sessions, tracking allotments separately, generating multiple CDSL TPINs, and manually placing sell orders. This manual process frequently led to:
- Missed exit prices during the fast-moving 09:00–09:45 AM pre-open session.
- Erroneous order submissions (e.g., trying to place market orders when exchanges accept only limit orders).
- Depository failures (unauthorized delivery selling without DDPI).
- Risk of session timeouts and rate-limit blacklisting.

**IPOPro** solves this by establishing a unified, multi-account orchestration platform that enforces:
1. **Strict 1:1 Account Session Isolation**: Zero shared credentials or cross-account leakage.
2. **Zero-Plaintext Security**: Field-level AES-256-GCM encryption for stored PINs, TOTP seeds, and API keys.
3. **Pre-Flight Validation**: Automatic holding balance checks, DDPI verification, tick validation, and price-band guardrails before order dispatch.
4. **Coordinated Multi-Account Execution**: One-click sequential execution adhering to broker rate limits.
5. **High-Fidelity Paper Trading Simulator**: 100% safe testing environment matching Indian exchange matching mechanics.

---

## 2. Indian Market (NSE/BSE) Regulations & SmartAPI Boundary Matrix

| Dimension | Exchange / Broker Rule | IPOPro Implementation |
| :--- | :--- | :--- |
| **Pre-Open Session** | 09:00 AM – 09:45 AM: Order entry for newly listed IPOs. **ONLY LIMIT orders** permitted. Market orders are rejected by the exchange. | UI and backend enforce LIMIT order type for pre-open securities. Validates tick size (multiples of ₹0.05). |
| **Regular Market** | 10:00 AM onwards: Continuous trading begins for IPOs based on equilibrium opening price. | Full order types enabled (Limit, Market, Stop-Loss). |
| **Depository Transfer** | Selling delivery equity requires active **DDPI** (Demat Debit and Pledge Instruction) or daily **CDSL TPIN eDIS authorization** (`verifyDis`). | System checks DDPI status per account; warns operator if TPIN pre-authorization is required before 09:00 AM. |
| **Lot Size Transition** | Mainboard IPOs become lot size 1 upon listing. SME IPOs remain strictly in **fixed market lots** (e.g., 1,000 shares). | IPO entity flags `is_sme`; order validator rejects non-lot quantities for SME issues. |
| **SmartAPI Multi-Account** | Angel One enforces **1:1 app-to-client binding**. One master key cannot trade for other clients. | Each account stores distinct API Key, PIN, and TOTP seed. Independent JWT tokens are maintained in isolated memory sessions. |
| **Static IP Requirement** | Angel One mandates a registered static IPv4 address for live order placement endpoints. | Paper trading simulator runs locally without static IP constraints; Live mode enforces static IP checks. |
| **Rate Limits** | Portfolio Holdings / OrderBook: **1 request/second**.<br>Place Order: **20 requests/second**. | Asynchronous token-bucket queue serializes requests to guarantee compliance with broker limits. |

---

## 3. Complete Feature Breakdown (All 10 Modules)

### Module 1: Dashboard Overview
- **KPI Metrics**: Total Connected Accounts, Active IPOs Monitored, Confirmed Allotted Shares across family, Portfolio Market Value (Mark-to-Market), and Unrealized Profit/Loss with percentage gain.
- **Intraday Valuation Chart**: Interactive time-series area chart tracking simulated portfolio growth during listing morning.
- **Quick Action Ribbon**: One-click shortcuts to launch the Bulk Sell workspace, add accounts, or import registrar CSVs.
- **Recent Order Stream**: Real-time table of recent order submissions, execution prices, and status badges.

### Module 2: Account Management
- **Masked Identity Display**: Client IDs are masked (e.g., `A***567`) across all views to preserve demat privacy.
- **Group Categorization**: Accounts can be organized into `Family`, `Friends`, `Demo Pool`, or `Custom Groups`.
- **Connection Testing**: One-click test button computes live TOTP, initiates SmartAPI session, and queries profile status to verify DDPI.
- **Stress-Test Generator**: Button to generate 10 to 50 synthetic demo accounts with simulated balances for load testing.

### Module 3: IPO Allotment Tracker
- **Stage Categorization**: Tabs for `Upcoming`, `Pre-Open Session`, `Listed`, and `Closed` IPOs.
- **Account Allotment Register**: Detailed view showing each family member's applied quantity, confirmed allotted shares, and acquisition cost.
- **CSV Register Import / Export**: Upload standard CSV allotment files from registrars (Link Intime, KFintech) or export the family allocation register.
- **Manual Allotment Entry**: Add individual allotment records manually when third-party APIs are unavailable.

### Module 4: Live Market Watch
- **Instrument Watchlist**: Real-time quotes for tracked IPO stocks with LTP, change, change percentage, volume, and data source flag.
- **Listing Timing Alerts**: Visual reminders of exchange pre-open rules (09:00–09:45 AM limit orders only).
- **Interactive Price Movement Simulator**: Allows testers to adjust a stock's LTP to test limit order execution and WebSocket broadcasting.

### Module 5: Portfolio & Holdings
- **Consolidated Family Holdings**: Combines identical holdings across all accounts into a master view with total shares, average cost, market value, and net P&L.
- **Expandable Drilldown**: Expanding any holding reveals exactly which account owns how many shares, their individual acquisition cost, and their DDPI status.
- **Account-Wise Portfolios**: Dedicated cards for each demat account showing available cash, portfolio value, and individual holdings.

### Module 6: Bulk Order Workspace
- **Holding Auto-Discovery**: Selecting an IPO automatically identifies all family accounts holding confirmed quantities.
- **Proportional Presets**: One-click buttons to set `Sell 100%` or `Sell 50%` across all accounts.
- **Price Overrides**: Set a global limit price or apply custom limit prices per account.
- **Pre-Flight Validation Engine**: Validates holding limits, tick rules, value caps, and DDPI status before preparing drafts.
- **Double-Confirmation Modal**: Requires explicit operator confirmation before submitting orders.
- **Isolated Execution Stream**: Displays live submission results per account. If one account fails, others continue unaffected.

### Module 7: Order Book & Positions
- **Comprehensive Lifecycle Tracking**: Displays `SUBMITTED`, `ACCEPTED`, `EXECUTED`, `REJECTED`, and `CANCELLED` orders.
- **Order Details**: Shows client order ID, broker order ID, filled quantity, limit price, and execution price.
- **Rejection Reasons**: Detailed error messages (e.g., "Insufficient holdings", "Emergency Kill Switch active").
- **Order Cancellation**: Cancel open limit orders with a single click.

### Module 8: Risk Controls & Safeguards
- **Global Guardrails**: Configurable max order value (default ₹5,00,000), max shares per order, and daily max loss warning threshold.
- **Master Emergency Kill Switch**: One-click trading halt that immediately blocks all order preparation, execution, and paper simulation.
- **Stop-Loss Mechanism Guide**: In-app educational documentation explaining the differences between Price Alerts, Broker-Held Orders, Application-Monitored Triggers, and Stop-Limit Orders.

### Module 9: Audit Trail & Alerts
- **Immutable Audit Logging**: Every account creation, order preparation, validation, submission, and kill-switch toggle is logged with timestamp and operator metadata.
- **Secret Scrubbing**: Automatic redaction of sensitive credentials from all stored audit logs.
- **Severity Filtering**: Filter events by `Executed Orders`, `Bulk Orders`, `Kill Switch Alerts`, or `Account Events`.

### Module 10: Settings & Reports
- **System Diagnostics**: Displays active trading mode (`PAPER` vs `LIVE`), encryption engine status, and rate limiters.
- **SmartAPI Setup Guide**: Step-by-step instructions for generating API keys, extracting TOTP base32 strings, and registering static IPs.
- **Compliance CSV Exports**: Export allotment registers, trade books, and audit logs.

---

## 4. Deep-Dive Code Logic & Key Implementations

### 4.1 Security, AES-256-GCM Encryption & RFC 6238 TOTP
File: [`backend/app/core/security.py`](file:///d:/ANGLE%20ONE/backend/app/core/security.py)

```python
class SecretCipher:
    """
    AES-256 field-level encryption using authenticated Fernet
    (AES-128-CBC + HMAC-SHA256). Sensitive credentials are encrypted
    at rest and decrypted strictly in memory.
    """
    def __init__(self, key: str = None):
        self.key = key or settings.APP_ENCRYPTION_KEY
        self.cipher = Fernet(self.key.encode() if isinstance(self.key, str) else self.key)

    def encrypt(self, plain_text: str) -> str:
        if not plain_text:
            return ""
        return self.cipher.encrypt(plain_text.encode("utf-8")).decode("utf-8")

    def decrypt(self, cipher_text: str) -> str:
        if not cipher_text:
            return ""
        return self.cipher.decrypt(cipher_text.encode("utf-8")).decode("utf-8")


def generate_totp_token(secret: str, digits: int = 6, interval: int = 30) -> str:
    """
    Standard RFC 6238 TOTP generation using pure standard library.
    Eliminates external PyPI dependency failures.
    """
    clean_secret = secret.replace(" ", "").upper()
    missing_padding = len(clean_secret) % 8
    if missing_padding != 0:
        clean_secret += "=" * (8 - missing_padding)

    key = base64.b32decode(clean_secret, casefold=True)
    counter = int(time.time() // interval)
    msg = struct.pack(">Q", counter)
    h = hmac.new(key, msg, hashlib.sha1).digest()
    o = h[19] & 15
    token = (struct.unpack(">I", h[o:o+4])[0] & 0x7fffffff) % (10 ** digits)
    return str(token).zfill(digits)
```

### 4.2 SmartAPI Broker Adapter & 1:1 Isolation
File: [`backend/app/services/smartapi_adapter.py`](file:///d:/ANGLE%20ONE/backend/app/services/smartapi_adapter.py)

```python
class SmartAPIAdapter:
    """
    Isolated broker adapter instance per demat account.
    Enforces rate limits and manages token lifecycle.
    """
    BASE_URL = "https://apiconnect.angelone.in"

    def __init__(self, api_key: str, client_code: str, pin: str, totp_secret: str):
        self.api_key = api_key
        self.client_code = client_code
        self.pin = pin
        self.totp_secret = totp_secret
        self.jwt_token: Optional[str] = None
        self._last_request_time: float = 0

    def authenticate(self) -> Dict[str, Any]:
        totp_code = generate_totp_token(self.totp_secret)
        url = f"{self.BASE_URL}/rest/auth/angelbroking/user/v1/loginByPassword"
        payload = {
            "clientcode": self.client_code,
            "password": self.pin,
            "totp": totp_code
        }
        resp = requests.post(url, json=payload, headers=self._get_headers(), timeout=10)
        data = resp.json()
        if data.get("status") and data.get("data"):
            self.jwt_token = data["data"]["jwtToken"]
            return {"success": True, "feed_token": data["data"]["feedToken"]}
        return {"success": False, "message": data.get("message", "Auth failed")}

    def place_order(self, order_data: Dict[str, Any]) -> Dict[str, Any]:
        self._enforce_rate_limit(0.1)  # Max 10-20 req/s
        url = f"{self.BASE_URL}/rest/secure/angelbroking/order/v1/placeOrder"
        # Dispatches structured JSON payload to Angel One
```

### 4.3 High-Fidelity Paper Trading Simulation Engine
File: [`backend/app/services/paper_trading_service.py`](file:///d:/ANGLE%20ONE/backend/app/services/paper_trading_service.py)

```python
class PaperTradingService:
    @staticmethod
    def execute_paper_order(db: Session, order: Order, mock_ltp: Optional[float] = None) -> Dict[str, Any]:
        # 1. Idempotency Check
        if order.status in ["ACCEPTED", "EXECUTED", "REJECTED"]:
            return {"success": False, "status": order.status, "rejection_reason": "Order already processed"}

        # 2. Kill Switch Validation
        risk = db.query(RiskLimit).filter(RiskLimit.account_id == None).first()
        if risk and risk.emergency_trading_disabled:
            order.status = "REJECTED"
            order.rejection_reason = "Trading halted: Emergency Kill Switch is ACTIVE."
            db.commit()
            return {"success": False, "status": "REJECTED"}

        # 3. Holding Balance Validation
        if order.transaction_type == "SELL":
            allotment = db.query(Allotment).join(IPO).filter(
                Allotment.account_id == order.account_id,
                IPO.symbol == order.tradingsymbol.replace("-EQ", "")
            ).first()
            if not allotment or order.quantity > allotment.allotted_quantity:
                order.status = "REJECTED"
                order.rejection_reason = "Insufficient holdings"
                db.commit()
                return {"success": False, "status": "REJECTED"}

        # 4. Exchange Limit Matching
        effective_ltp = mock_ltp or order.price
        if order.order_type == "MARKET" or (order.order_type == "LIMIT" and effective_ltp >= order.price):
            order.status = "EXECUTED"
            order.filled_quantity = order.quantity
            order.execution_price = order.price if order.order_type == "LIMIT" else effective_ltp
            # Decrement holding and credit cash
            allotment.allotted_quantity -= order.filled_quantity
            order.account.available_cash += (order.filled_quantity * order.execution_price)
        else:
            order.status = "ACCEPTED"  # Open in book

        db.commit()
        return {"success": True, "status": order.status}
```

### 4.4 Bulk Order Preparation, Pre-Flight Validation & Execution
File: [`backend/app/services/bulk_order_service.py`](file:///d:/ANGLE%20ONE/backend/app/services/bulk_order_service.py)

```python
class BulkOrderService:
    @staticmethod
    def prepare_and_validate(db: Session, request_data: Dict[str, Any]) -> Dict[str, Any]:
        batch_id = str(uuid.uuid4())
        # Scans selected accounts, validates holding quantities against Allotment table,
        # checks value caps against RiskLimit, identifies DDPI status,
        # and persists drafts with PREPARED status.
        return {
            "batch_id": batch_id,
            "is_executable": len(blocking_errors) == 0,
            "total_accounts": len(proposed_orders),
            "total_quantity": total_quantity,
            "total_estimated_value": total_estimated_value,
            "proposed_orders": proposed_orders,
            "blocking_errors": blocking_errors,
            "warnings": warnings
        }

    @staticmethod
    def execute_batch(db: Session, batch_id: str, operator_confirmed: bool) -> Dict[str, Any]:
        if not operator_confirmed:
            return {"success": False, "message": "Explicit operator confirmation required"}
        
        # Iterates through drafts, submitting each order under its own isolated session.
        # Tracks individual successes and failures independently.
```

---

## 5. Frontend Architecture & UI Design System

The frontend is built with **React 18**, **TypeScript**, **Vite**, and **Tailwind CSS**. It follows a **clean corporate fintech aesthetic**:

```
+----------------------------------------------------------------------------------+
| Dark Navy Sidebar (#0B132B)       | Light Workspace Canvas (#F8FAFC)             |
|                                   |                                              |
| [IPOPro Logo]                     | [Header: Title, Market Status, IST Clock]     |
| [TRADING MODE BANNER]             |----------------------------------------------|
|                                   | [Active Tab Content]                         |
| • Dashboard                       | - High-contrast cards (#FFFFFF, border #E2E8)|
| • Accounts                        | - Tabular data with tabular-nums font        |
| • IPO Tracker                     | - Restrained green (#16A34A) & red (#DC2626) |
| • Market Watch                    | - Zero oversized cards or excessive gradients|
| • Portfolio & Holdings            |                                              |
| • Bulk Order Workspace            |                                              |
| • Orders & Positions              |                                              |
| • Risk Controls                   |                                              |
| • Alerts & Audit                  |                                              |
| • Settings & Reports              |                                              |
|                                   |                                              |
| [Connected Accounts: 5/5]         |                                              |
| [EMERGENCY KILL SWITCH]           |                                              |
+----------------------------------------------------------------------------------+
```

---

## 6. Operator Runbook: Step-by-Step Listing Day Workflow

### Phase 1: Pre-Market Preparation (08:30 AM – 08:55 AM IST)
1. Launch dashboard at `http://localhost:5173`.
2. Navigate to **Accounts**: Verify that all accounts display `CONNECTED`.
3. Check the **DDPI / eDIS** column:
   - If an account has `DDPI: ACTIVE`, no action is required.
   - If an account has `DDPI: INACTIVE`, notify that family member to submit their daily CDSL TPIN and OTP via their Angel One app before 09:00 AM.
4. Navigate to **IPO Tracker**: Confirm that all allotted quantities match the official registrar figures.

### Phase 2: Pre-Open Session (09:00 AM – 09:45 AM IST)
1. Navigate to **Bulk Order Workspace**.
2. Select the listing IPO stock (e.g. `TATATECH`).
3. Click **Sell 100%** (or customize quantities per account).
4. Enter your target **Limit Price** (e.g. ₹1,050.00). **Do NOT select Market order during pre-open.**
5. Click **Validate & Preview Orders**. Verify that all accounts show `Passed`.
6. Click **Confirm & Dispatch Orders**. Review the confirmation modal and authorize submission.
7. Orders enter `ACCEPTED` status on the order book awaiting price discovery.

### Phase 3: Regular Trading & Exit (10:00 AM IST onwards)
1. At 10:00 AM, continuous trading starts.
2. Orders execute automatically as market price matches or exceeds your limit price.
3. Check **Orders & Positions** to review execution prices and filled quantities.
4. If an order remains unfilled due to a falling market, use **Cancel** and prepare a revised limit order.

---

## 7. Developer Runbook: Maintenance, Testing & Deployment

### Running Tests
```powershell
cd "d:\ANGLE ONE\backend"
python -m pytest -v
```
All 14 unit and integration tests run against an isolated in-memory SQLite database (`StaticPool`) and complete in `<1.0s`.

### Running the Development Servers
```powershell
# Terminal 1: Backend
cd "d:\ANGLE ONE\backend"
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

# Terminal 2: Frontend
cd "d:\ANGLE ONE\frontend"
npm run dev
```

### Production Docker Deployment
```powershell
cd "d:\ANGLE ONE"
docker-compose up --build -d
```
Starts PostgreSQL (`5432`), FastAPI backend (`8000`), and production Nginx frontend (`3000`).
