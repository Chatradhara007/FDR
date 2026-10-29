# Deploying the showcase build

The production image (`docker/prod/Dockerfile`) serves the built frontend and the API from **one origin**, runs the
mock bank inside the container on 127.0.0.1:4000, and keeps uploaded files on a mounted volume (`STORAGE_DIR=/data/storage`).
Health check: `GET /health` (also `/api/v1/health`) returns `{"status":"ok","db":"up",...}`.

With `SHOWCASE_MODE=true` the first start on an empty database seeds the sample data once (under a Postgres advisory
lock, so two instances cannot both seed), logging one line per seed phase. It never re-seeds afterwards. Startup
refuses to run with the placeholder `JWT_SECRET` or without `FILE_ENCRYPTION_KEY`.

## 1. Generate the secrets

```
python -c "import secrets;print(secrets.token_urlsafe(48))"                     # JWT_SECRET
python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"  # FILE_ENCRYPTION_KEY
```
Keep `FILE_ENCRYPTION_KEY` safe: stored documents cannot be read without it.

## 2. Environment variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgres://user:pass@host:5432/db` from the platform's Postgres |
| `JWT_SECRET` | from step 1 (32+ characters) |
| `FILE_ENCRYPTION_KEY` | from step 1 |
| `SHOWCASE_MODE` | `true` |
| `DEMO_MODE` | `false` (`true` only if you want the audit tamper demonstration available) |
| `PUBLIC_BASE_URL` | the public URL, e.g. `https://fdr-portal.onrender.com` (release-order QR codes point here) |
| `FRONTEND_ORIGIN` | same as `PUBLIC_BASE_URL` |
| `PORT` | set by the platform (the image defaults to 3000) |

The image already sets `STATIC_DIR`, `STORAGE_DIR=/data/storage`, `MOCK_BANK_URL`, `MOCK_BANK_DATA_FILE` and `TZ`.

## 3a. Render

1. New → **PostgreSQL** (version 16). Copy its *Internal Database URL*.
2. New → **Web Service** → connect this repository. Runtime **Docker**, Dockerfile path `docker/prod/Dockerfile`,
   Docker build context `.`.
3. Add the environment variables from step 2 (`DATABASE_URL` = the internal URL).
4. **Disks** → add a persistent disk mounted at `/data` (1 GB is plenty).
5. Health check path: `/health`.
6. Deploy. The first start migrates and seeds (the log shows `showcase data loaded: 60 instruments`).

## 3b. Railway

1. New project → **Deploy from GitHub repo** (this repository).
2. Add a **PostgreSQL** service; in the app service set `DATABASE_URL=${{Postgres.DATABASE_URL}}`.
3. Set variable `RAILWAY_DOCKERFILE_PATH=docker/prod/Dockerfile` (builder: Dockerfile).
4. Add the other variables from step 2. Railway injects `PORT`.
5. Add a **Volume** mounted at `/data`. (The Dockerfile has no `VOLUME` instruction because Railway rejects one; the
   platform volume, Render disk or compose's `appdata:/data` mount provides persistence instead.)
6. Settings → Deploy → healthcheck path `/health`. Settings → Networking → Generate domain, then put that URL in
   `PUBLIC_BASE_URL` and `FRONTEND_ORIGIN` and redeploy.

## 3c. Render free tier (no persistent disk)

The free tier has no disk: the container filesystem (`/data/storage`, `/data/bank/records.json`) is wiped on every
restart, redeploy and wake-up from sleep, while the Postgres database may keep its rows. With `SHOWCASE_MODE=true` the
startup is self-healing:

- **Fresh container** (storage directory has no document folders, or the mock-bank data file is missing or empty):
  a full reseed runs — the database data is wiped, the instruments are reseeded, the stored PDFs and the mock-bank
  records are regenerated — so database, files and bank always match.
- **Empty database**: the same full seed.
- **Files, bank data and deposits all present**: nothing happens.

The seed takes the advisory lock, so two instances cannot reseed at once. The log shows one line saying which case
ran, starting `showcase startup:`. The fixed demo-video bank records (SBIN/FDR/2026/09001–09008) are part of the mock
bank's code, so they are always available after a reseed.

**Data resets whenever the container restarts.** Anything lodged, verified or changed in the app (including the
09001–09004 sample deposits once submitted, and any app-date change) is lost at the next restart or wake-up; the app
comes back with the original sample dataset. Use a paid instance with a disk mounted at `/data` to keep changes.

## Local check of the production image

```
docker compose -f docker-compose.prod.yml --env-file .env.prod up --build -d   # http://localhost:8080
E2E_WEB=http://localhost:8080 E2E_API=http://localhost:8080/api/v1 node e2e/showcase.mjs
```
`.env.prod` needs `JWT_SECRET` and `FILE_ENCRYPTION_KEY` (compose refuses to start without them).

Sign in through the role picker on the login page; every sample account uses the password `Demo@123`.

## Troubleshooting

**`exec /app/start.sh: no such file or directory` (Windows).** The script was checked out with CRLF line
endings, so the kernel looks for an interpreter named `/bin/sh\r`. `.gitattributes` now forces LF for `*.sh`,
`Dockerfile*`, `*.yml`, `*.yaml` and `docker/**`, and the Dockerfile strips carriage returns from `start.sh`
before `chmod`, so a rebuild (`docker compose -f docker-compose.prod.yml up --build`) fixes it. To renormalise an
existing checkout: `git add --renormalize . && git status` (or re-clone).
