from fastapi import APIRouter, Depends
from app.api.endpoints_health import router as health_router
from app.api.endpoints_auth import router as auth_router
from app.api.endpoints_accounts import router as accounts_router
from app.api.endpoints_ipos import router as ipos_router
from app.api.endpoints_orders import router as orders_router
from app.api.endpoints_market import router as market_router
from app.api.endpoints_portfolio import router as portfolio_router
from app.api.endpoints_risk import router as risk_router
from app.api.endpoints_audit import router as audit_router
from app.api.endpoints_users import router as users_router
from app.api.endpoints_watchlists import router as watchlists_router
from app.api.endpoints_notes import router as notes_router
from app.api.endpoints_notifications import router as notifications_router
from app.api.endpoints_chat import router as chat_router
from app.api.endpoints_operations import router as operations_router
from app.core.auth import verify_api_key

api_v1_router = APIRouter(prefix="/api/v1")

# Public unauthenticated routes
api_v1_router.include_router(health_router)
api_v1_router.include_router(auth_router)

# Protected operational routes requiring valid API key or Bearer token
api_v1_router.include_router(accounts_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(ipos_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(orders_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(market_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(portfolio_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(risk_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(audit_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(users_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(watchlists_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(notes_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(notifications_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(chat_router, dependencies=[Depends(verify_api_key)])
api_v1_router.include_router(operations_router, dependencies=[Depends(verify_api_key)])
