from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import verify_api_key
from app.models.portfolio_note import PortfolioNote
from app.schemas.portfolio_note import (
    PortfolioNoteCreate, PortfolioNoteUpdate, PortfolioNoteResponse
)

router = APIRouter(prefix="/portfolio/notes", tags=["Portfolio Notes & Tags"])


@router.get("", response_model=List[PortfolioNoteResponse])
def list_notes(
    symbol: Optional[str] = Query(default=None),
    account_id: Optional[int] = Query(default=None),
    tag: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    query = db.query(PortfolioNote)
    if symbol:
        query = query.filter(PortfolioNote.symbol == symbol.strip().upper())
    if account_id:
        query = query.filter(PortfolioNote.account_id == account_id)
    if tag:
        query = query.filter(PortfolioNote.tag == tag.strip().upper())

    notes = query.order_by(PortfolioNote.id.desc()).all()
    return [PortfolioNoteResponse.model_validate(n) for n in notes]


@router.post("", response_model=PortfolioNoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: PortfolioNoteCreate,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    note = PortfolioNote(
        account_id=payload.account_id,
        symbol=payload.symbol.strip().upper() if payload.symbol else None,
        tag=payload.tag.strip().upper() if payload.tag else "GENERAL",
        content=payload.content.strip()
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return PortfolioNoteResponse.model_validate(note)


@router.put("/{note_id}", response_model=PortfolioNoteResponse)
def update_note(
    note_id: int,
    payload: PortfolioNoteUpdate,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    note = db.query(PortfolioNote).filter(PortfolioNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")

    if payload.tag is not None:
        note.tag = payload.tag.strip().upper()
    if payload.content is not None and payload.content.strip():
        note.content = payload.content.strip()

    db.commit()
    db.refresh(note)
    return PortfolioNoteResponse.model_validate(note)


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    note = db.query(PortfolioNote).filter(PortfolioNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    db.delete(note)
    db.commit()
