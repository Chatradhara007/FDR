# Build context is the repo root (see docker-compose.yml).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
# shared/constants.json is read at startup (app/shared_constants.py resolves it relative to backend/).
COPY shared/constants.json shared/constants.json
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/app backend/app
RUN pip install --no-cache-dir ./backend
WORKDIR /app/backend
EXPOSE 3000
CMD ["python", "-m", "app.server"]
