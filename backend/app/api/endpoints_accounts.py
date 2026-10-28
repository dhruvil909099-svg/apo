from typing import List, Optional, Dict, Any
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import cipher, mask_client_id, sanitize_dict_for_logging, normalize_base32_secret
from app.models.account import Account
from app.models.audit import AuditLog
from app.models.ipo import Allotment, IPO
from app.models.order import Order
from app.schemas.account import (
    AccountCreate, AccountUpdate, AccountResponse, AccountTestResult, AccountTestPayload,
    AccountOverviewResponse, AccountHoldingItem, AccountPositionItem,
    AccountOrderItem, AccountTradeItem, AccountSyncResponse
)
from app.services.smartapi_adapter import SmartAPIAdapter, get_adapter_for_account, invalidate_adapter_for_account
from app.services.account_persistence import persist_accounts_backup
from app.services.portfolio_sync_service import reconcile_broker_holdings
import json

router = APIRouter(prefix="/accounts", tags=["Accounts"])


@router.get("", response_model=List[AccountResponse])
def list_accounts(
    group: Optional[str] = Query(None, description="Filter by account group (e.g. Family, Friends)"),
    status_filter: Optional[str] = Query(None, description="Filter by auth status"),
    db: Session = Depends(get_db)
):
    query = db.query(Account)
    if group:
        query = query.filter(Account.account_group == group)
    if status_filter:
        query = query.filter(Account.auth_status == status_filter)
    
    accounts = query.order_by(Account.id.asc()).all()
    
    return [
        AccountResponse(
            id=acc.id,
            nickname=acc.nickname,
            masked_client_code=acc.masked_client_code,
            account_group=acc.account_group,
            is_enabled=acc.is_enabled,
            is_demo=acc.is_demo,
            auth_status=acc.auth_status,
            ddpi_status=acc.ddpi_status,
            edis_authorized_today=acc.edis_authorized_today,
            available_cash=acc.available_cash,
            last_sync_time=acc.last_sync_time,
            last_auth_error=acc.last_auth_error,
            created_at=acc.created_at
        )
        for acc in accounts
    ]


