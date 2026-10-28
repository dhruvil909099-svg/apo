# Angel One SmartAPI Integration & IPO Capability Audit

## 1. Executive Summary

This audit assesses the official capabilities of the Angel One SmartAPI (v1 / v2 SDK and REST documentation) concerning primary market Initial Public Offerings (IPOs) versus secondary market trading.

- **Broker**: Angel One Limited
- **API Suite**: SmartAPI REST & WebSocket Gateway (`apiconnect.angelone.in`)
- **SDK Reference**: `smartapi-python>=1.4.8`
- **Audit Date**: October 2026

**Core Finding**:
Angel One SmartAPI is designed exclusively for secondary market operations (equity cash, F&O, commodities, currency trading, historical market data, and portfolio holding retrieval). **Angel One does NOT provide public SmartAPI REST endpoints for primary market IPO catalog retrieval, IPO bid submission, IPO bid modification/cancellation, or UPI payment mandate authorization.**

In Angel One's architecture, primary market IPO applications are handled through Angel One's customer portal and mobile application via dedicated sponsor bank UPI interfaces (NPCI UPI 2.0 mandate framework) or ASBA via net banking.

Consequently, IPOPro implements:
1. **Official Handoff Workflow**: Validates application terms, lot limits, and category constraints across individual and multiple client accounts in IPOPro, and securely directs the account holder to complete the official submission and UPI mandate authorization on Angel One's official portal.
2. **Post-Handoff Reconciliation & Tracking**: Tracks application references, mandate statuses, registrar allotment feeds, and demat holding reconciliation without fabricating submissions or compromising credential security.

---

## 2. SmartAPI Official Capability Matrix

| Operation | SmartAPI Endpoint / Method | Official Documentation Status | IPOPro Implementation Status | Technical Limitation / Risk |
|---|---|---|---|---|
| **Broker Authentication** | `/rest/auth/angelbroking/user/v1/loginByPassword` | **Supported** (Official REST & SDK) | **VERIFIED & CONNECTED** | Requires TOTP, API Key, Client Code, and MPIN. Enforces strict session isolation. |
| **User Profile Retrieval** | `/rest/secure/angelbroking/user/v1/getProfile` | **Supported** (Official REST & SDK) | **VERIFIED & CONNECTED** | Returns DP ID, client name, bank account, and PAN details for application pre-fill. |
| **Portfolio Holdings** | `/rest/secure/angelbroking/portfolio/v1/getAllHolding` | **Supported** (Official REST & SDK) | **VERIFIED & CONNECTED** | Used to verify demat credit of allotted IPO shares post-listing. |
| **Order Placement (Equity/F&O)** | `/rest/secure/angelbroking/order/v1/placeOrder` | **Supported** (Secondary market only) | **PAPER ONLY (Live Blocked)** | **NOT APPLICABLE TO IPOS.** Regular equity buy orders cannot place primary market IPO bids. |
| **Market Quotes (LTP/Depth)** | `/rest/secure/angelbroking/market/v1/quote` | **Supported** (Official REST & SDK) | **VERIFIED & CONNECTED** | Used for real-time post-listing price tracking for listed IPOs. |
| **IPO Catalog Discovery** | None | **NOT SUPPORTED in SmartAPI** | **PROPRIETARY DISCOVERY ENGINE** | Sourced via verified public exchange publications and Angel One public market feeds. |
| **IPO Application Submission** | None | **NOT SUPPORTED in SmartAPI** | **OFFICIAL BROKER HANDOFF** | Attempting undocumented endpoints violates API Terms of Service. Handled via official portal link. |
| **IPO Application Modification** | None | **NOT SUPPORTED in SmartAPI** | **OFFICIAL BROKER HANDOFF** | Modifications must be authenticated directly on broker/ASBA gateway. |
| **IPO Application Cancellation** | None | **NOT SUPPORTED in SmartAPI** | **OFFICIAL BROKER HANDOFF** | Cancellation requires direct UPI mandate revocation through banking app or broker. |
| **UPI Mandate Status** | None | **NOT SUPPORTED in SmartAPI** | **SOURCE-AWARE STATUS ENGINE** | Tracks mandate lifecycle (PENDING, APPROVED, REJECTED) with audit trail. |
| **IPO Allotment Retrieval** | None | **NOT SUPPORTED in SmartAPI** | **DEMAT RECONCILIATION & CSV** | Automatically detected when shares appear in `/getAllHolding`, supplemented by registrar import. |

---

## 3. Official Application Handoff Workflow Specification

Because direct programmatic IPO submission is not exposed via SmartAPI, IPOPro enforces a secure 8-step handoff architecture:

```
[IPOPro Catalog]
       │
       ▼
[1. Select IPO & Category]
       │
       ▼
[2. Select Authorized Account(s)]
       │
       ▼
[3. Validate Limits (Lot multiples, Retail <= ₹2L)]
       │
       ▼
[4. Generate Application Preparation Summary]
       │
       ▼
[5. Account Holder Handoff to Official Angel One IPO Portal]
       │ (https://trade.angelone.in/ipo or Angel One App)
       ▼
[6. Account Holder Enters UPI ID & Submits Bid via Sponsor Bank]
       │
       ▼
[7. Account Holder Approves UPI AutoPay Mandate in BHIM / GPay / PhonePe]
       │
       ▼
[8. Import Application Reference & Track Allotment / Demat Credit in IPOPro]
```

### Safety & Compliance Guarantees:
1. **Zero Fake Submissions**: IPOPro explicitly differentiates `PREPARATION_READY` from `BROKER_CONFIRMED`.
2. **Account Isolation**: Client credentials are never pooled or reused across accounts.
3. **No Private Scraping**: No automated browser sessions or reverse-engineered private mobile endpoints are employed.
4. **Permanent Audit Trail**: All preparation, handoff, and status updates are recorded in `audit_logs`.
