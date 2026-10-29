from datetime import datetime
from typing import Optional, Dict, Any


def make_financial_amount(
    value: Optional[float],
    source: str,
    is_estimate: bool = False,
    verified: bool = False,
    error: Optional[str] = None,
    as_of: Optional[str] = None
) -> Dict[str, Any]:
    """
    Standard Financial Amount Model for IPOPro.
    Ensures every broker-dependent number carries explicit provenance,
    verification status, and error attribution.

    Permitted sources:
    - BROKER_QUOTE
    - BROKER_MARGIN_ESTIMATE
    - BROKER_CHARGES_ESTIMATE
    - USER_INPUT
    - DERIVED_FROM_VERIFIED_INPUTS
    - UNAVAILABLE
    """
    valid_sources = {
        "BROKER_QUOTE",
        "BROKER_MARGIN_ESTIMATE",
        "BROKER_CHARGES_ESTIMATE",
        "BROKER_ESTIMATE",
        "BROKER_VERIFIED",
        "SMARTAPI_RMS",
        "USER_INPUT",
        "CALCULATED",
        "DERIVED_FROM_VERIFIED_INPUTS",
        "UNAVAILABLE",
        "STALE",
        "NOT_PROVIDED",
        "INDICATIVE_REGULATORY_SCHEDULE",
        "INDICATIVE_STATUTORY_SCHEDULE"
    }

    norm_source = source if source in valid_sources else "UNAVAILABLE"

    # Normalize value: None if unavailable/error, or float rounded to 2-4 decimal places
    clean_val = None
    if value is not None:
        try:
            clean_val = round(float(value), 4) if abs(float(value)) < 1 else round(float(value), 2)
        except (ValueError, TypeError):
            clean_val = None

    return {
        "value": clean_val,
        "source": norm_source,
        "as_of": as_of or datetime.utcnow().isoformat(),
        "is_estimate": is_estimate,
        "verified": verified,
        "error": error
    }
