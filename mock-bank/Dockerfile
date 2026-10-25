# Build context is the repo root (see docker-compose.yml).
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY mock-bank/pyproject.toml mock-bank/pyproject.toml
COPY mock-bank/mock_bank mock-bank/mock_bank
RUN pip install --no-cache-dir ./mock-bank
WORKDIR /app/mock-bank
EXPOSE 4000
CMD ["python", "-m", "mock_bank.main"]
