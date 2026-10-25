"""Real-clock scheduling (§4.4): evaluate at start-up and daily at 06:00 IST, only while the clock mode is REAL.
With a simulated clock the job runs from the clock endpoints instead."""

from __future__ import annotations

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger

from ..db.pool import get_pool, transaction
from ..domain import clock
from .evaluate import evaluate

log = logging.getLogger("fdr.scheduler")


def run_if_real() -> None:
    if clock.mode(get_pool()) != "REAL":
        log.info("evaluation skipped: the app clock is simulated")
        return
    with transaction() as tx:
        summary = evaluate(tx, clock.today(tx))
    log.info("evaluation done: %s", summary)


def start_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=clock.IST)
    scheduler.add_job(run_if_real, id="evaluate-startup")  # once, right away
    scheduler.add_job(
        run_if_real, CronTrigger(hour=6, minute=0, timezone=clock.IST), id="evaluate-daily", coalesce=True
    )
    scheduler.start()
    return scheduler
