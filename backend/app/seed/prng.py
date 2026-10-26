"""mulberry32: a tiny seeded PRNG, so the demo dataset is the same on every run."""

from __future__ import annotations

from collections.abc import Sequence


class Mulberry32:
    def __init__(self, seed: int) -> None:
        self.state = seed & 0xFFFFFFFF

    def next(self) -> float:
        """Uniform in [0, 1), identical to the common JavaScript mulberry32."""
        self.state = (self.state + 0x6D2B79F5) & 0xFFFFFFFF
        t = self.state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    def int_between(self, lo: int, hi: int) -> int:
        """Integer in [lo, hi]."""
        return lo + int(self.next() * (hi - lo + 1))

    def choice[T](self, items: Sequence[T]) -> T:
        return items[int(self.next() * len(items))]
