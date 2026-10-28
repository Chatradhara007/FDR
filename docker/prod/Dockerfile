# Production image: the built frontend and the API from one origin, plus the mock bank on an internal port.
# Build context is the repo root:  docker build -f docker/prod/Dockerfile -t fdr-portal .

# 1. Build the frontend. The API is on the same origin, so the client calls /api/v1.
FROM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY shared ./shared
COPY frontend ./frontend
ENV VITE_API_URL=/api/v1
RUN npm run build -w frontend

# 2. Python runtime: backend + mock bank.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY shared/constants.json shared/constants.json
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/app backend/app
COPY mock-bank/pyproject.toml mock-bank/pyproject.toml
COPY mock-bank/mock_bank mock-bank/mock_bank
RUN pip install --no-cache-dir ./backend ./mock-bank
COPY --from=web /app/frontend/dist /app/frontend-dist
COPY docker/prod/start.sh /app/start.sh
RUN sed -i 's/\r$//' /app/start.sh && chmod +x /app/start.sh && mkdir -p /data/storage /data/bank
ENV STATIC_DIR=/app/frontend-dist \
    STORAGE_DIR=/data/storage \
    MOCK_BANK_DATA_FILE=/data/bank/records.json \
    MOCK_BANK_URL=http://127.0.0.1:4000 \
    MOCK_BANK_PORT=4000 \
    MOCK_BANK_SLOW_SECONDS=3 \
    TZ=Asia/Kolkata \
    PORT=3000
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"3000\")}/health',timeout=4)"
CMD ["/app/start.sh"]
