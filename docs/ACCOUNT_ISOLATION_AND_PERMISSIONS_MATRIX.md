# Account Isolation & Permissions Matrix

**Application:** IPOPro  
**Date:** October 28, 2026  
**Status:** ENFORCED & TESTED  

---

## 1. Authentication & API Protection

All operational and financial endpoints are mounted under `/api/v1` and protected by the constant-time master authentication middleware (`app.core.auth.verify_api_key`).

Supported Authentication Schemes:
- Header `X-API-Key: <key>`
- Header `Authorization: Bearer <key>`

```
Incoming Request -> [security_headers_middleware] -> [rate_limiter] -> [verify_api_key (constant-time)] -> Route Handler
```

---

## 2. Multi-Account Resource Isolation Matrix

| Resource | Endpoint | Read / List | Create | Update / Rotate | Delete | Isolated By |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- |
| **Demat Accounts** | `/api/v1/accounts` | YES | YES | YES | YES | `Account.id` (1:1 session pool) |
| **Account Overview** | `/api/v1/accounts/{id}/overview` | YES | N/A | N/A | N/A | `account_id` match |
| **Account Holdings** | `/api/v1/accounts/{id}/holdings` | YES | N/A | N/A | N/A | `account_id` match |
| **Account Positions**| `/api/v1/accounts/{id}/positions`| YES | N/A | N/A | N/A | `account_id` match |
| **Account Orders** | `/api/v1/accounts/{id}/orders` | YES | N/A | N/A | N/A | `account_id` match |
| **Portfolio Sync** | `/api/v1/accounts/{id}/sync` | N/A | N/A | YES | N/A | Dedicated adapter instance |
| **Order Placement** | `/api/v1/orders/single` | N/A | YES | N/A | N/A | Verified account ownership |
| **Bulk Orders** | `/api/v1/orders/bulk-prepare` | N/A | YES | YES | N/A | Account group / selection |
| **Watchlists** | `/api/v1/watchlists` | YES | YES | YES | YES | User / Session |
| **Research Notes** | `/api/v1/portfolio/notes` | YES | YES | YES | YES | `symbol` + `account_id` |
| **AI Assistant** | `/api/v1/chat/message` | YES | YES | N/A | YES | `session_id` isolation |

---

## 3. Account Group Isolation

Accounts are categorized into segregated groups:
- **`Family`**: Primary Demat accounts eligible for coordinated IPO family applications.
- **`Friends` / `HNI`**: Separate capital pools with custom risk allocations.
- **`Demo Pool`**: Categorically isolated simulated accounts (`is_demo = True`). Demo accounts can never execute orders through live Angel One SmartAPI gateways.
