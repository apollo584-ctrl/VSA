# Market Structure Terminal — frontend

Next.js (App Router) · React · strict TypeScript · Tailwind CSS v4 · Lightweight Charts · TanStack Query · Zod.

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000  (mock fixtures by default in development)
npm test           # vitest
npm run typecheck
npm run build
```

### Data source

Copy `.env.example` to `.env.local`:

| Variable | Meaning |
|---|---|
| `NEXT_PUBLIC_API_MODE` | `mock` — deterministic synthetic fixtures (clearly badged **MOCK DATA**); `http` — real backend. Defaults to `mock` in `next dev`, `http` in production builds. |
| `NEXT_PUBLIC_API_BASE_URL` | Backend base URL **including `/api/v1`** (e.g. `http://127.0.0.1:8000/api/v1`), used in `http` mode. If missing, the UI shows "Analysis service unavailable" — it never falls back to fabricated data. Backend CORS defaults allow ports 3000. |

Fixture instruments (`FIXA`, `FIXB`, `FIXC`) are synthetic and intentionally not real tickers:
`FIXA` has an advance with a late provisional upthrust (P-shaped session), `FIXB` is orderly balance with **no patterns**,
`FIXC` has **insufficient data**.

## Layout

```
app/                 routes: / (overview), /chart, /vsa, /auction, /interpretation, /knowledge[/slug], /history, /settings
components/
  ui/                primitives (button, badge, tooltip/Term, segmented, panel, ...)
  layout/            app shell, top bar, status bar
  charts/            MarketChart (Lightweight Charts + SVG overlay), layer & replay controls
  profiles/          profile visual, kind tabs, explanation, value migration
  vsa/               event list + detail panel
  auction/           state strip/flow + transition evidence
  interpretation/    summary + full interpretation, depth switch
  knowledge/         browser, concept detail, schematics, relationship path
  common/            states (loading/empty/error/…), badges, gate
hooks/               workspace state (context), data hooks (TanStack Query)
lib/api/             internal Zod schemas, client switch, errors
lib/api/backend/     raw backend schemas, mappers, HTTP client
lib/replay.ts        no-look-ahead guards
fixtures/            MOCK ONLY: synthetic bars, mock engine, knowledge, mock transport
docs/                BACKEND_INTEGRATION.md — how the UI maps docs/API_CONTRACT.md, and the reported mismatches
tests/               vitest
```

## Principles encoded in the UI

- Backend owns analysis; the frontend only renders (bins, levels, events, states, interpretation).
- Estimated profiles always carry an **Estimated Profile** badge.
- Observations vs hypotheses are visually distinct (solid vs dashed/tinted + text labels).
- Missing/absent patterns are never shown as signals. Up/down colors mean price direction only.
- Replay ("analysis timeline") shows only what was knowable at the selected bar.
- Status is never color-only (icon + text); reduced-motion is respected.

## Keyboard

`/` focuses instrument search. All controls are reachable by Tab; chart layer toggles and depth switches are
`role="switch"` / `role="radio"`.
