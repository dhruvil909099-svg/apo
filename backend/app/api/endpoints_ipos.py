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
    IPOApplicationPreparedItem, IPOApplicationHandoffUpdate
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


def _build_ipo_response(ipo: IPO) -> IPOResponse:
    m = _calculate_ipo_metrics(ipo)
    min_inv = ipo.min_investment or round((ipo.min_price or ipo.issue_price) * ipo.lot_size, 2)
    return IPOResponse(
        id=ipo.id,
        symbol=ipo.symbol,
        company_name=ipo.company_name,
        exchange=ipo.exchange,
        issue_price=ipo.issue_price,
        min_price=ipo.min_price,
        max_price=ipo.max_price,
        lot_size=ipo.lot_size,
        min_investment=min_inv,
        issue_size=ipo.issue_size,
        subscription_rate=ipo.subscription_rate,
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
        company_logo_url=ipo.company_logo_url,
        sector=ipo.sector,
        industry=ipo.industry,
        description=ipo.description,
        issue_type=ipo.issue_type or "Book Built Issue",
        fresh_issue_size=ipo.fresh_issue_size,
        offer_for_sale_size=ipo.offer_for_sale_size,
        face_value=ipo.face_value,
        retail_quota=ipo.retail_quota,
        qib_quota=ipo.qib_quota,
        nii_quota=ipo.nii_quota,
        listing_price=ipo.listing_price,
        listing_gain=ipo.listing_gain,
        lead_managers=ipo.lead_managers,
        registrar_name=ipo.registrar_name,
        registrar_url=ipo.registrar_url,
        drhp_url=ipo.drhp_url,
        rhp_url=ipo.rhp_url,
        financials_json=ipo.financials_json,
        valuation_json=ipo.valuation_json,
        strengths_risks_json=ipo.strengths_risks_json,
        objects_of_issue_json=ipo.objects_of_issue_json,
        subscription_details_json=ipo.subscription_details_json,
        timeline_json=ipo.timeline_json,
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


def _build_allotment_response(a: Allotment) -> AllotmentResponse:
    acc = a.account
    ipo = a.ipo
    qty = max(0, a.allotted_quantity or 0)
    cost = max(0.0, a.acquisition_cost or (ipo.issue_price if ipo else 0.0) or 0.0)
    ltp = (ipo.current_ltp if ipo and ipo.current_ltp is not None and ipo.current_ltp > 0 else (ipo.issue_price if ipo else 0.0))
    market_val = round(qty * ltp, 2)
    total_cost = round(qty * cost, 2)
    pnl = round(market_val - total_cost, 2)
    pnl_pct = round(((pnl / total_cost) * 100), 2) if total_cost > 0 else 0.0

    return AllotmentResponse(
        id=a.id,
        ipo_id=a.ipo_id,
        account_id=acc.id if acc else a.account_id,
        account_nickname=acc.nickname if acc else "Unknown",
        account_masked_code=acc.masked_client_code if acc else "XXXX",
        account_group=acc.account_group if acc else "General",
        ipo_symbol=ipo.symbol if ipo else "IPO",
        application_no=a.application_no,
        category=a.category or "RETAIL",
        applied_quantity=a.applied_quantity or 0,
        allotted_quantity=a.allotted_quantity or 0,
        acquisition_cost=a.acquisition_cost or 0.0,
        current_ltp=ipo.current_ltp if ipo else None,
        market_value=market_val,
        unrealized_pnl=pnl,
        pnl_percentage=pnl_pct,
        pan_masked=a.pan_masked,
        upi_id_masked=a.upi_id_masked,
        mandate_status=a.mandate_status or "PENDING",
        preparation_status=a.preparation_status or "READY_FOR_HANDOFF",
        broker_application_status=a.broker_application_status or "NOT_SUBMITTED",
        lots=a.lots or 1,
        bid_price=a.bid_price,
        total_amount=a.total_amount or 0.0,
        upi_mandate_reference=a.upi_mandate_reference,
        bid_reference_no=a.bid_reference_no,
        official_portal_url=a.official_portal_url or "https://trade.angelone.in/ipo",
        handoff_timestamp=a.handoff_timestamp,
        allotment_status=a.allotment_status or "PENDING",
        demat_credit_status=a.demat_credit_status or "PENDING",
        status=a.status,
        demat_verified=a.demat_verified,
        verification_source=a.verification_source,
        verification_timestamp=a.verification_timestamp,
        conflict_note=a.conflict_note,
        ddpi_status=acc.ddpi_status if acc else "UNKNOWN",
        edis_authorized=acc.edis_authorized_today if acc else False,
        created_at=a.created_at
    )


def _sanitize_csv_cell(val: Any) -> str:
    """Escapes potential spreadsheet formula injection characters (=, +, -, @)."""
    s = str(val or "")
    if s.startswith(("=", "+", "-", "@")):
        return f"'{s}"
    return s


@router.get("", response_model=List[IPOResponse])
def list_ipos(
    status_filter: Optional[str] = Query(None, description="Filter: ALL, OPEN, UPCOMING, CLOSED, LISTED, SME, MAINBOARD"),
    db: Session = Depends(get_db)
):
    query = db.query(IPO)
    if status_filter:
        s_upper = status_filter.upper().strip()
        if s_upper == "SME":
            query = query.filter(IPO.is_sme.is_(True))
        elif s_upper == "MAINBOARD":
            query = query.filter(IPO.is_sme.is_(False))
        elif s_upper in ["OPEN", "PRE_OPEN"]:
            query = query.filter(IPO.status.in_(["OPEN", "PRE_OPEN"]))
        elif s_upper != "ALL":
            query = query.filter(IPO.status == s_upper)

    ipos = query.order_by(IPO.id.desc()).all()
    return [_build_ipo_response(ipo) for ipo in ipos]


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

    min_inv = ipo_in.min_investment or round((ipo_in.min_price or ipo_in.issue_price) * ipo_in.lot_size, 2)

    ipo = IPO(
        symbol=clean_symbol,
        company_name=ipo_in.company_name.strip(),
        exchange=ipo_in.exchange.strip().upper(),
        issue_price=float(ipo_in.issue_price),
        min_price=float(ipo_in.min_price) if ipo_in.min_price else float(ipo_in.issue_price),
        max_price=float(ipo_in.max_price) if ipo_in.max_price else float(ipo_in.issue_price),
        lot_size=int(ipo_in.lot_size),
        min_investment=min_inv,
        issue_size=ipo_in.issue_size,
        subscription_rate=ipo_in.subscription_rate,
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
        company_logo_url=ipo_in.company_logo_url,
        sector=ipo_in.sector,
        industry=ipo_in.industry,
        description=ipo_in.description,
        issue_type=ipo_in.issue_type or "Book Built Issue",
        fresh_issue_size=ipo_in.fresh_issue_size,
        offer_for_sale_size=ipo_in.offer_for_sale_size,
        face_value=ipo_in.face_value,
        retail_quota=ipo_in.retail_quota,
        qib_quota=ipo_in.qib_quota,
        nii_quota=ipo_in.nii_quota,
        listing_price=ipo_in.listing_price,
        listing_gain=ipo_in.listing_gain,
        lead_managers=ipo_in.lead_managers,
        registrar_name=ipo_in.registrar_name,
        registrar_url=ipo_in.registrar_url,
        drhp_url=ipo_in.drhp_url,
        rhp_url=ipo_in.rhp_url,
        financials_json=ipo_in.financials_json,
        valuation_json=ipo_in.valuation_json,
        strengths_risks_json=ipo_in.strengths_risks_json,
        objects_of_issue_json=ipo_in.objects_of_issue_json,
        subscription_details_json=ipo_in.subscription_details_json,
        timeline_json=ipo_in.timeline_json,
        source_name=ipo_in.source_name or "MANUAL",
        source_timestamp=datetime.utcnow(),
        last_sync_at=datetime.utcnow()
    )
    db.add(ipo)
    db.commit()
    db.refresh(ipo)

    return _build_ipo_response(ipo)


@router.get("/applications/all", response_model=List[AllotmentResponse])
def list_all_applications(
    account_id: Optional[int] = Query(None, description="Filter by account ID"),
    status_filter: Optional[str] = Query(None, description="Filter by application/allotment status"),
    mandate_filter: Optional[str] = Query(None, description="Filter by mandate status"),
    is_sme: Optional[bool] = Query(None, description="Filter by SME flag"),
    db: Session = Depends(get_db)
):
    """
    Consolidated Applications Dashboard Query.
    Returns all IPO applications, drafts, and allotments across all registered client accounts.
    """
    query = db.query(Allotment).join(IPO, Allotment.ipo_id == IPO.id)

    if account_id:
        query = query.filter(Allotment.account_id == account_id)
    if is_sme is not None:
        query = query.filter(IPO.is_sme == is_sme)
    if mandate_filter:
        query = query.filter(Allotment.mandate_status == mandate_filter.upper())
    if status_filter:
        s = status_filter.upper()
        if s in ["ALLOTTED", "NOT_ALLOTTED", "PENDING"]:
            query = query.filter(Allotment.allotment_status == s)
        elif s in ["DRAFT", "READY_FOR_HANDOFF", "AWAITING_CONFIRMATION", "SUBMITTED_BROKER_CONFIRMED"]:
            query = query.filter(Allotment.preparation_status == s)
        else:
            query = query.filter(Allotment.status == s)

    allotments = query.order_by(Allotment.id.desc()).all()
    return [_build_allotment_response(a) for a in allotments]


@router.patch("/applications/{allotment_id}", response_model=AllotmentResponse)
def update_application_status(
    allotment_id: int,
    patch_in: AllotmentUpdate,
    db: Session = Depends(get_db)
):
    """Updates application tracking parameters, mandate events, or allotment resolutions."""
    allotment = db.query(Allotment).filter(Allotment.id == allotment_id).first()
    if not allotment:
        raise HTTPException(status_code=404, detail="Application record not found.")

    for field, val in patch_in.model_dump(exclude_unset=True).items():
        if val is not None:
            setattr(allotment, field, val)

    allotment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(allotment)

    db.add(AuditLog(
        event_type="IPO_APPLICATION_UPDATE",
        operator="SYSTEM",
        details_json=f'{{"allotment_id": {allotment_id}, "preparation_status": "{allotment.preparation_status}", "mandate_status": "{allotment.mandate_status}", "allotment_status": "{allotment.allotment_status}"}}'
    ))
    db.commit()

    return _build_allotment_response(allotment)


@router.post("/applications/handoff", response_model=AllotmentResponse)
def record_application_handoff(
    handoff: IPOApplicationHandoffUpdate,
    db: Session = Depends(get_db)
):
    """
    Records an official broker application handoff confirmation.
    Transitions status to AWAITING_CONFIRMATION or SUBMITTED_BROKER_CONFIRMED once authorized.
    """
    allotment = db.query(Allotment).filter(Allotment.id == handoff.allotment_id).first()
    if not allotment:
        raise HTTPException(status_code=404, detail="Application record not found.")

    if handoff.preparation_status:
        allotment.preparation_status = handoff.preparation_status
    if handoff.broker_application_status:
        allotment.broker_application_status = handoff.broker_application_status
    if handoff.application_no:
        allotment.application_no = handoff.application_no
    if handoff.upi_mandate_reference:
        allotment.upi_mandate_reference = handoff.upi_mandate_reference
    if handoff.mandate_status:
        allotment.mandate_status = handoff.mandate_status
    if handoff.verification_source:
        allotment.verification_source = handoff.verification_source

    allotment.handoff_timestamp = datetime.utcnow()
    allotment.verification_timestamp = datetime.utcnow()
    allotment.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(allotment)

    db.add(AuditLog(
        event_type="IPO_APPLICATION_HANDOFF",
        operator="USER",
        details_json=f'{{"allotment_id": {allotment.id}, "app_no": "{allotment.application_no}", "prep_status": "{allotment.preparation_status}"}}'
    ))
    db.commit()

    return _build_allotment_response(allotment)


@router.get("/{ipo_id}", response_model=IPOResponse)
def get_ipo(ipo_id: int, db: Session = Depends(get_db)):
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO record not found.")
    return _build_ipo_response(ipo)


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
    return [_build_allotment_response(a) for a in allotments]


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
        existing.preparation_status = allot_in.preparation_status or existing.preparation_status
        existing.broker_application_status = allot_in.broker_application_status or existing.broker_application_status
        existing.lots = allot_in.lots or existing.lots
        existing.bid_price = allot_in.bid_price or existing.bid_price
        existing.total_amount = allot_in.total_amount or existing.total_amount
        existing.upi_mandate_reference = allot_in.upi_mandate_reference or existing.upi_mandate_reference
        existing.bid_reference_no = allot_in.bid_reference_no or existing.bid_reference_no
        existing.official_portal_url = allot_in.official_portal_url or existing.official_portal_url
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
            preparation_status=allot_in.preparation_status or "READY_FOR_HANDOFF",
            broker_application_status=allot_in.broker_application_status or "NOT_SUBMITTED",
            lots=allot_in.lots or 1,
            bid_price=allot_in.bid_price,
            total_amount=allot_in.total_amount or 0.0,
            upi_mandate_reference=allot_in.upi_mandate_reference,
            bid_reference_no=allot_in.bid_reference_no,
            official_portal_url=allot_in.official_portal_url or "https://trade.angelone.in/ipo",
            status=allot_in.status,
            demat_verified=True,
            verification_source="MANUAL_ENTRY",
            verification_timestamp=datetime.utcnow()
        )
        db.add(allotment)

    db.commit()
    db.refresh(allotment)
    return _build_allotment_response(allotment)


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
    """Imports a CSV register containing account-wise allotment details."""
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
                if (existing.allotted_quantity != allotted or
                    existing.applied_quantity != applied or
                    abs(existing.acquisition_cost - cost) > 0.01):
                    conflict_msg = (
                        f"Row {idx} ({acc.nickname}): Existing allotment (Allotted={existing.allotted_quantity}, "
                        f"Cost=₹{existing.acquisition_cost}) differs from CSV (Allotted={allotted}, Cost=₹{cost}). "
                        f"Reconciled to CSV value with conflict audit trace."
                    )
                    conflicts.append(conflict_msg)
                    conflict_count += 1
                    
                    existing.conflict_note = f"Reconciled from CSV on {datetime.utcnow().strftime('%Y-%m-%d %H:%M')}"
                    existing.applied_quantity = applied
                    existing.allotted_quantity = allotted
                    existing.acquisition_cost = cost
                    existing.application_no = app_no or existing.application_no
                    existing.status = "ALLOTTED" if allotted > 0 else "NOT_ALLOTTED"
                    existing.allotment_status = "ALLOTTED" if allotted > 0 else "NOT_ALLOTTED"
                    existing.updated_at = datetime.utcnow()
                    updated_count += 1
                else:
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
                    allotment_status="ALLOTTED" if allotted > 0 else "NOT_ALLOTTED",
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
    """Exports a sanitized, RFC 4180 compliant CSV of all allotments for the given IPO."""
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
    - Optionally persists application drafts (`save_drafts=True`) for official handoff tracking.
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
    existing_map = {a.account_id: a for a in existing_allotments}

    for acc in accounts:
        is_valid = True
        val_msg = None
        dup_warn = None
        existing_record = existing_map.get(acc.id)

        if existing_record:
            dup_warn = f"Account '{acc.nickname}' already has a record (Status: {existing_record.preparation_status}) for {ipo.symbol}."

        # Category constraint validation
        if payload.category == "RETAIL" and amount_per_account > 200000.0:
            is_valid = False
            val_msg = f"Retail category limit is ₹2,00,000. Calculated amount ₹{amount_per_account:,.2f} exceeds limit."
            all_valid = False
        elif not acc.is_enabled:
            is_valid = False
            val_msg = f"Account '{acc.nickname}' is currently disabled in settings."
            all_valid = False

        draft_id = None
        if payload.save_drafts and is_valid:
            if existing_record:
                existing_record.applied_quantity = shares_per_account
                existing_record.lots = payload.lots
                existing_record.bid_price = cut_off_price
                existing_record.total_amount = amount_per_account
                existing_record.category = payload.category
                existing_record.preparation_status = "READY_FOR_HANDOFF"
                existing_record.updated_at = datetime.utcnow()
                draft_id = existing_record.id
            else:
                new_draft = Allotment(
                    ipo_id=ipo.id,
                    account_id=acc.id,
                    category=payload.category,
                    applied_quantity=shares_per_account,
                    allotted_quantity=0,
                    acquisition_cost=cut_off_price,
                    lots=payload.lots,
                    bid_price=cut_off_price,
                    total_amount=amount_per_account,
                    status="PENDING",
                    preparation_status="READY_FOR_HANDOFF",
                    broker_application_status="NOT_SUBMITTED",
                    mandate_status="PENDING",
                    allotment_status="PENDING",
                    demat_verified=False,
                    verification_source="IPRO_PREPARATION_WORKSPACE"
                )
                db.add(new_draft)
                db.flush()
                draft_id = new_draft.id

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
            duplicate_warning=dup_warn,
            official_portal_url="https://trade.angelone.in/ipo",
            draft_id=draft_id
        ))

    if payload.save_drafts:
        db.commit()

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
        all_valid=all_valid,
        official_portal_url="https://trade.angelone.in/ipo"
    )
