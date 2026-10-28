# IPOPro — Architecture & Data Flow Specification

This document details the complete end-to-end software architecture, data flow paths, session lifecycle, and concurrency model of the IPOPro application.

---

## 1. High-Level Architectural Diagram

```mermaid
flowchart TD
    subgraph Client["Frontend Layer (React 18 + TypeScript + Vite)"]
        UI[IPOPro Single Page App]
        State[Connection Manager & Schedulers]
        WS_Client[WebSocket Tick Consumer]
    end

    subgraph Backend["Backend Application Layer (FastAPI + Python 3.11)"]
        Router[API Gateway & Rate Limiter]
        AuthService[Auth & Credential Vault - Fernet]
        SyncService[Portfolio Reconciliation Service]
        PaperEngine[Paper Trading Matching Engine]
        ChatEngine[AI Financial Context Engine]
        WS_Server[WebSocket Price Broadcast Server]
    end

    subgraph Storage["Persistence & Caching Layer"]
        DB[(SQLAlchemy ORM - SQLite / PostgreSQL)]
        JSONBackup[(Disposable Storage Backup File)]
    end

    subgraph Broker["External Broker Infrastructure"]
        SmartAPI[Angel One SmartAPI REST]
        BrokerWS[Angel One Market Streamer]
    end

    UI -->|REST /api/v1| Router
    WS_Client <-->|ws://ticks| WS_Server
    Router --> AuthService
    Router --> SyncService
    Router --> PaperEngine
    Router --> ChatEngine

    AuthService --> SmartAPI
    SyncService --> SmartAPI
    WS_Server <-- BrokerWS

    SyncService --> DB
    PaperEngine --> DB
    ChatEngine --> DB
    DB -.->|Periodic Auto-Restore / Dump| JSONBackup
```

---

## 2. Authentication & Session Concurrency Flow

Angel One SmartAPI requires:
- `api_key`
- `client_code`
- `pin` (MPIN)
- `totp` (6-digit time-based one-time password generated from a Base32 secret)

### Thread-Safe Session Concurrency Model
To prevent race conditions during simultaneous API calls across multiple Demat accounts:
1. **Adapter Cache Lock (`threading.Lock`):**
   - Access to the in-memory adapter cache dictionary `_adapter_cache` is serialized with `_adapter_lock`.
2. **Re-entrant Session Lock (`threading.RLock`):**
   - Each `SmartAPIAdapter` instance encapsulates a dedicated `_auth_lock = threading.RLock()`.
   - `_ensure_authenticated()` acquires `_auth_lock` and inspects token expiration timestamp.
   - If token is missing, expired, or invalidated (`is_session_expired = True`), it invokes `self.authenticate()`, which safely re-enters the same lock without deadlocking.
3. **Session Re-use:**
   - Active JWT tokens are cached and re-used across requests until within 300 seconds of broker expiration, minimizing redundant login round-trips.

```mermaid
sequenceDiagram
    autonumber
    actor User as Frontend / Operator
    participant API as FastAPI Router
    participant Adapter as SmartAPIAdapter
    participant Vault as Security Cipher (Fernet)
    participant Broker as Angel One SmartAPI

    User->>API: GET /api/v1/accounts/1/holdings
    API->>Vault: Decrypt API Key, MPIN, TOTP Secret
    Vault-->>API: Cleartext credentials (in-memory only)
    API->>Adapter: get_adapter_for_account(account_id)
    Note over Adapter: Acquire _auth_lock (RLock)
    alt Token Valid & Active
        Adapter-->>API: Return existing session token
    else Token Expired or Missing
        Adapter->>Adapter: Generate 6-digit TOTP from normalized Base32 secret
        Adapter->>Broker: POST /rest/auth/partner/v1/loginByPassword
        Broker-->>Adapter: 200 OK (jwtToken, feedToken, refreshToken)
        Adapter->>Adapter: Cache token & set expiry (timestamp + 24h)
    end
    API->>Broker: GET /rest/secure/angelbroking/portfolio/v1/getAllHolding
    Broker-->>API: Return Demat holdings payload
    API->>User: Return holdings (masked credentials)
```

---

## 3. Real-Time Price Streaming & P&L Calculation

1. **Broker Tick Streaming:**
   - The backend maintains an asynchronous connection to Angel One WebSocket servers or generates synchronized simulation ticks in Paper mode.
2. **Fan-Out via Local WebSocket:**
   - Connected browser clients open a persistent WebSocket channel at `/api/v1/market/ws`.
   - Ticks containing `symbol_token`, `last_traded_price`, and `timestamp` are broadcast to all subscribers.
3. **Frontend Calculation Engine (`PortfolioView.tsx`):**
   - When a tick is received for an active holding, the client updates the prevailing LTP in memory.
   - The current market value (`allotted_quantity * current_ltp`) and unrealized P&L (`current_market_value - total_investment`) are recomputed instantly in pure JavaScript.
   - Total portfolio valuation, day change, and overall returns update continuously without page reloads.

---

## 4. Rate Limiting & Protection Layers

1. **FastAPI Rate Limiting (`SlowAPI` / Token Bucket):**
   - Critical operational endpoints (e.g. `/orders/single`, `/orders/bulk-execute`, `/accounts/{id}/reconnect`) are rate-limited to 30 requests per minute per IP to prevent broker rate-limit penalties.
2. **Emergency Trading Halt:**
   - A global kill switch stored in `RiskLimit` can be engaged at any time. When active, all order execution endpoints reject orders immediately with an explicit halt notice.
3. **Retail Application Capping:**
   - IPO application builders enforce the SEBI ₹200,000 retail investment ceiling across Demat accounts, blocking bids that exceed statutory thresholds.
