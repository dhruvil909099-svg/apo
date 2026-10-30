import pytest
from app.models.account import Account
from app.models.instrument import Instrument
from app.services.instrument_master_service import search_instruments
from app.services.smartapi_websocket import smartapi_ws_service
from app.services.data_orchestrator import DataOrchestrator


@pytest.fixture(autouse=True)
def seed_test_instruments(db_session):
    # Ensure test instruments exist in test DB
    instruments = [
        Instrument(
            symbol_token="2885",
            instrument_token="NSE_2885",
            tradingsymbol="RELIANCE-EQ",
            name="RELIANCE INDUSTRIES LIMITED",
            exchange="NSE",
            segment="EQUITY",
            instrument_type="EQUITY",
            underlying_symbol="RELIANCE",
            current_ltp=2950.0,
            is_active=True,
        ),
        Instrument(
            symbol_token="1594",
            instrument_token="NSE_1594",
            tradingsymbol="INFY-EQ",
            name="INFOSYS LIMITED",
            exchange="NSE",
            segment="EQUITY",
            instrument_type="EQUITY",
            underlying_symbol="INFY",
            current_ltp=1850.0,
            is_active=True,
        ),
        Instrument(
            symbol_token="3456",
            instrument_token="NSE_3456",
            tradingsymbol="TMPV-EQ",
            name="Tata Motors Passenger Vehicles Limited",
            exchange="NSE",
            segment="EQUITY",
            instrument_type="EQUITY",
            underlying_symbol="TATAMOTORS",
            current_ltp=920.0,
            is_active=True,
        ),
    ]
    for inst in instruments:
        db_session.add(inst)
    db_session.commit()


def test_search_instruments_decoupled_and_fast(db_session):
    # 1. Search without quote enrichment returns fast
    res = search_instruments(db_session, query="RELIANCE", limit=10, enrich_quotes=False)
    assert "instruments" in res
    assert "total_count" in res
    assert len(res["instruments"]) > 0

    first = res["instruments"][0]
    assert "RELIANCE" in first["tradingsymbol"]
    assert first["exchange"] in ["NSE", "BSE"]
    assert first["symbol_token"] == "2885"


def test_search_compound_ticker_splitting(db_session):
    # Searching TATAMOTORS should match Tata Motors despite concatenated name
    res = search_instruments(db_session, query="TATAMOTORS", limit=5, enrich_quotes=False)
    assert len(res["instruments"]) > 0
    symbols = [i["tradingsymbol"] for i in res["instruments"]]
    names = [i["name"].upper() for i in res["instruments"]]
    
    has_tata_motors = any("TATA MOTORS" in n for n in names) or any("TMPV" in s for s in symbols)
    assert has_tata_motors, f"Expected Tata Motors scrips in results, got symbols: {symbols}, names: {names}"


def test_search_exact_symbol_ranking_first(db_session):
    res = search_instruments(db_session, query="INFY", limit=5, enrich_quotes=False)
    assert len(res["instruments"]) > 0
    first_symbol = res["instruments"][0]["tradingsymbol"]
    assert first_symbol in ["INFY", "INFY-EQ"], f"Expected INFY or INFY-EQ first, got {first_symbol}"


def test_websocket_fast_cache_integration():
    # Verify smartapi_ws_service instant cache population without blocking
    clean = "TESTSYM"
    smartapi_ws_service._last_ticks[clean] = {
        "ltp": 2500.50,
        "previous_close": 2480.00,
        "change": 20.50,
        "change_percent": 0.83,
        "volume": 1200000
    }
    
    quote = smartapi_ws_service.get_latest_quote(clean)
    assert quote is not None
    assert quote["ltp"] == 2500.50
    assert quote["change"] == 20.50


def test_bounded_data_orchestrator_freshness():
    # Verify freshness evaluation does not crash and bounds stale checks
    assert DataOrchestrator.FRESHNESS_TTL_SECONDS == 180
    assert DataOrchestrator.is_data_stale(None) is True
