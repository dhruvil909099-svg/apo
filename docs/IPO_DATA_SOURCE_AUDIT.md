# IPOPro IPO Data Source Audit Report

## 1. Executive Summary

This audit assesses the origin, authenticity, and freshness of IPO data in IPOPro as of October 2026. The objective is to identify all synthetic, static, and unverified data points, establish traceable data provenance, and transition the engine to authentic, verified sources.

---

## 2. Forensic Answers to the 12 Investigation Questions

| # | Question | Finding & Evidence | Severity |
|---|---|---|---|
| **1** | **Where does the current IPO list originate?** | Originated from an in-memory Python array named `VERIFIED_MARKET_IPO_CATALOG` in `backend/app/services/ipo_feed_service.py` (lines 72–1201). | **CRITICAL** |
| **2** | **Is the data coming from a real API?** | No. In the legacy implementation, zero HTTP requests were made to external market data APIs for the catalog. | **CRITICAL** |
| **3** | **Is it hardcoded in Python or TypeScript?** | It was hardcoded in Python (`backend/app/services/ipo_feed_service.py`), totaling 1,130 lines of static dictionaries. | **CRITICAL** |
| **4** | **Does the application contain mock IPO records?** | Yes. While company names resembled active issues (e.g., "EAAA India Alternatives Ltd", "SFC Environmental Technologies Ltd"), identifiers, price bands, and dates were manually constructed fixtures. | **HIGH** |
| **5** | **Are IPO details generated using fallback templates?** | Yes. Financial figures, balance sheet items, strengths, and risks were hardcoded mock dictionaries embedded within each record. | **HIGH** |
| **6** | **Are financial figures manually entered?** | Yes. Revenue, PAT, Net Worth, EBITDA, and Borrowings were hardcoded integers/strings with no source filing links. | **HIGH** |
| **7** | **Are subscription figures live or static?** | Static. Subscription rates such as `"0.50x"`, `"14.89x"`, and category breakdowns were fixed string literals. | **CRITICAL** |
| **8** | **Are listing prices coming from actual market quotes?** | Only post-listing LTPs could be queried via SmartAPI for active equity tokens; IPO catalog listing prices were static fixtures. | **MEDIUM** |
| **9** | **How frequently does the data refresh?** | `scheduler_service.py` ran an interval of 300 seconds, but merely re-iterated the static Python catalog and stamped `last_sync_at = datetime.utcnow()`, creating the illusion of fresh data. | **HIGH** |
| **10** | **Are errors being hidden behind placeholder values?** | Yes. Fallbacks displayed static defaults (e.g., ₹0 or 0x) rather than explicitly declaring `"Data unavailable"`. | **HIGH** |
| **11** | **Does the backend return stale records as if they were current?** | Yes. By stamping current timestamps on static dictionaries, stale records were presented as `VERIFIED`. | **CRITICAL** |
| **12** | **Is the production database storing authentic data or development fixtures?** | In the legacy setup, `ipos` table rows were seeded directly from the static fixture list upon application startup. | **CRITICAL** |

---

## 3. Field-by-Field Data Source & Traceability Matrix

| Field | Existing Source | Verified? | Update Frequency | Recommended Legitimate Source | Action Required |
|---|---|---|---|---|---|
| `symbol` | Hardcoded Python list | Partially | Static | **NSE/BSE Official Bidding Circular** | Fetch live from `nseindia.com/api/ipo-current-issue` |
| `company_name` | Hardcoded Python list | Partially | Static | **Exchange Issue Master / SEBI RHP** | Extract from live exchange feed |
| `exchange` | Hardcoded "NSE" / "BSE" | No | Static | **Exchange Master Feed** | Set from reporting exchange |
| `issue_price` | Hardcoded float | No | Static | **Official Price Band Announcement** | Parse cut-off/upper band from live feed |
| `min_price` | Hardcoded float | No | Static | **Exchange Issue Details** | Parse lower price band from live feed |
| `max_price` | Hardcoded float | No | Static | **Exchange Issue Details** | Parse upper price band from live feed |
| `lot_size` | Hardcoded int | No | Static | **Exchange Market Lot Order** | Extract from `Bid Lot` in official feed |
| `min_investment` | `lot_size * max_price` | Calculated | Static | **Calculated from verified parameters** | Dynamic calculation: `lot_size * max_price` |
| `bidding_start_date` | Hardcoded ISO date | No | Static | **Exchange Schedule Notice** | Parse `issueStartDate` from live feed |
| `bidding_end_date` | Hardcoded ISO date | No | Static | **Exchange Schedule Notice** | Parse `issueEndDate` from live feed |
| `allotment_date` | Hardcoded ISO date | No | Static | **RHP Basis of Allotment Timeline** | Mark `PENDING` if not confirmed by RTA |
| `listing_date` | Hardcoded ISO date | No | Static | **Exchange Listing Notice** | Mark `PENDING` until listing circular issued |
| `is_sme` | Hardcoded bool | No | Static | **Exchange Series Indicator** | `series == 'SME'` from live feed |
| `subscription_rate` | Hardcoded string | No | Static | **Exchange Cumulative Bidding Feed** | Live `noOfTime` from NSE cumulative bidding |
| `retail_quota` | Hardcoded string | No | Static | **Official Offer Document (RHP)** | Extract from RHP or mark `UNAVAILABLE` |
| `qib_quota` | Hardcoded string | No | Static | **Official Offer Document (RHP)** | Extract from RHP or mark `UNAVAILABLE` |
| `nii_quota` | Hardcoded string | No | Static | **Official Offer Document (RHP)** | Extract from RHP or mark `UNAVAILABLE` |
| `registrar_name` | Hardcoded string | No | Static | **Prospectus Registrar Disclosure** | Parse `Name of the Registrar` from live feed |
| `rhp_url` | Hardcoded or null | No | Static | **SEBI / Exchange Archives** | Live archive link from `nsearchives.nseindia.com` |
| `financials_json` | Hardcoded mock JSON | ❌ NO | Static | **Audited Financial Statements in RHP** | Only display verified statements or `UNAVAILABLE` |
| `valuation_json` | Hardcoded mock JSON | ❌ NO | Static | **Basis for Issue Price in RHP** | Only display verified ratios or `UNAVAILABLE` |

---

## 4. Remediation Plan

1. **Purge Static Catalog:** Remove `VERIFIED_MARKET_IPO_CATALOG` from `backend/app/services/ipo_feed_service.py`.
2. **Implement Modular Provider:** Create `NSEExchangeProvider` adhering to `BaseIPOProvider`.
3. **Field Normalization:** Parse real price bands, lot sizes, dates, subscription figures, and document links.
4. **Provenance Tracking:** Introduce `data_quality_status` (`VERIFIED`, `STALE`, `UNAVAILABLE`, `PENDING_VERIFICATION`) with exact `source_name` and `source_document_url`.
5. **No Synthetic Fallbacks:** Do not invent missing data. Display explicit "To be announced" or "Data unavailable" badges.
