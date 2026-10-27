# IPOPro — System Documentation: Feature & User Experience Guide

---

## 1. End-to-End User Experience & Journey

### Step 1: Accessing the Application
When an operator accesses `http://localhost:5173`, the application displays the **Dashboard**. 
- The persistent **Header** displays the live Indian Standard Time (IST) clock (`HH:MM:SS IST`), the active execution environment badge (`PAPER TRADING (SIMULATION)` vs `LIVE TRADING (BROKER)`), and the active backend connectivity status (`ONLINE` vs `OFFLINE`).
- The dark navy **Sidebar** provides immediate navigation across the 10 core views and features a prominent, persistent **Emergency Kill Switch** button.

### Step 2: Account Registration & Authentication Setup
1. The operator navigates to **Accounts** (`AccountsView.tsx`).
2. If no accounts are registered, a clear empty state informs the user: *"No broker accounts registered. Click + Add Account to configure your first trading account."*
3. The operator clicks **+ Add Account** to open the registration drawer:
   - **Account Alias**: (e.g., *"Self - Angel"*, *"Wife - Demat"*, *"Father - HNI"*).
   - **Client Code**: Angel One user identifier (e.g., `V123456`).
   - **MPIN / Password**: 4-digit numeric MPIN.
   - **TOTP Secret Key**: 32-character base32 secret generated on the Angel One SmartAPI developer portal.
   - **API Key**: Unique SmartAPI app key associated with that client code.
4. Upon clicking **Save Account**:
   - The frontend validates required inputs.
   - The backend encrypts sensitive fields via AES-256 Fernet.
   - The client ID is masked in the response (`V***456`).
   - The card appears in the UI displaying: Client Code, Alias, Connection Status (`PENDING`), DDPI Status (`UNCHECKED`), and Last Sync timestamp.
5. The operator clicks **Test Auth**:
   - The backend runs `SmartAPIAdapter.authenticate()`.
   - The adapter generates a real-time RFC 6238 TOTP code, submits `loginByPassword`, extracts session tokens, and queries profile margin and DDPI status.
   - The account status changes to `ACTIVE` with a green indicator, displaying verified cash margin (e.g., `₹45,210.00`).

### Step 3: Registering IPOs & Ingesting Allotment Data
1. The operator navigates to **IPO Tracker** (`IPOTrackerView.tsx`).
2. Clicking **+ Register IPO** opens the creation modal:
   - Fields: Symbol (`TATATECH`), Name (`Tata Technologies Ltd`), Lot Size (`30`), Issue Price (`500.00`), Expected Listing Price (`1200.00`), Listing Date, Status (`UPCOMING`, `PRE_OPEN`, `LISTED`, or `CLOSED`).
3. To assign allotment records:
   - **Option A (Manual Entry)**: Click **View Allotments** on the IPO card. A modal opens listing registered accounts. The operator enters allotted lot counts (e.g., 1 lot = 30 shares) and marks status as `CONFIRMED`.
   - **Option B (CSV Upload)**: Click **Upload Registrar CSV**. The operator selects a standard registrar allotment CSV (columns: `client_id`, `pan`, `allotted_shares`, `application_number`). The backend parses and links records directly to matching `BrokerAccount` records.

### Step 4: Listing Morning Market Surveillance
1. On listing morning between 09:00 AM and 09:45 AM (pre-open call auction), the operator navigates to **Market Watch** (`MarketWatchView.tsx`).
2. The watchlist displays:
   - Tracked IPO symbols.
   - Indicative equilibrium price (LTP).
   - Absolute and percentage change relative to issue price.
   - Bid/Ask depth and timestamp of the last quote.
3. The live WebSocket listener receives incoming ticks. If market data stops updating, a yellow stale-data badge appears (`STALE DATA > 15s`).

### Step 5: Preparing & Executing Multi-Account Bulk Orders
1. The operator navigates to **Bulk Orders** (`BulkOrderView.tsx`).
2. **Account Selection**: The operator selects target accounts from a multi-select table.
3. **Parameter Configuration**:
   - Selects IPO symbol (`TATATECH`).
   - Selects Order Type: `LIMIT` (Indian exchanges reject market orders during pre-open).
   - Enters Limit Price (e.g., `₹1,250.00`).
   - Selects Action: `SELL`.
4. **Step 1: Pre-Flight Validation**:
   - The operator clicks **Run Pre-Flight Validation**.
   - The backend queries each account's physical Demat holdings (`getAllHolding`).
   - The system checks tick size (`price % 0.05 == 0`), price bands, and active DDPI status.
   - If an account has 0 shares or insufficient holdings, an inline error badge appears with clear rejection details.
5. **Step 2: Preview & Double Confirmation**:
   - The operator clicks **Prepare Order Batch**.
   - A draft summary displays: Account Alias, Masked Client Code, Sellable Quantity, Limit Price, Estimated Gross Value, and Potential Fees.
   - The operator must explicitly check the confirmation checkbox: *"I confirm that all order parameters are correct and authorize batch placement."*
