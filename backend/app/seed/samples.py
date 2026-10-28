"""`node scripts/py.mjs --cwd backend -m app.seed.samples`: rewrites the committed fresh-submission sample PDFs in
samples/ (no database needed). Run after editing SAMPLE_RECORDS in dataset.py."""

from __future__ import annotations

from ..config import REPO_ROOT
from .replay import sample_files


def main() -> None:
    out = REPO_ROOT / "samples"
    out.mkdir(exist_ok=True)
    for name, data in sample_files().items():
        (out / name).write_bytes(data)
    print(f"samples: {len(sample_files())} PDFs written to {out}")


if __name__ == "__main__":
    main()
