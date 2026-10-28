import io
import csv
from typing import List, Optional, Any, Dict
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.ipo import IPO, Allotment
from app.models.account import Account
from app.models.audit import AuditLog
from app.schemas.ipo import (
    IPOCreate, IPOResponse, AllotmentCreate, AllotmentUpdate, AllotmentResponse,
    CSVImportSummary, IPOPrepareApplicationRequest, IPOPrepareApplicationResponse,
    IPOApplicationPreparedItem
)
from app.services.ipo_feed_service import IPOFeedService
from app.services.scheduler_service import sync_manager

router = APIRouter(prefix="/ipos", tags=["IPOs"])


def _calculate_ipo_metrics(ipo: IPO):
    """
    Defensively calculates total shares, total cost, estimated value, and P&L.
    Guarantees zero division-by-zero crashes or NaN values.
    """
    total_shares = 0
    total_accounts = 0
    total_cost = 0.0

    for a in ipo.allotments:
        qty = max(0, a.allotted_quantity or 0)
        cost_unit = max(0.0, a.acquisition_cost or ipo.issue_price or 0.0)
        total_shares += qty
        total_cost += (qty * cost_unit)
        if qty > 0:
            total_accounts += 1

    ltp = ipo.current_ltp if ipo.current_ltp is not None and ipo.current_ltp > 0 else (ipo.issue_price or 0.0)
    est_val = total_shares * ltp
    pnl = est_val - total_cost
    pnl_pct = ((pnl / total_cost) * 100.0) if total_cost > 0.0 else 0.0

    return {
        "total_shares": total_shares,
        "total_accounts": total_accounts,
        "total_cost": total_cost,
        "est_val": round(est_val, 2),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl_pct, 2)
    }


def _sanitize_csv_cell(val: Any) -> str:
    """Escapes potential spreadsheet formula injection characters (=, +, -, @)."""
    s = str(val or "")
    if s.startswith(("=", "+", "-", "@")):
        return f"'{s}"
    return s


@router.get("", response_model=List[IPOResponse])
def list_ipos(
    status_filter: Optional[str] = Query(None, description="Filter: UPCOMING, PRE_OPEN, LISTED, CLOSED, SME"),
    db: Session = Depends(get_db)
):
    query = db.query(IPO)
    if status_filter:
        s_upper = status_filter.upper()
        if s_upper == "SME":
            query = query.filter(IPO.is_sme.is_(True))
        elif s_upper != "ALL":
            query = query.filter(IPO.status == s_upper)

    ipos = query.order_by(IPO.id.desc()).all()
    results = []

    for ipo in ipos:
        m = _calculate_ipo_metrics(ipo)
        results.append(IPOResponse(
            id=ipo.id,
            symbol=ipo.symbol,
            company_name=ipo.company_name,
            exchange=ipo.exchange,
            issue_price=ipo.issue_price,
            min_price=ipo.min_price,
            max_price=ipo.max_price,
            lot_size=ipo.lot_size,
            bidding_start_date=ipo.bidding_start_date,
            bidding_end_date=ipo.bidding_end_date,
            allotment_date=ipo.allotment_date,
            listing_date=ipo.listing_date,
            isin=ipo.isin,
            symbol_token=ipo.symbol_token,
            is_sme=ipo.is_sme,
            current_ltp=ipo.current_ltp,
            previous_close=ipo.previous_close,
            status=ipo.status,
            source_name=ipo.source_name or "MANUAL",
            source_timestamp=ipo.source_timestamp,
            last_sync_at=ipo.last_sync_at,
            total_allotted_shares=m["total_shares"],
            total_accounts_allotted=m["total_accounts"],
            estimated_current_value=m["est_val"],
            estimated_pnl=m["pnl"],
            pnl_percentage=m["pnl_pct"],
            created_at=ipo.created_at
        ))

    return results


