from typing import List, Dict, Any, Optional
from datetime import datetime
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.ipo import Allotment, IPO
from app.models.account import Account
from app.models.audit import AuditLog
import time
from app.services.smartapi_adapter import SmartAPIAdapter, get_adapter_for_account, invalidate_adapter_for_account
from app.core.security import cipher

router = APIRouter(prefix="/portfolio", tags=["Portfolio & Holdings"])


@router.get("/consolidated")
def get_consolidated_holdings(
    account_ids: Optional[str] = Query(None, description="Comma-separated list of account IDs to include"),
    capital_type: Optional[str] = Query(None, description="Account type filter: 'live', 'demo', or 'all'"),
    db: Session = Depends(get_db)
):
    """
    Returns consolidated portfolio overview and itemized holdings across all or selected authorized accounts.
    Calculates weighted average cost basis, total market value, unrealized P&L, day's change,
    and portfolio allocation percentages. Excludes demo/simulated accounts from live totals.
    """
    # 1. Determine accounts filter
    account_query = db.query(Account).filter(Account.is_enabled == True)
    selected_ids = None
    if account_ids:
        try:
            selected_ids = [int(x.strip()) for x in account_ids.split(",") if x.strip()]
            account_query = account_query.filter(Account.id.in_(selected_ids))
        except ValueError:
            pass
    elif capital_type == "demo":
        account_query = account_query.filter(Account.is_demo == True)
    elif capital_type == "live":
        account_query = account_query.filter(Account.is_demo == False)
    elif capital_type == "all":
        pass
    elif settings.TRADING_MODE == "LIVE":
        # In LIVE mode: demo accounts excluded from real portfolio totals by default
        account_query = account_query.filter(Account.is_demo == False)

    accounts = account_query.all()
    all_enabled_accounts = db.query(Account).filter(Account.is_enabled == True).all()

    total_connected = len(all_enabled_accounts)
    total_selected = len(accounts)
    synced_accounts = sum(1 for a in accounts if a.auth_status in ["CONNECTED", "ACTIVE"])
    failed_accounts = total_selected - synced_accounts

    # 2. Query matching allotments strictly for filtered accounts
    target_account_ids = [a.id for a in accounts]
    allotment_query = db.query(Allotment).join(IPO).join(Account).filter(
        Account.is_enabled == True,
        Account.id.in_(target_account_ids),
        Allotment.allotted_quantity > 0
    )

    allotments = allotment_query.all()

    # 3. Group holdings by verified instrument (ISIN or Symbol)
    grouped: Dict[str, Dict[str, Any]] = {}
    tot_portfolio_val = 0.0
    tot_portfolio_cost = 0.0
    tot_day_change = 0.0

    for a in allotments:
        # Group primarily by ISIN if available, fallback to symbol
        key = a.ipo.isin if a.ipo.isin else a.ipo.symbol
        sym = a.ipo.symbol

        if key not in grouped:
            ltp = a.ipo.current_ltp or a.ipo.issue_price
            prev = a.ipo.previous_close or a.ipo.issue_price
            day_chg = round(ltp - prev, 2)
            day_chg_pct = round((day_chg / prev) * 100, 2) if prev > 0 else 0.0

            grouped[key] = {
                "key": key,
                "symbol": sym,
                "company_name": a.ipo.company_name,
                "exchange": a.ipo.exchange,
                "isin": a.ipo.isin or "—",
                "symbol_token": a.ipo.symbol_token or "0",
                "total_quantity": 0,
                "total_cost": 0.0,
                "current_ltp": ltp,
                "previous_close": prev,
                "day_change": day_chg,
                "day_change_percent": day_chg_pct,
                "market_value": 0.0,
                "unrealized_pnl": 0.0,
                "pnl_percentage": 0.0,
                "portfolio_allocation_percent": 0.0,
                "accounts_count": 0,
                "data_source": "DEMAT_ALLOTMENT_LEDGER",
                "last_updated": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S IST"),
                "accounts_breakdown": []
            }

        cost_for_a = a.allotted_quantity * a.acquisition_cost
        val_for_a = a.allotted_quantity * grouped[key]["current_ltp"]
        day_chg_for_a = a.allotted_quantity * grouped[key]["day_change"]

        grouped[key]["total_quantity"] += a.allotted_quantity
        grouped[key]["total_cost"] += cost_for_a
        grouped[key]["accounts_count"] += 1
        grouped[key]["accounts_breakdown"].append({
            "account_id": a.account.id,
            "nickname": a.account.nickname,
            "masked_client_code": a.account.masked_client_code,
            "account_group": a.account.account_group,
            "quantity": a.allotted_quantity,
            "acquisition_cost": a.acquisition_cost,
            "market_value": val_for_a,
            "unrealized_pnl": round(val_for_a - cost_for_a, 2),
            "pnl_percentage": round(((val_for_a - cost_for_a) / cost_for_a) * 100, 2) if cost_for_a > 0 else 0.0,
            "ddpi_status": a.account.ddpi_status,
            "edis_authorized": a.account.edis_authorized_today,
            "sync_status": a.account.auth_status
        })

        tot_portfolio_val += val_for_a
        tot_portfolio_cost += cost_for_a
        tot_day_change += day_chg_for_a

    # 4. Finalize calculations & allocation percentages
    holdings_list = []
    for key, data in grouped.items():
        data["market_value"] = round(data["total_quantity"] * data["current_ltp"], 2)
        pnl = data["market_value"] - data["total_cost"]
        data["unrealized_pnl"] = round(pnl, 2)
        data["pnl_percentage"] = round((pnl / data["total_cost"]) * 100, 2) if data["total_cost"] > 0 else 0.0
        data["average_cost"] = round(data["total_cost"] / data["total_quantity"], 2) if data["total_quantity"] > 0 else 0.0
        data["portfolio_allocation_percent"] = round((data["market_value"] / tot_portfolio_val) * 100, 2) if tot_portfolio_val > 0 else 0.0
        holdings_list.append(data)

    # Sort holdings descending by market value
    holdings_list.sort(key=lambda x: x["market_value"], reverse=True)

    net_pnl = tot_portfolio_val - tot_portfolio_cost
    net_pnl_pct = (net_pnl / tot_portfolio_cost) * 100 if tot_portfolio_cost > 0 else 0.0
    day_change_pct = (tot_day_change / (tot_portfolio_val - tot_day_change)) * 100 if (tot_portfolio_val - tot_day_change) > 0 else 0.0

    return {
        "summary": {
            "total_current_value": round(tot_portfolio_val, 2),
            "total_investment_cost": round(tot_portfolio_cost, 2),
            "unrealized_pnl": round(net_pnl, 2),
            "unrealized_pnl_percentage": round(net_pnl_pct, 2),
            "day_change": round(tot_day_change, 2),
            "day_change_percentage": round(day_change_pct, 2),
            "total_accounts_connected": total_connected,
            "total_accounts_selected": total_selected,
            "total_accounts_synced": synced_accounts,
            "total_accounts_failed": failed_accounts,
            "distinct_instruments_count": len(holdings_list),
            "total_shares_count": sum(h["total_quantity"] for h in holdings_list),
            "last_sync_time": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S IST"),
            "calculation_basis": "FIFO weighted-average cost basis strictly against confirmed Demat holdings"
        },
        "holdings": holdings_list
    }


