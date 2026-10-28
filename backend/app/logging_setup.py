"""Logging for the API process and the startup script."""

from __future__ import annotations

import logging


def configure_logging() -> None:
    """The request log and startup warnings go to stderr (uvicorn configures only its own loggers)."""
    logger = logging.getLogger("fdr")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
