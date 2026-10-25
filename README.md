# FDR Portal — Security Deposit / FDR Management for AICTE

Smart India Hackathon · Problem SIH26265 · Smart Automation

A single secure portal that manages the whole lifecycle of institutions' security deposits and Fixed
Deposit Receipts: submission, bank verification, maturity tracking, renewal, release and audit.

It is built around two questions an official asks about every deposit:
1. **How much of this record is proven, and how much is only claimed?** — every field carries a trust
   tier: *Claimed by institution*, *Document-checked*, *Bank-confirmed*.
2. **What is about to go wrong, and who has to act?** — a rules engine on an app clock creates
   reminders, escalates what is ignored, and blocks releases while problems are open.

> Status: under construction — see `docs/PROGRESS.md`.

## Run it

```bash
cp .env.example .env
docker compose up --build          # http://localhost:5173
```
Development (Node 22, Python 3.12):

```bash
docker compose up -d db
npm install && npm run setup:py   # JS workspaces + .venv with backend and mock bank
npm run dev                       # FastAPI :3000, mock bank :4000, Vite :5173
```

## Demo users (password `Demo@123`)

| Role | Email |
|---|---|
| Institution | inst1@demo.in, inst2@demo.in, … |
| Scrutiny officer | officer@demo.in |
| Competent authority | approver@demo.in, approver2@demo.in |
| Admin | admin@demo.in |
| Auditor (read-only) | auditor@demo.in |

## Architecture

```mermaid
flowchart LR
  UI[React + Vite<br/>role-based views] -->|/api/v1 JSON, JWT| API[FastAPI (Python)<br/>routes → services → repositories]
  API --> DB[(PostgreSQL 16<br/>instruments, provenance, alerts,<br/>hash-chained events)]
  API -->|verify| BANK[Mock bank service<br/>stand-in for authorised bank APIs]
  JOB[Evaluation job<br/>daily 06:00 IST or on clock change] --> DB
  API --> FS[(Encrypted document storage)]
```

## Docs

- `CLAUDE.md` — engineering rules for this repo
- `docs/WORKFLOW.md` — how the project is built phase by phase with Claude Code
- `docs/phases/` — the specification, one file per phase
- `docs/DECISIONS.md` — binding design decisions
- `docs/demo-script.md` — the judged demo
- `docs/requirements-map.md` — the ten expected capabilities mapped to features
- `docs/spec/` — original build guide and problem/strategy report

Honesty notes: the bank integration is a mock service that implements the contract a real authorised
integration would; all data is synthetic; improvement figures are simulated on demo data.
