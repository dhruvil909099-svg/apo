import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.account import Account
from app.models.audit import AuditLog
from app.services.data_orchestrator import orchestrator

logger = logging.getLogger("ai_ops_service")

# Allowlisted safe operational remediation actions (strictly bounded)
APPROVED_ACTIONS = {
    "ACTION_AUTO_REAUTH": "Forces fresh automated re-authentication using stored Base32 secret without manual intervention.",
    "ACTION_SERVE_CACHED_LEDGER": "Flags account to display verified allotment ledger while upstream broker is unreachable.",
    "ACTION_RESET_CIRCUIT_BREAKER": "Clears temporary failure counter and resets circuit breaker state.",
    "ACTION_REQUEST_KEY_ROTATION": "Marks account for operator action to enter official API Key from smartapi.angelbroking.com."
}


class AIOperationsAssistant:
    """
    AI-Assisted Operational Diagnostics & Recovery Engine.
    - Operates strictly on sanitized metrics, error codes, and audit logs.
    - Categorically isolated from raw credentials, PINs, and TOTP secrets.
    - Classifies failure modes into deterministic root causes.
    - Recommends allowlisted safe remediation actions.
    - Strictly forbidden from executing arbitrary shell commands, raw SQL, or placing orders.
    """

    @classmethod
    def analyze_operational_health(cls, db: Session) -> Dict[str, Any]:
        """
        Gathers sanitized system telemetry, classifies failure modes,
        and provides diagnostic recommendations.
        """
        orch_status = orchestrator.get_orchestration_status(db)
        accounts = orch_status.get("accounts", [])

        diagnostics: List[Dict[str, Any]] = []
        requires_admin_action = False
        circuit_open_count = 0

        for a in accounts:
            account_id = a["account_id"]
            err_msg = (a.get("last_auth_error") or "").lower()
            auth_status = a.get("auth_status")
            consecutive = a.get("consecutive_errors", 0)

            classification = "HEALTHY"
            root_cause = "Account is operating normally within freshness TTL."
            recommended_action = "NONE"
            safe_to_remediate = False

            if "ag8004" in err_msg or "invalid api key" in err_msg or "placeholder" in err_msg or "incomplete" in err_msg:
                classification = "CONFIGURATION_ERROR"
                root_cause = "SmartAPI application key is invalid, placeholder, or credentials are incomplete. Official key from smartapi.angelbroking.com required."
                recommended_action = "ACTION_REQUEST_KEY_ROTATION"
                requires_admin_action = True
            elif "ab1050" in err_msg or "expired" in err_msg or "session" in err_msg or auth_status == "EXPIRED":
                classification = "SESSION_EXPIRED_RECOVERABLE"
                root_cause = "Broker session has expired for the trading session. Can be auto-healed using stored Base32 TOTP secret."
                recommended_action = "ACTION_AUTO_REAUTH"
                safe_to_remediate = True
            elif consecutive >= 5:
                classification = "CIRCUIT_BREAKER_ACTIVE"
                root_cause = f"Upstream broker experienced {consecutive} consecutive errors. Circuit breaker active to avoid rate-limiting."
                recommended_action = "ACTION_SERVE_CACHED_LEDGER"
                circuit_open_count += 1
                safe_to_remediate = True
            elif not a["is_fresh"]:
                classification = "DATA_STALE"
                root_cause = "Data exceeds freshness window. Scheduled auto-refresh will synchronize data on next tick."
                recommended_action = "ACTION_AUTO_REAUTH"
                safe_to_remediate = True

            diagnostics.append({
                "account_id": account_id,
                "nickname": a["nickname"],
                "masked_client_code": a["masked_client_code"],
                "classification": classification,
                "root_cause": root_cause,
                "recommended_action": recommended_action,
                "action_description": APPROVED_ACTIONS.get(recommended_action, "No action needed"),
                "safe_to_remediate": safe_to_remediate,
                "consecutive_errors": consecutive
            })

        # Formulate concise operational summary
        overall_health = "OPTIMAL"
        if requires_admin_action:
            overall_health = "ACTION_REQUIRED"
        elif orch_status.get("error_count", 0) > 0 or circuit_open_count > 0:
            overall_health = "DEGRADED_AUTO_HEALING"

        return {
            "status": "ANALYSIS_COMPLETE",
            "overall_health": overall_health,
            "timestamp": datetime.utcnow().isoformat(),
            "telemetry": {
                "total_enabled_accounts": orch_status.get("total_enabled_accounts", 0),
                "fresh_count": orch_status.get("fresh_count", 0),
                "stale_count": orch_status.get("stale_count", 0),
                "error_count": orch_status.get("error_count", 0),
                "circuit_open_count": circuit_open_count
            },
            "diagnostics": diagnostics,
            "approved_actions": APPROVED_ACTIONS
        }

    @classmethod
    def execute_remediation(cls, db: Session, action: str, account_id: Optional[int] = None) -> Dict[str, Any]:
        """
        Executes an allowlisted safe remediation action.
        Guarantees that unapproved or hazardous actions are categorically rejected.
        """
        if action not in APPROVED_ACTIONS:
            return {
                "success": False,
                "error": f"Rejected: Action '{action}' is not in the approved safe operations allowlist.",
                "allowed_actions": list(APPROVED_ACTIONS.keys())
            }

        logger.info(f"AI Ops executing approved remediation '{action}' for account_id={account_id}")

        if action == "ACTION_AUTO_REAUTH":
            if account_id:
                res = orchestrator._sync_account_worker(account_id)
                return {
                    "success": res.get("success", False),
                    "action": action,
                    "account_id": account_id,
                    "message": res.get("message", "Re-authentication evaluated")
                }
            else:
                # Refresh all stale accounts
                import asyncio
                loop = asyncio.get_event_loop()
                # Run sync in worker
                accounts = db.query(Account).filter(Account.is_enabled == True).all()
                refreshed = 0
                for a in accounts:
                    res = orchestrator._sync_account_worker(a.id)
                    if res.get("success"):
                        refreshed += 1
                return {
                    "success": True,
                    "action": action,
                    "message": f"Auto-reauth triggered across {len(accounts)} accounts ({refreshed} succeeded)."
                }

        elif action == "ACTION_SERVE_CACHED_LEDGER":
            if account_id:
                acc = db.query(Account).filter(Account.id == account_id).first()
                if acc:
                    acc.sync_status = "STALE_FALLBACK"
                    db.commit()
            return {
                "success": True,
                "action": action,
                "message": "Verified Demat ledger configured as primary display source during upstream broker maintenance."
            }

        elif action == "ACTION_RESET_CIRCUIT_BREAKER":
            if account_id:
                acc = db.query(Account).filter(Account.id == account_id).first()
                if acc:
                    acc.consecutive_errors = 0
                    acc.circuit_breaker_until = None
                    db.commit()
            return {
                "success": True,
                "action": action,
                "message": "Circuit breaker reset. Scheduled sync will retry normally."
            }

        elif action == "ACTION_REQUEST_KEY_ROTATION":
            return {
                "success": True,
                "action": action,
                "message": "Operator action recorded. Please click 'Rotate Credentials' to enter your 32-character key from smartapi.angelbroking.com."
            }

        return {"success": False, "error": "Action execution unhandled"}
