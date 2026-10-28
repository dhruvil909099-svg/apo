from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field, ConfigDict


class ChatMessagePayload(BaseModel):
    message: str = Field(..., min_length=1, max_length=1000)
    session_id: Optional[str] = Field(default=None, max_length=64)


class ChatMessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    session_id: str
    sender: str
    content: str
    context_meta: Optional[Dict[str, Any]] = None
    created_at: datetime


class ChatHistoryResponse(BaseModel):
    session_id: str
    messages: List[ChatMessageResponse]