@router.post("", response_model=AccountResponse, status_code=status.HTTP_201_CREATED)
def create_account(account_in: AccountCreate, db: Session = Depends(get_db)):
    # Standardize client code (strictly uppercase without whitespace)
    clean_client_code = account_in.client_code.strip().upper()
    existing = db.query(Account).filter(Account.client_code == clean_client_code).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account with client code {mask_client_id(clean_client_code)} already exists."
        )

    clean_api_key = account_in.api_key.strip()
    clean_pin = account_in.pin.strip()
    raw_totp = normalize_base32_secret(account_in.totp_secret.strip())

    if raw_totp.isdigit() and len(raw_totp) == 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Account registration requires the permanent Base32 secret string from Angel One 'Enable TOTP', not a 6-digit temporary code."
        )

    # Encrypt sensitive credentials using AES-256 Fernet
    encrypted_key = cipher.encrypt(clean_api_key)
    encrypted_pin = cipher.encrypt(clean_pin)
    encrypted_totp = cipher.encrypt(raw_totp)

    account = Account(
        nickname=account_in.nickname.strip(),
        client_code=clean_client_code,
        account_group=account_in.account_group.strip() or "Family",
        encrypted_api_key=encrypted_key,
        encrypted_pin=encrypted_pin,
        encrypted_totp_secret=encrypted_totp,
        is_demo=account_in.is_demo,
        is_enabled=True,
        auth_status="DISCONNECTED",
        ddpi_status="ACTIVE",
        available_cash=100000.0 if account_in.is_demo else 0.0
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    persist_accounts_backup(db)

    # Audit log
    audit = AuditLog(
        event_type="ACCOUNT_CREATED",
        account_id=account.id,
        operator="OPERATOR",
        details_json=json.dumps({
            "account_id": account.id,
            "nickname": account.nickname,
            "masked_client_code": account.masked_client_code,
            "group": account.account_group,
            "is_demo": account.is_demo
        })
    )
    db.add(audit)
    db.commit()

    return AccountResponse(
        id=account.id,
        nickname=account.nickname,
        masked_client_code=account.masked_client_code,
        account_group=account.account_group,
        is_enabled=account.is_enabled,
        is_demo=account.is_demo,
        auth_status=account.auth_status,
        ddpi_status=account.ddpi_status,
        edis_authorized_today=account.edis_authorized_today,
        available_cash=account.available_cash,
        last_sync_time=account.last_sync_time,
        last_auth_error=account.last_auth_error,
        created_at=account.created_at
    )


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    return AccountResponse(
        id=account.id,
        nickname=account.nickname,
        masked_client_code=account.masked_client_code,
        account_group=account.account_group,
        is_enabled=account.is_enabled,
        is_demo=account.is_demo,
        auth_status=account.auth_status,
        ddpi_status=account.ddpi_status,
        edis_authorized_today=account.edis_authorized_today,
        available_cash=account.available_cash,
        last_sync_time=account.last_sync_time,
        last_auth_error=account.last_auth_error,
        created_at=account.created_at
    )


@router.put("/{account_id}", response_model=AccountResponse)
def update_account(account_id: int, account_in: AccountUpdate, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if account_in.nickname is not None:
        account.nickname = account_in.nickname.strip()
    if account_in.account_group is not None:
        account.account_group = account_in.account_group.strip()
    if account_in.is_enabled is not None:
        account.is_enabled = account_in.is_enabled
    if account_in.ddpi_status is not None:
        account.ddpi_status = account_in.ddpi_status
    if account_in.edis_authorized_today is not None:
        account.edis_authorized_today = account_in.edis_authorized_today

    credentials_rotated = False
    manual_totp: Optional[str] = None

    if account_in.client_code is not None and account_in.client_code.strip():
        new_code = account_in.client_code.strip().upper()
        if new_code != account.client_code:
            existing = db.query(Account).filter(Account.client_code == new_code, Account.id != account.id).first()
            if existing:
                raise HTTPException(status_code=400, detail=f"Client code {mask_client_id(new_code)} already in use.")
            account.client_code = new_code
            credentials_rotated = True

    # Optional credential rotation
    if account_in.api_key is not None and account_in.api_key.strip():
        account.encrypted_api_key = cipher.encrypt(account_in.api_key.strip())
        credentials_rotated = True
    if account_in.pin is not None and account_in.pin.strip():
        account.encrypted_pin = cipher.encrypt(account_in.pin.strip())
        credentials_rotated = True

    if account_in.manual_totp is not None and account_in.manual_totp.strip():
        manual_totp = account_in.manual_totp.strip()

    if account_in.totp_secret is not None and account_in.totp_secret.strip():
        raw_secret_input = account_in.totp_secret.strip()
        # If the user entered a 6-digit code in the totp_secret field:
        if raw_secret_input.isdigit() and len(raw_secret_input) == 6:
            # Treat as temporary manual TOTP without overwriting permanent Base32 secret
            manual_totp = raw_secret_input
        else:
            normalized_secret = normalize_base32_secret(raw_secret_input)
            account.encrypted_totp_secret = cipher.encrypt(normalized_secret)
            credentials_rotated = True

    # If credentials were changed or manual_totp was provided, re-verify connectivity
    if (credentials_rotated or manual_totp) and not account.is_demo:
        invalidate_adapter_for_account(account.id)
        try:
            raw_key = cipher.decrypt(account.encrypted_api_key)
            raw_pin = cipher.decrypt(account.encrypted_pin)
            raw_totp = cipher.decrypt(account.encrypted_totp_secret)
            adapter = get_adapter_for_account(
                account.id, raw_key, account.client_code, raw_pin, raw_totp, force_new=True
            )
            test_res = adapter.test_connection(manual_totp=manual_totp)
            if test_res["success"]:
                account.auth_status = "CONNECTED"
                account.last_sync_time = datetime.utcnow()
                account.last_auth_error = None
                rms = adapter.get_rms()
                if rms:
                    cash = float(rms.get("availablecash", rms.get("net", account.available_cash)))
                    account.available_cash = round(cash, 2)
            else:
                account.auth_status = "ERROR"
                account.last_auth_error = test_res["message"]
        except Exception as e:
            account.auth_status = "ERROR"
            account.last_auth_error = str(e)

    account.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(account)
    persist_accounts_backup(db)

    return AccountResponse(
        id=account.id,
        nickname=account.nickname,
        masked_client_code=account.masked_client_code,
        account_group=account.account_group,
        is_enabled=account.is_enabled,
        is_demo=account.is_demo,
        auth_status=account.auth_status,
        ddpi_status=account.ddpi_status,
        edis_authorized_today=account.edis_authorized_today,
        available_cash=account.available_cash,
        last_sync_time=account.last_sync_time,
        last_auth_error=account.last_auth_error,
        created_at=account.created_at
    )


@router.delete("/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(account_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    invalidate_adapter_for_account(account_id)
    db.delete(account)
    db.commit()
    persist_accounts_backup(db)


@router.post("/{account_id}/test", response_model=AccountTestResult)
def test_account_connection(
    account_id: int,
    payload: Optional[AccountTestPayload] = None,
    db: Session = Depends(get_db)
):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    manual_totp = (payload.totp_code.strip() if payload and payload.totp_code and payload.totp_code.strip() else None)

    # If it is a demo account, simulate successful connection
    if account.is_demo:
        account.auth_status = "CONNECTED"
        account.last_sync_time = datetime.utcnow()
        account.last_auth_error = None
        db.commit()
        return AccountTestResult(
            account_id=account.id,
            nickname=account.nickname,
            masked_client_code=account.masked_client_code,
            success=True,
            message="Demo account simulated connection verified.",
            auth_status="CONNECTED",
            jwt_acquired=True,
            ddpi_status=account.ddpi_status
        )

    # Decrypt credentials in memory
    try:
        raw_key = cipher.decrypt(account.encrypted_api_key)
        raw_pin = cipher.decrypt(account.encrypted_pin)
        raw_totp = cipher.decrypt(account.encrypted_totp_secret)
    except Exception as e:
        account.auth_status = "ERROR"
        account.last_auth_error = "Credential decryption failed"
        db.commit()
        return AccountTestResult(
            account_id=account.id,
            nickname=account.nickname,
            masked_client_code=account.masked_client_code,
            success=False,
            message="Internal error: could not decrypt credentials.",
            auth_status="ERROR",
            jwt_acquired=False,
            ddpi_status="UNKNOWN"
        )

    # Get adapter from pool (forcing fresh session if manual TOTP provided)
    adapter = get_adapter_for_account(
        account.id,
        api_key=raw_key,
        client_code=account.client_code,
        pin=raw_pin,
        totp_secret=raw_totp,
        force_new=bool(manual_totp)
    )
    test_res = adapter.test_connection(manual_totp=manual_totp)

    if test_res["success"]:
        account.auth_status = "CONNECTED"
        account.last_sync_time = datetime.utcnow()
        account.last_auth_error = None
        account.ddpi_status = test_res.get("ddpi_status", "ACTIVE")
        rms_data = adapter.get_rms()
        if rms_data:
            cash_val = float(rms_data.get("availablecash", rms_data.get("net", 0.0)))
            account.available_cash = round(cash_val, 2)
    else:
        err_code = test_res.get("error_code", "")
        account.auth_status = "EXPIRED" if err_code in ("AG8001", "AB1004", "SESSION_EXPIRED") else "ERROR"
        account.last_auth_error = test_res["message"]

    db.commit()
    persist_accounts_backup(db)

    return AccountTestResult(
        account_id=account.id,
        nickname=account.nickname,
        masked_client_code=account.masked_client_code,
        success=test_res["success"],
        message=test_res["message"],
        auth_status=account.auth_status,
        jwt_acquired=test_res.get("jwt_acquired", False),
        ddpi_status=account.ddpi_status
    )


@router.get("/{account_id}/overview", response_model=AccountOverviewResponse)
def get_account_overview(account_id: int, db: Session = Depends(get_db)):
    """
    Returns verified account profile overview, funds, connection health, and holdings summary.
    """
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # Fetch holdings from verified Demat allotments
    allotments = db.query(Allotment).join(IPO).filter(
        Allotment.account_id == account_id,
        Allotment.allotted_quantity > 0
    ).all()
    holdings_count = len(allotments)
    holdings_val = sum(a.allotted_quantity * (a.ipo.current_ltp or a.ipo.issue_price) for a in allotments)

    # Stale data warning if last sync is missing or older than 12 hours
    is_stale = False
    if not account.last_sync_time:
        is_stale = True
    elif (datetime.utcnow() - account.last_sync_time).total_seconds() > 43200:
        is_stale = True

    # Do not return fabricated zero balances when live account data is unverified/unavailable
    verified_cash = account.available_cash if (account.is_demo or account.last_sync_time is not None) else None

    return AccountOverviewResponse(
        account_id=account.id,
        nickname=account.nickname,
        masked_client_code=account.masked_client_code,
        account_group=account.account_group,
        is_enabled=account.is_enabled,
        is_demo=account.is_demo,
        auth_status=account.auth_status,
        ddpi_status=account.ddpi_status,
        edis_authorized_today=account.edis_authorized_today,
        available_cash=verified_cash,
        total_margin=verified_cash,
        utilized_margin=0.0 if verified_cash is not None else None,
        total_holdings_count=holdings_count,
        total_holdings_value=round(holdings_val, 2),
        total_positions_count=0,
        last_sync_time=account.last_sync_time,
        data_source="DEMAT_LEDGER" if account.is_demo else "ANGEL_ONE_SMARTAPI",
        stale_data_warning=is_stale
    )


@router.get("/{account_id}/holdings", response_model=List[AccountHoldingItem])
def get_account_holdings(account_id: int, db: Session = Depends(get_db)):
    """
    Returns verified equity delivery holdings for the specified account.
    Keeps delivery holdings strictly separate from open intraday/derivative positions.
    """
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # If live account and connected, attempt to fetch live holdings from SmartAPI
    if not account.is_demo and account.auth_status == "CONNECTED":
        try:
            raw_key = cipher.decrypt(account.encrypted_api_key)
            raw_pin = cipher.decrypt(account.encrypted_pin)
            raw_totp = cipher.decrypt(account.encrypted_totp_secret)
            adapter = get_adapter_for_account(account.id, raw_key, account.client_code, raw_pin, raw_totp)
            live_holdings = adapter.get_holdings()
            if adapter.is_session_expired:
                invalidate_adapter_for_account(account.id)
                account.auth_status = "EXPIRED"
                account.last_auth_error = adapter.last_error or "Broker session expired"
                db.commit()
                persist_accounts_backup(db)
                raise HTTPException(
                    status_code=401,
                    detail=f"Angel One SmartAPI session expired for {account.masked_client_code}. Please reconnect."
                )

            if live_holdings is not None and not adapter.last_error:
                items = []
                now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S IST")
                for h in live_holdings:
                    qty = int(h.get("quantity", h.get("totalqty", 0)))
                    avg_p = float(h.get("averageprice", h.get("avgprice", 0.0)))
                    ltp = float(h.get("ltp", avg_p))
                    val = round(qty * ltp, 2)
                    pnl = float(h.get("totalpnl", h.get("pnl", round(val - (qty * avg_p), 2))))
                    pnl_pct = round((pnl / (qty * avg_p)) * 100, 2) if (qty * avg_p) > 0 else 0.0
                    items.append(AccountHoldingItem(
                        symbol=h.get("tradingsymbol", h.get("symbolname", "—")),
                        company_name=h.get("symbolname", h.get("tradingsymbol")),
                        isin=h.get("isin", "—"),
                        symbol_token=str(h.get("symboltoken", "0")),
                        quantity=qty,
                        authorised_quantity=int(h.get("authorisedquantity", qty)) if "authorisedquantity" in h else None,
                        average_price=avg_p,
                        current_ltp=ltp,
                        valuation=val,
                        unrealized_pnl=pnl,
                        pnl_percentage=pnl_pct,
                        data_source="ANGEL_ONE_SMARTAPI",
                        source_timestamp=now_str
                    ))
                return items
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Live holdings fetch failed for {account.masked_client_code}, using verified ledger: {str(e)}")

    # Fallback / Demo accounts / Verified Ledger
    allotments = db.query(Allotment).join(IPO).filter(
        Allotment.account_id == account_id,
        Allotment.allotted_quantity > 0
    ).all()
    results = []
    now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S IST")
    for a in allotments:
        ltp = a.ipo.current_ltp or a.ipo.issue_price
        val = round(a.allotted_quantity * ltp, 2)
        cost = round(a.allotted_quantity * a.acquisition_cost, 2)
        pnl = round(val - cost, 2)
        pnl_pct = round((pnl / cost) * 100, 2) if cost > 0 else 0.0
        results.append(AccountHoldingItem(
            symbol=a.ipo.symbol,
            company_name=a.ipo.company_name,
            isin=a.ipo.isin or "—",
            symbol_token=a.ipo.symbol_token or "0",
            quantity=a.allotted_quantity,
            authorised_quantity=a.allotted_quantity,
            average_price=a.acquisition_cost,
            current_ltp=ltp,
            valuation=val,
            unrealized_pnl=pnl,
            pnl_percentage=pnl_pct,
            data_source="DEMAT_ALLOTMENT_LEDGER",
            source_timestamp=now_str
        ))
    return results


@router.get("/{account_id}/positions", response_model=List[AccountPositionItem])
def get_account_positions(account_id: int, db: Session = Depends(get_db)):
    """
    Returns open and closed intraday/derivative positions for the specified account.
    Maintains clean separation between open positions and delivery holdings.
    """
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    if not account.is_demo and account.auth_status == "CONNECTED":
        try:
            raw_key = cipher.decrypt(account.encrypted_api_key)
            raw_pin = cipher.decrypt(account.encrypted_pin)
            raw_totp = cipher.decrypt(account.encrypted_totp_secret)
            adapter = get_adapter_for_account(account.id, raw_key, account.client_code, raw_pin, raw_totp)
            live_pos = adapter.get_positions()
            if adapter.is_session_expired:
                invalidate_adapter_for_account(account.id)
                account.auth_status = "EXPIRED"
                account.last_auth_error = adapter.last_error or "Broker session expired"
                db.commit()
                persist_accounts_backup(db)
                raise HTTPException(
                    status_code=401,
                    detail=f"Angel One SmartAPI session expired for {account.masked_client_code}. Please reconnect."
                )

            if live_pos is not None and not adapter.last_error:
                items = []
                now_str = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S IST")
                for p in live_pos:
                    items.append(AccountPositionItem(
                        symbol=p.get("tradingsymbol", "—"),
                        symbol_token=str(p.get("symboltoken", "0")),
                        exchange=p.get("exchange", "NSE"),
                        product_type=p.get("producttype", "INTRADAY"),
                        net_quantity=int(p.get("netqty", 0)),
                        buy_quantity=int(p.get("buyqty", 0)),
                        sell_quantity=int(p.get("sellqty", 0)),
                        buy_average_price=float(p.get("buyavgprice", 0.0)),
                        sell_average_price=float(p.get("sellavgprice", 0.0)),
                        current_ltp=float(p.get("ltp", 0.0)) if p.get("ltp") else None,
                        unrealized_pnl=float(p.get("unrealisedpnl", 0.0)) if p.get("unrealisedpnl") else None,
                        realized_pnl=float(p.get("realisedpnl", 0.0)) if p.get("realisedpnl") else None,
                        data_source="ANGEL_ONE_POSITIONS",
                        source_timestamp=now_str
                    ))
                return items
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Live positions fetch failed for {account.masked_client_code}: {str(e)}")

    # For demo or accounts with no active derivative positions, return empty list (0 positions)
    return []


@router.get("/{account_id}/orders", response_model=List[AccountOrderItem])
def get_account_orders(account_id: int, db: Session = Depends(get_db)):
    """
    Returns order book for the specified account (pending, executed, rejected, cancelled).
    Keeps orders distinct from executed trades.
    """
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # If live account and connected, fetch live order book from SmartAPI
    if not account.is_demo and account.auth_status == "CONNECTED":
        try:
            raw_key = cipher.decrypt(account.encrypted_api_key)
            raw_pin = cipher.decrypt(account.encrypted_pin)
            raw_totp = cipher.decrypt(account.encrypted_totp_secret)
            adapter = get_adapter_for_account(account.id, raw_key, account.client_code, raw_pin, raw_totp)
            broker_orders = adapter.get_order_book()
            if adapter.is_session_expired:
                invalidate_adapter_for_account(account.id)
                account.auth_status = "EXPIRED"
                account.last_auth_error = adapter.last_error or "Broker session expired"
                db.commit()
                persist_accounts_backup(db)
                raise HTTPException(
                    status_code=401,
                    detail=f"Angel One SmartAPI session expired for {account.masked_client_code}. Please reconnect."
                )

            if broker_orders is not None and not adapter.last_error:
                results = []
                for bo in broker_orders:
                    qty = int(bo.get("quantity", 0))
                    filled_qty = int(bo.get("filledshares", 0))
                    p = float(bo.get("price", 0.0))
                    tp = float(bo.get("triggerprice", 0.0))
                    avg_p = float(bo.get("averageprice", 0.0)) if bo.get("averageprice") else None
                    results.append(AccountOrderItem(
                        order_id=str(bo.get("orderid", "")),
                        symbol=bo.get("tradingsymbol", "—"),
                        exchange=bo.get("exchange", "NSE"),
                        transaction_type=bo.get("transactiontype", "BUY"),
                        order_type=bo.get("ordertype", "LIMIT"),
                        product_type=bo.get("producttype", "DELIVERY"),
                        quantity=qty,
                        filled_quantity=filled_qty,
                        price=p,
                        trigger_price=tp,
                        average_price=avg_p,
                        status=str(bo.get("orderstatus", bo.get("status", "open"))).upper(),
                        rejection_reason=bo.get("text"),
                        order_timestamp=bo.get("updatetime") or bo.get("exchtime"),
                        is_paper_trade=False
                    ))
                return results
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Live order book fetch failed for {account.masked_client_code}, returning local records: {str(e)}")

    orders = db.query(Order).filter(Order.account_id == account_id).order_by(Order.id.desc()).all()
    results = []
    for o in orders:
        results.append(AccountOrderItem(
            order_id=o.broker_order_id or o.client_order_id,
            symbol=o.tradingsymbol,
            exchange=o.exchange,
            transaction_type=o.transaction_type,
            order_type=o.order_type,
            product_type=o.product_type,
            quantity=o.quantity,
            filled_quantity=o.filled_quantity,
            price=o.price,
            trigger_price=o.trigger_price,
            average_price=o.execution_price,
            status=o.status,
            rejection_reason=o.rejection_reason,
            order_timestamp=o.created_at.strftime("%Y-%m-%d %H:%M:%S IST") if o.created_at else None,
            is_paper_trade=o.is_paper_trade
        ))
    return results


@router.get("/{account_id}/trades", response_model=List[AccountTradeItem])
def get_account_trades(account_id: int, db: Session = Depends(get_db)):
    """
    Returns confirmed executed trades for the specified account.
    Never misrepresents an acknowledged or unexecuted order as an executed trade.
    """
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    # If live account and connected, fetch live trade book from SmartAPI
    if not account.is_demo and account.auth_status == "CONNECTED":
        try:
            raw_key = cipher.decrypt(account.encrypted_api_key)
            raw_pin = cipher.decrypt(account.encrypted_pin)
            raw_totp = cipher.decrypt(account.encrypted_totp_secret)
            adapter = get_adapter_for_account(account.id, raw_key, account.client_code, raw_pin, raw_totp)
            broker_trades = adapter.get_trade_book()
            if adapter.is_session_expired:
                invalidate_adapter_for_account(account.id)
                account.auth_status = "EXPIRED"
                account.last_auth_error = adapter.last_error or "Broker session expired"
                db.commit()
                persist_accounts_backup(db)
                raise HTTPException(
                    status_code=401,
                    detail=f"Angel One SmartAPI session expired for {account.masked_client_code}. Please reconnect."
                )

            if broker_trades is not None and not adapter.last_error:
                results = []
                for bt in broker_trades:
                    fill_qty = int(bt.get("fillsize", 0))
                    fill_p = float(bt.get("fillprice", 0.0))
                    results.append(AccountTradeItem(
                        fill_id=str(bt.get("tradeid", "")),
                        order_id=str(bt.get("orderid", "")),
                        symbol=bt.get("tradingsymbol", "—"),
                        exchange=bt.get("exchange", "NSE"),
                        transaction_type=bt.get("transactiontype", "BUY"),
                        product_type=bt.get("producttype", "DELIVERY"),
                        fill_price=fill_p,
                        fill_quantity=fill_qty,
                        fill_timestamp=bt.get("filltime"),
                        is_paper_trade=False
                    ))
                return results
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Live trade book fetch failed for {account.masked_client_code}, returning local records: {str(e)}")

    results = []
    # Query confirmed executed orders ONLY (strictly excluding pending/rejected/acknowledged orders)
    executed_orders = db.query(Order).filter(
        Order.account_id == account_id,
        Order.status == "EXECUTED"
    ).order_by(Order.id.desc()).all()

    for o in executed_orders:
        results.append(AccountTradeItem(
            fill_id=f"FILL-{o.id:06d}",
            order_id=o.broker_order_id or o.client_order_id,
            symbol=o.tradingsymbol,
            exchange=o.exchange,
            transaction_type=o.transaction_type,
            product_type=o.product_type,
            fill_price=o.execution_price or o.price,
            fill_quantity=o.filled_quantity or o.quantity,
            fill_timestamp=o.updated_at.strftime("%Y-%m-%d %H:%M:%S IST") if o.updated_at else None,
            is_paper_trade=o.is_paper_trade
        ))

    return results


@router.post("/{account_id}/sync", response_model=AccountSyncResponse)
def sync_account_data(account_id: int, db: Session = Depends(get_db)):
    """
    Triggers on-demand read-only refresh of RMS funds, holdings, and connection status.
    Does NOT submit or modify any financial order or live trade.
    """
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

    now = datetime.utcnow()
    holdings_count = db.query(Allotment).filter(Allotment.account_id == account.id, Allotment.allotted_quantity > 0).count()
    positions_count = 0

    if account.is_demo:
        account.last_sync_time = now
        account.auth_status = "CONNECTED"
        account.last_auth_error = None
        db.add(AuditLog(
            event_type="ACCOUNT_SYNCED",
            account_id=account.id,
            operator="SYSTEM",
            details_json=json.dumps({
                "account_id": account.id,
                "masked_client_code": account.masked_client_code,
                "success": True,
                "timestamp": now.isoformat()
            })
        ))
        db.commit()
        persist_accounts_backup(db)
        return AccountSyncResponse(
            account_id=account.id,
            success=True,
            message="Demo account synchronized successfully.",
            holdings_count=holdings_count,
            positions_count=positions_count,
            available_cash=account.available_cash,
            sync_timestamp=now.strftime("%Y-%m-%d %H:%M:%S IST")
        )

    # Live account synchronization via SmartAPI
    try:
        raw_key = cipher.decrypt(account.encrypted_api_key)
        raw_pin = cipher.decrypt(account.encrypted_pin)
        raw_totp = cipher.decrypt(account.encrypted_totp_secret)
        adapter = get_adapter_for_account(account.id, raw_key, account.client_code, raw_pin, raw_totp)
        if adapter.jwt_token and time.time() < adapter.token_expiry_timestamp and not adapter.is_session_expired:
            auth_res = {"success": True, "message": "Using authenticated session"}
        else:
            auth_res = adapter.authenticate()

        if auth_res["success"]:
            account.auth_status = "CONNECTED"
            account.last_auth_error = None
            account.last_sync_time = now
            rms = adapter.get_rms()
            if rms:
                cash = float(rms.get("availablecash", rms.get("net", account.available_cash)))
                account.available_cash = round(cash, 2)
            try:
                holdings = adapter.get_holdings()
                if holdings:
                    holdings_count = reconcile_broker_holdings(db, account, holdings, now)
                else:
                    holdings_count = db.query(Allotment).filter(Allotment.account_id == account.id, Allotment.allotted_quantity > 0).count()
            except Exception:
                holdings_count = db.query(Allotment).filter(Allotment.account_id == account.id, Allotment.allotted_quantity > 0).count()
            msg = "Account synchronized successfully with Angel One."
            success = True
        else:
            if adapter.is_session_expired:
                invalidate_adapter_for_account(account.id)
                account.auth_status = "EXPIRED"
            else:
                account.auth_status = "ERROR"
            account.last_auth_error = auth_res["message"]
            msg = f"Broker sync warning: {auth_res['message']}"
            success = False

        db.commit()
        persist_accounts_backup(db)

        # Audit event without secrets
        db.add(AuditLog(
            event_type="ACCOUNT_SYNCED",
            account_id=account.id,
            operator="SYSTEM",
            details_json=json.dumps({
                "account_id": account.id,
                "masked_client_code": account.masked_client_code,
                "success": success,
                "timestamp": now.isoformat()
            })
        ))
        db.commit()

        return AccountSyncResponse(
            account_id=account.id,
            success=success,
            message=msg,
            holdings_count=holdings_count,
            positions_count=positions_count,
            available_cash=account.available_cash,
            sync_timestamp=now.strftime("%Y-%m-%d %H:%M:%S IST")
        )
    except Exception as e:
        account.auth_status = "ERROR"
        account.last_auth_error = str(e)
        db.commit()
        return AccountSyncResponse(
            account_id=account.id,
            success=False,
            message=f"Sync error: {str(e)}",
            holdings_count=holdings_count,
            positions_count=positions_count,
            available_cash=account.available_cash,
            sync_timestamp=now.strftime("%Y-%m-%d %H:%M:%S IST")
        )


@router.post("/batch-create-demo")
def batch_create_demo_accounts(
    count: int = Query(default=10, ge=1, le=50, description="Number of demo accounts to create (up to 50)"),
    db: Session = Depends(get_db)
):
    """
    Stress-test helper: Instantly creates N demo accounts for testing bulk operations across up to 50 accounts.
    """
    created = []
    base_idx = db.query(Account).count() + 1
    for i in range(count):
        idx = base_idx + i
        acc = Account(
            nickname=f"Demo Trader #{idx:02d}",
            client_code=f"DEMO_CLI_{idx:03d}",
            account_group="Demo Pool",
            encrypted_api_key=cipher.encrypt(f"DEMO_KEY_{idx}"),
            encrypted_pin=cipher.encrypt("1234"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=True,
            auth_status="CONNECTED",
            ddpi_status="ACTIVE" if i % 2 == 0 else "INACTIVE",
            edis_authorized_today=True if i % 2 == 0 else False,
            available_cash=100000.0 + (i * 10000)
        )
        db.add(acc)
        created.append(acc)

    db.commit()
    persist_accounts_backup(db)
    return {"message": f"Successfully created {len(created)} demo accounts for testing.", "count": len(created)}
