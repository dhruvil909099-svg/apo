# IPOPro — Paper Trading Simulation & AI Financial Assistant

This document outlines the architecture, functional behavior, isolation guarantees, and security constraints governing the Paper Trading sandbox and the AI Financial Assistant.

---

## 1. Paper Trading Sandbox

### Isolation Guarantee: Zero Live Broker Orders
In accordance with core enterprise safety policies:
- **Live broker accounts remain strictly read-only.**
- Live money orders are **NEVER** placed on Angel One infrastructure via the paper trading sandbox.
- When `TRADING_MODE == "PAPER"` or when an account is marked `is_demo == True`, order placement bypasses the SmartAPI order placement adapter and routes entirely to the local `PaperTradingService`.

### Paper Trading UI & UX (`OrdersView.tsx`)
The Orders workspace features a prominent amber Sandbox Warning Banner to eliminate confusion between simulated orders and production broker executions:
1. **Interactive Buy/Sell Side Selection:** Distinct green (Buy) and red (Sell) selector tabs.
2. **Real-Time Margin Calculation:** Automatically calculates estimated transaction value ($\text{Quantity} \times \text{Price}$) and displays available paper trading cash for the selected account.
3. **Two-Step Confirmation Modal:** Requires the operator to review order terms and click **`CONFIRM PAPER ORDER`** before submission.
4. **Instant Simulated Order Book:** Orders appear in the real-time order table with a purple `SIMULATED` badge and simulated broker ID (e.g. `SIM_A1B2C3D4E5`).

### Matching Engine & Balance Processing (`paper_trading_service.py`)
1. **Cash Balance Enforcement (BUY):**
   - The engine validates that $\text{Available Cash} \ge \text{Quantity} \times \text{Price}$.
   - If cash is insufficient, the order is rejected immediately (`status = "REJECTED"`) with a clear error message.
   - Upon execution, the simulated cash balance is debited by the exact transaction amount.
2. **Holdings Enforcement (SELL):**
   - The engine checks that the account owns sufficient allotted shares in `Allotment`.
   - If requested quantity exceeds holdings, the order is rejected.
   - Upon execution, holdings are decremented, and proceeds are credited back to simulated cash.
3. **Limit Order Matching:**
   - **Buy Limit:** Executes immediately if $\text{Prevailing LTP} \le \text{Limit Price}$. Otherwise, remains open in state `ACCEPTED`.
   - **Sell Limit:** Executes immediately if $\text{Prevailing LTP} \ge \text{Limit Price}$. Otherwise, remains open in state `ACCEPTED`.
   - **Market Order:** Fills immediately at prevailing LTP.
4. **Allotment Ledger Integration:**
   - Executed Buy orders create a new `Allotment` record or increment existing holdings with recalculated weighted average cost:
     $$\text{New Avg Price} = \frac{(\text{Old Qty} \times \text{Old Avg}) + (\text{New Qty} \times \text{Exec Price})}{\text{Old Qty} + \text{New Qty}}$$
5. **Order Cancellation:**
   - Open orders in state `ACCEPTED` or `PREPARED` can be cancelled instantly via `DELETE /api/v1/orders/{order_id}`, setting status to `CANCELLED`.

---

## 2. AI Financial Assistant

### Overview & Mission
The AI Financial Assistant provides authorized operators with intelligent, context-grounded analysis of their multi-account portfolio, upcoming IPO catalyst dates, risk exposures, and sector concentrations.

### Credential-Free Context Grounding
The primary vulnerability of LLM-integrated financial dashboards is accidental credential leakage in prompt contexts. IPOPro enforces strict zero-credential injection in `AIChatService.get_authorized_context()`:
- **Explicit Redaction:** `encrypted_api_key`, `encrypted_pin`, `encrypted_totp_secret`, `hashed_password`, and `salt` are filtered out before context assembly.
- **Allowed Context Elements:**
  1. Consolidated portfolio metrics (Total value, invested capital, net unrealized P&L, day change).
  2. Aggregated Demat holdings (Top 10 holdings by market value, shares held, weighted gain %).
  3. Active accounts overview (Nicknames, masked client codes, available cash).
  4. Monitored IPO listings (Current GMP, subscription status, listing dates).
  5. Active risk limits (Emergency halt status, stop loss %, max loss threshold).

### Conversation Flow & Session Persistence
- **Storage:** Messages are stored in the `ChatMessage` table with fields `session_id`, `sender` (`USER` or `ASSISTANT`), `content`, and sanitized `context_meta_json`.
- **Pre-Engineered Prompts:** The interface offers quick-start prompts:
  - *"Summarize my consolidated portfolio health and top performers"*
  - *"Analyze risk concentration and cash reserves across accounts"*
  - *"Which upcoming IPOs have highest subscription demand?"*
  - *"Explain current paper trading rules and matching logic"*
- **History Wipe:** Operators can clear session trajectories at any time via `DELETE /api/v1/chat/history?session_id=...`.
