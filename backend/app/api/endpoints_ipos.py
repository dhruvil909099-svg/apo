import io
import csv
from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.ipo import IPO, Allotment
from app.models.account import Account
from app.schemas.ipo import (
    IPOCreate, IPOResponse, AllotmentCreate, AllotmentUpdate, AllotmentResponse, CSVImportSummary
)

router = APIRouter(prefix="/ipos", tags=["IPOs"])


@router.get("", response_model=List[IPOResponse])
def list_ipos(
    status_filter: Optional[str] = Query(None, description="Filter: UPCOMING, PRE_OPEN, LISTED, CLOSED"),
    db: Session = Depends(get_db)
):
    query = db.query(IPO)
    if status_filter:
        query = query.filter(IPO.status == status_filter.upper())
    
    ipos = query.order_by(IPO.id.desc()).all()
    results = []
    
    for ipo in ipos:
        total_shares = 0
        total_accounts = 0
        total_cost = 0.0
        
        for a in ipo.allotments:
            total_shares += a.allotted_quantity
            total_cost += (a.allotted_quantity * a.acquisition_cost)
            if a.allotted_quantity > 0:
                total_accounts += 1

        ltp = ipo.current_ltp or ipo.issue_price
        est_val = total_shares * ltp
        pnl = est_val - total_cost
        pnl_pct = ((pnl / total_cost) * 100) if total_cost > 0 else 0.0

        results.append(IPOResponse(
            id=ipo.id,
            symbol=ipo.symbol,
            company_name=ipo.company_name,
            exchange=ipo.exchange,
            issue_price=ipo.issue_price,
            lot_size=ipo.lot_size,
            listing_date=ipo.listing_date,
            isin=ipo.isin,
            symbol_token=ipo.symbol_token,
            is_sme=ipo.is_sme,
            current_ltp=ipo.current_ltp,
            previous_close=ipo.previous_close,
            status=ipo.status,
            total_allotted_shares=total_shares,
            total_accounts_allotted=total_accounts,
            estimated_current_value=est_val,
            estimated_pnl=pnl,
            pnl_percentage=round(pnl_pct, 2),
            created_at=ipo.created_at
        ))

    return results