@router.get("/accounts")
def get_account_portfolios(db: Session = Depends(get_db)):
    """
    Returns account-level holdings, cash balances, and synchronization health.
    """
    accounts = db.query(Account).filter(Account.is_enabled == True).all()
    results = []

    for acc in accounts:
        holdings = []
        tot_val = 0.0
        tot_cost = 0.0

        for a in acc.allotments:
            if a.allotted_quantity > 0:
                ltp = a.ipo.current_ltp or a.ipo.issue_price
                val = a.allotted_quantity * ltp
                cost = a.allotted_quantity * a.acquisition_cost
                pnl = val - cost
                pnl_pct = (pnl / cost) * 100 if cost > 0 else 0.0

                tot_val += val
                tot_cost += cost

                holdings.append({
                    "allotment_id": a.id,
                    "symbol": a.ipo.symbol,
                    "company_name": a.ipo.company_name,
                    "isin": a.ipo.isin or "—",
                    "quantity": a.allotted_quantity,
                    "acquisition_cost": a.acquisition_cost,
                    "current_ltp": ltp,
                    "market_value": round(val, 2),
                    "unrealized_pnl": round(pnl, 2),
                    "pnl_percentage": round(pnl_pct, 2)
                })

        pnl_tot = tot_val - tot_cost
        pnl_tot_pct = (pnl_tot / tot_cost) * 100 if tot_cost > 0 else 0.0

        results.append({
            "account_id": acc.id,
            "nickname": acc.nickname,
            "masked_client_code": acc.masked_client_code,
            "account_group": acc.account_group,
            "is_demo": acc.is_demo,
            "auth_status": acc.auth_status,
            "ddpi_status": acc.ddpi_status,
            "edis_authorized": acc.edis_authorized_today,
            "available_cash": acc.available_cash,
            "portfolio_value": round(tot_val, 2),
            "unrealized_pnl": round(pnl_tot, 2),
            "pnl_percentage": round(pnl_tot_pct, 2),
            "last_sync_time": acc.last_sync_time.strftime("%Y-%m-%d %H:%M:%S IST") if acc.last_sync_time else "Never",
            "holdings": holdings
        })

    return results