6. **Step 3: Execution**:
   - The operator clicks **Execute Bulk Batch**.
   - A progress bar updates in real time as each order is routed through its isolated account session.
   - Completed orders report: Broker Order ID, Submission Timestamp, Execution Status (`COMPLETED` or `REJECTED`), and Fill Price.

---

## 2. Screen-by-Screen Interaction Guide

### 2.1 View 1: Dashboard (`DashboardView.tsx`)
- **Purpose**: Executive overview of portfolio value, active IPOs, account connection health, and market performance.
- **Key Widgets**:
  1. *KPI Cards*: Total Connected Accounts, Active IPOs Tracked, Confirmed Allotment Lots, Total Portfolio Value (INR), and Unrealized P&L.
  2. *Market Trends Chart*: Recharts area graph depicting daily portfolio valuation trends.
  3. *Account Health List*: Mini-cards showing connection status, last sync, and DDPI readiness.
  4. *Listing Alerts Widget*: Quick notices of IPOs listing today.
- **States**:
  - *Loading*: Animated pulse skeleton cards.
  - *Empty*: Zero-data banner with call-to-action buttons pointing to Accounts and IPO Tracker.

### 2.2 View 2: Accounts Management (`AccountsView.tsx`)
- **Purpose**: Registration, credential management, session testing, and status monitoring of broker accounts.
- **Key Widgets**:
  1. *Account Grid*: Cards displaying masked client ID, alias, connection status badge, DDPI status, cash balance, and action buttons.
  2. *Add Account Drawer*: Sliding modal containing input fields with client-side format validation.
  3. *Account Details Modal*: Expanded view displaying session token expiry, registered Demat DP ID, and recent order history.
- **Actions**:
  - *+ Add Account*: Opens registration form.
  - *Test Auth*: Sends live authentication request to Angel One SmartAPI.
  - *Sync Holdings*: Forces Demat holding refresh from Angel One.
  - *Delete Account*: Opens double-confirmation prompt before removing credentials.

### 2.3 View 3: IPO Allotment Tracker (`IPOTrackerView.tsx`)
- **Purpose**: Lifecycle tracking of IPOs and granular allotment records per family member.
- **Key Widgets**:
  1. *Filter Tabs*: All, Upcoming, Pre-Open, Listed, Closed.
  2. *IPO Card Grid*: Cards showing symbol, issue price, lot size, listing date, listing gain %, and total allotted value.
  3. *Allotment Management Modal*: Table listing each account, application number, category (Retail / HNI), lots applied, and lots allotted.
  4. *CSV Import Drawer*: File dropper accepting `.csv` files with validation of required headers (`client_id`, `allotted_shares`).

### 2.4 View 4: Market Watch & Depth (`MarketWatchView.tsx`)
- **Purpose**: Real-time market data monitoring, order book depth inspection, and tick simulation.
- **Key Widgets**:
  1. *Watchlist Table*: Symbol, Exchange (NSE/BSE), LTP, High, Low, Volume, Last Updated.
  2. *5-Level Market Depth*: Bid/Ask price and quantity ladders.
  3. *Market Simulator Controls*: Allows manual price manipulation and tick triggering during test sessions.

### 2.5 View 5: Portfolio & Holdings (`PortfolioView.tsx`)
- **Purpose**: Consolidated and account-wise Demat holdings view with mark-to-market valuation.
- **Key Widgets**:
  1. *Consolidated Summary Banner*: Total invested capital, current market value, overall P&L, day's change.
  2. *Holdings Table*: Grouped by symbol or account; displays Quantity, Average Cost, Current LTP, Current Value, and Unrealized P&L.
  3. *Account Filter Dropdown*: Allows filtering down to a single family account.

### 2.6 View 6: Bulk Order Workspace (`BulkOrderView.tsx`)
- **Purpose**: Safe, coordinated multi-account order preparation and execution.
- **Key Widgets**:
  1. *Account Multi-Selector*: Checkbox list showing account alias, available shares, and DDPI status.
  2. *Order Parameter Form*: Symbol selector, order type radio (`LIMIT` / `MARKET`), limit price input with tick-size stepper (`₹0.05`), action toggle (`BUY` / `SELL`).
  3. *Validation Warnings Panel*: Highlights blocking errors (e.g., insufficient shares, market order selected during pre-open).
  4. *Order Batch Preview Table*: Itemized breakdown of planned orders.
  5. *Execution Progress & Outcome Table*: Real-time progress tracker with order IDs and fill statuses.

