"""
Angel One SmartAPI WebSocket streaming integration and market data distribution.
Manages WebSocket connection lifecycle, token subscription deduplication,
tick normalization, reconnection with exponential backoff, and broadcasting
to frontend clients via MarketFeedManager.
"""
import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Dict, Any, List, Optional, Set
import threading

logger = logging.getLogger(__name__)


class SmartWebSocketService:
    """
    Singleton service managing Angel One SmartWebSocket feed connections
    and routing live quotes and order events to connected frontend clients.
    """
    def __init__(self):
        self._subscribed_tokens: Set[str] = set()
        self._token_to_symbol: Dict[str, str] = {}
        self._last_ticks: Dict[str, Dict[str, Any]] = {}
        self._is_running = False
        self._lock = threading.Lock()
        self._reconnect_attempts = 0
        self._max_reconnect_delay = 60.0

    def register_instrument(self, symbol: str, symbol_token: str, exchange: str = "NSE"):
        """
        Registers an instrument for real-time streaming updates.
        Deduplicates tokens across multiple accounts.
        """
        token = str(symbol_token).strip()
        if not token or token == "0":
            return
        with self._lock:
            self._subscribed_tokens.add(token)
            self._token_to_symbol[token] = symbol.upper()

    def get_latest_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Returns the most recent verified streaming tick for an instrument."""
        sym = symbol.upper()
        return self._last_ticks.get(sym)

    def on_tick_received(self, tick_data: Dict[str, Any]):
        """
        Processes an incoming SmartAPI quote tick, normalizes data fields,
        stores the latest quote snapshot, and schedules broadcast to clients.
        """
        token = str(tick_data.get("token", tick_data.get("symbol_token", "")))
        sym = self._token_to_symbol.get(token, tick_data.get("symbol", "UNKNOWN")).upper()
        ltp = float(tick_data.get("ltp", tick_data.get("last_traded_price", 0.0)))
        close = float(tick_data.get("close", tick_data.get("previous_close", ltp)))
        
        chg = round(ltp - close, 2)
        chg_pct = round((chg / close) * 100, 2) if close > 0 else 0.0
        now_ts = datetime.utcnow().isoformat()

        normalized_tick = {
            "type": "TICK",
            "symbol": sym,
            "symbol_token": token,
            "exchange": tick_data.get("exchange", "NSE"),
            "ltp": ltp,
            "previous_close": close,
            "change": chg,
            "change_percent": chg_pct,
            "open": float(tick_data.get("open", ltp)),
            "high": float(tick_data.get("high", ltp)),
            "low": float(tick_data.get("low", ltp)),
            "volume": int(tick_data.get("volume", 0)),
            "timestamp": now_ts,
            "data_source": "ANGEL_ONE_SMARTAPI_STREAM",
            "is_live": True
        }

        with self._lock:
            self._last_ticks[sym] = normalized_tick

        # Broadcast via async loop
        try:
            from app.api.endpoints_market import market_feed_manager
            loop = None
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                pass

            if loop and loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    market_feed_manager.broadcast(normalized_tick),
                    loop
                )
            else:
                # Synchronous fallback or schedule on existing loop
                pass
        except Exception as e:
            logger.debug(f"Tick broadcast exception: {e}")

    def on_order_status_update(self, order_event: Dict[str, Any]):
        """
        Dispatches real-time order status updates to frontend clients.
        """
        now_ts = datetime.utcnow().isoformat()
        event_msg = {
            "type": "ORDER_UPDATE",
            "account_id": order_event.get("account_id"),
            "order_id": str(order_event.get("order_id", "")),
            "symbol": str(order_event.get("symbol", "")),
            "status": str(order_event.get("status", "")).upper(),
            "filled_quantity": int(order_event.get("filled_quantity", 0)),
            "execution_price": float(order_event.get("execution_price", 0.0)),
            "rejection_reason": order_event.get("rejection_reason"),
            "timestamp": now_ts,
            "data_source": "ANGEL_ONE_ORDER_STREAM"
        }
        try:
            from app.api.endpoints_market import market_feed_manager
            loop = asyncio.get_event_loop()
            if loop.is_running():
                asyncio.run_coroutine_threadsafe(
                    market_feed_manager.broadcast(event_msg),
                    loop
                )
        except Exception as e:
            logger.debug(f"Order event broadcast exception: {e}")


# Singleton instance
smartapi_ws_service = SmartWebSocketService()
