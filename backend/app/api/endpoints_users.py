import json
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import verify_api_key
from app.models.user import User
from app.models.audit import AuditLog
from app.schemas.user import UserCreate, UserUpdate, UserResponse, UserListResponse

router = APIRouter(prefix="/users", tags=["User & Admin Management"])


@router.get("", response_model=UserListResponse)
def list_users(
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    role: Optional[str] = Query(default=None, pattern="^(ADMIN|USER)$"),
    search: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Administrative endpoint: lists registered application users with pagination and search.
    Secrets and password hashes are never returned.
    """
    query = db.query(User)
    if role:
        query = query.filter(User.role == role)
    if search:
        search_pattern = f"%{search.strip()}%"
        query = query.filter(
            (User.username.ilike(search_pattern)) | (User.email.ilike(search_pattern))
        )

    total = query.count()
    items = query.order_by(User.id.asc()).offset(offset).limit(limit).all()

    return UserListResponse(
        total=total,
        items=[UserResponse.model_validate(u) for u in items]
    )


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Administrative endpoint: creates a new authorized user or administrator.
    """
    existing_user = db.query(User).filter(
        (User.username == payload.username.strip()) | (User.email == payload.email.lower().strip())
    ).first()
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A user with this username or email address already exists."
        )

    pwd_hash, salt = User.hash_password(payload.password)
    user = User(
        username=payload.username.strip(),
        email=payload.email.lower().strip(),
        hashed_password=pwd_hash,
        salt=salt,
        role=payload.role,
        is_active=True
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    db.add(AuditLog(
        event_type="USER_CREATED",
        operator="ADMIN",
        details_json=json.dumps({
            "user_id": user.id,
            "username": user.username,
            "role": user.role
        })
    ))
    db.commit()

    return UserResponse.model_validate(user)


@router.get("/me", response_model=UserResponse)
def get_current_user_profile(
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Returns the operator / current user profile.
    """
    admin = db.query(User).filter(User.role == "ADMIN", User.is_active == True).first()
    if not admin:
        # Create default system administrator record if none exists
        pwd_hash, salt = User.hash_password("admin123")
        admin = User(
            username="admin",
            email="admin@ipopro.internal",
            hashed_password=pwd_hash,
            salt=salt,
            role="ADMIN",
            is_active=True
        )
        db.add(admin)
        db.commit()
        db.refresh(admin)

    return UserResponse.model_validate(admin)


@router.get("/{user_id}", response_model=UserResponse)
def get_user_detail(
    user_id: int,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse.model_validate(user)


@router.put("/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Protection: Cannot demote or deactivate the last remaining active admin
    if user.role == "ADMIN" and (payload.role == "USER" or payload.is_active is False):
        active_admins = db.query(User).filter(User.role == "ADMIN", User.is_active == True).count()
        if active_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Action denied: Cannot demote or deactivate the last remaining active administrator."
            )

    if payload.username is not None and payload.username.strip():
        new_uname = payload.username.strip()
        conflict = db.query(User).filter(User.username == new_uname, User.id != user_id).first()
        if conflict:
            raise HTTPException(status_code=400, detail="Username is already taken.")
        user.username = new_uname

    if payload.email is not None:
        new_email = payload.email.lower().strip()
        conflict = db.query(User).filter(User.email == new_email, User.id != user_id).first()
        if conflict:
            raise HTTPException(status_code=400, detail="Email is already in use.")
        user.email = new_email

    if payload.password is not None and payload.password.strip():
        pwd_hash, salt = User.hash_password(payload.password.strip())
        user.hashed_password = pwd_hash
        user.salt = salt

    if payload.role is not None:
        user.role = payload.role

    if payload.is_active is not None:
        user.is_active = payload.is_active

    db.commit()
    db.refresh(user)

    db.add(AuditLog(
        event_type="USER_UPDATED",
        operator="ADMIN",
        details_json=json.dumps({
            "user_id": user.id,
            "username": user.username,
            "role": user.role,
            "is_active": user.is_active
        })
    ))
    db.commit()

    return UserResponse.model_validate(user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if user.role == "ADMIN":
        active_admins = db.query(User).filter(User.role == "ADMIN", User.is_active == True).count()
        if active_admins <= 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Action denied: Cannot delete the last remaining active administrator."
            )

    db.add(AuditLog(
        event_type="USER_DELETED",
        operator="ADMIN",
        details_json=json.dumps({
            "user_id": user.id,
            "username": user.username
        })
    ))
    db.delete(user)
    db.commit()
