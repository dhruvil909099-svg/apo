import logging
from sqlalchemy import create_engine, event, text, inspect
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

logger = logging.getLogger("database")

# Engine configuration (supporting SQLite and PostgreSQL)
connect_args = {}
engine_kwargs = {"echo": False}

if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {
        "check_same_thread": False,
        "timeout": 30.0  # 30-second busy timeout to prevent 'database is locked' errors
    }
else:
    # Conservative connection pooling for client/server databases (PostgreSQL/MySQL)
    engine_kwargs.update({
        "pool_size": 3,
        "max_overflow": 1,
        "pool_timeout": 10.0,
        "pool_recycle": 300,
    })

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    **engine_kwargs
)

# Apply SQLite PRAGMAs for concurrency & durability
if settings.DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragmas(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL;")
        cursor.execute("PRAGMA synchronous=NORMAL;")
        cursor.execute("PRAGMA foreign_keys=ON;")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    """FastAPI dependency for thread-safe database sessions."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_safe_migrations():
    """
    Idempotent schema migration for SQLite and PostgreSQL.
    Safely adds missing columns without dropping tables or losing existing records.
    """
    logger.info("Verifying schema and running non-destructive column migrations...")
    inspector = inspect(engine)
    existing_tables = inspector.get_table_names()

    # Column definitions to verify for 'ipos'
    ipo_columns_to_add = [
        ("min_price", "FLOAT"),
        ("max_price", "FLOAT"),
        ("bidding_start_date", "VARCHAR(20)"),
        ("bidding_end_date", "VARCHAR(20)"),
        ("allotment_date", "VARCHAR(20)"),
        ("source_name", "VARCHAR(50) DEFAULT 'MANUAL'"),
        ("source_timestamp", "DATETIME"),
        ("last_sync_at", "DATETIME"),
    ]

    if "ipos" in existing_tables:
        existing_cols = {col["name"] for col in inspector.get_columns("ipos")}
        with engine.connect() as conn:
            for col_name, col_type in ipo_columns_to_add:
                if col_name not in existing_cols:
                    logger.info(f"Adding missing column ipos.{col_name} ({col_type})")
                    conn.execute(text(f"ALTER TABLE ipos ADD COLUMN {col_name} {col_type};"))
            conn.commit()

    # Column definitions to verify for 'allotments'
    allotment_columns_to_add = [
        ("category", "VARCHAR(20) DEFAULT 'RETAIL'"),
        ("pan_masked", "VARCHAR(20)"),
        ("upi_id_masked", "VARCHAR(100)"),
        ("mandate_status", "VARCHAR(30) DEFAULT 'PENDING'"),
        ("allotment_status", "VARCHAR(30) DEFAULT 'PENDING'"),
        ("demat_credit_status", "VARCHAR(30) DEFAULT 'PENDING'"),
        ("verification_source", "VARCHAR(50)"),
        ("verification_timestamp", "DATETIME"),
        ("conflict_note", "VARCHAR(255)"),
    ]

    if "allotments" in existing_tables:
        existing_cols = {col["name"] for col in inspector.get_columns("allotments")}
        with engine.connect() as conn:
            for col_name, col_type in allotment_columns_to_add:
                if col_name not in existing_cols:
                    logger.info(f"Adding missing column allotments.{col_name} ({col_type})")
                    conn.execute(text(f"ALTER TABLE allotments ADD COLUMN {col_name} {col_type};"))
            conn.commit()

    logger.info("Schema verification and safe migrations completed.")
