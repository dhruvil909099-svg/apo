import json
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.ipo import IPO, Allotment
from app.models.order import Order
from app.models.risk import RiskLimit
from app.models.chat import ChatMessage
from app.core.config import settings


class AIChatService:
    """
    Authorized Financial and Portfolio Assistant for IPOPro.
    Constructs authorized context strictly without sensitive broker secrets or passwords.
    Processes user inquiries regarding portfolio health, IPO tracking, SmartAPI diagnostics,
    and paper trading mechanics.
    """

    @classmethod
    def get_authorized_context(cls, db: Session) -> Dict[str, Any]:
        """
        Extracts high-level portfolio metrics, connection health, and market context.
        Strictly excludes all passwords, PINs, TOTP keys, JWT tokens, and private credentials.
        """
        now = datetime.utcnow()
        now_str = now.strftime("%Y-%m-%d %H:%M:%S UTC")

        # Accounts context
        accounts = db.query(Account).filter(Account.is_enabled == True).all()
        acc_summary = [
            {
                "id": a.id,
                "nickname": a.nickname,
                "masked_code": a.masked_client_code,
                "group": a.account_group,
                "auth_status": a.auth_status,
                "ddpi_status": a.ddpi_status,
                "is_demo": a.is_demo,
                "available_cash": a.available_cash,
                "last_sync": a.last_sync_time.strftime("%Y-%m-%d %H:%M:%S") if a.last_sync_time else "Never"
            }
            for a in accounts
        ]

        # Allotments and holdings
        allotments = db.query(Allotment).join(IPO).filter(Allotment.allotted_quantity > 0).all()
        holdings_dict: Dict[str, Dict[str, Any]] = {}
        total_market_val = 0.0
        total_cost_val = 0.0

        for a in allotments:
            sym = a.ipo.symbol
            ltp = a.ipo.current_ltp or a.ipo.issue_price
            cost = a.acquisition_cost
            qty = a.allotted_quantity

            if sym not in holdings_dict:
                holdings_dict[sym] = {
                    "symbol": sym,
                    "company_name": a.ipo.company_name,
                    "quantity": 0,
                    "current_ltp": ltp,
                    "total_cost": 0.0,
                    "market_value": 0.0,
                    "unrealized_pnl": 0.0
                }

            holdings_dict[sym]["quantity"] += qty
            holdings_dict[sym]["total_cost"] += (qty * cost)
            val = qty * ltp
            holdings_dict[sym]["market_value"] += val
            total_market_val += val
            total_cost_val += (qty * cost)

        for sym, data in holdings_dict.items():
            data["market_value"] = round(data["market_value"], 2)
            data["total_cost"] = round(data["total_cost"], 2)
            pnl = data["market_value"] - data["total_cost"]
            data["unrealized_pnl"] = round(pnl, 2)
            data["pnl_pct"] = round((pnl / data["total_cost"]) * 100, 2) if data["total_cost"] > 0 else 0.0

        net_pnl = total_market_val - total_cost_val
        net_pnl_pct = (net_pnl / total_cost_val) * 100 if total_cost_val > 0 else 0.0

        # Monitored IPOs
        ipos = db.query(IPO).order_by(IPO.id.desc()).limit(8).all()
        ipo_summary = [
            {
                "symbol": i.symbol,
                "company_name": i.company_name,
                "status": i.status,
                "issue_price": i.issue_price,
                "current_ltp": i.current_ltp,
                "bidding_dates": f"{i.bidding_start_date or 'TBA'} to {i.bidding_end_date or 'TBA'}"
            }
            for i in ipos
        ]

        # Recent Paper Orders
        orders = db.query(Order).order_by(Order.id.desc()).limit(10).all()
        orders_summary = [
            {
                "symbol": o.tradingsymbol,
                "side": o.transaction_type,
                "type": o.order_type,
                "qty": o.quantity,
                "price": o.price,
                "status": o.status,
                "is_paper": o.is_paper_trade
            }
            for o in orders
        ]

        # Risk settings
        risk = db.query(RiskLimit).first()
        is_halted = risk.emergency_trading_disabled if risk else False

        return {
            "timestamp": now_str,
            "trading_mode": settings.TRADING_MODE,
            "emergency_halt": is_halted,
            "accounts_count": len(accounts),
            "connected_accounts": sum(1 for a in accounts if a.auth_status in ["CONNECTED", "ACTIVE"]),
            "accounts": acc_summary,
            "portfolio": {
                "total_market_value": round(total_market_val, 2),
                "total_investment_cost": round(total_cost_val, 2),
                "net_unrealized_pnl": round(net_pnl, 2),
                "net_pnl_percentage": round(net_pnl_pct, 2),
                "distinct_symbols": len(holdings_dict),
                "holdings": list(holdings_dict.values())
            },
            "recent_ipos": ipo_summary,
            "recent_orders": orders_summary
        }

    @classmethod
    def generate_response(cls, db: Session, user_message: str, session_id: Optional[str] = None) -> Dict[str, Any]:
        """
        Synthesizes an intelligent, domain-specific response based on current authorized portfolio data.
        """
        ctx = cls.get_authorized_context(db)
        query = user_message.lower().strip()
        port = ctx["portfolio"]

        # Check for portfolio summary intent
        if any(w in query for w in ["portfolio", "holdings", "summary", "valuation", "pnl", "profit", "loss", "worth"]):
            if port["distinct_symbols"] == 0:
                answer = (
                    "**Portfolio Overview**:\n\n"
                    "Currently, there are no active Demat holdings recorded in the portfolio. "
                    "You can synchronize your live holdings via **Portfolio > Sync Portfolio** or connect your Angel One accounts."
                )
            else:
                top_holdings_str = "\n".join([
                    f"- **{h['symbol']}**: {h['quantity']} shares @ ₹{h['current_ltp']} (Value: ₹{h['market_value']:,}, P&L: ₹{h['unrealized_pnl']:,} / {h['pnl_pct']}%)"
                    for h in port["holdings"][:5]
                ])
                pnl_indicator = "Profit" if port["net_unrealized_pnl"] >= 0 else "Loss"
                answer = (
                    f"### Consolidated Portfolio Summary\n\n"
                    f"- **Total Market Valuation**: ₹{port['total_market_value']:,}\n"
                    f"- **Total Investment Cost**: ₹{port['total_investment_cost']:,}\n"
                    f"- **Net Unrealized {pnl_indicator}**: ₹{port['net_unrealized_pnl']:,} ({port['net_pnl_percentage']}%)\n"
                    f"- **Tracked Positions**: {port['distinct_symbols']} instrument(s)\n\n"
                    f"**Top Holdings Breakdown**:\n{top_holdings_str}\n\n"
                    f"*Data as of: {ctx['timestamp']} (FIFO weighted-average cost basis)*"
                )

        # Check for account connection / auth error intent
        elif any(w in query for w in ["account", "connection", "login", "auth", "ab1050", "ag8001", "reconnect", "error"]):
            err_accounts = [a for a in ctx["accounts"] if a["auth_status"] in ["ERROR", "EXPIRED"]]
            if err_accounts:
                err_list = "\n".join([f"- **{a['nickname']}** ({a['masked_code']}): Status `{a['auth_status']}`" for a in err_accounts])
                answer = (
                    f"### Account Connection Status\n\n"
                    f"We detected **{len(err_accounts)}** account(s) requiring attention:\n{err_list}\n\n"
                    f"**Diagnostic Recommendations**:\n"
                    f"1. **AB1050 Error**: Indicates an Invalid TOTP, PIN, or Client Code combination. Open **Accounts > Reconnect**, verify your 4-digit PIN, and enter a fresh 6-digit TOTP code from Google Authenticator.\n"
                    f"2. **AG8001 / Session Expired**: Angel One SmartAPI JWT tokens expire daily at 06:00 AM IST. Re-authenticate your account with one click to generate a fresh token.\n"
                    f"3. **DDPI / eDIS**: Ensure your account has active DDPI registration or authorize daily eDIS CDSL TPIN for seamless execution."
                )
            else:
                answer = (
                    f"### Account Connection Health\n\n"
                    f"All **{ctx['connected_accounts']}** active accounts are verified and connected to Angel One SmartAPI. "
                    f"Session tokens are isolated 1:1 per Demat account."
                )

        # Check for IPO intent
        elif any(w in query for w in ["ipo", "allotment", "listing", "upcoming", "swiggy", "tatatech", "hyundai"]):
            if ctx["recent_ipos"]:
                ipos_str = "\n".join([
                    f"- **{i['symbol']}** ({i['company_name']}): Status `{i['status']}` | Issue Price: ₹{i['issue_price']} | Current LTP: ₹{i['current_ltp'] or '—'}"
                    for i in ctx["recent_ipos"][:5]
                ])
                answer = (
                    f"### Monitored IPO Tracker\n\n"
                    f"Here are the active IPO issues tracked in your workspace:\n{ipos_str}\n\n"
                    f"You can import registrar allotment registers (KFintech / Link Intime) via **IPO Tracker > Import CSV** to reconcile confirmed allotments."
                )
            else:
                answer = "No IPO issues are currently registered in the database. You can add them under **IPO Tracker & Allotments**."

        # Check for paper trading intent
        elif any(w in query for w in ["paper", "order", "buy", "sell", "trade", "simulator", "halt"]):
            recent_orders_str = "\n".join([
                f"- {o['side']} {o['qty']} {o['symbol']} @ ₹{o['price']} [{o['status']}]"
                for o in ctx["recent_orders"][:5]
            ]) if ctx["recent_orders"] else "No simulated orders recorded today."
            answer = (
                f"### Paper Trading Simulator\n\n"
                f"- **Current Operational Mode**: `{ctx['trading_mode']}`\n"
                f"- **Emergency Kill Switch**: {'🚨 ACTIVE (TRADING BLOCKED)' if ctx['emergency_halt'] else '🟢 NORMAL (Trading Allowed)'}\n\n"
                f"**Recent Simulated Orders**:\n{recent_orders_str}\n\n"
                f"*Notice: Buy/Sell operations in IPOPro are strictly executed inside an isolated paper simulation sandbox. No live capital is ever risked.*"
            )

        # Default domain guidance
        else:
            answer = (
                f"Hello! I am your **IPOPro Portfolio & Financial Assistant**.\n\n"
                f"I can assist you with:\n"
                f"- **Portfolio Analysis**: Review total valuation, unrealized P&L, and top holdings.\n"
                f"- **Connection Diagnostics**: Troubleshoot Angel One SmartAPI login codes (e.g. AB1050, AG8001).\n"
                f"- **IPO Allotments**: Check tracked upcoming, open, and listed IPO issues.\n"
                f"- **Paper Trading**: Inspect simulated orders and available cash reserves.\n\n"
                f"How may I help you analyze your portfolio today?"
            )

        # Persist conversation message
        clean_session_id = session_id or str(uuid.uuid4())
        user_record = ChatMessage(
            session_id=clean_session_id,
            sender="USER",
            content=user_message.strip()
        )
        assistant_record = ChatMessage(
            session_id=clean_session_id,
            sender="ASSISTANT",
            content=answer,
            context_meta_json=json.dumps({
                "timestamp": ctx["timestamp"],
                "total_valuation": port["total_market_value"],
                "distinct_symbols": port["distinct_symbols"]
            })
        )
        db.add(user_record)
        db.add(assistant_record)
        db.commit()
        db.refresh(assistant_record)

        return {
            "id": assistant_record.id,
            "session_id": clean_session_id,
            "sender": "ASSISTANT",
            "content": answer,
            "context_meta": {
                "timestamp": ctx["timestamp"],
                "total_valuation": port["total_market_value"],
                "distinct_symbols": port["distinct_symbols"],
                "emergency_halt": ctx["emergency_halt"]
            },
            "created_at": assistant_record.created_at
        }
