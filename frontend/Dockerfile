# Build context is the repo root (see docker-compose.yml).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY shared ./shared
COPY frontend ./frontend
WORKDIR /app/frontend
EXPOSE 5173
CMD ["npx", "vite", "--host", "0.0.0.0"]