@router.post("", response_model=IPOResponse, status_code=status.HTTP_201_CREATED)
def create_ipo(ipo_in: IPOCreate, db: Session = Depends(get_db)):
    clean_symbol = ipo_in.symbol.strip().upper()
    existing = db.query(IPO).filter(IPO.symbol == clean_symbol).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"IPO with symbol '{clean_symbol}' already exists in catalog."
        )

    if ipo_in.issue_price <= 0:
        raise HTTPException(status_code=400, detail="Issue price must be strictly greater than 0.")
    if ipo_in.lot_size <= 0:
        raise HTTPException(status_code=400, detail="Lot size must be at least 1.")

    ipo = IPO(
        symbol=clean_symbol,
        company_name=ipo_in.company_name.strip(),
        exchange=ipo_in.exchange.strip().upper(),
        issue_price=float(ipo_in.issue_price),
        min_price=float(ipo_in.min_price) if ipo_in.min_price else float(ipo_in.issue_price),
        max_price=float(ipo_in.max_price) if ipo_in.max_price else float(ipo_in.issue_price),
        lot_size=int(ipo_in.lot_size),
        bidding_start_date=ipo_in.bidding_start_date,
        bidding_end_date=ipo_in.bidding_end_date,
        allotment_date=ipo_in.allotment_date,
        listing_date=ipo_in.listing_date,
        isin=ipo_in.isin,
        symbol_token=ipo_in.symbol_token,
        is_sme=ipo_in.is_sme,
        current_ltp=float(ipo_in.issue_price),
        previous_close=float(ipo_in.issue_price),
        status=ipo_in.status.upper(),
        source_name=ipo_in.source_name or "MANUAL",
        source_timestamp=datetime.utcnow(),
        last_sync_at=datetime.utcnow()
    )
    db.add(ipo)
    db.commit()
    db.refresh(ipo)

    return IPOResponse(
        id=ipo.id,
        symbol=ipo.symbol,
        company_name=ipo.company_name,
        exchange=ipo.exchange,
        issue_price=ipo.issue_price,
        min_price=ipo.min_price,
        max_price=ipo.max_price,
        lot_size=ipo.lot_size,
        bidding_start_date=ipo.bidding_start_date,
        bidding_end_date=ipo.bidding_end_date,
        allotment_date=ipo.allotment_date,
        listing_date=ipo.listing_date,
        isin=ipo.isin,
        symbol_token=ipo.symbol_token,
        is_sme=ipo.is_sme,
        current_ltp=ipo.current_ltp,
        previous_close=ipo.previous_close,
        status=ipo.status,
        source_name=ipo.source_name,
        source_timestamp=ipo.source_timestamp,
        last_sync_at=ipo.last_sync_at,
        total_allotted_shares=0,
        total_accounts_allotted=0,
        estimated_current_value=0.0,
        estimated_pnl=0.0,
        pnl_percentage=0.0,
        created_at=ipo.created_at
    )


@router.get("/{ipo_id}", response_model=IPOResponse)
def get_ipo(ipo_id: int, db: Session = Depends(get_db)):
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO record not found.")

    m = _calculate_ipo_metrics(ipo)
    return IPOResponse(
        id=ipo.id,
        symbol=ipo.symbol,
        company_name=ipo.company_name,
        exchange=ipo.exchange,
        issue_price=ipo.issue_price,
        min_price=ipo.min_price,
        max_price=ipo.max_price,
        lot_size=ipo.lot_size,
        bidding_start_date=ipo.bidding_start_date,
        bidding_end_date=ipo.bidding_end_date,
        allotment_date=ipo.allotment_date,
        listing_date=ipo.listing_date,
        isin=ipo.isin,
        symbol_token=ipo.symbol_token,
        is_sme=ipo.is_sme,
        current_ltp=ipo.current_ltp,
        previous_close=ipo.previous_close,
        status=ipo.status,
        source_name=ipo.source_name or "MANUAL",
        source_timestamp=ipo.source_timestamp,
        last_sync_at=ipo.last_sync_at,
        total_allotted_shares=m["total_shares"],
        total_accounts_allotted=m["total_accounts"],
        estimated_current_value=m["est_val"],
        estimated_pnl=m["pnl"],
        pnl_percentage=m["pnl_pct"],
        created_at=ipo.created_at
    )