@router.post("", response_model=IPOResponse, status_code=status.HTTP_201_CREATED)
def create_ipo(ipo_in: IPOCreate, db: Session = Depends(get_db)):
    clean_symbol = ipo_in.symbol.strip().upper()
    existing = db.query(IPO).filter(IPO.symbol == clean_symbol).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"IPO with symbol {clean_symbol} already exists.")

    ipo = IPO(
        symbol=clean_symbol,
        company_name=ipo_in.company_name.strip(),
        exchange=ipo_in.exchange.strip().upper(),
        issue_price=ipo_in.issue_price,
        lot_size=ipo_in.lot_size,
        listing_date=ipo_in.listing_date,
        isin=ipo_in.isin,
        symbol_token=ipo_in.symbol_token,
        is_sme=ipo_in.is_sme,
        current_ltp=ipo_in.issue_price,
        status=ipo_in.status.upper()
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
        lot_size=ipo.lot_size,
        listing_date=ipo.listing_date,
        isin=ipo.isin,
        symbol_token=ipo.symbol_token,
        is_sme=ipo.is_sme,
        current_ltp=ipo.current_ltp,
        previous_close=ipo.previous_close,
        status=ipo.status,
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
        raise HTTPException(status_code=404, detail="IPO not found")

    total_shares = sum(a.allotted_quantity for a in ipo.allotments)
    total_cost = sum(a.allotted_quantity * a.acquisition_cost for a in ipo.allotments)
    total_accounts = sum(1 for a in ipo.allotments if a.allotted_quantity > 0)
    ltp = ipo.current_ltp or ipo.issue_price
    est_val = total_shares * ltp
    pnl = est_val - total_cost
    pnl_pct = ((pnl / total_cost) * 100) if total_cost > 0 else 0.0

    return IPOResponse(
        id=ipo.id,
        symbol=ipo.symbol,
        company_name=ipo.company_name,
        exchange=ipo.exchange,
        issue_price=ipo.issue_price,
        lot_size=ipo.lot_size,
        listing_date=ipo.listing_date,
        isin=ipo.isin,
        symbol_token=ipo.symbol_token,
        is_sme=ipo.is_sme,
        current_ltp=ipo.current_ltp,
        previous_close=ipo.previous_close,
        status=ipo.status,
        total_allotted_shares=total_shares,
        total_accounts_allotted=total_accounts,
        estimated_current_value=est_val,
        estimated_pnl=pnl,
        pnl_percentage=round(pnl_pct, 2),
        created_at=ipo.created_at
    )


@router.get("/{ipo_id}/allotments", response_model=List[AllotmentResponse])
def list_ipo_allotments(ipo_id: int, db: Session = Depends(get_db)):
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found")

    allotments = db.query(Allotment).filter(Allotment.ipo_id == ipo_id).all()
    results = []

    for a in allotments:
        acc = a.account
        ltp = ipo.current_ltp or ipo.issue_price
        val = a.allotted_quantity * ltp
        cost = a.allotted_quantity * a.acquisition_cost
        pnl = val - cost
        pnl_pct = ((pnl / cost) * 100) if cost > 0 else 0.0

        results.append(AllotmentResponse(
            id=a.id,
            ipo_id=ipo.id,
            account_id=acc.id,
            account_nickname=acc.nickname,
            account_masked_code=acc.masked_client_code,
            account_group=acc.account_group,
            ipo_symbol=ipo.symbol,
            application_no=a.application_no,
            applied_quantity=a.applied_quantity,
            allotted_quantity=a.allotted_quantity,
            acquisition_cost=a.acquisition_cost,
            current_ltp=ipo.current_ltp,
            market_value=val,
            unrealized_pnl=pnl,
            pnl_percentage=round(pnl_pct, 2),
            status=a.status,
            demat_verified=a.demat_verified,
            ddpi_status=acc.ddpi_status,
            edis_authorized=acc.edis_authorized_today,
            created_at=a.created_at
        ))

    return results


@router.post("/{ipo_id}/allotments", response_model=AllotmentResponse)
def create_allotment(ipo_id: int, allot_in: AllotmentCreate, db: Session = Depends(get_db)):
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found")

    acc = db.query(Account).filter(Account.id == allot_in.account_id).first()
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    # Check if allotment already exists for this account & IPO
    existing = db.query(Allotment).filter(
        Allotment.ipo_id == ipo_id,
        Allotment.account_id == allot_in.account_id
    ).first()

    if existing:
        existing.allotted_quantity = allot_in.allotted_quantity
        existing.applied_quantity = allot_in.applied_quantity
        existing.acquisition_cost = allot_in.acquisition_cost
        existing.status = allot_in.status
        allotment = existing
    else:
        allotment = Allotment(
            ipo_id=ipo_id,
            account_id=allot_in.account_id,
            application_no=allot_in.application_no,
            applied_quantity=allot_in.applied_quantity,
            allotted_quantity=allot_in.allotted_quantity,
            acquisition_cost=allot_in.acquisition_cost,
            status=allot_in.status,
            demat_verified=True
        )
        db.add(allotment)

    db.commit()
    db.refresh(allotment)

    ltp = ipo.current_ltp or ipo.issue_price
    val = allotment.allotted_quantity * ltp
    cost = allotment.allotted_quantity * allotment.acquisition_cost
    pnl = val - cost
    pnl_pct = ((pnl / cost) * 100) if cost > 0 else 0.0

    return AllotmentResponse(
        id=allotment.id,
        ipo_id=ipo.id,
        account_id=acc.id,
        account_nickname=acc.nickname,
        account_masked_code=acc.masked_client_code,
        account_group=acc.account_group,
        ipo_symbol=ipo.symbol,
        application_no=allotment.application_no,
        applied_quantity=allotment.applied_quantity,
        allotted_quantity=allotment.allotted_quantity,
        acquisition_cost=allotment.acquisition_cost,
        current_ltp=ipo.current_ltp,
        market_value=val,
        unrealized_pnl=pnl,
        pnl_percentage=round(pnl_pct, 2),
        status=allotment.status,
        demat_verified=allotment.demat_verified,
        ddpi_status=acc.ddpi_status,
        edis_authorized=acc.edis_authorized_today,
        created_at=allotment.created_at
    )


@router.post("/{ipo_id}/import-csv", response_model=CSVImportSummary)
async def import_allotments_csv(ipo_id: int, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Imports a CSV register containing account-wise allotment details.
    Expected CSV columns: client_code (or nickname), application_no, applied_qty, allotted_qty, cost
    """
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found")

    content = await file.read()
    decoded = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(decoded))

    imported = 0
    skipped = 0
    errors = []

    for idx, row in enumerate(reader, start=1):
        raw_code = row.get("client_code") or row.get("clientcode") or row.get("Client ID")
        if not raw_code:
            errors.append(f"Row {idx}: Missing client_code column")
            skipped += 1
            continue

        acc = db.query(Account).filter(Account.client_code == raw_code.strip()).first()
        if not acc:
            # Try matching by nickname
            acc = db.query(Account).filter(Account.nickname == raw_code.strip()).first()
        
        if not acc:
            errors.append(f"Row {idx}: Account '{raw_code}' not found in registered accounts.")
            skipped += 1
            continue

        try:
            applied = int(row.get("applied_qty") or row.get("applied") or 0)
            allotted = int(row.get("allotted_qty") or row.get("allotted") or 0)
            cost = float(row.get("cost") or row.get("issue_price") or ipo.issue_price)
            app_no = row.get("application_no") or row.get("app_no") or ""

            existing = db.query(Allotment).filter(
                Allotment.ipo_id == ipo.id,
                Allotment.account_id == acc.id
            ).first()

            if existing:
                existing.applied_quantity = applied
                existing.allotted_quantity = allotted
                existing.acquisition_cost = cost
                existing.application_no = app_no
                existing.status = "ALLOTTED" if allotted > 0 else "NOT_ALLOTTED"
            else:
                new_allot = Allotment(
                    ipo_id=ipo.id,
                    account_id=acc.id,
                    application_no=app_no,
                    applied_quantity=applied,
                    allotted_quantity=allotted,
                    acquisition_cost=cost,
                    status="ALLOTTED" if allotted > 0 else "NOT_ALLOTTED",
                    demat_verified=True
                )
                db.add(new_allot)
            imported += 1
        except Exception as e:
            errors.append(f"Row {idx}: Parse error: {str(e)}")
            skipped += 1

    db.commit()
    return CSVImportSummary(imported_count=imported, skipped_count=skipped, errors=errors)


@router.get("/{ipo_id}/export-csv")
def export_allotments_csv(ipo_id: int, db: Session = Depends(get_db)):
    ipo = db.query(IPO).filter(IPO.id == ipo_id).first()
    if not ipo:
        raise HTTPException(status_code=404, detail="IPO not found")

    allotments = db.query(Allotment).filter(Allotment.ipo_id == ipo_id).all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["client_code", "nickname", "application_no", "applied_qty", "allotted_qty", "cost", "status"])

    for a in allotments:
        writer.writerow([
            a.account.client_code,
            a.account.nickname,
            a.application_no or "",
            a.applied_quantity,
            a.allotted_quantity,
            a.acquisition_cost,
            a.status
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=allotments_{ipo.symbol}.csv"}
    )
