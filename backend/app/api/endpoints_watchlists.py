from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import verify_api_key
from app.models.watchlist import Watchlist, WatchlistItem
from app.schemas.watchlist import (
    WatchlistCreate, WatchlistUpdate, WatchlistResponse,
    WatchlistItemCreate, WatchlistItemResponse
)

router = APIRouter(prefix="/watchlists", tags=["Watchlists"])


@router.get("", response_model=List[WatchlistResponse])
def list_watchlists(
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """Lists saved watchlists."""
    watchlists = db.query(Watchlist).order_by(Watchlist.id.asc()).all()
    return [WatchlistResponse.model_validate(w) for w in watchlists]


@router.post("", response_model=WatchlistResponse, status_code=status.HTTP_201_CREATED)
def create_watchlist(
    payload: WatchlistCreate,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """Creates a new watchlist."""
    wl = Watchlist(
        name=payload.name.strip(),
        description=payload.description.strip() if payload.description else None
    )
    db.add(wl)
    db.commit()
    db.refresh(wl)
    return WatchlistResponse.model_validate(wl)


@router.get("/{watchlist_id}", response_model=WatchlistResponse)
def get_watchlist(
    watchlist_id: int,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    return WatchlistResponse.model_validate(wl)


@router.put("/{watchlist_id}", response_model=WatchlistResponse)
def update_watchlist(
    watchlist_id: int,
    payload: WatchlistUpdate,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")

    if payload.name is not None and payload.name.strip():
        wl.name = payload.name.strip()
    if payload.description is not None:
        wl.description = payload.description.strip() if payload.description else None

    db.commit()
    db.refresh(wl)
    return WatchlistResponse.model_validate(wl)


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watchlist(
    watchlist_id: int,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")
    db.delete(wl)
    db.commit()


@router.post("/{watchlist_id}/items", response_model=WatchlistItemResponse, status_code=status.HTTP_201_CREATED)
def add_watchlist_item(
    watchlist_id: int,
    payload: WatchlistItemCreate,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    wl = db.query(Watchlist).filter(Watchlist.id == watchlist_id).first()
    if not wl:
        raise HTTPException(status_code=404, detail="Watchlist not found")

    sym = payload.symbol.strip().upper()
    item = WatchlistItem(
        watchlist_id=watchlist_id,
        symbol=sym,
        exchange=payload.exchange.strip().upper() if payload.exchange else "NSE",
        symbol_token=payload.symbol_token,
        notes=payload.notes
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return WatchlistItemResponse.model_validate(item)


@router.delete("/{watchlist_id}/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_watchlist_item(
    watchlist_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    item = db.query(WatchlistItem).filter(
        WatchlistItem.id == item_id,
        WatchlistItem.watchlist_id == watchlist_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Watchlist item not found")
    db.delete(item)
    db.commit()
