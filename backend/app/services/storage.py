"""The only module that touches uploaded files (2.4). Phase 8 adds encryption at rest here,
without changing callers. Paths never contain the original filename.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import filetype

from ..config import config


@dataclass(frozen=True)
class StoredFile:
    storage_path: str  # relative to STORAGE_DIR: '<instrumentId>/<uuid>.<ext>'
    sha256: str
    size: int


@dataclass(frozen=True)
class DetectedType:
    ext: Literal["pdf", "png", "jpg"]
    mime: Literal["application/pdf", "image/png", "image/jpeg"]


ALLOWED: dict[str, DetectedType] = {
    "application/pdf": DetectedType("pdf", "application/pdf"),
    "image/png": DetectedType("png", "image/png"),
    "image/jpeg": DetectedType("jpg", "image/jpeg"),
}


def detect_file_type(tmp_path: str) -> DetectedType | None:
    """Real type from magic bytes (never the extension or the browser's header); None when not PDF/PNG/JPEG."""
    kind = filetype.guess(tmp_path)
    return ALLOWED.get(kind.mime) if kind is not None else None


def resolve_stored(storage_path: str) -> Path:
    root = config.storage_dir.resolve()
    full = (root / storage_path).resolve()
    if not str(full).startswith(str(root) + os.sep):
        raise RuntimeError("storage path escapes STORAGE_DIR")
    return full


def save_upload(tmp_path: str, instrument_id: str, ext: str) -> StoredFile:
    """Copies the temp upload into STORAGE_DIR while hashing it, then removes the temp file."""
    storage_path = f"{instrument_id}/{uuid.uuid4()}.{ext}"
    dest = resolve_stored(storage_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    try:
        with open(tmp_path, "rb") as src, open(dest, "xb") as out:
            while chunk := src.read(64 * 1024):
                digest.update(chunk)
                size += len(chunk)
                out.write(chunk)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    finally:
        remove_temp(tmp_path)
    return StoredFile(storage_path, digest.hexdigest(), size)


def path_for_read(storage_path: str) -> Path:
    return resolve_stored(storage_path)


def discard_unrecorded(storage_path: str) -> None:
    """Removes a stored file that never got a DB row (failed transaction). Recorded files are never removed."""
    resolve_stored(storage_path).unlink(missing_ok=True)


def remove_temp(tmp_path: str) -> None:
    Path(tmp_path).unlink(missing_ok=True)
