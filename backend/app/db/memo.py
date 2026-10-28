"""Replay-scoped memo for values that only the current thread changes while it runs: the seed replay (Phase 9).

Outside `session()` nothing is cached and every read goes to the database (CLAUDE.md rule 11 is unchanged for
normal requests). Inside, the rules are read once and the app clock lives in memory: the replay is the only writer
of both (the reset holds the evaluation lock and refuses a concurrent reset), and it writes the clock row for real
once it leaves the session. A ContextVar keeps the memo private to the thread running the replay.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar

_memo: ContextVar[dict[str, object] | None] = ContextVar("fdr_replay_memo", default=None)


@contextmanager
def session() -> Iterator[None]:
    token = _memo.set({})
    try:
        yield
    finally:
        _memo.reset(token)


def active() -> dict[str, object] | None:
    """The current memo, or None outside a session."""
    return _memo.get()
