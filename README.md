# ChainReact V2

Workflow automation platform — architecture reset of [chainreact-app-9e](../nstoddard17/chainreact-app-9e). Same product and UI; rebuilt internal architecture per the [V2 architecture baseline](../../../.claude/plans/you-are-helping-me-happy-nebula.md).

## Status

Skeleton only. Slice 1 (Slack `new_message_in_channel` → `send_channel_message`) is the next work.

## Stack

Next.js 15 (App Router) · TypeScript strict + `noUncheckedIndexedAccess` · Supabase · Zustand · Tailwind + Shadcn/UI · Jest · Playwright

## Rule docs

The architecture is governed by nine rule docs at [`docs/rules/`](./docs/rules):

- [project-structure-and-module-boundaries.md](./docs/rules/project-structure-and-module-boundaries.md) — whole-codebase rule (folders, imports, file size, single source of truth)
- [variable-resolver.md](./docs/rules/variable-resolver.md)
- [oauth-dispatcher.md](./docs/rules/oauth-dispatcher.md)
- [provider-registry.md](./docs/rules/provider-registry.md)
- [workflow-lifecycle.md](./docs/rules/workflow-lifecycle.md)
- [workflow-builder-ui.md](./docs/rules/workflow-builder-ui.md)
- [workflow-state-store.md](./docs/rules/workflow-state-store.md)
- [webhook-receipt-routes.md](./docs/rules/webhook-receipt-routes.md)
- [testing-strategy.md](./docs/rules/testing-strategy.md)

## Setup

```bash
npm install
cp .env.example .env.local   # fill in Supabase + Slack values
npm run dev
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (boundary rules + style) |
| `npm run lint:structure` | Leaf-folder file-count check (≤ 50 per leaf) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Jest unit / integration / parity / structure tests |
| `npm run test:e2e` | Playwright E2E |

## Folder structure

Per [project-structure-and-module-boundaries.md §3](./docs/rules/project-structure-and-module-boundaries.md):

```
app/                  Next.js routes (thin)
features/             Feature-level UI, hooks, slice actions
components/           Reusable presentational UI
core/                 Pure business rules
workflow-engine/      Execution orchestration
integrations/         Provider adapters (one folder per provider)
services/             Application orchestration (server-side)
repositories/         Database access (server-side)
contracts/            Shared cross-layer types + Zod schemas
stores/               Global client stores only
lib/api/              Typed client API functions (the only client→server bridge)
tests/                unit / integration / parity / structure / e2e
docs/                 Rule docs, architecture, runbooks
scripts/              Operational scripts
supabase/migrations/  Clean V2 migration sequence
```

## Rules at a glance

- Components never call `fetch` or `supabase.from`.
- Repositories and server services are imported only by other server-side code.
- Client → server flow: component → feature hook → `lib/api/<domain>.ts` → API route → service → repository → DB.
- File hard cap < 500 lines; leaf folders ≤ 50 files.
- Every PR answers the test-acceptance checklist in [testing-strategy.md §10](./docs/rules/testing-strategy.md).
