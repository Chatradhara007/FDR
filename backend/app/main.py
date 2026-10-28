"""FastAPI app factory. `uvicorn app.main:app` serves the module-level instance."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import FileResponse, Response

from .config import config
from .domain.errors import NotFound
from .jobs.scheduler import start_scheduler
from .logging_setup import configure_logging
from .middleware.errors import RequestIdMiddleware, install_error_handlers
from .middleware.responses import ApiJSONResponse
from .middleware.security import SecurityMiddleware
from .routes import admin, alerts, audit, clock, demo, health, instruments, jobs, meta, releases, reporting, scrutiny
from .routes.auth import auth_router
from .routes.public import public_router
from .security import check_startup_config


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    scheduler = start_scheduler() if config.scheduler_enabled else None
    yield
    if scheduler is not None:
        scheduler.shutdown(wait=False)


def create_app(mount_test_routes: Callable[[APIRouter], None] | None = None) -> FastAPI:
    """`mount_test_routes` lets tests add throwaway routes under /api/v1. Refuses to build with weak secrets."""
    configure_logging()
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
    api.include_router(public_router())
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
    if config.demo_mode or config.showcase_mode:
        api.include_router(demo.tamper_router)
        api.include_router(demo.router)
    if mount_test_routes:
        mount_test_routes(api)
    app.include_router(api, prefix="/api/v1")
    app.include_router(health.router)  # also at /health, for load balancers and platform health checks
    if config.static_dir is not None:
        mount_frontend(app, config.static_dir)
    return app


# The page itself may run its own scripts and open document previews (blob: URLs); the API keeps its strict policy.
FRONTEND_CSP = (
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; frame-src 'self' blob:; "
    "object-src 'self' blob:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"
)


def mount_frontend(app: FastAPI, root: Path) -> None:
    """Production image: the built frontend from the API's origin. Files under `root` are served as they are; any
    other path outside /api/ gets index.html (client-side routes). /api/* misses stay JSON 404s."""
    index = root / "index.html"
    headers = {"Content-Security-Policy": FRONTEND_CSP}

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> Response:
        if path == "api" or path.startswith("api/"):
            raise NotFound("Not found")
        target = (root / path).resolve()
        if path and target.is_file() and target.is_relative_to(root):
            cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
            return FileResponse(target, headers={**headers, "Cache-Control": cache})
        return FileResponse(index, headers={**headers, "Cache-Control": "no-cache"})


app = create_app()
