# IPOPro — Changed Files Index

This document tracks all files modified, created, or deleted across the application during the comprehensive production readiness, CRUD, paper trading, and AI assistant completion pass.

---

## 1. Backend Application Files

### New Models & Schemas
- `backend/app/models/user.py`: Added `User` database model with PBKDF2-SHA256 password hashing, salt, and `role` (`ADMIN`/`USER`).
- `backend/app/models/watchlist.py`: Added `Watchlist` and `WatchlistItem` database models.
- `backend/app/models/portfolio_note.py`: Added `PortfolioNote` database model with `symbol`, `account_id`, `tag`, and `content`.
- `backend/app/models/notification.py`: Added `Notification` database model with `title`, `message`, `notification_type`, and `is_read`.
- `backend/app/models/chat.py`: Added `ChatMessage` database model with `session_id`, `sender`, `content`, and `context_meta_json`.
- `backend/app/models/__init__.py`: Exported all newly defined models.
- `backend/app/schemas/user.py`: Defined Pydantic schemas for User creation, updates, and responses (excluding password hashes) with resilient regex email validation to eliminate external email-validator import requirements.
- `backend/requirements.txt`: Added `email-validator>=2.0.0` to resolve container startup dependency requirements on Render.
- `backend/app/schemas/watchlist.py`: Defined Pydantic schemas for Watchlist and WatchlistItem CRUD.
- `backend/app/schemas/portfolio_note.py`: Defined Pydantic schemas for PortfolioNote CRUD and tag filtering.
- `backend/app/schemas/notification.py`: Defined Pydantic schemas for System Notifications.
- `backend/app/schemas/chat.py`: Defined Pydantic schemas for AI Assistant messages and conversation history.

### Services & Logic Engines
- `backend/app/services/smartapi_adapter.py`:
  - Added `_adapter_lock = threading.Lock()` around global `_adapter_cache`.
  - Upgraded adapter session lock to re-entrant `threading.RLock()` to prevent deadlocks during concurrent auth checks.
  - Hardened `AB1050` and `AG8001` error classification and session re-use.
- `backend/app/services/portfolio_sync_service.py`:
  - Created `reconcile_broker_holdings()`: syncs live Demat holdings, records weighted average prices, populates instrument catalog, and zeroes out liquidated holdings.
- `backend/app/services/paper_trading_service.py`:
  - Added simulated cash balance verification, cash deduction, and holding creation/increment with weighted average cost for BUY orders.
  - Added `cancel_paper_order()`.
- `backend/app/services/ai_chat_service.py`:
  - Built context-grounded AI analytics engine with zero-credential extraction and prompt assembly.

### REST API Endpoints & Routing
- `backend/app/api/endpoints_users.py`: User CRUD with role enforcement and last-admin deletion protection.
- `backend/app/api/endpoints_watchlists.py`: Watchlists and items CRUD.
- `backend/app/api/endpoints_notes.py`: Portfolio notes and custom tags CRUD.
- `backend/app/api/endpoints_notifications.py`: Notifications CRUD.
- `backend/app/api/endpoints_chat.py`: AI Assistant message posting, history retrieval, context inspection, and history clearance.
- `backend/app/api/endpoints_accounts.py`: Integrated `reconcile_broker_holdings` into `sync_account_data`.
- `backend/app/api/endpoints_portfolio.py`: Integrated `reconcile_broker_holdings` into `sync_portfolio`.
- `backend/app/api/api_v1.py`: Registered all new routers with appropriate authentication dependencies.
- `backend/app/core/database.py`: Ensured safe non-destructive table and column migrations on boot.

---

## 2. Frontend Application Files

- `frontend/src/types.ts`:
  - Added TypeScript interfaces for `AppUser`, `Watchlist`, `WatchlistItem`, `PortfolioNote`, `AppNotification`, and `ChatMessage`.
- `frontend/src/api.ts`:
  - Added API client methods for users, watchlists, portfolio notes, notifications, and AI assistant chat.
- `frontend/src/views/AIChatView.tsx`:
  - Created dedicated AI Financial Assistant view with quick prompts, chat history, metadata tags, and history wipe controls.
- `frontend/src/views/OrdersView.tsx`:
  - Added Sandbox Warning Banner, Buy/Sell side tabs, real-time margin calculation, cash check, and two-step `CONFIRM PAPER ORDER` modal.
- `frontend/src/views/PortfolioView.tsx`:
  - Integrated real-time WebSocket tick streamer; automatically recalculates LTP, market value, unrealized P&L, and portfolio totals on every tick.
- `frontend/src/App.tsx`:
  - Added `AIChatView` tab integration and routing condition.
- `frontend/src/components/Sidebar.tsx`:
  - Added `AI Financial Assistant` navigation link under the `OVERVIEW` section.

---

## 3. Distribution & Hosting Files

- `index.html`: Updated root script and style tags to point to active production build hashes (`index-BjEGgJFo.js`, `index-BpNjkYn9.css`).
- `assets/`: Synchronized compiled distribution assets (`index-BjEGgJFo.js`, `index-BpNjkYn9.css`) and cleaned stale files.
- `hostinger_frontend_upload.zip`: Updated deployment archive containing `index.html`, `assets/`, and `.htaccess`.

---

## 4. Automated Test Files

- `backend/tests/test_crud_and_ai_chat.py`:
  - Added 7 automated tests covering User CRUD & last-admin protection, Watchlist CRUD, Notes & custom tags CRUD, Notifications CRUD, Paper Trading BUY cash deduction & holding creation, AI Assistant prompt flow & zero secret leakage, and Broker Holdings reconciliation & liquidation zeroing.

---

## 5. Documentation Files (`docs/`)

- `docs/FINAL_ENGINEERING_REPORT.md`: Comprehensive engineering assessment, verification matrix, persistence blocker analysis, and ChatGPT review prompt.
- `docs/CRUD_AND_PERMISSIONS_MATRIX.md`: Exhaustive REST API resource, verb, permission, and audit matrix.
- `docs/ARCHITECTURE_AND_DATA_FLOW.md`: High-level architecture, thread safety model, and data flow diagrams.
- `docs/LIVE_DATA_AND_HOLDINGS_SYNC.md`: Detailed holdings reconciliation and real-time streaming documentation.
- `docs/PAPER_TRADING_AND_AI_CHAT.md`: Paper trading matching engine and AI assistant specifications.
- `docs/SECURITY_REVIEW.md`: Cryptographic and security architecture review.
- `docs/DEPLOYMENT_AND_RECOVERY.md`: Render PostgreSQL external provisioning steps and operations guide.
- `docs/TEST_RESULTS.md`: Pytest suite and frontend build logs and metrics.
- `docs/KNOWN_ISSUES_AND_BLOCKERS.md`: Analysis of the Render ephemeral storage blocker.
- `docs/CHANGED_FILES_INDEX.md`: Complete changed files index.
