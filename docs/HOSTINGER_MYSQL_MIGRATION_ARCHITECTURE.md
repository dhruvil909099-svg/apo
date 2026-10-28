# IPOPro — Hostinger MySQL / MariaDB Database Architecture & Migration Guide

## 1. Executive Summary

This document specifies the database migration architecture replacing IPOPro's ephemeral SQLite database with a managed, persistent Hostinger MySQL / MariaDB database.

- **Frontend Hosting**: Hostinger static web hosting (`https://ipo.emperialcabs.com`)
- **Backend Hosting**: Render Free tier container (`https://apo-wubq.onrender.com`)
- **Persistent Database**: Hostinger Managed MySQL / MariaDB via `mysql+pymysql` driver
- **Repository**: [https://github.com/dhruvil909099-svg/apo](https://github.com/dhruvil909099-svg/apo)
- **Branch**: `main`

---

## 2. Driver & Connection Pool Architecture

### Database Driver
We use `pymysql>=1.1.0`. Pure Python implementation eliminates compilation overhead and C-extension dependencies on Render's Debian-based Docker runtime. Supports MySQL 8.x and MariaDB 10.x native authentication (`caching_sha2_password` and `mysql_native_password`).

### Connection Pool Configuration (`backend/app/core/database.py`)
Hostinger shared MySQL servers enforce strict connection lifetimes, typically terminating idle connections around 300 seconds (5 minutes). The connection pool is conservatively tuned:

| Parameter | Value | Rationale |
|---|---|---|
| `pool_size` | 5 | Stays comfortably within Hostinger's concurrent connection quotas per cPanel user. |
| `max_overflow` | 2 | Allows transient bursts up to 7 connections during concurrent account syncs. |
| `pool_timeout` | 15.0s | Bounds wait times if connections saturate. |
| `pool_recycle` | 280s | Proactively refreshes connections before Hostinger's 300-second idle disconnect. |
| `pool_pre_ping` | `True` | Runs `SELECT 1` heartbeat prior to query checkout to detect dropped sockets without raising exceptions. |
| `charset` | `utf8mb4` | Full 4-byte UTF-8 encoding ensuring Emoji and Indian language name support. |
| `connect_timeout`| 10s | Bounds socket establishment over cross-datacenter WAN connections. |

---

## 3. Safe Schema & Column Migration Engine

The migration engine (`run_safe_migrations` in `backend/app/core/database.py`) verifies and idempotently applies missing columns across SQLite, MySQL, and PostgreSQL without dropping tables or corrupting records:

- Tables created automatically via `Base.metadata.create_all(bind=engine)`
- Schema inspector verifies column existence for:
  - `ipos`: `is_sme`, `open_date`, `close_date`, `listing_date`
  - `allotments`: `pan_number`, `shares_bid`, `shares_allotted`, `cutoff_price`, `allotment_status`, `refund_status`
  - `accounts`: `account_name`, `error_code`, `last_sync_attempt`

---

## 4. Migration Script (`backend/scripts/migrate_sqlite_to_mysql.py`)

A standalone CLI script manages end-to-end data transfer from local SQLite or fallback JSON backups to Hostinger MySQL:

### Topological Table Dependency Order
1. `User` (root user profiles)
2. `Account` (Angel One client accounts, encrypted credentials, connection statuses)
3. `IPO` (master IPO offerings)
4. `Allotment` (IPO application & allotment records, linked to Account and IPO)
5. `Order` (historical buy/sell orders)
6. `RiskLimit` (per-account financial controls)
7. `AuditLog` (immutable audit trails)
8. `Watchlist` (user watchlist groups)
9. `WatchlistItem` (symbols linked to Watchlist)
10. `PortfolioNote` (account-specific user notes)
11. `Notification` (system and trade alerts)
12. `ChatMessage` (AI market intelligence query history)

### Reliability Features
- **Dry-run Mode (`--dry-run`)**: Validates connectivity, tests schema generation, counts source records, and simulates migration without writing to MySQL.
- **Source Backup**: Automatically creates a timestamped copy (`angel_dashboard.db.backup_<timestamp>`) before initiating reads.
- **Auto-Recovery**: If SQLite database was reset by an ephemeral Render restart, recovers baseline accounts and encrypted credentials from `backend/app/data/accounts_backup.json`.
- **Integrity Validation**: Computes exact table-by-table record counts before and after migration.
- **Credential Decryption Check**: Reads each account's encrypted `api_key`, `mpin`, and `totp_secret` from target MySQL and validates that `cipher.decrypt()` succeeds with `APP_ENCRYPTION_KEY`.
- **Foreign Key Safety**: Executes `SET FOREIGN_KEY_CHECKS = 0;` during batch insertion and re-enables constraints after commit.
- **Auto-Increment Realignment**: Realizes `ALTER TABLE <table_name> AUTO_INCREMENT = max_id + 1;` so subsequent primary key inserts continue sequentially.
- **Transactional Read/Write Smoke Probe**: Performs test insert, read, and rollback to verify DML permissions and transaction mechanics.

---

## 5. Hostinger Remote MySQL Setup Instructions

To enable secure cross-cloud connectivity from Render Free to Hostinger MySQL:

1. **Log in to Hostinger hPanel**:
   - Navigate to **Databases** -> **Management**.
   - Create a dedicated database: e.g., `uXXXXX_ipopro`.
   - Create a dedicated database user: e.g., `uXXXXX_ipouser` with a strong 32+ character password.
   - Grant full permissions on `uXXXXX_ipopro` to `uXXXXX_ipouser`.

2. **Enable Remote Database Access in Hostinger**:
   - In hPanel, go to **Databases** -> **Remote MySQL**.
   - Under **Host (IP)**: Add Render outbound IPs or `%` (wildcard) with the dedicated database selected.
   - Note down the MySQL Host / IP (e.g., `sqlXXX.main-hosting.eu` or `srvXXX.hstgr.io`).

3. **Configure Render Environment Variables**:
   In Render Dashboard for `ipopro-backend` (`apo-wubq`):
   ```bash
   DATABASE_URL = mysql+pymysql://uXXXXX_ipouser:<PASSWORD>@sqlXXX.main-hosting.eu:3306/uXXXXX_ipopro?charset=utf8mb4
   APP_ENCRYPTION_KEY = <PRESERVE_EXISTING_KEY>
   TRADING_MODE = PAPER
   ```

4. **Execute Database Migration**:
   In Render Shell or from an authorized workstation:
   ```bash
   python backend/scripts/migrate_sqlite_to_mysql.py \
     --source-sqlite sqlite:///./backend/angel_dashboard.db \
     --target-mysql "mysql+pymysql://uXXXXX_ipouser:<PASSWORD>@sqlXXX.main-hosting.eu:3306/uXXXXX_ipopro?charset=utf8mb4"
   ```

5. **Verify Readiness**:
   Check `https://apo-wubq.onrender.com/api/v1/health/ready`.
   Expected response:
   ```json
   {
     "status": "ready",
     "database": "CONNECTED",
     "database_engine": "mysql",
     "storage_type": "MANAGED_PERSISTENT",
     "trading_mode": "PAPER"
   }
   ```

---

## 6. Disconnected Account Safeguards & Shared Market Data

- **Historical Data Preservation**: Disconnected accounts retain historical holdings, saved average prices, saved quantities, and previous trade orders.
- **Trading Mutation Lockout**: The backend rejects all order requests for disconnected accounts with HTTP 400 (`Account is not connected to Angel One`).
- **Shared Market Price Quotes**: If Client A is disconnected and Client B is connected, Client B's authenticated market quote connection can provide authorized market prices for Client A's holdings, without modifying Client A's demat holdings or exposing private data across accounts.
- **Full Credential Reconnection**: Reconnecting an account requires full credentials (`client_code`, `api_key`, `mpin`, permanent `totp_secret`). Temporary 6-digit OTP codes are strictly rejected.

---

## 7. Render Free Operational Characteristics

- **Container Inactivity Sleep**: Render Free spins down services after 15 minutes of inactivity. When a request arrives, a cold start (30-50s) occurs.
- **Data Persistence**: With Hostinger MySQL, all portfolio snapshots, historical orders, and credentials persist indefinitely across container restarts, spin-downs, and redeployments.
- **Background Synchronization**: Background scheduled syncs pause during container sleep and resume immediately upon container wakeup.
