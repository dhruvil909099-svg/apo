from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict


class PortfolioNoteCreate(BaseModel):
    account_id: Optional[int] = None
    symbol: Optional[str] = Field(default=None, max_length=50)
    tag: str = Field(default="GENERAL", max_length=50)
    content: str = Field(..., min_length=1, max_length=2000)


class PortfolioNoteUpdate(BaseModel):
    tag: Optional[str] = Field(default=None, max_length=50)
    content: Optional[str] = Field(default=None, min_length=1, max_length=2000)


class PortfolioNoteResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    account_id: Optional[int] = None
    symbol: Optional[str] = None
    tag: str
    content: str
    created_at: datetime
    updated_at: Optional[datetime] = None
