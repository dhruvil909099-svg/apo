import re
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta
import requests
from app.services.ipo_providers.base import BaseIPOProvider

logger = logging.getLogger("nse_provider")


def parse_indian_date(date_str: Optional[str]) -> Optional[str]:
    """
    Parses dates in exchange formats (e.g., '29-Oct-2026', '02-Nov-2026', '2026-10-29')
    into standardized ISO string 'YYYY-MM-DD'.
    """
    if not date_str or not isinstance(date_str, str):
        return None
    cleaned = date_str.strip()
    if not cleaned or cleaned.upper() in ["NA", "N/A", "TBD", "TO BE ANNOUNCED"]:
        return None

    formats = ["%d-%b-%Y", "%d-%B-%Y", "%Y-%m-%d", "%d/%m/%Y"]
    for fmt in formats:
        try:
            return datetime.strptime(cleaned, fmt).strftime("%Y-%m-%d")
        except Exception:
            continue
    return None


def parse_price_range(price_str: Optional[str]) -> tuple[Optional[float], Optional[float], float]:
    """
    Extracts min_price, max_price, and effective issue_price from exchange strings:
    - 'Rs.78 to Rs.82' -> (78.0, 82.0, 82.0)
    - 'Rs. 78/- to Rs. 82/- per Equity Share' -> (78.0, 82.0, 82.0)
    - '150' -> (150.0, 150.0, 150.0)
    """
    if not price_str or not isinstance(price_str, str):
        return None, None, 0.0

    numbers = re.findall(r"\d+(?:\.\d+)?", price_str.replace(",", ""))
    if not numbers:
        return None, None, 0.0

    floats = [float(n) for n in numbers]
    if len(floats) >= 2:
        min_p = min(floats[0], floats[1])
        max_p = max(floats[0], floats[1])
        return min_p, max_p, max_p
    elif len(floats) == 1:
        return floats[0], floats[0], floats[0]
    return None, None, 0.0


def parse_lot_size(lot_str: Optional[str]) -> int:
    """
    Extracts integer lot size from strings like '182 Equity Shares and in multiples thereof'.
    Defaults to 1 if unavailable.
    """
    if not lot_str:
        return 1
    match = re.search(r"(\d+)", str(lot_str).replace(",", ""))
    if match:
        try:
            val = int(match.group(1))
            return val if val > 0 else 1
        except Exception:
            return 1
    return 1


