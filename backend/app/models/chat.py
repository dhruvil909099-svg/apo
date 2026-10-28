from datetime import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from app.core.database import Base


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    session_id = Column(String(64), index=True, nullable=False)
    sender = Column(String(20), nullable=False)  # "USER" or "ASSISTANT"
    content = Column(Text, nullable=False)
    context_meta_json = Column(Text, nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow)
