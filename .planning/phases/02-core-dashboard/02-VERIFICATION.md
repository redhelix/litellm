---
phase: 02-core-dashboard
verified: 2026-04-13T18:20:00Z
status: human_needed
score: 10/11 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Visit https://dashboard.thelaljis.com/ in a browser on the LAN"
    expected: "Page loads without Authentik SSO prompt; all 3 sections render live data"
    why_human: "Requires DNS resolution of dashboard.thelaljis.com via Technitium + Cloudflare, which is pending; curl via --resolve was used as a proxy but full DNS+TLS path has not been validated end-to-end by the user"
deferred: []
---

# Phase 2: Core Dashboard Verification Report

**Phase Goal:** Users can see the state of their lab at a glance — aggregate performance across all 7 models and per-node availability for all 5 nodes are visible on a single screen that auto-refreshes.
**Verified:** 2026-04-13T18:20:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Overview panel shows aggregate stats (p50/p95 TTFT, p50/p95 total latency, tok/s, ctx%, tool-call 3-state) updating every 30s | ✓ VERIFIED | OverviewPanel.tsx calls computeOverview(); 30s polling in useDashboardData; O1-O7 specs all pass |
| 2 | Per-node health grid shows all 5 nodes with model loaded, last request timestamp, and availability status (healthy/slow/unreachable distinguished) | ✓ VERIFIED | NodeGrid.tsx iterates nodes calling deriveStatus(); N1-N7 specs pass; 90s scrape-age override verified in N4 |
| 3 | Dashboard accessible at a LAN URL without any login or authentication prompt | ✓ VERIFIED (partial) | http://docker-001:4002 confirmed 200 OK with no Location header by user. HTTPS path pending DNS (see human_needed) |
| 4 | Per-model metrics panels surface p50/p95 TTFT and total latency, tok/s, ctx%, tool call rates for each of the 7 deployed models | ✓ VERIFIED | ModelCard.tsx renders all MET-01..05 fields with formatters; M1-M5 specs pass; responsive grid in App.tsx |
| 5 | Null metric values render as em-dash "—", not "N/A" or "null" | ✓ VERIFIED | All formatters return "—" for null; M2 spec confirms null → em-dash |
| 6 | 30s auto-refresh with countdown ring; stale/connection-lost affordances wired | ✓ VERIFIED | useDashboardData dual intervals; RefreshRing SVG countdown; isStale → opacity-50; H1-H5 specs pass |
| 7 | dashboard/ scaffolded with React+Vite+TS+shadcn+vitest; all shadcn primitives present | ✓ VERIFIED | dashboard/components.json exists; src/components/ui/ confirmed; vitest in package.json |
| 8 | CORSMiddleware in dashboard-sidecar/main.py with literal allow_origins=["http://docker-001:4002"] | ✓ VERIFIED | main.py lines 75-76 confirmed via grep |
| 9 | deriveStatus encodes verified numeric mapping (0=healthy, 1=slow, null=unreachable) with 90s stale override | ✓ VERIFIED | status.ts lines 17-19; live probe from Plan 01 recorded {0, 1, null}; no string fallback |
| 10 | API response envelope unwrapped in useDashboardData (e.map TypeError fix committed 8447e6b) | ✓ VERIFIED | useDashboardData.ts lines 46-47: Array.isArray guard unwraps models/nodes from envelope |
| 11 | dashboard.thelaljis.com resolves through Traefik without Authentik prompt (SYS-03 HTTPS path) | ? HUMAN NEEDED | Traefik services.yml has dashboard router with no middlewares block (confirmed); curl --resolve to docker-001:443 returned 200. Full DNS (Technitium+Cloudflare) not yet live per user note |

