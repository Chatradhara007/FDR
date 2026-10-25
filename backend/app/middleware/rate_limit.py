"""In-memory fixed-window rate limiter (wall time: rate limiting is exempt from the app clock).

One instance per create_app(), so tests do not share attempt counts.
"""

from __future__ import annotations

import math
import threading
import time


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float) -> None:
        self.limit = limit
        self.window = window_seconds
        self._hits: dict[str, tuple[float, int]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> tuple[bool, dict[str, str]]:
        """Counts one attempt; returns (allowed, IETF draft-7 RateLimit headers)."""
        now = time.monotonic()
        with self._lock:
            start, count = self._hits.get(key, (now, 0))
            if now - start >= self.window:
                start, count = now, 0
            count += 1
            self._hits[key] = (start, count)
        reset = max(0, math.ceil(self.window - (now - start)))
        headers = {
            "RateLimit-Policy": f"{self.limit};w={int(self.window)}",
            "RateLimit": f"limit={self.limit}, remaining={max(0, self.limit - count)}, reset={reset}",
        }
        return count <= self.limit, headers
