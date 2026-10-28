import logging
from sqlalchemy import create_engine, event, text, inspect
from sqlalchemy.orm import declarative_base, sessionmaker
from app.core.config import settings

logger = logging.getLogger("database")

def normalize_database_url(url: str) -> str:
    """Normalizes database URLs to their respective modern SQLAlchemy dialects."""
    if not url:
        return "sqlite:///./angel_dashboard.db"
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql://", 1)
    if url.startswith("mysql://"):
        # Auto-configure PyMySQL driver for Hostinger MySQL/MariaDB
        return url.replace("mysql://", "mysql+pymysql://", 1)
    if url.startswith("mariadb://"):
        return url.replace("mariadb://", "mysql+pymysql://", 1)
    return url


# Engine configuration (supporting SQLite, Hostinger MySQL/MariaDB, and PostgreSQL)
connect_args = {}
engine_kwargs = {"echo": False}

db_url = normalize_database_url(settings.DATABASE_URL)

if db_url.startswith("sqlite"):
    connect_args = {
        "check_same_thread": False,
        "timeout": 30.0  # 30-second busy timeout to prevent 'database is locked' errors
    }
else:
    is_mysql = "mysql" in db_url or "mariadb" in db_url
    if is_mysql:
        connect_args = {
            "charset": "utf8mb4",
            "connect_timeout": 10,
        }
    # Conservative connection pooling for remote databases (Hostinger MySQL & PostgreSQL)
    engine_kwargs.update({
        "pool_size": 5,
        "max_overflow": 2,
        "pool_timeout": 15.0,
        "pool_recycle": 280,  # Recycle before Hostinger's 300-second idle connection timeout
        "pool_pre_ping": True,  # Critical for catching dropped remote connections before query checkout
    })

engine = create_engine(
    db_url,
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


def run_safe_migrations(target_engine=None):
    """
    Idempotent schema migration for SQLite, Hostinger MySQL/MariaDB, and PostgreSQL.
    Safely adds missing tables and columns without dropping tables or losing existing records.
    """
    active_engine = target_engine or engine
    logger.info(f"Verifying schema and running non-destructive column migrations on {active_engine.dialect.name}...")
    Base.metadata.create_all(bind=active_engine)
    inspector = inspect(active_engine)
    existing_tables = inspector.get_table_names()

    # Column definitions to verify for 'ipos'
    ipo_columns_to_add = [
        ("min_price", "FLOAT"),
        ("max_price", "FLOAT"),
        ("bidding_start_date", "VARCHAR(20)"),
        ("bidding_end_date", "VARCHAR(20)"),
        ("allotment_date", "VARCHAR(20)"),
        ("source_name", "VARCHAR(50) DEFAULT 'MANUAL'"),
        ("source_timestamp", "TIMESTAMP"),
        ("last_sync_at", "TIMESTAMP"),
        ("subscription_rate", "VARCHAR(30)"),
        ("min_investment", "FLOAT"),
        ("issue_size", "VARCHAR(50)"),
    ]

    if "ipos" in existing_tables:
        existing_cols = {col["name"] for col in inspector.get_columns("ipos")}
        with active_engine.connect() as conn:
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
        ("verification_timestamp", "TIMESTAMP"),
        ("conflict_note", "VARCHAR(255)"),
    ]

    if "allotments" in existing_tables:
        existing_cols = {col["name"] for col in inspector.get_columns("allotments")}
        with active_engine.connect() as conn:
            for col_name, col_type in allotment_columns_to_add:
                if col_name not in existing_cols:
                    logger.info(f"Adding missing column allotments.{col_name} ({col_type})")
                    conn.execute(text(f"ALTER TABLE allotments ADD COLUMN {col_name} {col_type};"))
            conn.commit()

    # Column definitions to verify for 'accounts'
    account_columns_to_add = [
        ("account_group", "VARCHAR(50) DEFAULT 'Family'"),
        ("is_demo", "BOOLEAN DEFAULT FALSE"),
        ("auth_status", "VARCHAR(30) DEFAULT 'DISCONNECTED'"),
        ("ddpi_status", "VARCHAR(30) DEFAULT 'UNKNOWN'"),
        ("edis_authorized_today", "BOOLEAN DEFAULT FALSE"),
        ("last_auth_error", "VARCHAR(500)"),
        ("last_sync_attempt", "TIMESTAMP"),
        ("sync_status", "VARCHAR(30) DEFAULT 'IDLE'"),
        ("consecutive_errors", "INTEGER DEFAULT 0"),
        ("circuit_breaker_until", "TIMESTAMP"),
    ]

    if "accounts" in existing_tables:
        existing_cols = {col["name"] for col in inspector.get_columns("accounts")}
        with active_engine.connect() as conn:
            for col_name, col_type in account_columns_to_add:
                if col_name not in existing_cols:
                    logger.info(f"Adding missing column accounts.{col_name} ({col_type})")
                    conn.execute(text(f"ALTER TABLE accounts ADD COLUMN {col_name} {col_type};"))
            conn.commit()

    logger.info("Schema verification and safe migrations completed.")
