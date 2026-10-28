# Database Persistence & Recovery Protocols

**Application:** IPOPro  
**Date:** October 28, 2026  
**Status:** DUAL-TIER PERSISTENCE ACTIVE  

---

## 1. Production Architecture Overview

IPOPro supports dual database architectures:
1. **Managed PostgreSQL (Recommended for Render Production):**
   - Configured via `DATABASE_URL=postgresql://user:password@host:5432/dbname`.
   - Utilizes `NullPool` in containerized environments with pre-ping validation to eliminate stale connections.
2. **Local SQLite with JSON Snapshot Recovery (Render Free/Ephemeral Fallback):**
   - Configured via `DATABASE_URL=sqlite:///./angel_dashboard.db`.
   - On ephemeral hosts (e.g. Render free tier restarts), `account_persistence.py` automatically writes and restores an encrypted JSON backup snapshot (`account_persistence_backup.json`).
   - Guarantees account profiles, groups, and risk limits persist across container restarts.

---

## 2. Non-Destructive Safe Migrations (`run_safe_migrations`)

- Checks table schemas on startup.
- Adds missing columns (`ddpi_status`, `edis_authorized_today`, `available_cash`, `is_demo`) non-destructively without dropping tables or altering existing data.
- Enforces strict foreign key integrity between `allotments`, `ipos`, and `accounts`.
