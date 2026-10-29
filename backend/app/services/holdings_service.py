import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.account import Account
from app.models.holding import AccountHoldingSnapshot
from app.models.ipo import IPO, Allotment
from app.models.order import Order

logger = logging.getLogger("holdings_service")


def get_blocked_open_order_quantity(db: Session, account_id: int, symbol: str) -> int:
    """
    Computes total shares blocked in active pending sell orders for this account.
    """
    clean_sym = symbol.replace("-EQ", "").strip().upper()
    active_statuses = ["PREPARED", "SUBMITTED", "PENDING", "OPEN", "TRIGGER_PENDING"]
    
    # Query orders with or without -EQ suffix
    open_orders = db.query(Order).filter(
        Order.account_id == account_id,
        Order.transaction_type == "SELL",
        Order.status.in_(active_statuses)
    ).all()
    
    blocked = 0
    for o in open_orders:
        o_sym = (o.tradingsymbol or "").replace("-EQ", "").strip().upper()
        if o_sym == clean_sym:
            pending_qty = max(0, (o.quantity or 0) - (o.filled_quantity or 0))
            blocked += pending_qty
            
    return blocked


def get_unified_account_holdings(db: Session, account_id: int) -> List[Dict[str, Any]]:
    """
    Single authoritative source of truth for an account's delivery equity holdings.
    Integrates:
    1. AccountHoldingSnapshot (ordinary equity delivery shares synced from Angel One)
    2. Allotment (pre-existing unlisted or demat credited IPO allotments)
    
    Accurately computes:
    - Total owned quantity
    - Settled quantity (realised)
    - Unsettled quantity (T+1)
    - Blocked quantity in open sell orders
    - Collateral quantity
    - Confirmed sellable quantity
    - Sellability verification status
    """
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        return []

    # 1. Primary: AccountHoldingSnapshot records
    snapshots = db.query(AccountHoldingSnapshot).filter(
        AccountHoldingSnapshot.account_id == account_id,
        AccountHoldingSnapshot.quantity > 0
    ).all()

    # 2. Secondary: Allotment records
    allotments = db.query(Allotment).join(IPO).filter(
        Allotment.account_id == account_id,
        Allotment.allotted_quantity > 0
    ).all()

    seen_keys = set()
    unified_items: List[Dict[str, Any]] = []

    # Process snapshots first
    for s in snapshots:
        clean_sym = (s.symbol or s.tradingsymbol).replace("-EQ", "").strip().upper()
        isin = s.isin or f"KEY_{clean_sym}"
        dedup_key = (clean_sym, isin)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        blocked_qty = get_blocked_open_order_quantity(db, account_id, clean_sym)
        collateral_qty = s.collateral_quantity or 0
        total_qty = s.quantity
        t1_qty = s.t1_quantity or 0
        settled_qty = s.realised_quantity if s.realised_quantity > 0 else max(0, total_qty - t1_qty)
        auth_qty = s.authorised_quantity or total_qty

        # Sellable calculation & verification status
        is_account_connected = account.is_demo or account.auth_status == "CONNECTED"
        has_authorization = account.ddpi_status == "ACTIVE" or account.edis_authorized_today or account.is_demo

        base_sellable = max(0, total_qty - blocked_qty - collateral_qty)

        if not is_account_connected:
            verification_status = "DISCONNECTED"
            sellable_qty = base_sellable
            verification_note = "Account is disconnected. Reconnection required before submitting broker orders."
        elif not has_authorization:
            verification_status = "VERIFICATION_REQUIRED"
            sellable_qty = base_sellable
            verification_note = "CDSL T-PIN (eDIS) or active DDPI required prior to trade settlement."
        else:
            verification_status = "VERIFIED"
            sellable_qty = base_sellable
            verification_note = "Fully verified and authorized for sell execution."

        # Pricing & Valuation
        ltp = s.ltp if s.ltp > 0 else s.average_price
        close_p = s.close_price if s.close_price > 0 else ltp
        avg_cost = s.average_price
        invested = s.invested_value if (s.invested_value and s.invested_value > 0) else round(total_qty * avg_cost, 2)
        val = s.market_value if (s.market_value and s.market_value > 0) else round(total_qty * ltp, 2)

        if s.is_broker_reported and s.unrealized_pnl is not None:
            pnl = s.unrealized_pnl
            pnl_pct = s.pnl_percentage or (round((pnl / invested) * 100, 2) if invested > 0 else 0.0)
            is_broker_rep = True
        else:
            pnl = round(val - invested, 2)
            pnl_pct = round((pnl / invested) * 100, 2) if invested > 0 else 0.0
            is_broker_rep = False

        day_pnl = s.day_pnl if s.day_pnl is not None else round((ltp - close_p) * total_qty, 2)
        day_pnl_pct = s.day_pnl_percentage if s.day_pnl_percentage is not None else (
            round(((ltp - close_p) / close_p) * 100, 2) if close_p > 0 else 0.0
        )

        unified_items.append({
            "account_id": account.id,
            "account_nickname": account.nickname,
            "account_masked_code": account.masked_client_code,
            "symbol": clean_sym,
            "trading_symbol": s.tradingsymbol or f"{clean_sym}-EQ",
            "company_name": clean_sym,
            "exchange": s.exchange or "NSE",
            "isin": s.isin or "—",
            "symbol_token": s.symbol_token or "0",
            "quantity": total_qty,
            "available_quantity": sellable_qty,
            "sellable_quantity": sellable_qty,
            "settled_quantity": settled_qty,
            "t1_quantity": t1_qty,
            "authorised_quantity": auth_qty,
            "collateral_quantity": collateral_qty,
            "blocked_quantity": blocked_qty,
            "average_price": avg_cost,
            "current_ltp": ltp,
            "close_price": close_p,
            "valuation": val,
            "market_value": val,
            "invested_amount": invested,
            "unrealized_pnl": pnl,
            "pnl_percentage": pnl_pct,
            "day_pnl": day_pnl,
            "day_pnl_percentage": day_pnl_pct,
            "is_broker_reported": is_broker_rep,
            "verification_status": verification_status,
            "verification_note": verification_note,
            "data_source": s.data_source or "ANGEL_ONE_SMARTAPI",
            "last_sync_time": s.last_sync_time.strftime("%Y-%m-%d %H:%M:%S IST") if s.last_sync_time else None
        })

    # Process allotments not already captured in snapshots
    for a in allotments:
        clean_sym = a.ipo.symbol.replace("-EQ", "").strip().upper()
        isin = a.ipo.isin or f"KEY_{clean_sym}"
        dedup_key = (clean_sym, isin)
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        blocked_qty = get_blocked_open_order_quantity(db, account_id, clean_sym)
        total_qty = a.allotted_quantity
        t1_qty = a.t1_quantity or 0
        settled_qty = max(0, total_qty - t1_qty)
        auth_qty = a.authorised_quantity or total_qty

        is_account_connected = account.is_demo or account.auth_status == "CONNECTED"
        has_authorization = account.ddpi_status == "ACTIVE" or account.edis_authorized_today or account.is_demo
        base_sellable = max(0, total_qty - blocked_qty)

        if not is_account_connected:
            verification_status = "DISCONNECTED"
            sellable_qty = base_sellable
            verification_note = "Account is disconnected. Reconnection required before submitting broker orders."
        elif not has_authorization:
            verification_status = "VERIFICATION_REQUIRED"
            sellable_qty = base_sellable
            verification_note = "CDSL T-PIN (eDIS) or active DDPI required prior to trade settlement."
        else:
            verification_status = "VERIFIED"
            sellable_qty = base_sellable
            verification_note = "Fully verified and authorized for sell execution."

        ltp = a.ipo.current_ltp or a.ipo.issue_price or a.acquisition_cost
        close_p = a.close_price or ltp
        avg_cost = a.acquisition_cost
        invested = a.invested_value if (a.invested_value and a.invested_value > 0) else round(total_qty * avg_cost, 2)
        val = a.current_market_value if (a.current_market_value and a.current_market_value > 0) else round(total_qty * ltp, 2)

        if a.is_broker_reported and a.unrealized_pnl is not None:
            pnl = a.unrealized_pnl
            pnl_pct = a.pnl_percentage or (round((pnl / invested) * 100, 2) if invested > 0 else 0.0)
            is_broker_rep = True
        else:
            pnl = round(val - invested, 2)
            pnl_pct = round((pnl / invested) * 100, 2) if invested > 0 else 0.0
            is_broker_rep = False

        day_pnl = a.day_pnl if a.day_pnl is not None else round((ltp - close_p) * total_qty, 2)
        day_pnl_pct = a.day_pnl_percentage if a.day_pnl_percentage is not None else (
            round(((ltp - close_p) / close_p) * 100, 2) if close_p > 0 else 0.0
        )

        unified_items.append({
            "account_id": account.id,
            "account_nickname": account.nickname,
            "account_masked_code": account.masked_client_code,
            "symbol": clean_sym,
            "trading_symbol": f"{clean_sym}-EQ",
            "company_name": a.ipo.company_name or clean_sym,
            "exchange": a.ipo.exchange or "NSE",
            "isin": a.ipo.isin or "—",
            "symbol_token": a.ipo.symbol_token or "0",
            "quantity": total_qty,
            "available_quantity": sellable_qty,
            "sellable_quantity": sellable_qty,
            "settled_quantity": settled_qty,
            "t1_quantity": t1_qty,
            "authorised_quantity": auth_qty,
            "collateral_quantity": 0,
            "blocked_quantity": blocked_qty,
            "average_price": avg_cost,
            "current_ltp": ltp,
            "close_price": close_p,
            "valuation": val,
            "market_value": val,
            "invested_amount": invested,
            "unrealized_pnl": pnl,
            "pnl_percentage": pnl_pct,
            "day_pnl": day_pnl,
            "day_pnl_percentage": day_pnl_pct,
            "is_broker_reported": is_broker_rep,
            "verification_status": verification_status,
            "verification_note": verification_note,
            "data_source": "DEMAT_ALLOTMENT_LEDGER" if account.is_demo else "HISTORICAL_LEDGER",
            "last_sync_time": a.verification_timestamp.strftime("%Y-%m-%d %H:%M:%S IST") if a.verification_timestamp else None
        })

    return unified_items


