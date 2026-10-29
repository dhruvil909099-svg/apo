"""
Market Stream Engine
Provides live, sub-second market data streaming from Angel One SmartAPI to frontend WebSocket clients.
Continuously streams real-time ticks, LTP, Day P&L, and 5-depth market order book for all portfolio
holdings and active watchlists.
"""

import asyncio
import logging
from datetime import datetime
from typing import Dict, Any, List, Set, Optional

from app.core.database import SessionLocal
from app.models.account import Account
from app.models.holding import AccountHoldingSnapshot
from app.core.security import cipher
from app.services.smartapi_adapter import get_adapter_for_account
from app.api.endpoints_market import market_feed_manager
from app.services.smartapi_websocket import smartapi_ws_service

logger = logging.getLogger("market_stream_engine")


class MarketStreamEngine:
    def __init__(self):
        self._is_running = False
        self._task: Optional[asyncio.Task] = None
        self._subscribed_tokens: Set[str] = set()
        self._poll_interval = 1.0  # 1-second live streaming cadence

    def register_token(self, token: str):
        if token and str(token).strip() != "0":
            self._subscribed_tokens.add(str(token).strip())

    def start(self):
        if self._is_running:
            return
        self._is_running = True
        self._task = asyncio.create_task(self._stream_loop())
        logger.info("MarketStreamEngine started.")

    def stop(self):
        self._is_running = False
        if self._task and not self._task.done():
            self._task.cancel()
        logger.info("MarketStreamEngine stopped.")

    async def _stream_loop(self):
        logger.info("MarketStreamEngine loop active.")
        while self._is_running:
            try:
                # Only poll upstream when at least one frontend WebSocket is listening
                if not market_feed_manager.active_connections:
                    await asyncio.sleep(2.0)
                    continue

                # Query active tokens and live account credentials from DB
                tokens, live_acc = await asyncio.to_thread(self._get_tokens_and_live_account)
                
                # Combine with any manually registered tokens
                all_tokens = list(set(tokens) | self._subscribed_tokens)

                if not all_tokens or not live_acc:
                    await asyncio.sleep(2.0)
                    continue

                # Fetch live batch quotes from Angel One SmartAPI
                quotes_data = await asyncio.to_thread(self._fetch_quotes, live_acc, all_tokens)
                
                if quotes_data and quotes_data.get("fetched"):
                    for q in quotes_data["fetched"]:
                        raw_sym = str(q.get("trading_symbol", q.get("symbol", "")))
                        clean_sym = raw_sym.replace("-EQ", "").strip().upper()
                        ltp = float(q.get("ltp", 0.0))
                        close = float(q.get("close", ltp))
                        chg = round(ltp - close, 2)
                        chg_pct = round((chg / close) * 100, 2) if close > 0 else 0.0
                        now_ts = datetime.utcnow().isoformat()

                        tick_msg = {
                            "type": "TICK",
                            "symbol": clean_sym,
                            "trading_symbol": raw_sym,
                            "symbol_token": str(q.get("symbol_token", "")),
                            "exchange": q.get("exchange", "NSE"),
                            "ltp": ltp,
                            "previous_close": close,
                            "change": chg,
                            "change_percent": chg_pct,
                            "open": float(q.get("open", ltp)),
                            "high": float(q.get("high", ltp)),
                            "low": float(q.get("low", ltp)),
                            "volume": int(q.get("volume", 0)),
                            "depth": q.get("depth", {}),
                            "timestamp": now_ts,
                            "is_live": True,
                            "data_source": "ANGEL_ONE_SMARTAPI_LIVE"
                        }

                        # Store in in-memory cache for fast REST responses
                        smartapi_ws_service._last_ticks[clean_sym] = tick_msg

                        # Broadcast live tick to all connected frontend WebSockets
                        await market_feed_manager.broadcast(tick_msg)

                await asyncio.sleep(self._poll_interval)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"MarketStreamEngine loop exception: {e}")
                await asyncio.sleep(2.0)

    @staticmethod
    def _get_tokens_and_live_account():
        db = SessionLocal()
        try:
            # Get tokens from holding snapshots
            tokens = [
                s.symbol_token for s in db.query(AccountHoldingSnapshot).filter(
                    AccountHoldingSnapshot.quantity > 0
                ).all() if s.symbol_token and s.symbol_token != "0"
            ]

            # Find connected live Angel One account
            acc = db.query(Account).filter(
                Account.is_enabled == True,
                Account.is_demo == False,
                Account.auth_status == "CONNECTED"
            ).first()

            if not acc:
                return tokens, None

            raw_key = cipher.decrypt(acc.encrypted_api_key)
            raw_pin = cipher.decrypt(acc.encrypted_pin)
            raw_totp = cipher.decrypt(acc.encrypted_totp_secret)

            return tokens, {
                "id": acc.id,
                "client_code": acc.client_code,
                "api_key": raw_key,
                "pin": raw_pin,
                "totp": raw_totp
            }
        except Exception as e:
            logger.error(f"Error fetching tokens or credentials: {e}")
            return [], None
        finally:
            db.close()

    @staticmethod
    def _fetch_quotes(acc_info: Dict[str, Any], tokens: List[str]) -> Dict[str, Any]:
        try:
            adapter = get_adapter_for_account(
                acc_info["id"],
                acc_info["api_key"],
                acc_info["client_code"],
                acc_info["pin"],
                acc_info["totp"]
            )
            return adapter.get_market_quotes_batch({"NSE": tokens}, mode="FULL")
        except Exception as e:
            logger.warning(f"Upstream quote fetch error: {e}")
            return {"fetched": []}


market_stream_engine = MarketStreamEngine()
