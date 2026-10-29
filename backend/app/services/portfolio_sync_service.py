import logging
from datetime import datetime
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.holding import AccountHoldingSnapshot

logger = logging.getLogger(__name__)


def reconcile_broker_holdings(
    db: Session,
    account: Account,
    holdings: List[Dict[str, Any]],
    sync_time: datetime
) -> int:
    """
    Reconciles live broker Demat holdings with local records for an account.
    - Persists ordinary delivery holdings into the dedicated `account_holding_snapshots` table.
    - Segregates ordinary holdings from the IPO `allotments` table, preserving IPO allotment integrity.
    - If a holding corresponds to a known IPO allotment, verifies demat credit without corrupting IPO metadata.
    - Zeroes out stale snapshots no longer returned by the broker.
    - Returns the count of active holdings.
    """
    active_symbols = set()
    valid_count = 0

    for h in holdings:
        raw_sym = str(h.get("tradingsymbol", h.get("symbolname", ""))).strip()
        sym = raw_sym.replace("-EQ", "")
        qty = int(h.get("quantity", h.get("realisedquantity", h.get("totalqty", 0))))
        avg_price = float(h.get("averageprice", h.get("avgprice", 0.0)))
        ltp = float(h.get("ltp", avg_price))
        close = float(h.get("close", ltp))
        isin = str(h.get("isin", "")).strip()
        token = str(h.get("symboltoken", "")).strip()
        exchange = str(h.get("exchange", "NSE")).strip()

        if not raw_sym or qty <= 0:
            continue

        active_symbols.add(raw_sym)
        valid_count += 1

        t1_qty = int(h.get("t1quantity", 0))
        realised_qty = int(h.get("realisedquantity", qty))
        auth_qty = int(h.get("authorisedquantity", qty))
        invested_val = float(h.get("invested", round(qty * avg_price, 2)))
        mkt_val = round(qty * ltp, 2)

        # Broker-reported P&L check
        raw_pnl = h.get("profitandloss")
        if raw_pnl is not None:
            unrealized_pnl = float(raw_pnl)
            is_broker_rep = True
        else:
            unrealized_pnl = round(mkt_val - (qty * avg_price), 2)
            is_broker_rep = False

        raw_pnl_pct = h.get("pnlpercentage")
        if raw_pnl_pct is not None:
            pnl_pct = float(raw_pnl_pct)
        else:
            pnl_pct = round((unrealized_pnl / (qty * avg_price)) * 100, 2) if (qty * avg_price) > 0 else 0.0

        day_pnl = round((ltp - close) * qty, 2)
        day_pnl_pct = round(((ltp - close) / close) * 100, 2) if close > 0 else 0.0

        # 1. Upsert dedicated AccountHoldingSnapshot
        snapshot = db.query(AccountHoldingSnapshot).filter(
            AccountHoldingSnapshot.account_id == account.id,
            AccountHoldingSnapshot.tradingsymbol == raw_sym
        ).first()

        if not snapshot:
            snapshot = AccountHoldingSnapshot(
                account_id=account.id,
                tradingsymbol=raw_sym,
                symbol=sym,
                symbol_token=token if token else None,
                exchange=exchange,
                isin=isin if isin else None,
                product="DELIVERY",
                quantity=qty,
                t1_quantity=t1_qty,
                realised_quantity=realised_qty,
                authorised_quantity=auth_qty,
                average_price=avg_price,
                ltp=ltp,
                close_price=close,
                invested_value=invested_val,
                market_value=mkt_val,
                unrealized_pnl=unrealized_pnl,
                pnl_percentage=pnl_pct,
                day_pnl=day_pnl,
                day_pnl_percentage=day_pnl_pct,
                is_broker_reported=is_broker_rep,
                data_source="ANGEL_ONE_HOLDINGS",
                last_sync_time=sync_time,
                raw_payload=h
            )
            db.add(snapshot)
        else:
            snapshot.symbol = sym
            if token and not snapshot.symbol_token:
                snapshot.symbol_token = token
            if isin and not snapshot.isin:
                snapshot.isin = isin
            snapshot.exchange = exchange
            snapshot.quantity = qty
            snapshot.t1_quantity = t1_qty
            snapshot.realised_quantity = realised_qty
            snapshot.authorised_quantity = auth_qty
            snapshot.average_price = avg_price
            snapshot.ltp = ltp
            snapshot.close_price = close
            snapshot.invested_value = invested_val
            snapshot.market_value = mkt_val
            snapshot.unrealized_pnl = unrealized_pnl
            snapshot.pnl_percentage = pnl_pct
            snapshot.day_pnl = day_pnl
            snapshot.day_pnl_percentage = day_pnl_pct
            snapshot.is_broker_reported = is_broker_rep
            snapshot.last_sync_time = sync_time
            snapshot.raw_payload = h

        # 2. Update real-time LTP cache on known catalog instruments if present
        ipo = db.query(IPO).filter((IPO.symbol == sym) | (IPO.isin == isin if isin else False)).first()
        if ipo:
            ipo.current_ltp = ltp
            ipo.previous_close = close
            if isin and not ipo.isin:
                ipo.isin = isin
            if token and not ipo.symbol_token:
                ipo.symbol_token = token
            ipo.last_sync_at = sync_time

            # 3. Explicit cross-reconciliation for genuine IPO allotments
            matching_allotment = db.query(Allotment).filter(
                Allotment.ipo_id == ipo.id,
                Allotment.account_id == account.id
            ).first()
            if matching_allotment:
                matching_allotment.demat_verified = True
                matching_allotment.demat_credit_status = "CREDITED"
                matching_allotment.verification_source = "ANGEL_ONE_DEMAT_RECONCILIATION"
                matching_allotment.verification_timestamp = sync_time

    # 4. Zero out stale holdings snapshots no longer in the broker's active portfolio
    if active_symbols:
        stale_snapshots = db.query(AccountHoldingSnapshot).filter(
            AccountHoldingSnapshot.account_id == account.id,
            ~AccountHoldingSnapshot.tradingsymbol.in_(active_symbols)
        ).all()
        for s in stale_snapshots:
            s.quantity = 0
            s.market_value = 0.0
            s.unrealized_pnl = 0.0
            s.invested_value = 0.0
            s.day_pnl = 0.0
            s.last_sync_time = sync_time
    else:
        logger.warning(
            f"No active symbols returned in broker snapshot for account {account.nickname}. "
            "Preserving previously saved snapshots without zeroing."
        )

    db.commit()
    return valid_count