### 2.7 View 7: Orders & Positions (`OrdersView.tsx`)
- **Purpose**: Complete audit book of all requested, open, completed, and rejected orders.
- **Key Widgets**:
  1. *Filter Bar*: Filter by status (`ALL`, `OPEN`, `COMPLETED`, `REJECTED`, `CANCELLED`), Account, or Symbol.
  2. *Order Book Table*: Order ID, Account Alias, Timestamp, Symbol, Type, Quantity, Price, Status, and Action.
  3. *Order Cancellation Action*: Allows single-click cancellation of open limit orders.

### 2.8 View 8: Risk Management (`RiskView.tsx`)
- **Purpose**: Exposure limits configuration and emergency fail-safe controls.
- **Key Widgets**:
  1. *Emergency Kill Switch Card*: Red high-visibility card displaying current halt status and one-click toggle.
  2. *Risk Parameter Form*: Max Order Value per Account (INR), Max Batch Value (INR), Max Daily Loss Threshold (INR), Require Pre-Flight Validation toggle.
  3. *Risk Audit Log*: Historical record of triggered limits and halt events.

### 2.9 View 9: Alerts & Audit Trail (`AlertsView.tsx`)
- **Purpose**: Tamper-evident operational logging and system notification feed.
- **Key Widgets**:
  1. *Alert Severity Filter*: All, Info, Warning, Error, Critical.
  2. *Audit Trail Table*: Timestamp, Event Type, Account Affected, IP Address, Action Summary, and Sanitized Details payload.

### 2.10 View 10: Settings & Compliance Reports (`SettingsView.tsx`)
- **Purpose**: System configuration, environment variables inspection, and compliance CSV downloads.
- **Key Widgets**:
  1. *Environment Configuration Panel*: Displays API Base URL, Encryption Engine (`AES-256 Fernet`), Static IP status, and Active Database engine.
  2. *CSV Report Exporters*: Download Trade Book CSV, Download Allotment Register CSV, Download Audit Log CSV.
  3. *SmartAPI Quick Reference*: Instructions on setting up Angel One API keys and TOTP.

---

## 3. System Behavior Scenarios

### Scenario 1: Application Startup
```
[User loads browser]
  → Frontend mounts App.tsx
  → Header calls GET /api/v1/health
  → Backend executes SELECT 1 against database
  → If DB responds: returns {"status": "UP", "database": "HEALTHY"}
  → Frontend displays green "ONLINE" status and initializes WebSocket at /api/v1/market/ws
```

### Scenario 2: Emergency Kill Switch Triggered
```
[Operator clicks "Emergency Kill Switch" in Sidebar]
  → Frontend sends POST /api/v1/risk/emergency-halt with {"halt": true}
  → Backend updates RiskLimit record in database to is_emergency_halt=True
  → Backend creates critical AuditLog record: "EMERGENCY_HALT_ACTIVATED"
  → Any subsequent call to POST /api/v1/orders/bulk-execute or POST /api/v1/orders/create
    is intercepted by BulkOrderService and rejected immediately with HTTP 403:
    "TRADING_HALTED: Emergency Kill Switch is currently ACTIVE"
  → Frontend displays persistent red warning banner across all views
```

### Scenario 3: Pre-Flight Bulk Order Validation Failure (Insufficient Holdings)
```
[Operator selects Account 1 (0 TATATECH shares) and Account 2 (30 TATATECH shares)]
  → Operator clicks "Run Pre-Flight Validation"
  → Frontend sends POST /api/v1/orders/bulk-prepare
  → BulkOrderService loops through selected accounts:
      - Account 1: Demat balance = 0. Appends blocking error: "INSUFFICIENT_HOLDINGS: Requires 30, available 0"
      - Account 2: Demat balance = 30. Passes checks.
  → Backend returns HTTP 200 with validation_status="FAILED", can_execute=False, itemized errors
  → Frontend disables "Execute Bulk Batch" button and highlights Account 1 in red
```

### Scenario 4: Stale Market Data Detection
```
[WebSocket market stream disconnects or pauses]
  → MarketWatchView tracks timestamp of last received tick per symbol
  → Client-side timer compares Date.now() - tick.timestamp
  → If difference > 15,000 ms:
      - Price badge turns yellow
      - Label updates to: "STALE DATA (Last updated 18s ago)"
      - Pre-open order execution displays warning dialog before submission
```

### Scenario 5: External Angel One SmartAPI Network Timeout
```
[Backend attempts live order placement via SmartAPIAdapter]
  → HTTP POST to Angel One apiconnect gateway times out after 10,000 ms
  → SmartAPIAdapter catches httpx.TimeoutException
  → Order status in database is set to "SUBMISSION_UNKNOWN" (never marked as FAILED or FILLED)
  → AuditLog records: "BROKER_TIMEOUT: Order submission outcome unknown"
  → UI displays amber status badge: "UNKNOWN OUTCOME - Manual Verification Required"
  → Operator is prompted to check Angel One mobile app before re-submitting to prevent double-selling
```
