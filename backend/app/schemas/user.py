from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, Field, ConfigDict

EMAIL_REGEX = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


class UserBase(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., pattern=EMAIL_REGEX)
    role: str = Field(default="USER", pattern="^(ADMIN|USER)$")
    is_active: bool = True


class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: str = Field(..., pattern=EMAIL_REGEX)
    password: str = Field(..., min_length=6, max_length=100)
    role: str = Field(default="USER", pattern="^(ADMIN|USER)$")


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, min_length=3, max_length=50)
    email: Optional[str] = Field(default=None, pattern=EMAIL_REGEX)
    password: Optional[str] = Field(default=None, min_length=6, max_length=100)
    role: Optional[str] = Field(default=None, pattern="^(ADMIN|USER)$")
    is_active: Optional[bool] = None


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    email: str
    role: str
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None


class UserListResponse(BaseModel):
    total: int
    items: List[UserResponse]
