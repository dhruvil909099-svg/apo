import logging
from datetime import datetime
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.ipo import IPO, Allotment

logger = logging.getLogger(__name__)


def reconcile_broker_holdings(
    db: Session,
    account: Account,
    holdings: List[Dict[str, Any]],
    sync_time: datetime
) -> int:
    """
    Reconciles live broker Demat holdings with local records for an account.
    - Adds or updates instruments in the IPO/stock catalog with real-time LTP and close.
    - Creates or updates Allotment records with allotted_quantity and weighted acquisition cost.
    - Zeroes out any previously tracked broker holdings that are no longer in the broker's portfolio.
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

        if not sym or qty <= 0:
            continue

        active_symbols.add(sym)
        valid_count += 1

        # Instrument catalog
        ipo = db.query(IPO).filter(IPO.symbol == sym).first()
        if not ipo:
            ipo = IPO(
                symbol=sym,
                company_name=str(h.get("symbolname", sym)),
                exchange=str(h.get("exchange", "NSE")),
                issue_price=avg_price,
                lot_size=1,
                isin=isin if isin else None,
                symbol_token=token if token else None,
                current_ltp=ltp,
                previous_close=close,
                status="LISTED",
                source_name="ANGEL_ONE_HOLDINGS",
                source_timestamp=sync_time
            )
            db.add(ipo)
            db.flush()
        else:
            ipo.current_ltp = ltp
            ipo.previous_close = close
            if isin and not ipo.isin:
                ipo.isin = isin
            if token and not ipo.symbol_token:
                ipo.symbol_token = token
            ipo.last_sync_at = sync_time

        # Account holding record
        allotment = db.query(Allotment).filter(
            Allotment.ipo_id == ipo.id,
            Allotment.account_id == account.id
        ).first()

        t1_qty = int(h.get("t1quantity", 0))
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

        if not allotment:
            allotment = Allotment(
                ipo_id=ipo.id,
                account_id=account.id,
                applied_quantity=qty,
                allotted_quantity=qty,
                acquisition_cost=avg_price,
                t1_quantity=t1_qty,
                authorised_quantity=auth_qty,
                invested_value=invested_val,
                current_market_value=mkt_val,
                unrealized_pnl=unrealized_pnl,
                pnl_percentage=pnl_pct,
                day_pnl=day_pnl,
                day_pnl_percentage=day_pnl_pct,
                close_price=close,
                is_broker_reported=is_broker_rep,
                allotment_status="ALLOTTED",
                demat_credit_status="CREDITED",
                status="DEMAT_CREDITED",
                demat_verified=True,
                verification_source="ANGEL_ONE_HOLDINGS",
                verification_timestamp=sync_time
            )
            db.add(allotment)
        else:
            allotment.allotted_quantity = qty
            allotment.applied_quantity = qty
            allotment.acquisition_cost = avg_price
            allotment.t1_quantity = t1_qty
            allotment.authorised_quantity = auth_qty
            allotment.invested_value = invested_val
            allotment.current_market_value = mkt_val
            allotment.unrealized_pnl = unrealized_pnl
            allotment.pnl_percentage = pnl_pct
            allotment.day_pnl = day_pnl
            allotment.day_pnl_percentage = day_pnl_pct
            allotment.close_price = close
            allotment.is_broker_reported = is_broker_rep
            allotment.allotment_status = "ALLOTTED"
            allotment.demat_credit_status = "CREDITED"
            allotment.status = "DEMAT_CREDITED"
            allotment.demat_verified = True
            allotment.verification_source = "ANGEL_ONE_HOLDINGS"
            allotment.verification_timestamp = sync_time

    # Reconcile verified broker portfolio without wiping historical records on empty/failed responses
    if active_symbols:
        stale_allotments = db.query(Allotment).join(IPO).filter(
            Allotment.account_id == account.id,
            Allotment.verification_source == "ANGEL_ONE_HOLDINGS",
            ~IPO.symbol.in_(active_symbols)
        ).all()
        for sa in stale_allotments:
            sa.allotted_quantity = 0
            sa.current_market_value = 0.0
            sa.unrealized_pnl = 0.0
            sa.invested_value = 0.0
            sa.day_pnl = 0.0
    else:
        logger.warning(
            f"No active symbols returned in broker snapshot for account {account.nickname}. "
            "Preserving previously saved historical allotments without zeroing."
        )

    db.commit()
    return valid_count
