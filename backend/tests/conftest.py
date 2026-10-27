import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Set test environment
os.environ["TRADING_MODE"] = "PAPER"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["APP_ENCRYPTION_KEY"] = "UOq2vBkYP1PnplztDgeVbfI3UTQvdREy-EsbYI0g3C4="

from app.core.database import Base, get_db
import app.core.database as app_db
from app.main import app
from app.core.security import cipher
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.risk import RiskLimit

# In-memory test engine with StaticPool so all threads/sessions share the same memory DB
test_engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)

app_db.engine = test_engine
app_db.SessionLocal = TestingSessionLocal


def seed_test_fixtures(db):
    """Injects dedicated test fixtures into the in-memory test database."""
    accounts = [
        Account(
            nickname="Self - Primary Demat",
            client_code="DEMO_SELF01",
            account_group="Family",
            encrypted_api_key=cipher.encrypt("DEMO_KEY_1"),
            encrypted_pin=cipher.encrypt("1234"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=True,
            auth_status="CONNECTED",
            ddpi_status="ACTIVE",
            edis_authorized_today=True,
            available_cash=250000.0
        ),
        Account(
            nickname="Father - Retirement Demat",
            client_code="DEMO_DAD02",
            account_group="Family",
            encrypted_api_key=cipher.encrypt("DEMO_KEY_2"),
            encrypted_pin=cipher.encrypt("2345"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=True,
            auth_status="CONNECTED",
            ddpi_status="ACTIVE",
            edis_authorized_today=True,
            available_cash=180000.0
        ),
        Account(
            nickname="Mother - Savings Demat",
            client_code="DEMO_MOM03",
            account_group="Family",
            encrypted_api_key=cipher.encrypt("DEMO_KEY_3"),
            encrypted_pin=cipher.encrypt("3456"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=True,
            auth_status="CONNECTED",
            ddpi_status="INACTIVE",
            edis_authorized_today=False,
            available_cash=120000.0
        ),
        Account(
            nickname="Brother - HNI Demat",
            client_code="DEMO_BRO04",
            account_group="Family",
            encrypted_api_key=cipher.encrypt("DEMO_KEY_4"),
            encrypted_pin=cipher.encrypt("4567"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=True,
            auth_status="CONNECTED",
            ddpi_status="ACTIVE",
            edis_authorized_today=True,
            available_cash=450000.0
        ),
        Account(
            nickname="Friend - Gaurav Demat",
            client_code="DEMO_GAU05",
            account_group="Friends",
            encrypted_api_key=cipher.encrypt("DEMO_KEY_5"),
            encrypted_pin=cipher.encrypt("5678"),
            encrypted_totp_secret=cipher.encrypt("JBSWY3DPEHPK3PXP"),
            is_enabled=True,
            is_demo=True,
            auth_status="CONNECTED",
            ddpi_status="INACTIVE",
            edis_authorized_today=False,
            available_cash=95000.0
        )
    ]
    for acc in accounts:
        db.add(acc)
    db.commit()

    ipos = [
        IPO(
            symbol="TATATECH",
            company_name="Tata Technologies Limited",
            exchange="NSE",
            issue_price=500.0,
            lot_size=30,
            listing_date="2023-11-30",
            isin="INE142M01025",
            symbol_token="19326",
            is_sme=False,
            current_ltp=1042.80,
            previous_close=1025.00,
            status="LISTED"
        ),
        IPO(
            symbol="SWIGGY",
            company_name="Swiggy Limited",
            exchange="NSE",
            issue_price=390.0,
            lot_size=38,
            listing_date="2024-11-13",
            isin="INE00H001014",
            symbol_token="21845",
            is_sme=False,
            current_ltp=468.50,
            previous_close=455.00,
            status="LISTED"
        ),
        IPO(
            symbol="HYUNDAI",
            company_name="Hyundai Motor India Limited",
            exchange="NSE",
            issue_price=1960.0,
            lot_size=7,
            listing_date="2024-10-22",
            isin="INE002A01018",
            symbol_token="21450",
            is_sme=False,
            current_ltp=1820.00,
            previous_close=1845.00,
            status="LISTED"
        ),
        IPO(
            symbol="NTPCGREEN",
            company_name="NTPC Green Energy Limited",
            exchange="NSE",
            issue_price=108.0,
            lot_size=138,
            listing_date="2024-11-27",
            isin="INE00K001019",
            symbol_token="22100",
            is_sme=False,
            current_ltp=132.40,
            previous_close=128.00,
            status="PRE_OPEN"
        )
    ]
    for ipo in ipos:
        db.add(ipo)
    db.commit()

    allotments = [
        Allotment(ipo_id=ipos[0].id, account_id=accounts[0].id, application_no="APP-TT-1", applied_quantity=30, allotted_quantity=30, acquisition_cost=500.0, status="ALLOTTED", demat_verified=True),
        Allotment(ipo_id=ipos[0].id, account_id=accounts[1].id, application_no="APP-TT-2", applied_quantity=30, allotted_quantity=30, acquisition_cost=500.0, status="ALLOTTED", demat_verified=True),
        Allotment(ipo_id=ipos[1].id, account_id=accounts[0].id, application_no="APP-SW-1", applied_quantity=38, allotted_quantity=38, acquisition_cost=390.0, status="ALLOTTED", demat_verified=True),
    ]
    for a in allotments:
        db.add(a)

    risk = RiskLimit(
        account_id=None,
        max_order_value=500000.0,
        max_quantity_per_order=5000,
        max_loss_threshold=50000.0,
        stop_loss_percent=5.0,
        target_profit_percent=20.0,
        emergency_trading_disabled=False,
        allow_market_orders_on_listing=False
    )
    db.add(risk)
    db.commit()


@pytest.fixture(scope="function")
def db_session():
    Base.metadata.create_all(bind=test_engine)
    db = TestingSessionLocal()
    seed_test_fixtures(db)
    try:
        yield db
    finally:
        db.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture(scope="function")
def client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        test_client.headers["X-API-Key"] = "ipopro-secure-master-key-2026"
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(scope="function")
def unauthenticated_client(db_session):
    def override_get_db():
        try:
            yield db_session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
