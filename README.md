# ChainReact V2

Workflow automation platform — architecture reset of [chainreact-app-9e](../nstoddard17/chainreact-app-9e). Same product and UI; rebuilt internal architecture per the [V2 architecture baseline](../../../.claude/plans/you-are-helping-me-happy-nebula.md).

## Status

Skeleton only. Slice 1 (Slack `new_message_in_channel` → `send_channel_message`) is the next work.

## Stack

Next.js 15 (App Router) · TypeScript strict + `noUncheckedIndexedAccess` · Supabase · Zustand · Tailwind + Shadcn/UI · Jest · Playwright

## Rule docs

The architecture is governed by ten rule docs at [`docs/rules/`](./docs/rules):

- [project-structure-and-module-boundaries.md](./docs/rules/project-structure-and-module-boundaries.md) — whole-codebase rule (folders, imports, file size, single source of truth)
- [database-security.md](./docs/rules/database-security.md) — RLS on every user-data table, tenant isolation, token encryption, service-role boundaries
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

## Apply migrations to the V2 Supabase project

Migrations live in [`supabase/migrations/`](./supabase/migrations) and follow the template in [database-security.md](./docs/rules/database-security.md).

```bash
npm run db:push
```

This reads `POSTGRES_URL_NON_POOLING` from `.env.local` and applies any pending migrations via the Supabase CLI. Migrations are forward-only after merge.

**Connection-string note:** `POSTGRES_URL_NON_POOLING` should be the **Session pooler** URL from Supabase Dashboard → Project Settings → Database → "Connect" panel. New projects sit behind `aws-1-<region>.pooler.supabase.com:5432` (Supavisor v2); the direct `db.<ref>.supabase.co` hostname is IPv6-only and won't resolve from most networks.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run build` | Production build |
| `npm run lint` | ESLint (boundary rules + style) |
| `npm run lint:structure` | Leaf-folder file-count check (≤ 50 per leaf) |
| `npm run lint:migrations` | Migration RLS lint — every user-data table enables RLS + has policies in the same file |
| `npm run db:push` | Apply pending migrations to the V2 Supabase project (reads `POSTGRES_URL_NON_POOLING` from `.env.local`) |
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