**Score:** 10/11 truths verified (1 pending human DNS check)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `dashboard/src/types/api.ts` | ModelAggregate, NodeRow, AvailabilityStatus exports | ✓ VERIFIED | All 3 types exported; consumed by all components |
| `dashboard/src/lib/format.ts` | formatMs, formatTokensPerSec, formatContextPct, formatRelativeTime | ✓ VERIFIED | F1-F4 specs green |
| `dashboard/src/lib/aggregate.ts` | computeOverview | ✓ VERIFIED | A1-A5 specs green |
| `dashboard/src/lib/status.ts` | deriveStatus with numeric mapping | ✓ VERIFIED | S1-S5 specs green; numeric mapping confirmed |
| `dashboard/src/hooks/useDashboardData.ts` | Polling hook with models/nodes/error/countdown/lastSuccess/isStale | ✓ VERIFIED | H1-H5 specs green; AbortController cleanup |
| `dashboard/src/components/OverviewPanel.tsx` | VIEW-01 aggregate stats row | ✓ VERIFIED | O1-O7 specs green; 5 aria-labelled Cards |
| `dashboard/src/components/ToolCallBar.tsx` | 3-segment normalised bar | ✓ VERIFIED | B1-B4 specs green; widths sum to 100% |
| `dashboard/src/components/RefreshRing.tsx` | SVG countdown + error banner | ✓ VERIFIED | Exists; wired in App.tsx header |
| `dashboard/src/components/NodeGrid.tsx` | VIEW-02 per-node health table | ✓ VERIFIED | N1-N7 specs green |
| `dashboard/src/components/StatusDot.tsx` | 8px aria-hidden status circle | ✓ VERIFIED | D1-D4 specs green |
| `dashboard/src/components/ModelCard.tsx` | MET-01..05 per-model card | ✓ VERIFIED | M1-M5 specs green |
| `dashboard/src/App.tsx` | Full page shell — 3 sections wired | ✓ VERIFIED | Imports all 4 components; layout: Header → Overview → Models → Nodes |
| `dashboard/Dockerfile` | Multi-stage node:22-alpine → nginx:alpine | ✓ VERIFIED | FROM nginx:alpine confirmed |
| `dashboard/nginx.conf` | SPA fallback on :80 | ✓ VERIFIED | try_files confirmed |
| `dashboard-sidecar/main.py` | CORSMiddleware for docker-001:4002 | ✓ VERIFIED | Lines 75-76 confirmed |
| `docker-compose.yaml` | dashboard service on 4002:80, traefik-net | ✓ VERIFIED | Lines 141-149 confirmed |
| `/home/rhx/projects/home-infra-backups/traefik/services.yml` | dashboard router + service, no middleware | ✓ VERIFIED | Lines 272-280, 411-414; no middlewares block present |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| App.tsx | /api/models, /api/nodes | useDashboardData reading VITE_SIDECAR_URL | ✓ WIRED | App.tsx line 9-12; .env.production has correct URL |
| OverviewPanel | computeOverview(models) | direct import from src/lib/aggregate | ✓ WIRED | OverviewPanel imports and calls computeOverview |
| OverviewPanel tool-call cell | ToolCallBar | prop passthrough of averaged rates | ✓ WIRED | ToolCallBar rendered in OverviewPanel |
| NodeGrid row | deriveStatus(node) from src/lib/status | direct call per row | ✓ WIRED | NodeGrid imports and calls deriveStatus per row |
| ModelCard context % | shadcn Progress | value={avg_context_utilization * 100} | ✓ WIRED | M4 spec confirms Progress rendered |
| ModelCard tool call section | ToolCallBar | import reuse | ✓ WIRED | M4 spec confirms ToolCallBar rendered |
| dashboard container :80 | host port 4002 | docker-compose ports | ✓ WIRED | "4002:80" in docker-compose.yaml |
| Traefik file provider | dashboard service @ 192.168.50.117:4002 | services.yml loadBalancer | ✓ WIRED | services.yml lines 411-414 confirmed |
| dashboard.thelaljis.com | no auth middleware | absence of middlewares in router | ✓ WIRED | Router block has no middlewares key |
| useDashboardData fetch | API response arrays (not envelopes) | Array.isArray unwrap guard | ✓ WIRED | Lines 46-47 unwrap models/nodes from envelope |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| OverviewPanel | models prop | useDashboardData → fetch /api/models → unwrap → setModels | Yes — live sidecar API | ✓ FLOWING |
| NodeGrid | nodes prop | useDashboardData → fetch /api/nodes → unwrap → setNodes | Yes — live sidecar API | ✓ FLOWING |
| ModelCard | model prop | models array from useDashboardData, mapped in App.tsx | Yes — propagated from live fetch | ✓ FLOWING |
| RefreshRing | countdown, error, isStale | useDashboardData state (dual intervals) | Yes — driven by timer + fetch result | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| vitest suite green | `cd dashboard && npx vitest run` | 53 passed (8 test files) | ✓ PASS |
| All artifacts exist | File listing | All component/lib/hook/test files found | ✓ PASS |
| CORS header configured | grep CORSMiddleware main.py | allow_origins=["http://docker-001:4002"] | ✓ PASS |
| Dashboard container port | grep 4002 docker-compose.yaml | "4002:80" found | ✓ PASS |
| Traefik router, no auth | services.yml inspection | dashboard router present, no middlewares block | ✓ PASS |
| API unwrap fix present | grep useDashboardData.ts | Array.isArray guard on lines 46-47 | ✓ PASS |
| http://docker-001:4002 LAN access | Verified by user directly | 200 OK, all 3 sections rendered | ✓ PASS |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| MET-01 (p50 TTFT) | 02-02, 02-03 | p50 TTFT per-model and aggregate | ✓ SATISFIED | OverviewPanel + ModelCard render formatMs(ttft_p50) |
| MET-02 (p95 total latency) | 02-02, 02-03 | p95 total latency | ✓ SATISFIED | OverviewPanel + ModelCard render formatMs(total_latency_p95) |
| MET-03 (tok/s) | 02-02, 02-03 | tokens/sec throughput | ✓ SATISFIED | formatTokensPerSec used; computeOverview sums per-model values |
| MET-04 (ctx %) | 02-02, 02-03 | context utilization % | ✓ SATISFIED | formatContextPct; Progress bar in ModelCard |
| MET-05 (tool call 3-state) | 02-02, 02-03 | success/repaired/failed breakdown | ✓ SATISFIED | ToolCallBar with 3 colour segments |
| VIEW-01 (aggregate overview) | 02-02 | Aggregate across all models | ✓ SATISFIED | OverviewPanel calls computeOverview |
| VIEW-02 (per-node health) | 02-03 | Per-node availability grid | ✓ SATISFIED | NodeGrid with deriveStatus; 90s scrape-age override |
| SYS-03 (LAN access, no auth) | 02-04 | Local network access without login | ✓ SATISFIED (LAN path) | http://docker-001:4002 verified by user; HTTPS DNS pending |

