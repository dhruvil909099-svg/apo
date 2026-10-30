import time
import threading
from typing import Any, Optional, Dict, Tuple, Set


class InMemoryCache:
    """
    High-performance thread-safe in-memory cache with TTL support and tag-based invalidation.
    Designed to eliminate remote database roundtrip latency for read-heavy API operations.
    """
    def __init__(self, default_ttl: float = 15.0):
        self._default_ttl = default_ttl
        self._store: Dict[str, Tuple[Any, float]] = {}  # key -> (value, expiry_time)
        self._tags: Dict[str, Set[str]] = {}            # tag -> set of keys
        self._lock = threading.RLock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            val, expiry = entry
            if time.time() > expiry:
                self._delete_key_internal(key)
                return None
            return val

    def set(self, key: str, value: Any, ttl: Optional[float] = None, tag: Optional[str] = None) -> None:
        actual_ttl = ttl if ttl is not None else self._default_ttl
        expiry = time.time() + actual_ttl
        with self._lock:
            self._store[key] = (value, expiry)
            if tag:
                if tag not in self._tags:
                    self._tags[tag] = set()
                self._tags[tag].add(key)

    def delete(self, key: str) -> None:
        with self._lock:
            self._delete_key_internal(key)

    def invalidate_tag(self, tag: str) -> int:
        """Invalidates all cache keys associated with a specific tag (e.g., 'accounts', 'orders', 'summary')."""
        with self._lock:
            keys = self._tags.pop(tag, set())
            for k in keys:
                self._store.pop(k, None)
            return len(keys)

    def clear(self) -> None:
        with self._lock:
            self._store.clear()
            self._tags.clear()

    def _delete_key_internal(self, key: str) -> None:
        self._store.pop(key, None)
        for tag_keys in self._tags.values():
            tag_keys.discard(key)


# Global singleton cache instance
app_cache = InMemoryCache(default_ttl=15.0)
