# IPOPro — CRUD Operations & Permissions Matrix

This document provides an exhaustive reference of all REST API resources, HTTP methods, authorization requirements, request validation rules, and audit trail side-effects implemented in IPOPro.

---

## 1. Role-Based Access Control (RBAC) Overview

IPOPro implements a dual-role access control model:
- **`ADMIN`**: System administrators with full control over user provisioning, broker account credentials, system-wide risk limits, audit logs, and operational configuration.
- **`USER`**: Authorized operators or portfolio analysts capable of viewing accounts, managing watchlists, creating portfolio notes, interacting with the AI financial assistant, and placing paper orders.

---

## 2. Resource & Permissions Matrix

| Resource | Method | Endpoint Path | Minimum Role | Validation & Guardrails | Audit Event Logged |
|---|---|---|---|---|---|
| **Users** | `GET` | `/api/v1/users` | `ADMIN` | Returns list of users; password hashes omitted | — |
| **Users** | `POST` | `/api/v1/users` | `ADMIN` | Unique username & email, PBKDF2-SHA256 hashed | `USER_CREATED` |
| **Users** | `GET` | `/api/v1/users/me` | `USER` | Returns authenticated caller's profile | — |
| **Users** | `GET` | `/api/v1/users/{id}` | `ADMIN` | Validates user ID exists (404 if missing) | — |
| **Users** | `PUT` | `/api/v1/users/{id}` | `ADMIN` | Validates unique username/email conflict | `USER_UPDATED` |
| **Users** | `DELETE` | `/api/v1/users/{id}` | `ADMIN` | **Guarded**: Rejects deleting last active admin (400) | `USER_DELETED` |
| **Accounts** | `GET` | `/api/v1/accounts` | `USER` | Returns masked client codes and auth status | — |
| **Accounts** | `POST` | `/api/v1/accounts` | `ADMIN` | Fernet encrypts API Key, PIN, and TOTP secret | `ACCOUNT_CREATED` |
| **Accounts** | `PUT` | `/api/v1/accounts/{id}` | `ADMIN` | Partial update support; re-encrypts if rotated | `ACCOUNT_UPDATED` |
| **Accounts** | `POST` | `/api/v1/accounts/{id}/sync` | `USER` | Fetches live RMS & Demat holdings, reconciles | `ACCOUNT_SYNCED` |
| **Accounts** | `POST` | `/api/v1/accounts/{id}/reconnect` | `ADMIN` | Accepts manual 6-digit TOTP or re-evaluates | `ACCOUNT_RECONNECTED` |
| **Watchlists** | `GET` | `/api/v1/watchlists` | `USER` | Returns all watchlists with embedded items | — |
| **Watchlists** | `POST` | `/api/v1/watchlists` | `USER` | Name required (min 1, max 100 chars) | — |
| **Watchlists** | `GET` | `/api/v1/watchlists/{id}` | `USER` | Validates watchlist exists | — |
| **Watchlists** | `PUT` | `/api/v1/watchlists/{id}` | `USER` | Updates name or description | — |
| **Watchlists** | `DELETE` | `/api/v1/watchlists/{id}` | `USER` | Cascades deletion to items (204 No Content) | — |
| **Watchlist Items** | `POST` | `/api/v1/watchlists/{id}/items` | `USER` | Requires symbol & exchange; associates with list | — |
| **Watchlist Items** | `DELETE` | `/api/v1/watchlists/{id}/items/{item_id}` | `USER` | Validates item belongs to specified watchlist | — |
| **Portfolio Notes** | `GET` | `/api/v1/portfolio/notes` | `USER` | Supports filters: `symbol`, `account_id`, `tag` | — |
| **Portfolio Notes** | `POST` | `/api/v1/portfolio/notes` | `USER` | Requires content; validates symbol/tag format | — |
| **Portfolio Notes** | `PUT` | `/api/v1/portfolio/notes/{id}` | `USER` | Updates note content or tag | — |
| **Portfolio Notes** | `DELETE` | `/api/v1/portfolio/notes/{id}` | `USER` | Returns 204 No Content | — |
| **Notifications** | `GET` | `/api/v1/notifications` | `USER` | Filter by `unread_only=true` (limit 100) | — |
| **Notifications** | `POST` | `/api/v1/notifications` | `USER` | Title & message required; severity categorized | — |
| **Notifications** | `POST` | `/api/v1/notifications/{id}/read` | `USER` | Marks record `is_read = true` | — |
| **Notifications** | `DELETE` | `/api/v1/notifications/{id}` | `USER` | Deletes notification (204 No Content) | — |
| **AI Assistant** | `POST` | `/api/v1/chat/message` | `USER` | Injects sanitized context; redacts all secrets | — |
| **AI Assistant** | `GET` | `/api/v1/chat/history` | `USER` | Returns chat trajectory for given `session_id` | — |
| **AI Assistant** | `DELETE` | `/api/v1/chat/history` | `USER` | Wipes messages for `session_id` (204 No Content) | — |
| **Paper Orders** | `POST` | `/api/v1/orders/single` | `USER` | Rate-limited; balance check; zero live dispatch | `ORDER_PLACED` |
| **Bulk Orders** | `POST` | `/api/v1/orders/bulk-execute` | `ADMIN` | Requires explicit operator confirmation flag | `BULK_ORDER_EXECUTED` |
| **Risk Controls** | `PUT` | `/api/v1/risk/limits` | `ADMIN` | Emergency kill switch and drawdown caps | `RISK_LIMITS_UPDATED` |

---

## 3. Request & Response Integrity Rules

1. **Secret Masking Guarantee:**
   - Responses from `/api/v1/accounts` and `/api/v1/users` **never** return `encrypted_api_key`, `encrypted_pin`, `encrypted_totp_secret`, or `hashed_password`.
   - Client codes are masked in non-administrative view contexts (e.g. `DEMO****01`).
2. **Idempotent Operations:**
   - Feed sync and Demat holdings reconciliation operations are strictly idempotent. Repeated calls preserve existing allotment statuses, lot counts, and tags while updating current LTP and P&L.
3. **Audit Trail Encasement:**
   - Any state-altering action executed by an administrator or operator generates an entry in the `AuditLog` table with UTC timestamp, operator ID, event type, and sanitized JSON metadata.
