import secrets
from typing import Optional
from fastapi import Security, HTTPException, status
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from app.core.config import settings

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)
bearer_security = HTTPBearer(auto_error=False)


def verify_api_key(
    key_header: Optional[str] = Security(api_key_header),
    auth_credentials: Optional[HTTPAuthorizationCredentials] = Security(bearer_security),
    api_key: Optional[str] = None
) -> bool:
    """
    Validates that incoming requests supply a valid master API key via:
    1. 'X-API-Key: <key>' header, OR
    2. 'Authorization: Bearer <key>' header, OR
    3. '?api_key=<key>' query parameter (essential for standard browser WebSockets).
    
    Uses constant-time comparison (secrets.compare_digest) to prevent timing analysis.
    """
    if not settings.REQUIRE_AUTH:
        return True

    provided_key: Optional[str] = None

    if key_header:
        provided_key = key_header.strip()
    elif auth_credentials and auth_credentials.credentials:
        provided_key = auth_credentials.credentials.strip()
    elif api_key:
        provided_key = api_key.strip()

    if not provided_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="UNAUTHORIZED: Missing required authentication. Provide 'X-API-Key', 'Authorization: Bearer <token>' header, or '?api_key=<token>' query parameter.",
            headers={"WWW-Authenticate": "Bearer, ApiKey"}
        )

    # Constant-time comparison
    is_valid = secrets.compare_digest(provided_key, settings.MASTER_API_KEY)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="UNAUTHORIZED: Invalid API key or bearer token provided.",
            headers={"WWW-Authenticate": "Bearer, ApiKey"}
        )

    return True
