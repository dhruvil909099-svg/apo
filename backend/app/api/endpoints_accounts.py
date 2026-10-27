from typing import List, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import cipher, mask_client_id, sanitize_dict_for_logging
from app.models.account import Account
from app.models.audit import AuditLog
from app.schemas.account import (
    AccountCreate, AccountUpdate, AccountResponse, AccountTestResult
)
from app.services.smartapi_adapter import SmartAPIAdapter
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
    # Check for duplicate client code
    existing = db.query(Account).filter(Account.client_code == account_in.client_code.strip()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Account with client code {mask_client_id(account_in.client_code)} already exists."
        )

    # Encrypt sensitive credentials using AES-256 Fernet
    encrypted_key = cipher.encrypt(account_in.api_key.strip())
    encrypted_pin = cipher.encrypt(account_in.pin.strip())
    encrypted_totp = cipher.encrypt(account_in.totp_secret.strip())

    account = Account(
        nickname=account_in.nickname.strip(),
        client_code=account_in.client_code.strip(),
        account_group=account_in.account_group.strip() or "Family",
        encrypted_api_key=encrypted_key,
        encrypted_pin=encrypted_pin,
        encrypted_totp_secret=encrypted_totp,
        is_demo=account_in.is_demo,
        is_enabled=True,
        auth_status="DISCONNECTED",
        ddpi_status="UNKNOWN",
        available_cash=100000.0 if account_in.is_demo else 0.0
    )
    db.add(account)
    db.commit()
    db.refresh(account)

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

    # Optional credential rotation
    if account_in.api_key:
        account.encrypted_api_key = cipher.encrypt(account_in.api_key.strip())
    if account_in.pin:
        account.encrypted_pin = cipher.encrypt(account_in.pin.strip())
    if account_in.totp_secret:
        account.encrypted_totp_secret = cipher.encrypt(account_in.totp_secret.strip())

    account.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(account)

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

    db.delete(account)
    db.commit()


@router.post("/{account_id}/test", response_model=AccountTestResult)
def test_account_connection(account_id: int, db: Session = Depends(get_db)):
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")

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

    # Test via SmartAPIAdapter
    adapter = SmartAPIAdapter(api_key=raw_key, client_code=account.client_code, pin=raw_pin, totp_secret=raw_totp)
    test_res = adapter.test_connection()

    if test_res["success"]:
        account.auth_status = "CONNECTED"
        account.last_sync_time = datetime.utcnow()
        account.last_auth_error = None
        if test_res.get("ddpi_status") != "UNKNOWN":
            account.ddpi_status = test_res["ddpi_status"]
    else:
        account.auth_status = "EXPIRED" if "SESSION_EXPIRED" in test_res.get("error_code", "") else "ERROR"
        account.last_auth_error = test_res["message"]

    db.commit()

    return AccountTestResult(
        account_id=account.id,
        nickname=account.nickname,
        masked_client_code=account.masked_client_code,
        success=test_res["success"],
        message=test_res["message"],
        auth_status=account.auth_status,
        jwt_acquired=test_res["jwt_acquired"],
        ddpi_status=account.ddpi_status
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
    return {"message": f"Successfully created {len(created)} demo accounts for testing.", "count": len(created)}
