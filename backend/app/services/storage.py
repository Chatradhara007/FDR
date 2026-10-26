"""The only module that touches uploaded files (2.4). Paths never contain the original filename.

Encryption at rest (Phase 8 §8.4): AES-256-GCM. Stored file = b"FDE1" + 12-byte IV + ciphertext + 16-byte tag.
SHA-256 and size are of the plaintext. Files without the FDE1 marker (written before Phase 8) are read as plaintext.
"""

from __future__ import annotations

import hashlib
import os
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

import filetype
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from ..config import config
from ..security import file_key

MAGIC = b"FDE1"
IV_BYTES = 12
TAG_BYTES = 16


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
    """Encrypts the temp upload into STORAGE_DIR while hashing the plaintext, then removes the temp file."""
    storage_path = f"{instrument_id}/{uuid.uuid4()}.{ext}"
    dest = resolve_stored(storage_path)
    dest.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    iv = os.urandom(IV_BYTES)
    encryptor = Cipher(algorithms.AES(file_key()), modes.GCM(iv)).encryptor()
    try:
        with open(tmp_path, "rb") as src, open(dest, "xb") as out:
            out.write(MAGIC + iv)
            while chunk := src.read(64 * 1024):
                digest.update(chunk)
                size += len(chunk)
                out.write(encryptor.update(chunk))
            out.write(encryptor.finalize())
            out.write(encryptor.tag)
    except BaseException:
        dest.unlink(missing_ok=True)
        raise
    finally:
        remove_temp(tmp_path)
    return StoredFile(storage_path, digest.hexdigest(), size)


def read_stored(storage_path: str) -> bytes:
    """The original bytes. Decrypted fully in memory (uploads are at most 10 MB) so the GCM tag is checked before
    a single byte is served; a file that fails the check raises instead of returning corrupted content."""
    data = resolve_stored(storage_path).read_bytes()
    if not data.startswith(MAGIC):
        return data  # written before encryption at rest
    iv = data[len(MAGIC) : len(MAGIC) + IV_BYTES]
    try:
        return AESGCM(file_key()).decrypt(iv, data[len(MAGIC) + IV_BYTES :], None)
    except InvalidTag:
        raise RuntimeError(f"stored file {storage_path} failed its integrity check") from None


def discard_unrecorded(storage_path: str) -> None:
    """Removes a stored file that never got a DB row (failed transaction). Recorded files are never removed."""
    resolve_stored(storage_path).unlink(missing_ok=True)


def remove_temp(tmp_path: str) -> None:
    Path(tmp_path).unlink(missing_ok=True)