def get_holding_for_symbol(db: Session, account_id: int, symbol: str) -> Optional[Dict[str, Any]]:
    """
    Finds verified holding quantities for a specific security in an account.
    """
    holdings = get_unified_account_holdings(db, account_id)
    clean_target = symbol.replace("-EQ", "").strip().upper()
    for h in holdings:
        if h["symbol"] == clean_target or h["trading_symbol"].replace("-EQ", "").strip().upper() == clean_target:
            return h
    return None


def update_holding_on_order_fill(
    db: Session,
    account_id: int,
    symbol: str,
    quantity: int,
    price: float,
    side: str,
    exchange: str = "NSE",
    symbol_token: str = "0"
):
    """
    Synchronously updates holding snapshots and allotments upon order execution (paper or live).
    Guarantees account holdings, consolidated portfolio, and order validation stay perfectly in sync.
    """
    clean_sym = symbol.replace("-EQ", "").strip().upper()
    tradingsymbol = f"{clean_sym}-EQ"
    now = datetime.utcnow()

    snapshot = db.query(AccountHoldingSnapshot).filter(
        AccountHoldingSnapshot.account_id == account_id,
        (AccountHoldingSnapshot.symbol == clean_sym) | (AccountHoldingSnapshot.tradingsymbol == tradingsymbol)
    ).first()

    allotment = db.query(Allotment).join(IPO).filter(
        Allotment.account_id == account_id,
        IPO.symbol == clean_sym
    ).first()

    if side.upper() == "SELL":
        if snapshot:
            new_qty = max(0, snapshot.quantity - quantity)
            snapshot.quantity = new_qty
            snapshot.realised_quantity = max(0, snapshot.realised_quantity - quantity)
            snapshot.authorised_quantity = max(0, snapshot.authorised_quantity - quantity)
            snapshot.market_value = round(new_qty * snapshot.ltp, 2)
            snapshot.invested_value = round(new_qty * snapshot.average_price, 2)
            snapshot.unrealized_pnl = round(snapshot.market_value - snapshot.invested_value, 2)
            snapshot.last_sync_time = now

        if allotment:
            allotment.allotted_quantity = max(0, allotment.allotted_quantity - quantity)
            allotment.current_market_value = round(allotment.allotted_quantity * (allotment.ipo.current_ltp or price), 2)
            allotment.invested_value = round(allotment.allotted_quantity * allotment.acquisition_cost, 2)
            allotment.unrealized_pnl = round(allotment.current_market_value - allotment.invested_value, 2)

    elif side.upper() == "BUY":
        if snapshot:
            old_qty = snapshot.quantity
            old_cost = snapshot.invested_value or (old_qty * snapshot.average_price)
            add_cost = quantity * price
            new_qty = old_qty + quantity
            new_avg = round((old_cost + add_cost) / new_qty, 2) if new_qty > 0 else price

            snapshot.quantity = new_qty
            snapshot.realised_quantity += quantity
            snapshot.average_price = new_avg
            snapshot.invested_value = round(new_qty * new_avg, 2)
            snapshot.market_value = round(new_qty * snapshot.ltp, 2)
            snapshot.unrealized_pnl = round(snapshot.market_value - snapshot.invested_value, 2)
            snapshot.last_sync_time = now
        else:
            # Create snapshot for new holding
            new_snap = AccountHoldingSnapshot(
                account_id=account_id,
                tradingsymbol=tradingsymbol,
                symbol=clean_sym,
                symbol_token=symbol_token,
                exchange=exchange,
                quantity=quantity,
                realised_quantity=quantity,
                authorised_quantity=quantity,
                t1_quantity=0,
                average_price=price,
                ltp=price,
                close_price=price,
                invested_value=round(quantity * price, 2),
                market_value=round(quantity * price, 2),
                unrealized_pnl=0.0,
                pnl_percentage=0.0,
                is_broker_reported=False,
                data_source="EXECUTION_LEDGER",
                last_sync_time=now
            )
            db.add(new_snap)

    db.commit()
