import time
import json
import os
import sys
from datetime import datetime
from sqlalchemy import text

# Add app to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.core.database import SessionLocal, engine, run_safe_migrations
from app.models.account import Account
from app.models.holding import AccountHoldingSnapshot
from app.models.order import Order
from app.models.broker_activity import BrokerTradeSnapshot
from app.models.instrument import Instrument
from app.models.audit import AuditLog
from app.models.ipo import IPO, Allotment
from app.services.smartapi_adapter import SmartAPIAdapter
from app.services.bulk_order_service import BulkOrderService
from app.services.holdings_service import get_unified_account_holdings
from app.services.historical_candle_service import HistoricalCandleService

def run_benchmarks():
    print("=== STARTING IPOPRO FORENSIC MEASUREMENTS ===")
    run_safe_migrations()
    db = SessionLocal()
    
    results = {}

    # 1. Database Connection & Basic Query Benchmarks
    print("\n--- Measuring Database Query Latencies ---")
    db_timings = {}
    
    # Ping
    t0 = time.perf_counter()
    db.execute(text("SELECT 1") if 'text' in globals() else db.connection().execute(db.connection().text("SELECT 1") if hasattr(db.connection(), 'text') else "SELECT 1"))
    t1 = time.perf_counter()
    db_timings["db_ping_ms"] = round((t1 - t0) * 1000, 3)

    # Accounts Query
    t0 = time.perf_counter()
    accounts = db.query(Account).all()
    t1 = time.perf_counter()
    db_timings["query_accounts_ms"] = round((t1 - t0) * 1000, 3)
    db_timings["accounts_count"] = len(accounts)

    # Holdings Snapshot Query
    t0 = time.perf_counter()
    holdings = db.query(AccountHoldingSnapshot).all()
    t1 = time.perf_counter()
    db_timings["query_holdings_ms"] = round((t1 - t0) * 1000, 3)
    db_timings["holdings_count"] = len(holdings)

    # Orders Query
    t0 = time.perf_counter()
    orders = db.query(Order).all()
    t1 = time.perf_counter()
    db_timings["query_orders_ms"] = round((t1 - t0) * 1000, 3)
    db_timings["orders_count"] = len(orders)

    # Trades Query
    t0 = time.perf_counter()
    trades = db.query(BrokerTradeSnapshot).all()
    t1 = time.perf_counter()
    db_timings["query_trades_ms"] = round((t1 - t0) * 1000, 3)
    db_timings["trades_count"] = len(trades)

    # Instruments Count & Search Query
    t0 = time.perf_counter()
    inst_count = db.query(Instrument).count()
    t1 = time.perf_counter()
    db_timings["query_instrument_count_ms"] = round((t1 - t0) * 1000, 3)
    db_timings["instruments_count"] = inst_count

    # Wildcard search (ILIKE '%RELIANCE%')
    t0 = time.perf_counter()
    search_res = db.query(Instrument).filter(
        (Instrument.tradingsymbol.like("%RELIANCE%")) |
        (Instrument.name.like("%RELIANCE%"))
    ).limit(50).all()
    t1 = time.perf_counter()
    db_timings["query_wildcard_search_ms"] = round((t1 - t0) * 1000, 3)
    db_timings["wildcard_search_results"] = len(search_res)

    results["database_performance"] = db_timings
    print(f"DB Ping: {db_timings['db_ping_ms']} ms")
    print(f"Query Accounts ({db_timings['accounts_count']} rows): {db_timings['query_accounts_ms']} ms")
    print(f"Query Holdings ({db_timings['holdings_count']} rows): {db_timings['query_holdings_ms']} ms")
    print(f"Query Orders ({db_timings['orders_count']} rows): {db_timings['query_orders_ms']} ms")
    print(f"Query Instruments Count ({inst_count} rows): {db_timings['query_instrument_count_ms']} ms")
    print(f"Wildcard Search (%RELIANCE%): {db_timings['query_wildcard_search_ms']} ms")

    # 2. Portfolio Aggregation Scaling Benchmarks (1, 5, 10, 36 accounts)
    print("\n--- Measuring Consolidated Portfolio Aggregation Scaling ---")
    from app.api.endpoints_portfolio import get_consolidated_holdings
    from app.core.auth import UserPrincipal

    mock_admin = UserPrincipal(id=1, username="admin", role="ADMIN", is_admin=True)
    
    scaling_results = {}
    for count in [1, 5, 10, 36]:
        # Measure in-memory aggregation duration
        t0 = time.perf_counter()
        # Create synthetic snapshots in memory to simulate 1, 5, 10, 36 accounts
        # Each account holding ~15 stocks
        sim_snapshots = []
        for acc_id in range(1, count + 1):
            for stock_idx in range(1, 16):
                sym = f"STOCK_{stock_idx}"
                sim_snapshots.append({
                    "account_id": acc_id,
                    "symbol": sym,
                    "isin": f"INE{stock_idx:09d}",
                    "quantity": 100 * acc_id,
                    "average_price": 250.0 + stock_idx,
                    "ltp": 275.0 + stock_idx,
                    "close_price": 270.0,
                    "invested_value": (100 * acc_id) * (250.0 + stock_idx),
                    "market_value": (100 * acc_id) * (275.0 + stock_idx),
                    "unrealized_pnl": (100 * acc_id) * 25.0
                })
        t_snap_gen = time.perf_counter()
        
        # Aggregation loop mimicking get_consolidated_holdings
        grouped = {}
        tot_val = 0.0
        tot_cost = 0.0
        for s in sim_snapshots:
            key = s["isin"]
            if key not in grouped:
                grouped[key] = {
                    "symbol": s["symbol"],
                    "isin": s["isin"],
                    "total_quantity": 0,
                    "total_cost": 0.0,
                    "total_val": 0.0,
                    "accounts_count": 0,
                    "accounts_breakdown": []
                }
            grouped[key]["total_quantity"] += s["quantity"]
            grouped[key]["total_cost"] += s["invested_value"]
            grouped[key]["total_val"] += s["market_value"]
            grouped[key]["accounts_count"] += 1
            grouped[key]["accounts_breakdown"].append({
                "account_id": s["account_id"],
                "quantity": s["quantity"],
                "market_value": s["market_value"]
            })
            tot_val += s["market_value"]
            tot_cost += s["invested_value"]
        
        t1 = time.perf_counter()
        agg_ms = round((t1 - t_snap_gen) * 1000, 3)
        total_ms = round((t1 - t0) * 1000, 3)
        scaling_results[f"{count}_accounts"] = {
            "account_count": count,
            "total_holding_records": len(sim_snapshots),
            "aggregated_symbols_count": len(grouped),
            "aggregation_duration_ms": agg_ms,
            "total_processing_ms": total_ms
        }
        print(f"Portfolio Scaling ({count} accounts, {len(sim_snapshots)} positions): Aggregation {agg_ms} ms")

    results["portfolio_scaling"] = scaling_results

    # 3. SmartAPI Rate-Limiting & Serialization Overhead
    print("\n--- Measuring SmartAPI Rate Limiter & Concurrency ---")
    adapter = SmartAPIAdapter(
        api_key="TEST_API_KEY",
        client_code="TEST_CLIENT",
        pin="1234",
        totp_secret="TEST_TOTP_SECRET"
    )
    
    # Measure rate limiter enforcement
    t0 = time.perf_counter()
    adapter._enforce_rate_limit(0.1, category="orders")
    t1 = time.perf_counter()
    first_rl_ms = round((t1 - t0) * 1000, 3)

    t0 = time.perf_counter()
    adapter._enforce_rate_limit(0.1, category="orders")
    t1 = time.perf_counter()
    second_rl_ms = round((t1 - t0) * 1000, 3)

    results["smartapi_rate_limiter"] = {
        "first_call_overhead_ms": first_rl_ms,
        "second_immediate_call_sleep_ms": second_rl_ms,
        "configured_limits": adapter.DEFAULT_RATE_LIMITS
    }
    print(f"SmartAPI Rate Limiter first call: {first_rl_ms} ms, second call sleep: {second_rl_ms} ms")

    # 4. Save results to JSON file
    out_path = os.path.join(os.path.dirname(__file__), "..", "scratch", "forensic_benchmarks.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nSaved benchmark metrics to {out_path}")
    db.close()

if __name__ == "__main__":
    run_benchmarks()
