from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict


class WatchlistItemBase(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=50)
    exchange: str = Field(default="NSE", max_length=10)
    symbol_token: Optional[str] = None
    notes: Optional[str] = None


class WatchlistItemCreate(WatchlistItemBase):
    pass


class WatchlistItemResponse(WatchlistItemBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    watchlist_id: int
    created_at: datetime


class WatchlistBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = None


class WatchlistCreate(WatchlistBase):
    pass


class WatchlistUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    description: Optional[str] = None


class WatchlistResponse(WatchlistBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: Optional[int] = None
    items: List[WatchlistItemResponse] = []
    created_at: datetime
    updated_at: Optional[datetime] = None
