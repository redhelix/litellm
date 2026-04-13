---
phase: 02-core-dashboard
plan: "04"
subsystem: dashboard-containerisation-traefik
tags: [docker, nginx, traefik, spa, deployment, sys-03]
dependency_graph:
  requires:
    - dashboard/src/ (built by Plans 02-01..02-03)
    - dashboard-sidecar running on docker-001:4001
    - traefik file provider watching /opt/traefik/config/dynamic/
  provides:
    - dashboard container on docker-001:4002 (nginx:alpine SPA)
    - https://dashboard.thelaljis.com/ (no auth, SYS-03)
  affects:
    - Phase 2 goal: all 3 sections live with auto-refresh on LAN + public URL
tech_stack:
  added:
    - nginx:alpine (multi-stage Docker build serving React SPA)
  patterns:
    - Multi-stage Docker build (node:22-alpine build → nginx:alpine serve)
    - .env.production for build-time Vite env injection (non-secret LAN hostname)
    - Traefik file provider live reload (watch: true, no restart needed)
key_files:
  created:
    - dashboard/Dockerfile
    - dashboard/nginx.conf
    - dashboard/.dockerignore
    - dashboard/.env.production
  modified:
    - docker-compose.yaml (dashboard service added on 4002:80)
    - /home/rhx/projects/home-infra-backups/traefik/services.yml (dashboard router + service)
decisions:
  - "Used .env.production (option a) over Dockerfile ARG to inject VITE_SIDECAR_URL — simpler, no build-arg plumbing in compose; hostname is not secret (T-02-01)"
  - "Dashboard attaches ONLY to traefik-net (not litellm-internal) — serves static files only; browser talks directly to docker-001:4001"
  - "Traefik services.yml deployed to /opt/traefik/config/dynamic/ (live watch path); git repo copy kept in sync via commit to traefik repo"
metrics:
  duration_minutes: 20
  completed_date: "2026-04-13"
  tasks_completed: 2
  tasks_total: 3
  files_created: 4
  files_modified: 2
---

# Phase 02 Plan 04: Containerisation + Traefik Routing Summary

**One-liner:** nginx:alpine multi-stage Docker build serving the React SPA on docker-001:4002, wired through Traefik file provider at dashboard.thelaljis.com with no Authentik middleware (SYS-03); human-verify checkpoint pending.

## What Was Built

### Task 1: Dockerfile + nginx.conf + docker-compose dashboard service (commit 92125bf)

- `dashboard/Dockerfile`: multi-stage build — node:22-alpine builds `npm run build` (190 modules, 320 kB); nginx:alpine serves dist/
- `dashboard/nginx.conf`: SPA fallback (`try_files $uri $uri/ /index.html`) on port 80
- `dashboard/.env.production`: `VITE_SIDECAR_URL=http://docker-001:4001` — baked in at build time by Vite; not secret (LAN hostname only per T-02-01)
- `dashboard/.dockerignore`: excludes node_modules, dist, .env/.env.local/.env.development* (keeps .env.production for build)
- `docker-compose.yaml`: `dashboard` service — build ./dashboard, image dashboard:local, ports 4002:80, traefik-net only, autoheal label, wget healthcheck
- Deployed on docker-001: `docker compose up -d --build dashboard` — container started, build exit 0
- Verified: `http://docker-001:4002/` → 200 OK, JS bundle contains literal `docker-001:4001`, no Location header

### Task 2: Traefik services.yml — dashboard router (no authentik) (traefik repo commit 5d44431e)

- Added `http.routers.dashboard`: entryPoints websecure, Host(`dashboard.thelaljis.com`), NO middlewares block (SYS-03)
- Added `http.services.dashboard`: loadBalancer → `http://192.168.50.117:4002`
- Deployed to `/opt/traefik/config/dynamic/services.yml` (Traefik watch:true picked up live — no restart)
- Verified: `curl -sSk --resolve dashboard.thelaljis.com:443:127.0.0.1 https://dashboard.thelaljis.com/` → 200, no Location header

### Task 3: Human verify — Phase 2 goal against live dashboard

