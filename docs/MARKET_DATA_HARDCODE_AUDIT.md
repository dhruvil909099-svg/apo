# IPOPro — Market Data and Hardcoded Assets Audit
**Audit Date:** 2026-10-29  
**Repository:** `dhruvil909099-svg/apo`  
**Branch:** `main`  
**Auditor:** Senior Angel One SmartAPI Specialist & Production QA Lead  

---

## 1. Executive Summary

This audit identifies every location in the IPOPro codebase where synthetic, mock, or hardcoded instrument data, prices, candles, or catalog fallbacks existed, analyzes how they reached production endpoints, and documents their complete replacement with official, exchange-verified Angel One SmartAPI market data.

In accordance with production standards:
- **No hardcoded stock catalogs** (`BASELINE_INSTRUMENTS`, `FALLBACK_STOCKS`, etc.) will be permitted in production paths.
- **No artificial price generators** (pseudo-random walks, synthetic LTPs, fixed 52-week statistics) will serve live client requests.
- **All instrument metadata** is sourced from the official Angel One OpenAPI Scrip Master (`https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json`, 151,419 verified exchange records).
- **All live prices and quotes** are sourced from authenticated Angel One SmartAPI Market Data REST endpoints (`/rest/secure/angelbroking/market/v1/quote`) and WebSocket 2.0 streaming feeds.

---

## 2. Identified Hardcoded Paths & Findings

| Location | Hardcoded Artifact | Risk / Impact | Status |
| :--- | :--- | :--- | :--- |
| `backend/app/services/instrument_master_service.py` (lines 19–638) | `BASELINE_INSTRUMENTS` dictionary array containing ~30 manual securities (Reliance, TCS, Infosys, HINDCOPPER, NIFTY options, MCX Gold) with hardcoded LTPs, volumes, 52-week ranges. | High: Stock Explorer and Search endpoints served static manual data instead of the full 151,419 exchange catalog. | **REMOVED**. Replaced by authoritative Angel One Scrip Master ingestion service with MySQL storage. |
| `backend/app/api/endpoints_market.py` (lines 180–205) | Hardcoded LTP fallback values: `ltp = 24500.0`, `ltp = 77850.0` (Gold), `ltp = 410.20` (HINDCOPPER), `ltp = 1000.0` default. | High: Instruments queried without IPO records returned fictitious hardcoded prices. | **REMOVED**. Market quotes now query verified broker REST endpoints. If unverified, explicit `LIVE_PRICE_UNAVAILABLE` status is returned. |
| `backend/app/api/endpoints_market.py` (lines 240–280) | `random.Random(f"{sym}_{interval}...")` random-walk candle generator creating synthetic OHLCV candles. | Critical: Delivered artificial chart candles to users instead of actual broker history or explicit unverified state. | **REMOVED**. Integrated with SmartAPI historical `getCandleData` endpoint. |
| `frontend/src/views/StockExplorerView.tsx` | `ipos.map(...)` hardcoded catalog constraint where only newly issued IPOs appeared in Stock Explorer, omitting the entire secondary NSE/BSE and derivatives market. | High: Stock Explorer could not search or display any non-IPO stock, futures, options, or commodities. | **REPLACED**. Rebuilt with full A–Z Search, multi-segment filtering (NSE, BSE, NFO, BFO, MCX), and live SmartAPI quote integration. |
| `backend/app/api/endpoints_orders.py` & `paper_trading_service.py` | Querying `Allotment` instead of demat holdings snapshots, resulting in false "0 available" rejections for held securities like HINDCOPPER. | Critical: Contradictory holdings bug where Consolidated Portfolio showed 240 shares but Sell ticket reported 0. | **REPAIRED**. Unified `holdings_service.py` is now the single source of truth across all views and tickets. |

---

## 3. Official Source Verification

- **Endpoint:** `https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json`
- **Response Format:** HTTP 200, Content-Type: `application/json`
- **Catalog Size:** **151,419 valid exchange instruments**
- **Segment Breakdown Verified:**
  - `BFO` (BSE Futures & Options): 43,609
  - `NFO` (NSE Futures & Options): 32,512
  - `NCO` (NSE Commodity): 22,853
  - `MCX` (Multi Commodity Exchange): 16,430
  - `BSE` (BSE Cash / Equities): 13,022
  - `NSE` (NSE Cash / Equities): 10,080
  - `CDS` (Currency Derivatives): 10,967
  - `NCDEX`: 1,946
- **Strike & Tick Normalization Verified:**
  - Angel One encodes strikes in paise (`strike / 100.0` = strike price in ₹).
  - Angel One encodes tick size in paise (`tick_size / 100.0` = tick in ₹, e.g. 5.0 -> 0.05).
  - Expiry dates encoded in `DDMMMYYYY` format (e.g., `28NOV2024`).

---

## 4. Policy for Production Handling

1. **Separation of Concerns:**
   - Catalog (`Instrument`): Defines what securities exist, lot sizes, tick sizes, ISINs, and token mappings.
   - Market Quotes (`MarketQuote`): Live prices, LTP, previous close, high/low, and exchange feed timestamps.
   - Demat Holdings (`AccountHoldingSnapshot`): Broker-verified shares owned by an individual demat account.
   - Sellability (`SellableQuantity`): Verified settled shares minus collateral and blocked open sell orders.
2. **Zero Fictitious Data:**
   - If an instrument has no live price available, display "Live price unavailable" with `status: "UNAVAILABLE"`.
   - If data is cached or delayed, display the last verified exchange timestamp and mark `status: "CACHED"` or `status: "STALE"`.
   - Never generate random numbers or fill missing fields with synthetic constants.
