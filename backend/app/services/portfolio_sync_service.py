from datetime import datetime
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.ipo import IPO, Allotment


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

        if not allotment:
            allotment = Allotment(
                ipo_id=ipo.id,
                account_id=account.id,
                applied_quantity=qty,
                allotted_quantity=qty,
                acquisition_cost=avg_price,
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
            allotment.allotment_status = "ALLOTTED"
            allotment.demat_credit_status = "CREDITED"
            allotment.status = "DEMAT_CREDITED"
            allotment.demat_verified = True
            allotment.verification_source = "ANGEL_ONE_HOLDINGS"
            allotment.verification_timestamp = sync_time

    # Remove or zero out holdings that no longer exist in broker portfolio for this account
    if active_symbols:
        stale_allotments = db.query(Allotment).join(IPO).filter(
            Allotment.account_id == account.id,
            Allotment.verification_source == "ANGEL_ONE_HOLDINGS",
            ~IPO.symbol.in_(active_symbols)
        ).all()
        for sa in stale_allotments:
            sa.allotted_quantity = 0
    else:
        stale_allotments = db.query(Allotment).filter(
            Allotment.account_id == account.id,
            Allotment.verification_source == "ANGEL_ONE_HOLDINGS"
        ).all()
        for sa in stale_allotments:
            sa.allotted_quantity = 0

    db.commit()
    return valid_count
