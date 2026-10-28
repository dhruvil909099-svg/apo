import json
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.auth import verify_api_key
from app.models.chat import ChatMessage
from app.schemas.chat import ChatMessagePayload, ChatMessageResponse, ChatHistoryResponse
from app.services.ai_chat_service import AIChatService

router = APIRouter(prefix="/chat", tags=["AI Portfolio Assistant"])


@router.post("/message", response_model=ChatMessageResponse)
def post_chat_message(
    payload: ChatMessagePayload,
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Submits a message to the AI portfolio assistant.
    The assistant generates responses strictly grounded in authorized portfolio, IPO,
    and account metrics without access to sensitive credentials.
    """
    res = AIChatService.generate_response(db, payload.message, payload.session_id)
    return ChatMessageResponse(
        id=res["id"],
        session_id=res["session_id"],
        sender=res["sender"],
        content=res["content"],
        context_meta=res.get("context_meta"),
        created_at=res["created_at"]
    )


@router.get("/history", response_model=ChatHistoryResponse)
def get_chat_history(
    session_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Retrieves message history for a given chat session.
    """
    messages = db.query(ChatMessage).filter(
        ChatMessage.session_id == session_id
    ).order_by(ChatMessage.id.asc()).limit(100).all()

    resp_items = []
    for m in messages:
        meta = None
        if m.context_meta_json:
            try:
                meta = json.loads(m.context_meta_json)
            except Exception:
                pass
        resp_items.append(ChatMessageResponse(
            id=m.id,
            session_id=m.session_id,
            sender=m.sender,
            content=m.content,
            context_meta=meta,
            created_at=m.created_at
        ))

    return ChatHistoryResponse(
        session_id=session_id,
        messages=resp_items
    )


@router.delete("/history", status_code=status.HTTP_204_NO_CONTENT)
def clear_chat_history(
    session_id: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Clears message history for a given chat session.
    """
    db.query(ChatMessage).filter(ChatMessage.session_id == session_id).delete()
    db.commit()


@router.get("/context")
def get_authorized_chat_context(
    db: Session = Depends(get_db),
    _auth: bool = Depends(verify_api_key)
):
    """
    Returns the real-time sanitized context used by the AI assistant.
    """
    return AIChatService.get_authorized_context(db)
