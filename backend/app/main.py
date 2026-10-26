"""FastAPI app factory. `uvicorn app.main:app` serves the module-level instance."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import config
from .jobs.scheduler import start_scheduler
from .middleware.errors import RequestIdMiddleware, install_error_handlers
from .middleware.responses import ApiJSONResponse
from .middleware.security import SecurityMiddleware
from .routes import admin, alerts, audit, clock, demo, health, instruments, jobs, meta, releases, reporting, scrutiny
from .routes.auth import auth_router
from .security import check_startup_config


def _configure_logging() -> None:
    """The request log and startup warnings go to stderr (uvicorn configures only its own loggers)."""
    logger = logging.getLogger("fdr")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    scheduler = start_scheduler() if config.scheduler_enabled else None
    yield
    if scheduler is not None:
        scheduler.shutdown(wait=False)


def create_app(mount_test_routes: Callable[[APIRouter], None] | None = None) -> FastAPI:
    """`mount_test_routes` lets tests add throwaway routes under /api/v1. Refuses to build with weak secrets."""
    _configure_logging()
    check_startup_config()
    app = FastAPI(
        title="FDR Portal API",
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        default_response_class=ApiJSONResponse,
        lifespan=lifespan,
    )
    install_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.frontend_origins,
        allow_methods=["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE"],
        allow_headers=["*"],
        expose_headers=["X-Request-Id", "Content-Disposition"],
    )
    app.add_middleware(RequestIdMiddleware)
    app.add_middleware(SecurityMiddleware)  # outermost: headers on every response, including errors and preflights

    api = APIRouter()
    api.include_router(health.router)
    api.include_router(auth_router())
    api.include_router(clock.router)
    api.include_router(instruments.router)
    api.include_router(scrutiny.router)
    api.include_router(releases.router)
    api.include_router(meta.router)
    api.include_router(alerts.router)
    api.include_router(jobs.router)
    api.include_router(reporting.router)
    api.include_router(admin.router)
    api.include_router(audit.router)
    if config.demo_mode:
        api.include_router(demo.router)
    if mount_test_routes:
        mount_test_routes(api)
    app.include_router(api, prefix="/api/v1")
    return app


app = create_app()
