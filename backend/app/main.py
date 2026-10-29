import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.core.database import engine, Base, SessionLocal, run_safe_migrations
import app.models
from app.api.api_v1 import api_v1_router
from app.services.seed_data import seed_demo_data
from app.services.scheduler_service import sync_manager

# Configure structured logging
logging.basicConfig(
    level=logging.INFO if settings.DEBUG else logging.WARNING,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("IPOPro")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Ensure tables exist & run non-destructive schema migrations
    logger.info("Initializing database tables...")
    Base.metadata.create_all(bind=engine)
    run_safe_migrations()
    
    db = SessionLocal()
    try:
        seed_demo_data(db)
    finally:
        db.close()

    # Start background scheduler for automated IPO discovery
    sync_manager.start()
        
    logger.info(f"{settings.APP_NAME} started successfully in {settings.TRADING_MODE} mode.")
    yield
    # Shutdown
    logger.info("Application shutting down. Stopping background sync scheduler...")
    sync_manager.stop()
    logger.info("Scheduler stopped cleanly.")


app = FastAPI(
    title=settings.APP_NAME,
    description="Multi-Account IPO Monitoring and Order Management Platform for Indian Markets",
    version="1.0.0",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security Headers and Cache Prevention Middleware
@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        response.headers["Pragma"] = "no-cache"
    return response


# Include versioned API router
app.include_router(api_v1_router)


# Global Exception Handler
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {str(exc)}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "success": False,
            "error_type": "INTERNAL_SERVER_ERROR",
            "message": "An internal server error occurred. Please consult system logs.",
            "detail": str(exc) if settings.DEBUG else None
        }
    )


@app.get("/healthz")
@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "trading_mode": settings.TRADING_MODE
    }


@app.get("/")
def root_redirect():
    return {
        "app": settings.APP_NAME,
        "trading_mode": settings.TRADING_MODE,
        "docs": "/docs",
        "api_v1": "/api/v1"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="127.0.0.1", port=8000, reload=True)
