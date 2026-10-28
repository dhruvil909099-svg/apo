# Indian Capital Markets IPO Data Provider Comparison

## 1. Executive Summary

This document evaluates authorized, legitimate Indian capital-market data providers for primary market Initial Public Offerings (Mainboard and SME). It provides technical specifications, legal/commercial licensing limitations, and integration feasibility for IPOPro.

---

## 2. Provider Evaluation Matrix

| Provider Name | Official Website | Supported Segments | Refresh Frequency | API / Data Interface | Commercial Terms / Licensing | Integration Status | Evidence & Documentation References |
|---|---|---|---|---|---|---|---|
| **NSE India** (Exchange Feed) | `https://www.nseindia.com` | Mainboard & SME (`series: EQ`, `series: SME`) | Real-time during market hours (bidding closes 5:00 PM IST) | JSON REST endpoints (`/api/ipo-current-issue`, `/api/all-upcoming-issues?category=ipo`, `/api/ipo-detail?symbol={sym}`) | Exchange public market dissemination. Commercial redistribution requires NSE Data & Analytics license. | **ACTIVE ADAPTER (Default Exchange Provider)** | Verified live JSON responses returning real active issues (`BCSSL`, `MKSONS`, `SFCTECH`, `BLSPOLY`, `EDELALTS`). |
| **BSE India** | `https://www.bseindia.com` | Mainboard & BSE SME | Daily / market hours | Web-based public issue notices; BSE StAR IPO for member terminals | Direct broker/syndicate access. Public web access throttled with Cloudflare/WAF. | **PLANNED ADAPTER (Awaiting Member Credentials)** | BSE Public Issues module (`bseindia.com/markets/PublicIssues`). |
| **SEBI (Securities & Exchange Board of India)** | `https://www.sebi.gov.in` | Mainboard & SME Offer Documents | Statutory filing events | Public Offer Documents repository (DRHP/RHP PDF downloads) | Statutory public disclosure under ICDR regulations. No automated REST JSON API provided. | **DOCUMENT LINK ADAPTER (Direct RHP Links)** | `sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=3&ssid=15&smid=1` |
| **Registrars (KFintech, Link Intime, Bigshare)** | `kfintech.com`, `linkintime.co.in`, `bigshareonline.com` | Mainboard & SME Allotment Feeds | Event-driven (Allotment finalization T+2/T+3) | Web query forms with Captcha; B2B SFTP for authorized brokers | Public REST API not offered to retail developers. Requires Registrar-Broker B2B agreement. | **CSV IMPORT ADAPTER (Official Registrar Export)** | SEBI circulars on T+3 IPO allotment timeline and registrar query portals. |
| **Prime Database Group** | `https://www.primedatabase.com` | Comprehensive Indian Capital Markets Master Data | Real-time & End-of-Day | Commercial Enterprise Feed (FTP / API / Custom Delivery) | Commercial institutional license required (Enterprise subscription, ~$5,000–$15,000/year). | **CONFIGURABLE ADAPTER (Disabled: License Required)** | Recognized market leader for primary capital market statistics in India. |
| **Trendlyne** | `https://trendlyne.com` | Mainboard & SME with Financial Ratios | Daily / Real-time updates | Commercial B2B API | Paid enterprise API partnership. Redistribution restricted without contract. | **CONFIGURABLE ADAPTER (Disabled: License Required)** | Trendlyne IPO tracker & B2B data licensing suites. |
| **Chittorgarh / IPO Watch** | `chittorgarh.com` | Mainboard & SME, GMP, Subscriptions | Frequent intraday updates | No authorized public API; scraping prohibited by Terms of Service | Commercial web portal. Scraping violates Terms of Service and Cloudflare WAF. | **REJECTED (Unauthorized Scraping Prohibited)** | Adheres to strict engineering rule: No unauthorized scraping or bot bypass. |
| **TrueData India** | `https://www.truedata.in` | Real-time Market Quotes & Corporate Actions | Low-latency streaming | Official REST & WebSocket API (NSE/BSE authorized vendor) | Commercial API subscription (Monthly/Annual subscription required). | **QUOTE ADAPTER (Enabled for Post-Listing LTP)** | SEBI-registered data vendor providing licensed market feeds. |

---

## 3. Implementation Policy in IPOPro

1. **Authorized Exchange Adapter (NSE India):**
   - Implemented as the primary data engine.
   - Harvests official price bands, market lots, start/end dates, series, official RHP links, registrar disclosures, and live subscription multiples (`noOfTime`).
2. **Provenance & Attribution:**
   - Every record from this provider is marked:
     - `source_name: "NSE_INDIA_OFFICIAL_FEED"`
     - `data_quality_status: "VERIFIED"`
     - `source_document_url: "https://www.nseindia.com/market-data/all-upcoming-issues-ipo"`
3. **No Synthetic Fillers:**
   - Where a field is not yet announced by the issuer (e.g., pending listing date, lot size not finalized), the engine stores `null` and displays `"To be announced"` or `"Data unavailable"`.
   - Never displays fake ₹0 or 0x subscription multiples.
4. **Commercial Providers:**
   - Commercial adapters (Prime Database, Trendlyne) are structured cleanly in the provider abstraction layer and remain disabled until the operator supplies legitimate commercial API keys in `.env`.