@router.delete("/{ipo_id}", status_code=status.HTTP_200_OK)
def delete_ipo(ipo_id: int, db: Session = Depends(get_db)):
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found.")

    symbol = ipo.symbol
    db.delete(ipo)
    db.commit()

    db.add(AuditLog(
        event_type="IPO_DELETE",
        operator="SYSTEM",
        details_json=f'{{"deleted_ipo_id": {ipo_id}, "symbol": "{symbol}"}}'
    ))
    db.commit()
    return {"success": True, "message": f"IPO '{symbol}' removed from catalog."}


@router.get("/{ipo_id}/allotments", response_model=List[AllotmentResponse])
def list_ipo_allotments(ipo_id: int, db: Session = Depends(get_db)):
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found.")

    allotments = db.query(Allotment).filter(Allotment.ipo_id == ipo_id).all()
    results = []
    ltp = ipo.current_ltp if ipo.current_ltp is not None and ipo.current_ltp > 0 else (ipo.issue_price or 0.0)

    for a in allotments:
        acc = a.account
        qty = max(0, a.allotted_quantity or 0)
        cost = max(0.0, a.acquisition_cost or ipo.issue_price or 0.0)
        market_val = round(qty * ltp, 2)
        total_cost = round(qty * cost, 2)
        pnl = round(market_val - total_cost, 2)
        pnl_pct = round(((pnl / total_cost) * 100), 2) if total_cost > 0 else 0.0

        results.append(AllotmentResponse(
            id=a.id,
            ipo_id=ipo.id,
            account_id=acc.id,
            account_nickname=acc.nickname,
            account_masked_code=acc.masked_client_code,
            account_group=acc.account_group,
            ipo_symbol=ipo.symbol,
            application_no=a.application_no,
            category=a.category or "RETAIL",
            applied_quantity=a.applied_quantity,
            allotted_quantity=a.allotted_quantity,
            acquisition_cost=a.acquisition_cost,
            current_ltp=ipo.current_ltp,
            market_value=market_val,
            unrealized_pnl=pnl,
            pnl_percentage=pnl_pct,
            pan_masked=a.pan_masked,
            upi_id_masked=a.upi_id_masked,
            mandate_status=a.mandate_status or "PENDING",
            allotment_status=a.allotment_status or "PENDING",
            demat_credit_status=a.demat_credit_status or "PENDING",
            status=a.status,
            demat_verified=a.demat_verified,
            verification_source=a.verification_source,
            verification_timestamp=a.verification_timestamp,
            conflict_note=a.conflict_note,
            ddpi_status=acc.ddpi_status,
            edis_authorized=acc.edis_authorized_today,
            created_at=a.created_at
        ))

    return results


