# IPOPro — Known Issues & Production Blockers

This document provides a transparent, evidence-based status of active production blockers and known limitations in IPOPro as of October 28, 2026.

---

## 1. Summary of Active Blockers

| Blocker ID | Description | Severity | Impacted Component | Resolution Responsibility | Status |
|---|---|---|---|---|---|
| **BLK-01** | Render Backend running on Ephemeral SQLite Storage | **High** | Data Durability across Web Service restarts | Repository / Infrastructure Owner (Render Console) | **ACTIVE — BLOCKING SIGN-OFF** |

---

## 2. Detailed Blocker Analysis: BLK-01 (Ephemeral Storage)

### Technical Description
The live Render web service `https://apo-wubq.onrender.com/api/v1/health/ready` currently reports:
```json
{
  "database_engine": "sqlite",
  "storage_type": "EPHEMERAL_LOCAL",
  "database_url_configured": false
}
```

On Render's platform, web services run within ephemeral container instances. When a service:
1. Deploys a new commit,
2. Restarts due to platform maintenance, or
3. Enters sleep mode due to inactivity (on free tiers),
the local disk filesystem is rebuilt from the Git commit image. Any local SQLite database file (`app.db`) stored within the container filesystem is discarded.

### Application Code Readiness
The IPOPro codebase is **100% architected and tested for PostgreSQL**:
- SQLAlchemy database initialization dynamically detects the dialect (`postgresql://` vs `sqlite://`).
- PostgreSQL connection pooling (`pool_size`, `max_overflow`, `pool_pre_ping=True`) is natively configured in `backend/app/core/database.py`.
- Non-destructive schema migrations (`run_safe_migrations()`) execute seamlessly against both SQLite and PostgreSQL engines.
- No code modification is needed to support PostgreSQL.

### Why the AI Agent Cannot Resolve BLK-01 Autonomously
Provisioning a managed PostgreSQL database on Render requires account-level billing authorization, access to the Render Dashboard (`dashboard.render.com`), and generation of external cloud credentials. This action lies outside the local repository workspace.

### Current Fail-Safe Safeguards
To mitigate risk until PostgreSQL is provisioned:
1. `account_persistence.py` automatically writes encrypted JSON snapshots of configured Demat accounts and risk limits to local backup storage.
2. On boot, `seed_data.py` auto-detects empty databases and restores accounts seamlessly.

### Unblocking Procedure
To unblock production persistence:
1. Owner provisions a managed PostgreSQL instance in the Render dashboard.
2. Set the `DATABASE_URL` environment variable on the `apo-wubq` Web Service.
3. Once redeployed, `/health/ready` will return `storage_type: PERSISTENT_REMOTE`.
4. Sign-off can then transition to **`FULLY VERIFIED — PRODUCTION READY`**.

---

## 3. Code-Level Issues & Defect Log

| Defect ID | Description | Resolution Status |
|---|---|---|
| **DEF-01** | Angel One `AB1050` Invalid TOTP error caused by unpadded or non-Base32 secrets | **RESOLVED & VERIFIED** (Base32 sanitization & RLock thread-safety) |
| **DEF-02** | Demat holdings not updating during trigger sync | **RESOLVED & VERIFIED** (Added `reconcile_broker_holdings` Demat sync) |
| **DEF-03** | Stale sold stocks remaining in portfolio table | **RESOLVED & VERIFIED** (Automatic zeroing of omitted holdings) |
| **DEF-04** | Frozen portfolio P&L in UI without manual browser reload | **RESOLVED & VERIFIED** (Integrated real-time WebSocket tick streamer) |
| **DEF-05** | Lack of isolated paper trading buy flow with cash check | **RESOLVED & VERIFIED** (Dedicated paper trading buy/sell engine) |
| **DEF-06** | Missing user profile and watchlist CRUD operations | **RESOLVED & VERIFIED** (Implemented REST endpoints with RBAC) |
| **DEF-07** | Lack of AI portfolio assistance grounded in Demat data | **RESOLVED & VERIFIED** (Implemented `AIChatService` with zero credential leakage) |
