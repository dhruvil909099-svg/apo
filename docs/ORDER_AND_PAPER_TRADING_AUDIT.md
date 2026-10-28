# Order & Paper Trading Audit Report

**Application:** IPOPro  
**Date:** October 28, 2026  
**Status:** PASS WITH ISOLATION  

---

## 1. Safety & Production Guardrails

1. **Catastrophic Live Order Safeguard**:
   - `TRADING_MODE` is enforced at the backend level (`PAPER` vs `LIVE`).
   - When `TRADING_MODE == "PAPER"`, real broker order routes categorically reject execution and simulate fills inside the virtual ledger.
2. **Emergency Kill Switch (`/api/v1/risk/emergency-halt`)**:
   - Immediate toggle halts all order execution across all accounts simultaneously.
   - Any order submitted during emergency halt is rejected with HTTP 403 `EMERGENCY_HALT_ACTIVE`.
3. **Risk Limits Enforcement (`/api/v1/risk`)**:
   - `global_max_order_value`: Rejects individual orders exceeding capital limits.
   - `global_max_quantity_per_account`: Limits exposure per single Demat account.
   - `max_orders_per_bulk`: Caps bulk basket size to prevent flood conditions.

---

## 2. Paper Trading Engine

1. **Virtual Ledger Isolation**:
   - Simulated accounts (`is_demo = True`) maintain dedicated virtual balances (default ₹1,00,000 to ₹5,00,000).
   - Paper trades execute against real-time market quotes or simulated equilibrium pricing.
   - Virtual order records are stored in the database with status `EXECUTED`, `CANCELLED`, or `REJECTED`.
2. **Restart Persistence**:
   - Virtual orders, paper portfolios, and simulated balances persist cleanly across server restarts via SQLite / PostgreSQL transactions.
   - Automated backup saves paper trading states to `backend/account_persistence_backup.json`.