@router.post("/{ipo_id}/allotments", response_model=AllotmentResponse)
def create_allotment(ipo_id: int, allot_in: AllotmentCreate, db: Session = Depends(get_db)):
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found.")

    acc = db.query(Account).filter(Account.id == allot_in.account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Target account not found.")

    existing = db.query(Allotment).filter(
        Allotment.ipo_id == ipo_id,
        Allotment.account_id == allot_in.account_id
    ).first()

    if existing:
        existing.application_no = allot_in.application_no or existing.application_no
        existing.category = allot_in.category or existing.category
        existing.applied_quantity = allot_in.applied_quantity
        existing.allotted_quantity = allot_in.allotted_quantity
        existing.acquisition_cost = allot_in.acquisition_cost
        existing.status = allot_in.status
        existing.pan_masked = allot_in.pan_masked or existing.pan_masked
        existing.upi_id_masked = allot_in.upi_id_masked or existing.upi_id_masked
        existing.mandate_status = allot_in.mandate_status or existing.mandate_status
        existing.updated_at = datetime.utcnow()
        allotment = existing
    else:
        allotment = Allotment(
            ipo_id=ipo_id,
            account_id=acc.id,
            application_no=allot_in.application_no,
            category=allot_in.category,
            applied_quantity=allot_in.applied_quantity,
            allotted_quantity=allot_in.allotted_quantity,
            acquisition_cost=allot_in.acquisition_cost,
            pan_masked=allot_in.pan_masked,
            upi_id_masked=allot_in.upi_id_masked,
            mandate_status=allot_in.mandate_status,
            status=allot_in.status,
            demat_verified=True,
            verification_source="MANUAL_ENTRY",
            verification_timestamp=datetime.utcnow()
        )
        db.add(allotment)

    db.commit()
    db.refresh(allotment)

    ltp = ipo.current_ltp if ipo.current_ltp is not None and ipo.current_ltp > 0 else ipo.issue_price
    val = round(allotment.allotted_quantity * ltp, 2)
    cost = round(allotment.allotted_quantity * allotment.acquisition_cost, 2)
    pnl = round(val - cost, 2)
    pnl_pct = round(((pnl / cost) * 100), 2) if cost > 0 else 0.0

    return AllotmentResponse(
        id=allotment.id,
        ipo_id=ipo.id,
        account_id=acc.id,
        account_nickname=acc.nickname,
        account_masked_code=acc.masked_client_code,
        account_group=acc.account_group,
        ipo_symbol=ipo.symbol,
        application_no=allotment.application_no,
        category=allotment.category,
        applied_quantity=allotment.applied_quantity,
        allotted_quantity=allotment.allotted_quantity,
        acquisition_cost=allotment.acquisition_cost,
        current_ltp=ipo.current_ltp,
        market_value=val,
        unrealized_pnl=pnl,
        pnl_percentage=pnl_pct,
        pan_masked=allotment.pan_masked,
        upi_id_masked=allotment.upi_id_masked,
        mandate_status=allotment.mandate_status,
        allotment_status=allotment.allotment_status,
        demat_credit_status=allotment.demat_credit_status,
        status=allotment.status,
        demat_verified=allotment.demat_verified,
        verification_source=allotment.verification_source,
        verification_timestamp=allotment.verification_timestamp,
        conflict_note=allotment.conflict_note,
        ddpi_status=acc.ddpi_status,
        edis_authorized=acc.edis_authorized_today,
        created_at=allotment.created_at
    )


@router.delete("/{ipo_id}/allotments/{allotment_id}", status_code=status.HTTP_200_OK)
def delete_allotment(ipo_id: int, allotment_id: int, db: Session = Depends(get_db)):
    allotment = db.query(Allotment).filter(
        Allotment.id == allotment_id,
        Allotment.ipo_id == ipo_id
    ).first()
    if not allotment:
        raise HTTPException(status_code=404, detail="Allotment entry not found.")

    db.delete(allotment)
    db.commit()
    return {"success": True, "message": "Allotment entry removed."}


@router.post("/{ipo_id}/import-csv", response_model=CSVImportSummary)
async def import_allotments_csv(ipo_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Imports a CSV register containing account-wise allotment details.
    Expected CSV columns: client_code (or nickname), application_no, applied_qty, allotted_qty, cost
    Defensively detects duplicate entries, reports conflicts, and avoids silent overwriting.
    """
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found.")

    content = await file.read()
    if not content or len(content.strip()) == 0:
        raise HTTPException(status_code=400, detail="Uploaded CSV file is empty.")

    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            decoded = content.decode("latin-1")
        except Exception:
            raise HTTPException(status_code=400, detail="Unable to decode CSV file encoding.")

    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        raise HTTPException(status_code=400, detail="CSV contains no header row.")

    imported_count = 0
    updated_count = 0
    conflict_count = 0
    skipped_count = 0
    conflicts: List[str] = []
    errors: List[str] = []

    for idx, row in enumerate(reader, start=1):
        # Normalize row keys
        row_clean = {k.strip().lower(): v.strip() for k, v in row.items() if k and v is not None}
        raw_code = (
            row_clean.get("client_code") or row_clean.get("clientcode") or
            row_clean.get("client id") or row_clean.get("account") or
            row_clean.get("nickname")
        )

        if not raw_code:
            errors.append(f"Row {idx}: Missing client_code or nickname column.")
            skipped_count += 1
            continue

        acc = db.query(Account).filter(Account.client_code == raw_code).first()
        if not acc:
            acc = db.query(Account).filter(Account.nickname == raw_code).first()

        if not acc:
            errors.append(f"Row {idx}: Account identifier '{raw_code}' not found in registered accounts.")
            skipped_count += 1
            continue

        try:
            raw_applied = row_clean.get("applied_qty") or row_clean.get("applied") or "0"
            raw_allotted = row_clean.get("allotted_qty") or row_clean.get("allotted") or "0"
            raw_cost = row_clean.get("cost") or row_clean.get("issue_price") or str(ipo.issue_price)
            app_no = row_clean.get("application_no") or row_clean.get("app_no") or ""

            applied = max(0, int(float(raw_applied)))
            allotted = max(0, int(float(raw_allotted)))
            cost = max(0.01, float(raw_cost))

            existing = db.query(Allotment).filter(
                Allotment.ipo_id == ipo.id,
                Allotment.account_id == acc.id
            ).first()

            if existing:
                # Check for duplicate record conflict
                if (existing.allotted_quantity != allotted or
                    existing.applied_quantity != applied or
                    abs(existing.acquisition_cost - cost) > 0.01):
                    # Values differ - record explicit conflict notice rather than silent overwrite
                    conflict_msg = (
                        f"Row {idx} ({acc.nickname}): Existing allotment (Allotted={existing.allotted_quantity}, "
                        f"Cost=₹{existing.acquisition_cost}) differs from CSV (Allotted={allotted}, Cost=₹{cost}). "
                        f"Reconciled to CSV value with conflict audit trace."
                    )
                    conflicts.append(conflict_msg)
                    conflict_count += 1
                    
                    # Update with conflict audit note
                    existing.conflict_note = f"Reconciled from CSV on {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
                    existing.applied_quantity = applied
                    existing.allotted_quantity = allotted
                    existing.acquisition_cost = cost
                    existing.application_no = app_no or existing.application_no
                    existing.status = "ALLOTTED" if allotted > 0 else "NOT_ALLOTTED"
                    existing.updated_at = datetime.utcnow()
                    updated_count += 1
                else:
                    # Identical record already present
                    skipped_count += 1
            else:
                new_allot = Allotment(
                    ipo_id=ipo.id,
                    account_id=acc.id,
                    application_no=app_no,
                    applied_quantity=applied,
                    allotted_quantity=allotted,
                    acquisition_cost=cost,
                    status="ALLOTTED" if allotted > 0 else "NOT_ALLOTTED",
                    demat_verified=True,
                    verification_source="REGISTRAR_CSV",
                    verification_timestamp=datetime.utcnow()
                )
                db.add(new_allot)
                imported_count += 1

        except Exception as e:
            errors.append(f"Row {idx}: Data parsing error ({str(e)})")
            skipped_count += 1

    db.commit()

    return CSVImportSummary(
        imported_count=imported_count,
        updated_count=updated_count,
        conflict_count=conflict_count,
        skipped_count=skipped_count,
        conflicts=conflicts,
        errors=errors
    )


@router.get("/{ipo_id}/export-csv")
def export_allotments_csv(ipo_id: int, db: Session = Depends(get_db)):
    """
    Exports a sanitized, RFC 4180 compliant CSV of all allotments for the given IPO.
    Escapes potential spreadsheet formula injections.
    """
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found.")

    allotments = db.query(Allotment).filter(Allotment.ipo_id == ipo_id).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "client_code", "nickname", "account_group", "application_no",
        "category", "applied_qty", "allotted_qty", "acquisition_cost",
        "current_ltp", "market_value", "unrealized_pnl", "status",
        "demat_verified", "ddpi_status"
    ])

    ltp = ipo.current_ltp if ipo.current_ltp is not None and ipo.current_ltp > 0 else ipo.issue_price

    for a in allotments:
        acc = a.account
        qty = a.allotted_quantity
        cost = a.acquisition_cost
        val = round(qty * ltp, 2)
        pnl = round(val - (qty * cost), 2)

        writer.writerow([
            _sanitize_csv_cell(acc.client_code),
            _sanitize_csv_cell(acc.nickname),
            _sanitize_csv_cell(acc.account_group),
            _sanitize_csv_cell(a.application_no or ""),
            _sanitize_csv_cell(a.category or "RETAIL"),
            a.applied_quantity,
            a.allotted_quantity,
            f"{cost:.2f}",
            f"{ltp:.2f}",
            f"{val:.2f}",
            f"{pnl:.2f}",
            _sanitize_csv_cell(a.status),
            "YES" if a.demat_verified else "NO",
            _sanitize_csv_cell(acc.ddpi_status)
        ])

    output.seek(0)
    clean_sym = "".join(c for c in ipo.symbol if c.isalnum() or c in ("-", "_"))
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="allotments_{clean_sym}.csv"',
            "Cache-Control": "no-cache, no-store, must-revalidate"
        }
    )


@router.post("/sync-feed", status_code=status.HTTP_200_OK)
def trigger_feed_sync(db: Session = Depends(get_db)):
    """Triggers on-demand discovery and catalog update from verified market feed."""
    result = IPOFeedService.sync_feed(db, force_refresh=True)
    return result


@router.get("/feed-status", status_code=status.HTTP_200_OK)
def get_feed_status():
    """Returns background synchronization telemetry and scheduler health."""
    return sync_manager.get_status()


@router.post("/prepare-applications", response_model=IPOPrepareApplicationResponse)
def prepare_ipo_applications(
    payload: IPOPrepareApplicationRequest,
    db: Session = Depends(get_db)
):
    """
    Multi-Account IPO Application Preparation Workspace.
    - Validates lot size multipliers and retail limits (max ₹2,00,000 for Retail).
    - Detects duplicate applications across accounts.
    - Computes required application funding per account.
    - Does NOT simulate live broker submission (strictly preparation & validation).
    """
    ipo = db.query(IPO).filter(IPO.id == payload.ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found.")

    accounts = db.query(Account).filter(Account.id.in_(payload.account_ids)).all()
    if not accounts:
        raise HTTPException(status_code=400, detail="No valid accounts selected.")

    cut_off_price = payload.bid_price if payload.bid_price and payload.bid_price > 0 else (ipo.max_price or ipo.issue_price)
    shares_per_account = payload.lots * ipo.lot_size
    amount_per_account = round(shares_per_account * cut_off_price, 2)

    prepared_items: List[IPOApplicationPreparedItem] = []
    all_valid = True

    # Check for accounts already having an application for this IPO
    existing_allotments = db.query(Allotment).filter(
        Allotment.ipo_id == ipo.id,
        Allotment.account_id.in_(payload.account_ids)
    ).all()
    existing_account_ids = {a.account_id for a in existing_allotments}

    for acc in accounts:
        is_valid = True
        val_msg = None
        dup_warn = None

        if acc.id in existing_account_ids:
            dup_warn = f"Account '{acc.nickname}' already has an active application record for {ipo.symbol}."

        # Category constraint validation
        if payload.category == "RETAIL" and amount_per_account > 200000.0:
            is_valid = False
            val_msg = f"Retail category limit is ₹2,00,000. Calculated amount ₹{amount_per_account:,.2f} exceeds limit."
            all_valid = False
        elif not acc.is_enabled:
            is_valid = False
            val_msg = f"Account '{acc.nickname}' is currently disabled in settings."
            all_valid = False

        prepared_items.append(IPOApplicationPreparedItem(
            account_id=acc.id,
            account_nickname=acc.nickname,
            account_masked_code=acc.masked_client_code,
            ipo_symbol=ipo.symbol,
            category=payload.category,
            lots=payload.lots,
            shares=shares_per_account,
            cut_off_price=cut_off_price,
            total_amount=amount_per_account,
            is_valid=is_valid,
            validation_message=val_msg,
            duplicate_warning=dup_warn
        ))

    total_shares = len(accounts) * shares_per_account
    total_amount = round(len(accounts) * amount_per_account, 2)

    return IPOPrepareApplicationResponse(
        ipo_id=ipo.id,
        ipo_symbol=ipo.symbol,
        company_name=ipo.company_name,
        lot_size=ipo.lot_size,
        issue_price=cut_off_price,
        total_accounts=len(accounts),
        total_shares=total_shares,
        total_amount=total_amount,
        applications=prepared_items,
        all_valid=all_valid
    )