class NSEExchangeProvider(BaseIPOProvider):
    """
    Live data provider pulling authentic, traceable primary market feeds
    directly from the National Stock Exchange of India (NSE).
    """
    BASE_URL = "https://www.nseindia.com"
    API_CURRENT = "https://www.nseindia.com/api/ipo-current-issue"
    API_UPCOMING = "https://www.nseindia.com/api/all-upcoming-issues?category=ipo"
    API_DETAIL = "https://www.nseindia.com/api/ipo-detail"

    def __init__(self):
        self.session = requests.Session()
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Referer": "https://www.nseindia.com/market-data/all-upcoming-issues-ipo",
        }
        self.session.headers.update(self.headers)
        self._last_cookie_refresh = 0

    def get_provider_name(self) -> str:
        return "NSE_INDIA_OFFICIAL_FEED"

    def _ensure_session(self):
        """Initializes cookies from NSE homepage if expired or missing."""
        try:
            self.session.get(f"{self.BASE_URL}/", timeout=8)
        except Exception as e:
            logger.warning(f"Could not refresh NSE session cookies: {e}")

    def fetch_current_issues(self) -> List[Dict[str, Any]]:
        """Fetches active, live issues currently open on the exchange."""
        try:
            resp = self.session.get(self.API_CURRENT, timeout=10)
            if resp.status_code == 403 or resp.status_code == 401:
                self._ensure_session()
                resp = self.session.get(self.API_CURRENT, timeout=10)

            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
        except Exception as e:
            logger.error(f"Error fetching current issues from NSE: {e}")
        return []

    def fetch_upcoming_issues(self) -> List[Dict[str, Any]]:
        """Fetches upcoming / forthcoming issues announced on the exchange."""
        try:
            resp = self.session.get(self.API_UPCOMING, timeout=10)
            if resp.status_code == 403 or resp.status_code == 401:
                self._ensure_session()
                resp = self.session.get(self.API_UPCOMING, timeout=10)

            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list):
                    return data
        except Exception as e:
            logger.error(f"Error fetching upcoming issues from NSE: {e}")
        return []

    def fetch_issue_details(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Fetches detailed prospectuses, lot limits, registrar, and BRLM disclosures."""
        if not symbol:
            return None
        try:
            url = f"{self.API_DETAIL}?symbol={symbol.strip()}"
            resp = self.session.get(url, timeout=10)
            if resp.status_code == 200:
                return resp.json()
        except Exception as e:
            logger.warning(f"Failed to fetch details for {symbol}: {e}")
        return None

    def fetch_all_normalized(self) -> List[Dict[str, Any]]:
        """
        Retrieves all issues (Active, Forthcoming, and Closed) from NSE,
        enriches with detailed metadata, and maps into normalized records.
        """
        all_raw_issues: Dict[str, Dict[str, Any]] = {}

        # 1. Fetch current issues
        current_list = self.fetch_current_issues()
        for item in current_list:
            sym = item.get("symbol")
            if sym:
                all_raw_issues[sym.upper()] = {**item, "_source_type": "CURRENT"}

        # 2. Fetch upcoming issues
        upcoming_list = self.fetch_upcoming_issues()
        for item in upcoming_list:
            sym = item.get("symbol")
            if sym:
                existing = all_raw_issues.get(sym.upper(), {})
                all_raw_issues[sym.upper()] = {**item, **existing, "_source_type": existing.get("_source_type", "UPCOMING")}

        normalized_records: List[Dict[str, Any]] = []

        for symbol, raw in all_raw_issues.items():
            try:
                # Fetch detailed metadata (RHP links, Lot size, Registrar)
                details = self.fetch_issue_details(symbol) or {}
                issue_info_list = details.get("issueInfo", {}).get("dataList", [])
                info_map: Dict[str, str] = {}
                for entry in issue_info_list:
                    t = entry.get("title")
                    v = entry.get("value")
                    if t and v:
                        info_map[t.strip()] = str(v).strip().strip('"')

                # Determine SME vs Mainboard
                series = raw.get("series", "").upper()
                is_sme = (series == "SME" or series == "SM")

                # Parse dates
                start_date = parse_indian_date(raw.get("issueStartDate"))
                end_date = parse_indian_date(raw.get("issueEndDate"))

                # Parse prices
                raw_price = raw.get("issuePrice") or info_map.get("Price Range")
                min_p, max_p, issue_p = parse_price_range(raw_price)

                # Parse Lot size
                lot_size = parse_lot_size(info_map.get("Bid Lot") or info_map.get("Minimum Order Quantity") or "1")

                # Minimum investment calculation
                min_investment = round(lot_size * (max_p or issue_p or 0.0), 2) if (max_p or issue_p) else None

                # Subscription Multiple
                sub_rate_raw = raw.get("noOfTime")
                subscription_rate = None
                if sub_rate_raw and sub_rate_raw != "0.00":
                    try:
                        sub_val = float(sub_rate_raw)
                        subscription_rate = f"{sub_val:.2f}x"
                    except Exception:
                        subscription_rate = f"{sub_rate_raw}x"

                # Lifecycle Status
                raw_status = (raw.get("status") or "").upper()
                ist_offset = timezone(timedelta(hours=5, minutes=30))
                today_ist = datetime.now(ist_offset).date()

                if raw_status == "CLOSED":
                    lifecycle_status = "CLOSED"
                elif raw_status == "FORTHCOMING":
                    lifecycle_status = "UPCOMING"
                elif raw_status == "ACTIVE":
                    lifecycle_status = "OPEN"
                else:
                    # Date-based fallback
                    d_start = datetime.strptime(start_date, "%Y-%m-%d").date() if start_date else None
                    d_end = datetime.strptime(end_date, "%Y-%m-%d").date() if end_date else None
                    if d_start and d_end:
                        if d_start <= today_ist <= d_end:
                            lifecycle_status = "OPEN"
                        elif today_ist < d_start:
                            lifecycle_status = "UPCOMING"
                        else:
                            lifecycle_status = "CLOSED"
                    else:
                        lifecycle_status = "UPCOMING"

                # Extract verified documents
                rhp_url = info_map.get("Red Herring Prospectus")
                if rhp_url and not rhp_url.startswith("http"):
                    rhp_url = None

                registrar_name = info_map.get("Name of the Registrar")
                lead_managers = info_map.get("Book Running Lead Managers")

                # Issue Size
                issue_size = info_map.get("Issue Size") or raw.get("issueSize")
                if issue_size and issue_size.isdigit():
                    # Format share count to crores if raw count
                    shares_cnt = int(issue_size)
                    issue_size = f"{shares_cnt:,} Shares"

                record: Dict[str, Any] = {
                    "symbol": symbol,
                    "company_name": raw.get("companyName") or symbol,
                    "exchange": "NSE",
                    "issue_price": issue_p,
                    "min_price": min_p,
                    "max_price": max_p,
                    "lot_size": lot_size,
                    "min_investment": min_investment,
                    "issue_size": issue_size,
                    "bidding_start_date": start_date,
                    "bidding_end_date": end_date,
                    "allotment_date": None,  # Confirmed on allotment day by registrar
                    "listing_date": None,    # Confirmed on listing notice
                    "is_sme": is_sme,
                    "status": lifecycle_status,
                    "subscription_rate": subscription_rate,
                    "registrar_name": registrar_name,
                    "lead_managers": lead_managers,
                    "rhp_url": rhp_url,
                    "source_name": self.get_provider_name(),
                    "source_document_url": "https://www.nseindia.com/market-data/all-upcoming-issues-ipo",
                    "data_quality_status": "VERIFIED",
                    "source_timestamp": datetime.utcnow(),
                    "last_sync_at": datetime.utcnow(),
                }
                normalized_records.append(record)
            except Exception as item_err:
                logger.warning(f"Error normalizing issue {symbol}: {item_err}")
                continue

        logger.info(f"NSE Provider normalized {len(normalized_records)} real IPO issues from live feed.")
        return normalized_records