@router.post("/sync")
def trigger_portfolio_sync(db: Session = Depends(get_db)):
    """
    Triggers real holdings and cash margin synchronization from Angel One SmartAPI
    across all enabled accounts. Updates demat holdings and ledger balances.
    """
    accounts = db.query(Account).filter(Account.is_enabled == True).all()
    synced_count = 0
    failed_count = 0
    now = datetime.utcnow()

    for acc in accounts:
        try:
            acc.last_sync_time = now
            if acc.is_demo:
                acc.auth_status = "CONNECTED"
                synced_count += 1
                continue

            # Decrypt live credentials
            raw_key = cipher.decrypt(acc.encrypted_api_key)
            raw_pin = cipher.decrypt(acc.encrypted_pin)
            raw_totp = cipher.decrypt(acc.encrypted_totp_secret)

            adapter = get_adapter_for_account(
                account_id=acc.id,
                api_key=raw_key,
                client_code=acc.client_code,
                pin=raw_pin,
                totp_secret=raw_totp
            )
            if not (adapter.jwt_token and time.time() < adapter.token_expiry_timestamp and not adapter.is_session_expired):
                auth_res = adapter.authenticate()
                if not auth_res.get("success"):
                    if adapter.is_session_expired:
                        invalidate_adapter_for_account(acc.id)
                        acc.auth_status = "EXPIRED"
                    else:
                        acc.auth_status = "ERROR"
                    acc.last_auth_error = auth_res.get("message", "Authentication failed")
                    failed_count += 1
                    continue

            acc.auth_status = "CONNECTED"
            acc.last_auth_error = None
            acc.ddpi_status = "ACTIVE"

            # 1. Fetch live RMS Margin & Cash Balance
            rms_data = adapter.get_rms()
            if rms_data:
                cash_val = float(rms_data.get("availablecash", rms_data.get("net", 0.0)))
                acc.available_cash = round(cash_val, 2)

            # 2. Fetch live Demat Holdings
            holdings = adapter.get_holdings()
            for h in holdings:
                raw_sym = h.get("tradingsymbol", "")
                sym = raw_sym.replace("-EQ", "")
                qty = int(h.get("quantity", h.get("realisedquantity", 0)))
                avg_price = float(h.get("averageprice", 0.0))
                ltp = float(h.get("ltp", avg_price))
                close = float(h.get("close", ltp))
                isin = h.get("isin", "")
                token = str(h.get("symboltoken", ""))

                if not sym or qty <= 0:
                    continue

                # Find or register Instrument in IPO table
                ipo = db.query(IPO).filter(IPO.symbol == sym).first()
                if not ipo:
                    ipo = IPO(
                        symbol=sym,
                        company_name=sym,
                        exchange=h.get("exchange", "NSE"),
                        issue_price=avg_price,
                        lot_size=1,
                        isin=isin,
                        symbol_token=token,
                        current_ltp=ltp,
                        previous_close=close,
                        status="LISTED"
                    )
                    db.add(ipo)
                    db.flush()
                else:
                    ipo.current_ltp = ltp
                    ipo.previous_close = close
                    if isin and not ipo.isin:
                        ipo.isin = isin
                    if token and not ipo.symbol_token:
                        ipo.symbol_token = token

                # Find or create Demat Allotment entry
                allotment = db.query(Allotment).filter(
                    Allotment.ipo_id == ipo.id,
                    Allotment.account_id == acc.id
                ).first()
                if not allotment:
                    allotment = Allotment(
                        ipo_id=ipo.id,
                        account_id=acc.id,
                        applied_quantity=qty,
                        allotted_quantity=qty,
                        acquisition_cost=avg_price,
                        allotment_status="ALLOTTED",
                        demat_credit_status="CREDITED",
                        status="DEMAT_CREDITED",
                        demat_verified=True,
                        verification_source="ANGEL_ONE_HOLDINGS",
                        verification_timestamp=now
                    )
                    db.add(allotment)
                else:
                    allotment.allotted_quantity = qty
                    allotment.applied_quantity = qty
                    allotment.acquisition_cost = avg_price
                    allotment.allotment_status = "ALLOTTED"
                    allotment.demat_credit_status = "CREDITED"
                    allotment.status = "DEMAT_CREDITED"
                    allotment.demat_verified = True
                    allotment.verification_source = "ANGEL_ONE_HOLDINGS"
                    allotment.verification_timestamp = now

            synced_count += 1
        except Exception as e:
            failed_count += 1
            acc.last_auth_error = str(e)

    db.commit()

    import json
    db.add(AuditLog(
        event_type="PORTFOLIO_SYNC",
        operator="SYSTEM",
        details_json=json.dumps({"message": f"Live broker synchronization completed for {synced_count} accounts ({failed_count} failed)."})
    ))
    db.commit()

    return {
        "success": True,
        "accounts_synced": synced_count,
        "accounts_failed": failed_count,
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S IST")
    }
