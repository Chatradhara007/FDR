#!/bin/sh
# The mock bank stands in for the banks' verification service; it listens only inside the container.
set -e
cd /app/mock-bank
python -m uvicorn mock_bank.main:app --host 127.0.0.1 --port "${MOCK_BANK_PORT:-4000}" --log-level warning &
cd /app/backend
# Waits for the database, migrates, seeds once when SHOWCASE_MODE=true and the database is empty, then serves.
exec python -m app.server
