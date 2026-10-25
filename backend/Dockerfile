# Build context is the repo root (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY mock-bank/package.json mock-bank/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY shared ./shared
COPY backend ./backend
WORKDIR /app/backend
EXPOSE 3000
CMD ["npx", "tsx", "src/server.ts"]