---

### Anti-Patterns Found

None blocking. No TODO/FIXME/placeholder comments remain in production code. Placeholder sections from Plan 02 were replaced in Plan 03. The e.map TypeError was diagnosed and fixed (commit 8447e6b) before the user verified the live dashboard.

---

### Human Verification Required

#### 1. HTTPS via dashboard.thelaljis.com

**Test:** In a browser on the LAN, visit `https://dashboard.thelaljis.com/`
**Expected:** Page loads without any Authentik SSO prompt; title reads "Lab Dashboard"; all 3 sections (Overview, Models, Nodes) show live data
**Why human:** DNS setup in Technitium and Cloudflare is pending. The Traefik services.yml entry is confirmed present and correct (no middlewares block, correct loadBalancer URL). The curl --resolve test during execution returned 200 with no Location header. Full end-to-end DNS validation requires the browser path once DNS propagates.

---

### Gaps Summary

No blocking gaps. The one outstanding item (HTTPS via dashboard.thelaljis.com) is infrastructure-dependent (DNS propagation) rather than a code defect. All code artifacts are present, substantive, wired, and data-flowing. The vitest suite is 53/53 green. The LAN path (http://docker-001:4002) was confirmed live by the user with all 3 sections rendering.

---

_Verified: 2026-04-13T18:20:00Z_
_Verifier: Claude (gsd-verifier)_
