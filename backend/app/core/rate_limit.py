import time
from collections import defaultdict
from typing import Dict, List
from fastapi import Request, HTTPException, status
from app.core.config import settings


class InMemoryRateLimiter:
    """
    Sliding window rate limiter to prevent API abuse, flood attacks,
    and broker rate-limit bans.
    """
    def __init__(self, requests_per_second: int = 10, window_seconds: float = 1.0):
        self.rate_limit = requests_per_second
        self.window = window_seconds
        self.client_history: Dict[str, List[float]] = defaultdict(list)

    def is_allowed(self, client_key: str) -> bool:
        now = time.monotonic()
        cutoff = now - self.window
        
        # Clean older entries
        timestamps = self.client_history[client_key]
        self.client_history[client_key] = [t for t in timestamps if t > cutoff]
        
        if len(self.client_history[client_key]) >= self.rate_limit:
            return False
            
        self.client_history[client_key].append(now)
        return True


# Global instances for critical routes
order_rate_limiter = InMemoryRateLimiter(
    requests_per_second=settings.RATE_LIMIT_ORDERS_PER_SEC,
    window_seconds=1.0
)

risk_rate_limiter = InMemoryRateLimiter(
    requests_per_second=5,
    window_seconds=1.0
)


def rate_limit_orders(request: Request):
    """Dependency protecting order endpoints from flood execution."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    if not order_rate_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"RATE_LIMIT_EXCEEDED: Exceeded max {settings.RATE_LIMIT_ORDERS_PER_SEC} order requests per second. Throttle requests.",
            headers={"Retry-After": "1"}
        )
    return True


def rate_limit_risk(request: Request):
    """Dependency protecting emergency halt and risk threshold modifications."""
    client_ip = request.client.host if request.client else "127.0.0.1"
    if not risk_rate_limiter.is_allowed(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="RATE_LIMIT_EXCEEDED: Exceeded allowed risk modification rate. Please wait.",
            headers={"Retry-After": "1"}
        )
    return True
