"""FastAPI app factory. `uvicorn app.main:app` serves the module-level instance."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import config
from .jobs.scheduler import start_scheduler
from .middleware.errors import RequestIdMiddleware, install_error_handlers
from .middleware.responses import ApiJSONResponse
from .routes import alerts, clock, demo, health, instruments, jobs, meta, scrutiny
from .routes.auth import auth_router


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    scheduler = start_scheduler() if config.scheduler_enabled else None
    yield
    if scheduler is not None:
        scheduler.shutdown(wait=False)


def create_app(mount_test_routes: Callable[[APIRouter], None] | None = None) -> FastAPI:
    """`mount_test_routes` lets tests add throwaway routes under /api/v1."""
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

    api = APIRouter()
    api.include_router(health.router)
    api.include_router(auth_router())
    api.include_router(clock.router)
    api.include_router(instruments.router)
    api.include_router(scrutiny.router)
    api.include_router(meta.router)
    api.include_router(alerts.router)
    api.include_router(jobs.router)
    if config.demo_mode:
        api.include_router(demo.router)
    if mount_test_routes:
        mount_test_routes(api)
    app.include_router(api, prefix="/api/v1")
    return app


app = create_app()