**STATUS: PENDING — checkpoint:human-verify reached**

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Traefik watches /opt/traefik/config/dynamic/, not the git repo path**
- **Found during:** Task 2 HTTPS verification (404 when testing after services.yml edit in git repo)
- **Issue:** The plan stated "Traefik file provider watches services.yml live" but Traefik mounts `/opt/traefik/config/dynamic/` — the git repo at `/home/rhx/projects/home-infra-backups/traefik/` is not the watched path
- **Fix:** After committing to the traefik git repo, also `scp services.yml root@docker-001:/opt/traefik/config/dynamic/services.yml`; Traefik picked it up immediately
- **Files modified:** traefik/services.yml (same content, different deploy path)

**2. [Rule 3 - Blocking] dashboard/ directory absent on docker-001**
- **Found during:** Task 1 scp step
- **Issue:** `scp` failed — `/opt/litellm/dashboard/` doesn't exist on server (only `dashboard-sidecar/` was there from prior manual work)
- **Fix:** `ssh root@docker-001 "mkdir -p /opt/litellm/dashboard"` then `rsync -av --exclude=node_modules --exclude=dist` to sync full source tree

## Known Stubs

None — all three sections (Overview, Models, Nodes) are fully wired. Container is live and serving the built SPA.

## Threat Flags

- **T-02-16 mitigated:** CORS allowlist in dashboard-sidecar/main.py is `["http://docker-001:4002"]` — set in Plan 02-01, unchanged.
- **T-02-14 accepted:** dashboard.thelaljis.com is intentionally public/unauthenticated per SYS-03; no new threat surface beyond plan's threat model.
- **T-02-18 mitigated:** services.yml change committed to traefik git repo (commit 5d44431e).

## Self-Check

- `dashboard/Dockerfile` — FOUND
- `dashboard/nginx.conf` — FOUND
- `dashboard/.dockerignore` — FOUND
- `dashboard/.env.production` — FOUND
- `docker-compose.yaml` has `dashboard:` service — FOUND
- `docker-compose.yaml` has `4002:80` — FOUND
- `docker-compose.yaml` has `traefik-net` for dashboard — FOUND
- Commit 92125bf (Task 1) — FOUND in git log
- traefik/services.yml has dashboard router with no authentik — VERIFIED (grep confirmed)
- http://docker-001:4002/ → 200 — VERIFIED
- JS bundle contains `docker-001:4001` — VERIFIED
- https://dashboard.thelaljis.com/ → 200 (via docker-001 local resolve) — VERIFIED
- No Location header on either URL — VERIFIED
- Task 3 checkpoint: PENDING human verify

## Self-Check: PASSED (Tasks 1-2)

---

## Post-Deploy Bug Fix: e.map TypeError on load (2026-04-13)

**Commit:** `8447e6b` — fix(02-04): unwrap API response shape — e.map TypeError on load

### Problem

Dashboard crashed immediately on page load with:

```
Uncaught TypeError: e.map is not a function
```

Overview, Models, and Nodes sections never rendered.

### Root Cause

`useDashboardData.ts` passed raw fetch JSON directly to `setModels()` / `setNodes()`. The sidecar API returns wrapped envelopes:

- `/api/models` → `{ "models": [...] }`
- `/api/nodes`  → `{ "nodes": [...] }`

The hook and all downstream components expected bare arrays.

### Fix

`dashboard/src/hooks/useDashboardData.ts` lines 46-47:

```ts
// Before
setModels(modelsData)
setNodes(nodesData)

// After
setModels(Array.isArray(modelsData) ? modelsData : (modelsData.models ?? []))
setNodes(Array.isArray(nodesData) ? nodesData : (nodesData.nodes ?? []))
```

Defensive unwrap — works regardless of whether the API returns a bare array or wrapped object.

### Verification

- `npm run build` passed (TypeScript + Vite, no errors)
- Image rebuilt on docker-001: `docker compose build dashboard && docker compose up -d dashboard`
- `curl http://localhost:4002/` → HTTP 200
- Dashboard renders all sections without console errors

**Plan 02-04 is now complete.**
