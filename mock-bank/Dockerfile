# Build context is the repo root (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY mock-bank/package.json mock-bank/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY mock-bank ./mock-bank
WORKDIR /app/mock-bank
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
