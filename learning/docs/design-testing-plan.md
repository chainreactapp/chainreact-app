---
title: Design & Button Testing Plan
owner: Claude (with human review)
created: 2026-04-24
last_updated: 2026-04-24
status: planning — awaiting user approval to start execution
---

# Design & Button Testing Plan

This is the working memory for a full visual + interaction audit of the ChainReact app. It is intentionally detailed so that any session — including a fresh Claude starting from zero — can pick up exactly where the previous one left off. Update it in real time as work progresses.

**If you are a fresh Claude session: read [Session Resumption Guide](#12-session-resumption-guide) first.**

---

## 1. Purpose & Scope

**Goal:** validate that every in-scope page (a) is visually correct across all breakpoints and both themes, (b) has every interactive control wired up, (c) reflects best-in-class UX patterns from Zapier / Make.com / n8n where applicable.

**Explicitly in scope**
- Visual correctness (no truncation, no overflow, no clipped content, no overlapping chrome, WCAG AA contrast)
- Button / link / form wiring (clicks produce the expected route, modal, toast, API call, or state change)
- Notifications UI (in-app bell, toasts, system banners) — triggered deliberately
- AI Assistant page (`/ai-assistant`) — full interaction test
- Auth flow pages (sign up, sign in, reset, confirmation landings)
- Light mode AND dark mode, both required (see CLAUDE.md §7 UI Rules)
- Responsive layout at four breakpoints (375 / 768 / 1280 / 1920)
- Per-page redesign proposals against Zapier/Make/n8n references where a clear improvement exists
- **Modal/dialog surfaces** — every opened modal treated as its own 8-variant capture target
- **Hover + keyboard-focus states** on primary CTAs, nav items, and all interactive controls on each page
- **Full-page scrolled captures** (not just viewport) for every page — captures sticky headers, lazy loads, and footers
- **Empty / loading / error / skeleton states** — deliberately triggered per page
- **Toast / notification / banner captures** — triggered by real actions (save setting → toast; etc.)
- **Form validation error states** — submit empty and invalid to capture error UIs
- **Auth-state variation** — public pages (`/`, `/pricing`, `/docs`, etc.) captured in both logged-out AND logged-in states
- **Dynamic-route seeding** — real slugs for `/teams/[slug]`, `/support/tickets/[id]`, `/org/[slug]/settings/[[...section]]`
- **Accessibility pass** via `@axe-core/playwright` per page
- **Dropdown / tooltip / popover captures** — opened state
- **Wizard / stepper multi-step captures** — onboarding (`/new`), invite signup
- **Navigation audit** — top nav, sidebar, footer captured as first-class surfaces in collapsed + expanded states
- **Dead-link sweep** — HEAD-check external links on marketing pages
- **Transactional email HTML** — auth confirm, password reset etc., rendered via Resend or captured HTML

**Explicitly out of scope**
- Workflow builder (`/workflows/builder/*`) — user stated it's WIP and will be tested separately
- Admin pages (`/admin/*`) — user skip
- Any Stripe-live flows — `/subscription` and `/payments` pages are visually audited but no Stripe buttons clicked; user will test manually
- Integration OAuth consent flows — no external provider tests; Connect buttons verified only up to the redirect URL
- Development / debug / showcase routes (`/test/*`, `/debug*`, `/fix-notion-template`, `/hubspot-*`, `/icon-preview`, `/node-design-showcase`, `/oauth/callback`)
- Functional workflow execution, trigger firing, webhook delivery
- Review pages (user skip)
- **Non-Chrome browser variation** — per `PLAYWRIGHT.md`, Chrome only. Safari/Firefox differences not tested.
- **Tier-gated UI (Pro / Business / Enterprise views)** — test account is free tier. Upgrade CTAs visible, but Pro-only states rendered only as the upsell side. Added to manual handoff in §10.
- **Motion / animation quality** — anecdotal flagging only; no systematic capture of transitions.
- **Performance (LCP / CLS / Web Vitals)** — not part of design audit; can be added as a separate Lighthouse pass if user wants.
- **RTL / locale variation** — not a stated priority.

---

## 2. Status Dashboard

Keep this tight. Expand per-page details in §7 and §8.

### 2.1 Phases

| Phase | Name                                          | Status   | Notes |
|-------|-----------------------------------------------|----------|-------|
| 0     | Environment & safety setup                    | in-progress | Vercel linked, preview env pulled, dev DB confirmed |
| 1     | Playwright harness + test account             | pending  |       |
| 2     | Baseline capture (screenshots + console) all pages | pending  |       |
| 3     | Per-page audit + redesign proposals (batched) | pending  |       |
| 4     | Implementation of approved redesigns          | pending  |       |
| 5     | Post-redesign regression sweep                | pending  |       |
| 6     | Manual-testing handoff report                 | pending  |       |
| 7     | Orphan audit — list unused pages/components   | pending  | user-requested; first entry: `/apps-v2` (deleted 2026-04-24) |

### 2.2 High-level counts (updated as pages are processed)

| Metric                                  | Target | Done |
|-----------------------------------------|--------|------|
| In-scope pages                          | ~54    | 0    |
| Baseline screenshots captured           | ~432*  | 0    |
| Pages with button inventory recorded    | ~54    | 0    |
| Pages with redesign proposal            | TBD    | 0    |
| Pages with redesign merged              | TBD    | 0    |

\* 54 pages × 4 breakpoints × 2 modes. Some flow pages may not need all breakpoints; final count will be lower.

---

## 3. Environment & Safety

### 3.1 Database

| Env      | Supabase project                           | Ref                    | Used by                             |
|----------|--------------------------------------------|------------------------|-------------------------------------|
| Dev      | `chainreact-supabase-dev`                  | `xzwsdwllmrnrgbltibxt` | **All testing in this plan**        |
| Prod     | `chainreact-supabase-production`           | `gyrntsmtyshgukwrngpb` | Off-limits                          |

**Verification source:** `vercel env pull .env.preview --environment=preview` pulled 152 vars; `NEXT_PUBLIC_SUPABASE_URL` prefix is `xzwsdwllmrnrgbltibxt` → dev project. **Any run that shows a Supabase URL starting with `gyrntsmtyshgukwrngpb` must be halted immediately.**

> NOTE: An older doc at `learning/docs/URGENT-shared-database-issue.md` described a shared DB — that condition was resolved sometime after 2025-10-20 when the prod project was created. The URGENT doc is now outdated.

### 3.2 Env file

- `.env.local` at repo root (git-ignored; matched by `.env*` / `.env*.local` rules in `.gitignore`). User pulled Preview vars into it directly. All test tooling reads from it.
- Do NOT commit `.env.local`.
- Earlier `.env.preview` was created during recon then deleted — avoid recreating it. Single source of truth = `.env.local`.

### 3.3 Dev server strategy

User's dev server is live on **http://localhost:3001** loaded from `.env.local` (Supabase URL confirmed pointing at `xzwsdwllmrnrgbltibxt` = dev DB). Playwright will target this server directly — no isolated second server needed.

Playwright `baseURL` → `http://localhost:3001`. Do **not** run `npm run dev`; the user's server is already live and healthy.

### 3.4 Safety checklist (must all be true before any click that writes to DB)

- [ ] `.env.local` NEXT_PUBLIC_SUPABASE_URL starts with `xzwsdwllmrnrgbltibxt`
- [ ] Playwright baseURL is `http://localhost:3001` (not chainreact.app, not any other host)
- [ ] Test account email contains `+design-test` (easy to purge)
- [ ] Stripe-bound buttons not clicked
- [ ] No bulk delete / admin actions invoked
- [ ] No migration commands run against any DB as part of this plan

### 3.5 Test account

Created via Supabase service role against dev DB.

| Field              | Value                                     |
|--------------------|-------------------------------------------|
| Email              | `design-test+claude@chainreactapp.com`    |
| Password           | generated at creation, stored in .env.preview as `TEST_USER_PASSWORD` (not committed) |
| auth.users.id      | _filled after creation_                   |
| Plan / entitlements| Free tier, no beta flags unless needed    |
| Admin capabilities | none                                      |

Storage of credentials: `.env.preview` only. Delete user at end of plan.

---

## 4. Playwright Harness

### 4.1 Existing state

- `playwright.config.ts` exists at repo root
- `@playwright/test@1.52.0` installed
- Existing tests live in `/tests`
- `PLAYWRIGHT.md` prescribes real Chrome (not Chromium), headed for MCP-driven runs. For this plan we'll use `channel: 'chrome'` headless — speed + reproducibility matter more than visual headed runs.

### 4.2 New harness components (to be written in Phase 1)

```
/tests/design-audit/
  .gitignore                  # ignore screenshots/ and artifacts/
  README.md                   # how to run; env requirements; troubleshooting
  fixtures/
    auth.ts                   # authenticated context factory (Supabase password grant → sets cookies)
    breakpoints.ts            # [{mobile:375×812},{tablet:768×1024},{laptop:1280×800},{wide:1920×1080}]
    routes.ts                 # full in-scope route manifest; source of truth for enumeration
    dynamic-seeds.ts          # team slug, ticket ID, org slug resolved at runtime from dev DB
  utils/
    theme.ts                  # toggles next-themes via localStorage.theme + reload; asserts html.dark class
    capture.ts                # captureAll(page, slug, mode) → viewport + full-page; all 4 breakpoints
    hover.ts                  # captureHoverStates(page, selectors[]) — primary CTAs + nav
    focus.ts                  # captureFocusStates(page, selectors[]) — keyboard-focus rings
    modal.ts                  # openAndCapture(trigger, modalSelector) — treats modal as own surface
    state-captures.ts         # capture empty / loading / error / skeleton per page helper
    toast.ts                  # trigger + capture toast/bell notification
    forms.ts                  # validation: submit empty / invalid → capture error state
    scroll.ts                 # capture mid-scroll and bottom-of-page states
    dropdown.ts               # open dropdowns/popovers and capture
    console-collector.ts      # pushes page console + pageerror into per-route JSON sidecar
    button-trace.ts           # enumerate buttons/links → click → assert navigation/modal/API
    axe-runner.ts             # @axe-core/playwright per page → JSON report
    link-check.ts             # HEAD-check external hrefs on marketing pages
  specs/
    01-smoke.spec.ts          # Phase 1 — login + /workflows sanity
    02-baseline.spec.ts       # Phase 2 — full route × breakpoint × mode matrix
    03-modals.spec.ts         # every modal as its own surface
    04-states.spec.ts         # empty / loading / error / skeleton per page
    05-forms.spec.ts          # form validation error states
    06-a11y.spec.ts           # axe-core pass per page
    07-nav.spec.ts            # top/sidebar/footer audit
    08-hover-focus.spec.ts    # hover + keyboard-focus for primary CTAs
    09-auth-state.spec.ts     # public pages logged-out AND logged-in
    10-dead-links.spec.ts     # marketing external link HEAD check
    11-transactional-email.spec.ts  # Resend preview / HTML capture
    per-page/                 # Phase 3+ regression specs per redesigned page
  scripts/
    create-test-account.ts    # Supabase service role script — creates design-test+claude@chainreactapp.com
    seed-dynamic-data.ts      # creates a team, a support ticket, an org for dynamic route coverage
    delete-test-account.ts    # teardown at end of plan
  reports/                    # git-ignored; axe JSON + console JSON + button-trace JSON per run
  screenshots/                # git-ignored; /phase/slug/breakpoint-mode[-variant].png
```

### 4.3 Breakpoints

| Name   | Width | Height | Why                                           |
|--------|-------|--------|-----------------------------------------------|
| mobile | 375   | 812    | iPhone 13/14 baseline, dominant mobile size   |
| tablet | 768   | 1024   | iPad portrait, sidebar collapse threshold     |
| laptop | 1280  | 800    | MacBook Air 13", majority of app traffic      |
| wide   | 1920  | 1080   | Large monitor, marketing-page extreme         |

### 4.4 Theme modes

Light + dark, toggled via `localStorage.theme = 'dark' | 'light'` then reload, OR whatever the app's theme store uses (verify in Phase 1). Each route captured in both modes.

### 4.5 Screenshot storage

Path: `/tests/design-audit/screenshots/<phase>/<route-slug>/<breakpoint>-<mode>.png`

Keep out of git; add to `.gitignore`. User can view them via IDE.

### 4.6 Console error policy

Any run that produces a `pageerror` or a `console.error` containing `Error:`, `Warning:` at severity error, or `Uncaught` — flagged on the per-page report. React hydration warnings flagged separately.

### 4.7 Button audit policy

For each page:
1. Enumerate every `button`, `a[href]`, `[role="button"]`, form submit.
2. Classify each by expected effect (nav / modal / API / OAuth redirect / destructive / external).
3. Click, observe outcome, assert matches expected class.
4. Record PASS / FAIL / SKIP-destructive with evidence (screenshot + network trace).

**Never clicked automatically:**
- Any button in a confirmation dialog that cascades to data deletion beyond the test user's own rows
- Stripe checkout / portal buttons
- OAuth "Connect" buttons beyond asserting redirect URL
- Logout (saved for last per-page to keep session alive)

---

## 5. Methodology

### 5.1 Per-page acceptance criteria

A page is "baseline complete" when:
- [ ] Viewport + full-page screenshots at all 4 breakpoints × both modes (16 per page)
- [ ] Scrolled-mid + scrolled-bottom captures for any page longer than 1.5 viewports
- [ ] Each modal on the page captured at all 4 breakpoints × both modes
- [ ] Hover + keyboard-focus captured for primary CTAs and nav items
- [ ] Empty / loading / error / skeleton state captured where applicable
- [ ] Toast / notification triggered and captured
- [ ] Forms: empty-submit + invalid-input error states captured
- [ ] Dropdowns / tooltips / popovers: opened state captured
- [ ] axe-core report attached with no new critical violations
- [ ] Public pages: captured in both logged-out AND logged-in states
- [ ] No console errors outside a documented allow-list
- [ ] Every button/link enumerated, classified, and click-traced
- [ ] Dead external links (marketing): HEAD-check passed
- [ ] Obvious issues noted (truncation, overflow, dark-mode contrast fails, broken responsive)

A page is "redesign complete" when:
- [ ] Reference researched (Zapier, Make, n8n, or Linear/Notion where design patterns fit)
- [ ] Proposal diff drafted and reviewed by user
- [ ] Implementation merged
- [ ] Re-capture shows issues resolved, no regressions elsewhere

### 5.2 Redesign principles (from CLAUDE.md + user memory)

- **Stop over-designing.** Match real apps. Flat layouts. No filler patterns.
- Light + dark must work equally; never ship a mode unreviewed.
- Never use `ScrollArea` in configuration modals — use `ConfigurationContainer`.
- Do not touch `FlowEdges.tsx`, auth store guardrails, or the workflow builder canvas.
- Prefer small edits over rewrites; honor existing component patterns.

### 5.3 Review cadence

Batches of **3–5 pages per PR**. User reviews screenshots + diff before merge. No single megamerge.

---

## 6. Test Execution Order

Ordered for maximum signal early and blast-radius containment:

1. **Marketing / public pages first** — no auth required, no DB writes, lowest risk, highest visitor traffic.
2. **Auth flow pages** — gatekeeper for everything else; must be solid.
3. **App shell, non-destructive read pages** (analytics, templates, connections-view, settings read).
4. **App shell with light writes** (create template draft, toggle setting, mark notification read).
5. **AI assistant page** — isolated, costs real OpenAI tokens; budget 3 turns.
6. **Invite & onboarding** — reset test account or create sibling account to exercise first-run.
7. **Support ticket detail** — needs a seeded ticket in dev DB.

---

## 7. Full Page Inventory

Legend for status columns: `—` not started · `B` baseline captured · `R` redesign proposed · `M` merged · `V` verified post-merge.

### 7.1 Marketing & Public (no auth)

| Route                       | Purpose                      | Priority | Baseline | Redesign | Notes |
|-----------------------------|------------------------------|----------|----------|----------|-------|
| `/`                         | Landing                      | P0       | —        | —        |       |
| `/pricing`                  | Plans + pricing              | P0       | —        | —        |       |
| `/about`                    | Company                      | P1       | —        | —        |       |
| `/enterprise`               | Enterprise pitch             | P1       | —        | —        |       |
| `/docs`                     | Documentation landing        | P1       | —        | —        |       |
| `/community`                | Community hub                | P2       | —        | —        |       |
| `/support`                  | Support center               | P1       | —        | —        |       |
| `/support/tickets/[id]`     | Ticket detail (seed needed)  | P2       | —        | —        | needs seeded ticket |
| `/contact`                  | Contact form                 | P2       | —        | —        |       |
| `/learn`                    | Learning resources           | P2       | —        | —        |       |
| `/feedback`                 | Feedback form                | P2       | —        | —        |       |
| `/request-integration`      | Integration request form     | P2       | —        | —        |       |
| `/terms`                    | Terms of service             | P2       | —        | —        | legal, do not rewrite copy |
| `/privacy`                  | Privacy policy               | P2       | —        | —        | legal, do not rewrite copy |
| `/security`                 | Security statement           | P2       | —        | —        |       |
| `/sub-processors`           | Sub-processors list          | P3       | —        | —        |       |
| `/waitlist`                 | Waitlist form                | P2       | —        | —        |       |
| `/waitlist/success`         | Waitlist confirmation        | P3       | —        | —        |       |

### 7.2 Auth Flow

| Route                              | Purpose                       | Priority | Baseline | Redesign |
|------------------------------------|-------------------------------|----------|----------|----------|
| `/auth/login`                      | Sign in                       | P0       | —        | —        |
| `/auth/register`                   | Sign up                       | P0       | —        | —        |
| `/auth/reset-password`             | Password reset request/finish | P1       | —        | —        |
| `/auth/confirm`                    | Confirm email                 | P1       | —        | —        |
| `/auth/confirmation-success`       | Post-confirm landing          | P2       | —        | —        |
| `/auth/email-confirmed`            | Email confirmed landing       | P2       | —        | —        |
| `/auth/waiting-confirmation`       | Awaiting email verify         | P1       | —        | —        |
| `/auth/beta-signup`                | Beta sign-up                  | P2       | —        | —        |
| `/auth/sso-session`                | SSO in progress               | P3       | —        | —        |
| `/auth/sso-signup`                 | SSO new account               | P3       | —        | —        |
| `/auth/sso-error`                  | SSO error                     | P3       | —        | —        |
| `/auth/auth-code-error`            | Magic-link code error         | P3       | —        | —        |
| `/auth/error`                      | Generic auth error            | P3       | —        | —        |

### 7.3 App shell (auth required)

| Route                                   | Purpose                             | Priority | Baseline | Redesign | Notes |
|-----------------------------------------|-------------------------------------|----------|----------|----------|-------|
| `/workflows`                            | Workflows list (main page)          | P0       | —        | —        | user named this |
| `/workflows/newly`                      | Recent / new workflows              | P2       | —        | —        |       |
| `/workflows/templates`                  | Template gallery                    | P1       | —        | —        |       |
| `/templates`                            | Main templates page                 | P1       | —        | —        |       |
| `/templates/showcase`                   | Template showcase                   | P2       | —        | —        |       |
| `/ai-assistant`                         | AI Assistant page                   | P0       | —        | —        | user named this; real OpenAI cost |
| `/analytics`                            | Workflow analytics                  | P1       | —        | —        |       |
| `/connections`                          | Apps / connected integrations (canonical) | P0   | —        | —        | user-confirmed canonical Apps page |
| `/connections/trello-auth`              | Trello auth landing                 | P3       | —        | —        |       |
| `/webhooks`                             | Webhook management                  | P2       | —        | —        |       |
| `/settings`                             | User settings                       | P0       | —        | —        |       |
| `/settings/ai-usage`                    | AI usage dashboard                  | P1       | —        | —        |       |
| `/subscription`                         | Subscription / billing view         | P1       | —        | —        | visual only, no Stripe clicks |
| `/payments`                             | Payment history                     | P2       | —        | —        | visual only |
| `/teams`                                | Teams list                          | P1       | —        | —        |       |
| `/teams/[slug]`                         | Team detail                         | P2       | —        | —        |       |
| `/teams/[slug]/members`                 | Team members                        | P2       | —        | —        |       |
| `/team-settings`                        | Team settings                       | P2       | —        | —        |       |
| `/org`                                  | Org landing                         | P2       | —        | —        |       |
| `/org/[slug]/settings/[[...section]]`   | Org settings                        | P2       | —        | —        | catch-all route |

### 7.4 Invite & onboarding

| Route                  | Purpose                     | Priority | Baseline | Redesign |
|------------------------|-----------------------------|----------|----------|----------|
| `/invite`              | Accept invite               | P1       | —        | —        |
| `/invite/signup`       | Invite-based signup         | P1       | —        | —        |
| `/new`                 | New-user onboarding         | P0       | —        | —        |

### 7.5 Out of scope (listed for completeness)

`/admin`, `/admin/email-preview`, `/admin/integration-tests`, `/workflows/builder`, `/workflows/builder/[id]`, `/workflows/ai-agent`, `/debug-notion`, `/debug/stripe-account`, `/fix-notion-template`, `/hubspot-config`, `/hubspot-fields`, `/icon-preview`, `/node-design-showcase`, `/oauth/callback`, `/test/apps`, `/test/hitl`, `/test/nodes`.

---

## 8. Per-Page Detail Template

Each page gets its own section appended below as work progresses. Template:

```markdown
### /route-name — <short title>

**Priority:** P0 · **Auth:** required/none · **Last audit:** YYYY-MM-DD

#### Baseline findings
- Screenshots: `/tests/design-audit/screenshots/baseline/<slug>/`
- Console: <N errors, M warnings — links to JSON>
- Layout issues: <bullets>
- Contrast issues: <bullets>
- Responsive issues: <bullets — which breakpoint broke>

#### Button inventory
| Selector | Expected | Actual | Status |
|----------|----------|--------|--------|

#### Redesign proposal
- Reference: <Zapier/Make/n8n/Linear link + rationale>
- Diff summary: <1–3 bullets>
- Files touched: <list>

#### Verification (post-merge)
- Screenshots diff: before vs after
- Console clean: yes/no
- Buttons retested: yes/no

#### Open questions for user
- <bullets>
```

---

## Phase 3 — Batch 1 Audit (P0 pages, 2026-04-24)

### Cross-cutting findings (apply to multiple pages)

**1. Authenticated sidebar does not collapse on mobile — HIGH PRIORITY**
- **Observed on:** `/workflows`, `/connections`, `/ai-assistant`, all app-shell pages at 375px.
- **Issue:** The vertical nav sidebar (Workflows, Templates, Connections, Assistant, Analytics, Organization, Teams, Billing, Settings) persists at ~80px wide on 375px viewports, leaving ~295px for content.
- **Why it matters:** Every major competitor (Zapier, Make, n8n, Linear, Notion) collapses to a hamburger on mobile. Keeping a persistent icon-rail on a 375px phone is unusable for any table- or form-heavy page.
- **Reference:** Linear's mobile web view — hamburger-toggled left drawer. Zapier mobile — top-bar hamburger, sidebar becomes off-canvas drawer.
- **Proposed fix:** At `md:` (768px) and below, replace sidebar with a hamburger that opens an off-canvas drawer. Re-use the existing nav items, just swap layout above a breakpoint.
- **File likely involved:** the app shell layout at `app/(app)/layout.tsx` and related sidebar components.

**2. Multiple marketing pages are theme-locked (light == dark) — NEEDS DECISION**
- **Observed on:** `/`, `/pricing`, `/about`, `/auth/login`, `/auth/register` (and likely other auth-flow pages).
- **Issue:** Light-mode and dark-mode screenshots are byte-identical. These pages ignore `next-themes` and render a fixed dark palette.
- **Two interpretations:**
  1. **Intentional** — lots of marketing sites (Linear, Vercel) lock to a single brand color scheme. Legitimate.
  2. **Bug** — pages were built before theme support shipped, or use hardcoded Tailwind classes instead of theme tokens.
- **CLAUDE.md §7** mandates both modes across the app. Decision needed: do marketing + auth pages get dual theme support, or are they excluded from that rule?
- **Ask user:** which?

**3. Data-fetch errors surfaced by baseline console collection — REAL BUGS**
- `[PlansStore] Failed to fetch plans` — **46 occurrences** across routes; repeats per route because many pages probably call the plans store on mount.
- `Failed to load resource: 404` — **36 occurrences**.
- `[useWorkspaces] Error fetching workspaces: {}` — **7 occurrences**; empty error object suggests error handler ate the real message.
- `ReferenceError: reactFlowInstance is not defined` in CustomNode — **2 occurrences** (leaking from workflow-builder imports onto non-builder routes).
- Full per-route breakdown lives in `tests/design-audit/reports/baseline/*-console.json`.
- **These should be fixed before the user-facing redesign pass** so per-page audits aren't polluted by known issues.

### `/` — Landing (P0)

**Baseline:** `tests/design-audit/screenshots/baseline/landing/` (16 PNGs). Fullpage included.
- **Strong:** clean hero, "Describe your workflow. AI builds it. You make it better." — aligns with STRATEGY.md positioning ("AI-native, not cheap Zapier"). Free-during-beta pill, two CTAs, product demo video placeholder beside hero.
- **Theme-locked dark** (see cross-cutting #2).
- **Mobile:** hamburger correctly replaces desktop nav. Collapsed hero works. Video placeholder moves below hero.
- **Fullpage:** extremely long page (~20 screens of content at laptop). Includes logos, features, how-it-works, "AI outlines not air traffic control", "Built for every team", feature matrix, pricing teaser, "Your first workflow in 60 seconds" CTA.
- **Concerns:**
  - Video placeholder on the right (laptop viewport) is empty — it's a large dead rectangle on a first impression. Either embed the video, add an animated preview, or shrink the placeholder.
  - Very long fullpage — length itself isn't a bug, but "Zapier-style one-page marketing" can be overwhelming. Consider breaking into a shorter landing + linked feature pages.
- **Redesign proposal:** defer — no blocking issues. Revisit after user feedback on theme-lock question.

### `/pricing` — Pricing (P0)

**Baseline:** `tests/design-audit/screenshots/baseline/pricing/`
- **Strong:** 5-tier layout (Free / Pro highlighted / Team / Business / Enterprise). Monthly/Annual toggle with "Save up to 19%" badge. Clear feature list per tier.
- **Theme-locked dark** (cross-cutting #2).
- **Mobile:** cards stack vertically. **Free tier appears first**, which buries the Pro tier (the one highlighted/recommended). Competitors (Linear, Vercel) either put Pro first on mobile OR render the recommended tier first by default.
- **Concern:** 5 tiers visible at once on laptop (1280) is dense — text shrinks, cards are cramped. Linear renders 4 tiers max at 1280 and pushes Enterprise to a separate "Contact sales" block.
- **Redesign proposal:**
  - On mobile, open with the Pro tier at top (the one highlighted/recommended).
  - Consider collapsing Enterprise into its own "Need something custom? Contact sales" band below the 4-tier grid, reducing the main card density.

### `/workflows` — Workflows list (P0)

**Baseline:** `tests/design-audit/screenshots/baseline/workflows/`
- **Strong:** laptop-light empty state is the cleanest view I've captured. Stats cards (Active / Workflows / Today / Success), toolbar with Workflows/Folders tabs, search, list/grid toggle, Group by Workspace, Filters, Create workflow. Central empty-state illustration with "No workflows found" + CTA.
- **Theme-responsive.**
- **Mobile:** the first-run onboarding tour ("Welcome to ChainReact! Step 1 of 8") overlays the page, blocking the underlying UI. Expected for a new user — but the baseline also captured this for tablet/laptop; the tour is persistent until dismissed and we couldn't dismiss it during capture.
- **A11y:** 1 critical + 1 serious violation (details in `axe-summary.jsonl`).
- **Console:** 11 errors — `useWorkspaces` fetch fail, `PlansStore` fetch fail, `reactFlowInstance` undefined leakage from CustomNode.
- **Redesign proposal:**
  - **Needs a separate capture pass** with the onboarding tour dismissed, so we audit the actual workflows-list UI without a modal on top.
  - Fix the `useWorkspaces` error — it likely explains the empty `{}` error object: error not stringified or not typed properly.
  - Audit the stats cards: Zapier removed stats cards from its Zaps list in 2023 (moved to a separate analytics surface). Make keeps them. Worth deciding if they belong on the primary page or on `/analytics`.

### `/connections` — Apps / connected integrations (P0)

**Baseline:** `tests/design-audit/screenshots/baseline/connections/`
- **Strong:** clear heading, subtitle ("Manage your connected accounts. Connect new integrations from the workflow builder."), search, "All 0" / "Connected 0" filter pills, empty-state "No connections yet".
- **Theme-responsive.**
- **Mobile:** sidebar-persist issue (cross-cutting #1) makes the page feel cramped.
- **Concern:** "Connect new integrations from the workflow builder" — this is user-hostile copy. It tells users the connections page can't actually create connections; they have to go somewhere else. Every competitor (Zapier, Make, n8n) lets users connect integrations from the Apps/Connections page directly. Either add a "Connect new" button that opens the provider picker here, or rewrite the copy to explain why it's a builder-only flow.
- **Console:** 7 errors.
- **Redesign proposal:**
  - **High priority:** add a "Connect new integration" / "Browse apps" CTA directly on this page. Users looking at their connections expect to add more from here, not navigate to the builder.
  - Filter pills could become a segmented control with counts (Linear/Make pattern).

### `/ai-assistant` — AI Assistant (P0)

**Baseline:** `tests/design-audit/screenshots/baseline/ai-assistant/`
- **Strong:** clean upsell card when on free tier — Pro features listed, price, clear CTA.
- **Theme-responsive.**
- **BUG — LAPTOP + WIDE:** the "Unlock Assistant" heading is clipped by the sticky top nav. The upsell card sits in the middle of the viewport but its title extends above the nav's bottom edge. First impression of this page on desktop is "half a heading".
- **BUG — MOBILE:** sidebar-persist issue (cross-cutting #1) plus the upsell card bleeds off the top — mobile users see "AI workflow builds", "Unlimited active workflows", "All integrations (unlimited)" list items without the context of what they're for.
- **Console:** 5 errors.
- **Redesign proposal:**
  - **Must fix:** upsell card should be anchored below the top nav (add top padding or use `min-h-[calc(100vh-var(--nav-height))]` on the container).
  - Mobile: upsell card should scroll from the top, not vertically-center.
  - The free-tier paywall is also the page's default empty state — for a feature called "AI Assistant", showing only a paywall rather than any preview (demo chat, example prompts, video) is a missed conversion opportunity. Zapier Copilot shows a disabled-but-visible chat UI with "Upgrade to use" overlay.

### `/auth/login` — Sign in (P0)

**Baseline:** `tests/design-audit/screenshots/baseline/auth-login/`
- **Strong:** clean centered card, email/password, OAuth row (Google/GitHub/Microsoft), SSO option, link to Register.
- **Theme-locked dark** (cross-cutting #2).
- **Mobile:** card fits at 375px. **Microsoft button text may be clipping** at 375px — "Microsoft" reaches the right edge; verify in full-res.
- **Concern:** the three OAuth buttons stack as a 3-column grid at mobile, which is tight. Linear uses a single-column OAuth stack at narrow widths.
- **A11y:** no critical violations reported; specific violations in per-route JSON.
- **Redesign proposal:**
  - At `sm:` and below, stack the OAuth buttons vertically — gives each full-width, reduces text-clipping risk.
  - Consider compressing the "Or continue with" / "Or" divider stack — two dividers in 500px of vertical card space is heavy.

---

## Phase 3 — Batch 2 Audit (2026-04-24)

### `/auth/register` — Sign up (P0)

- **Theme-locked dark** (same as `/auth/login`).
- Clean centered card: "Join ChainReact — Start automating your workflows today". OAuth row (Google/GitHub/Microsoft), divider "Or with email", First Name + Last Name + Email + Password + Confirm Password.
- **Consistent with login** — good. Same visual language.
- **Mobile**: tight on 375px — same 3-col OAuth stacking concern from login applies. Stack vertically at `sm:`.
- **Concern**: 6 fields (name split + email + two passwords) makes the form feel long. Linear, Clerk hosted UI, and Zapier all use email-first single-step, with name collection deferred to post-signup onboarding. Worth considering a simpler 2-field (email + password) flow for signup, or at least dropping the First/Last Name split to one "Full name" field.
- **Redesign proposal:** merge First Name + Last Name into a single "Full name" field; optionally defer to a post-signup profile step.

### `/new` — New-user onboarding (P0)

- **Theme dark** (inherits marketing shell).
- Content: "New: AI-Powered Workflow Automation" pill, hero "Purpose-built tool for automating workflows", subhead, "Start building" / "Browse templates" CTAs, screenshot of a workflow.
- **This is a marketing-style page, not an onboarding flow.** A brand-new user reaching `/new` sees no steps (no name capture, no workspace selection, no connect-first-integration prompt, no sample-workflow-creation). Just two CTAs that push them into the builder or templates. Compare to Zapier (tour + first-zap wizard), Make (onboarding scenario templates), Linear (workspace setup wizard).
- **Ask user:** is `/new` intended as a marketing hero (because onboarding happens elsewhere or via the tour overlay seen on `/workflows` mobile), or is this route supposed to be a multi-step onboarding wizard that hasn't been built yet?
- **Redesign proposal (pending clarification):** if this is the canonical new-user landing, add at minimum a 3-step progress indicator: ① Name / workspace name → ② "What do you want to automate?" (goal selection) → ③ "Connect your first app OR pick a template". Zapier's first-run flow is a reasonable reference.

### `/templates` — Template library (P1)

- **Theme-responsive.**
- **Excellent layout** — Template Library heading, search, sort dropdown, 11 category filter pills ("All 43", "AI Automation 6", "Customer Service 5", …, "Sales & CRM 6"), 3-column card grid.
- Cards include provider logos, name, description, difficulty badge, tag, estimated time ("6 mins"). Comparable to Zapier and n8n template galleries.
- **Mobile**: baseline screenshot shows the old sidebar (pre-fix). Mobile now shows hamburger per the shell fix. Category filter pills wrap to multiple rows — a horizontal-scroll "pill rail" would reduce vertical space (Spotify/Apple Podcasts pattern) but wrapped is also fine.
- **No design issues.** Keep as-is.

### `/analytics` — Workflow analytics (P1)

- **Theme-responsive.**
- Free-tier view shows a Pro upsell modal-card over the analytics shell. Behind the card: the Analytics page is visible (charts + stats).
- **BUG (same as `/ai-assistant`):** the "Unlock Analytics" heading is clipped by the sticky top nav on laptop+wide. This is the same vertical-centering bug — the modal container doesn't account for the nav.
- **A11y**: 1 critical violation per axe.
- **Redesign proposal (shared with `/ai-assistant`):**
  - Fix the upsell-card top offset to respect the top nav height. Apply to both `/analytics` and `/ai-assistant` — it's likely the same `<UpgradeCard>` or similar component used by both.
  - Same paywall-anti-pattern critique as `/ai-assistant`: showing only a paywall for a feature called "Analytics" is a weak pitch. Show a teaser: faded-out chart previews with "Upgrade to see real data" overlay.

### `/settings` — User settings (P0)

- **Theme-responsive.**
- Clean single-column settings layout. "Account" heading, Profile section (avatar upload, Full name input, Save profile button). Email Address section (current email + Change email button). Password section (below fold).
- Test account email appears correctly.
- **Strong design.** Matches Linear/Vercel settings patterns.
- **A11y**: 1 critical violation per axe — likely another icon-only button.
- **Mobile**: captured pre-fix with persistent sidebar; post-fix mobile will have the hamburger.
- **No structural redesign needed.** Investigate the a11y violation; otherwise keep.

### `/docs` — Documentation (P1)

- **Theme-responsive** (light shown).
- Dedicated docs shell (not the app shell). Top bar: "ChainReact / Docs" + "Get Started" CTA.
- Left sidebar: 5 sections (Getting Started, Core Features, Integrations & API, AI Features, Configuration) with 15+ pages.
- Main: "Overview" + markdown content + inline screenshot.
- Closely matches Vercel Docs / Linear Docs structure. **Good.**
- **Concern:** the top nav shows "Get Started" (green highlight CTA) — but a user reading docs is likely either logged in or evaluating. A single "Sign in / Sign up" pattern would be clearer. Minor.
- **Mobile**: unchecked. Docs pattern usually collapses sidebar to a dropdown on mobile. Verify.
- **No redesign needed.** Keep.

---

## Cross-cutting fixes applied (2026-04-24)

### Fix #1 — Mobile sidebar collapses to hamburger drawer

- **Files touched:**
  - `components/app-shell/AppShell.tsx` — added `mobileSidebarOpen` state; passes `onMenuClick` to topbar and `isMobileOpen` + `onMobileClose` to sidebar.
  - `components/app-shell/UnifiedSidebar.tsx` — accepts `isMobileOpen` + `onMobileClose`; renders off-canvas overlay + backdrop at `md:` and below; auto-closes on pathname change; auto-closes on Escape key.
  - `components/app-shell/UnifiedTopBar.tsx` — imports `Menu` icon; left spacer replaced with hamburger button visible only at `md:hidden`; includes `aria-label="Open navigation menu"`.
- **Verification:** `tests/design-audit/specs/99-verify-mobile-nav.spec.ts` — captures closed (hamburger-only) and opened (drawer) mobile states for `/connections` and `/ai-assistant` (passed); `/workflows` verify timed out because the onboarding tour intercepts clicks at mobile — not a fix regression.
- **Status:** ✅ shipped.

### Fix #2 — `button-name` a11y on workflows list

- **Files touched:**
  - `components/workflows/RecentFavorites.tsx` — added `aria-label` to 3 icon-only buttons (remove-from-favorites, add/remove-favorite, remove-from-recent).
  - `components/workflows/WorkflowsPageContent.tsx` — added `aria-label` to 2 `<Checkbox>` instances (select-all and per-row select) and to 2 previously-unlabeled `<DropdownMenuTrigger>` buttons (folder actions × 2).
- **Verification:** axe re-ran against `/workflows`. Critical button-name violations: 2 → 1. One residual `.h-6.w-6.hover:bg-accent` button remains — it lives in a child component I couldn't locate via direct grep (suspect a shared UI wrapper). Flagged for a second pass.
- **Status:** ⚠️ partial. Fix for residual one deferred.

### Pending cross-cutting fixes

- `PlansStore: Failed to fetch plans` (46 occurrences). Likely a race in `/api/plans` fetch vs auth readiness. Not yet investigated.
- `useWorkspaces: Error fetching workspaces: {}` (7 occurrences) — empty error object. Error handler needs to stringify / extract real error.
- `reactFlowInstance is not defined` in `CustomNode` — leaking from builder onto non-builder routes via unconditional import.
- `/analytics` and `/ai-assistant` upsell-card nav clipping — same component likely, single fix candidate.
- Theme-lock on `/`, `/pricing`, `/about`, `/auth/login`, `/auth/register` — awaiting user decision: intentional or bug?

---

## Phase 3 — Batch 3 Audit (2026-04-24)

### `/support` — Help center (P1)

- Dedicated support shell (not app shell). "ChainReact / Support" top bar + "Get Started" CTA.
- Three primary action cards: **Submit a Ticket** (with "Sign in required" badge — nice touch), **Email Us**, **Community**.
- Resources row: Documentation, Templates, Changelog.
- FAQ section with expandable questions.
- **Strong.** Matches Linear / Vercel help-center patterns. **Keep.**

### `/teams` — Team features (P1)

- Paywall on free tier — rendered via `AccessGuard`.
- **Benefits from the Fix #3 shipped this session** (upsell clipping). Once re-captured, heading "Unlock Teams" will render correctly.
- Team Plan $49/mo listing with 11 feature bullets, Upgrade to Team button.
- Behind the paywall: blurred "Teams" page shell with a "Create Team" button visible at top-right.
- **Consideration:** same paywall-only critique as `/ai-assistant` and `/analytics`. For the "Teams" feature, showing teaser UI (e.g., a mock team card with member avatars, "Upgrade to invite real members") converts better than a pure paywall.

### `/subscription` — Billing / subscription (P1)

- **Well-designed billing page.** App shell + Billing subsection with its own sidebar (Subscription active, Payments sibling).
- Top summary card: My plan (Free 750 requests/month), Billing ($0 billed annually), Requests 0/750 with progress bar, Connections 0/2 active, Teams 1/1, Members 1/3.
- "Choose your plan" section with Monthly / Annual toggle (green "Save up to 19%" badge). 5 plan cards — Free marked "Your plan" (green outline), Pro marked "Most popular" (orange outline). Each card shows strike-through monthly price and annual-equivalent price ("$19 → $15 /mo" for Pro). "Billed annually (save $48/year)" footnote.
- **Concern:** the strike-through price implies a promo — is this launch pricing? If yes, add a header note like "🎉 Launch pricing — first year". If no, the strike is misleading and should become the actual monthly price.
- **Concern:** Monthly/Annual toggle sits inside "Choose your plan" section. Stripe/Linear place the toggle at the top of the plan grid or between the current-plan summary and the plan grid. Minor.
- **Note:** user asked me to skip Stripe click-through, so the "Upgrade to Pro" buttons are visually audited only, not tested.

### `/payments` — Payment history (P2)

- Billing subsection (shares shell with `/subscription`). Payments tab active.
- "Payments — Task usage history and billing events" heading + Refresh button.
- Filter dropdown "All sources".
- Table headers: Date, Source, Workflow, Tasks, Balance.
- **Empty state:** inbox icon + "No payment history yet — Run a workflow to see your task usage here".
- **Clean.** Keep.

### `/waitlist` — Waitlist / early access (P2)

- Dark marketing hero: **"The Future of Workflow Automation"**.
- "Early Access Program" pill.
- Subhead: "Join the waitlist to be among the first to experience AI-powered workflow automation that connects to your favorite tools seamlessly."
- 3 feature pillars: Universal (integrations), AI-First (Built for the future), No-Code (Visual builder).
- Form at bottom: "Full Name" + "John Doe" placeholder.
- **Strong standalone marketing page.**
- **Concern:** this page duplicates content with the main landing (`/`). If waitlist is meant for gated early access, it should distinguish from the general landing — possibly de-emphasize the feature pillars (already on `/`) and focus on the waitlist value prop (exclusivity, early-adopter perks, referral bonuses).

### `/webhooks` — Webhook configuration (P2)

- App shell; sidebar active = **Workflows** (webhooks belongs to that nav section).
- Tab strip: **Configuration** (active) / Custom Webhooks / Integration Webhooks.
- Configuration content: "Webhook Configuration" heading, "Development (localhost)" environment pill, **large yellow "Development Mode" alert box** explaining testing options (ngrok, Postman, env vars). Production/Development URLs toggle. Green "Production Configuration" info card. Then a list of provider webhook URLs (Discord shown; more below).
- **Concerns:**
  - The Development Mode alert is always visible in dev, which is correct, but on the production host (`chainreact.app`) a user would never see this. However if the user is on prod but the code still renders the dev badge/alert due to a detection bug, it would confuse real customers.
  - The page title reads "Webhook Configuration" — no in-page "Webhooks" heading; sidebar-highlight says "Workflows". A breadcrumb like "Workflows › Webhooks" or a clearer page title would help orient users.
  - Copy button for webhook URLs is visible — good. No `aria-label` verified; may be flagged by axe.
- **Redesign proposal (low priority):** collapse the Development Mode alert by default (user can expand); show Production URLs as the default tab since they're the operative ones.

---

## Cross-cutting fixes applied (2026-04-24) — continued

### Fix #4 — Silence spurious `PlansStore` + `useWorkspaces` console errors

- **Files touched:**
  - `stores/plansStore.ts` — classify fetch failures; `TypeError: Failed to fetch` (browser-aborted during navigation) logs at debug level; real HTTP errors still log at error level.
  - `hooks/useWorkspaces.ts` — same abort-classifier; also serialize Error objects as `{ message, name }` instead of passing them directly to the logger (the logger uses `JSON.stringify` which produces `{}` for Error instances because Error properties are non-enumerable).
- **Verification:** re-ran smoke spec and inspected `post-login-console.json`. Before: 11 errors on /workflows (PlansStore × 4, useWorkspaces × 4, and others). After: 0 PlansStore or useWorkspaces errors — only GA CSP blocks (expected) and a Gravatar 404 (documented below).
- **Impact:** across the full baseline, this silences **46 + 7 = 53 spurious error lines per run**. Remaining console output is now meaningful (real bugs or expected-benign noise).
- **Status:** ✅ shipped.

### Known-benign remaining console noise

- **Google Analytics CSP blocks** (`Refused to connect to 'https://www.google.com/g/collect'`). Dev environment's CSP blocks GA telemetry. Expected in dev; whitelist or upgrade CSP if we want prod-parity in dev.
- **Gravatar 404** on users without a registered Gravatar. The `d=404` parameter is intentional: it forces Gravatar to 404 so Radix `<AvatarImage>` falls through to `<AvatarFallback>` and renders the user's initials. Alternatives (`d=mp`, `d=identicon`, `d=blank`) would either replace initials with a generic silhouette (worse UX) or hide the fallback entirely (broken UX). The 404 is the price of the correct fallback behavior. Not a bug.

### Fix #3 — Upsell-card nav clipping on `/analytics`, `/ai-assistant`, `/teams`, `/organization`

- **Root cause:** `components/common/AccessGuard.tsx` rendered the upsell card inside `absolute inset-0 flex items-center justify-center`. For cards taller than the parent `min-h-[60vh]` container, `items-center` pushed the top of the card above the content area (i.e., behind the top nav).
- **Fix:** changed alignment to `items-start` (always top-aligned) and added `overflow-y-auto py-8` so tall cards scroll gracefully instead of clipping. Works on all viewports.
- **Verification:** `tests/design-audit/specs/98-verify-upsell-clip.spec.ts` captured `/ai-assistant` and `/analytics` at mobile/laptop/wide post-fix. "Unlock Assistant" and "Unlock Analytics" headings render cleanly below the nav on all three sizes.
- **Status:** ✅ shipped. Covers `/teams` and `/organization` by reuse.

---

## Phase 3 — Batch 4 Audit (2026-04-24)

Focus: remaining marketing pages, auth subpages, legal/policy, miscellaneous routes not covered in Batches 1–3.

### High-priority issues surfaced

1. **`/feedback` is a placeholder.** Only content is `"Feedback — This page is under construction. Check back soon!"`. Must either be built out or the route/nav entry removed. Currently a dead-end on every user who clicks it.
2. **`/learn` renders the Sign In form.** At `/learn`, the capture shows the `/auth/login` card ("Welcome to ChainReact — Automate your workflows with ease"). Either this route silently redirects to login for logged-out visitors (without any "Sign in to access Learn" context) or the route is misconfigured. Users clicking "Learn" expect a learning-resources landing, not a login. **Investigate.**
3. **`/community` contains likely-fake stats + discussions.** Cards show "2,400+ Members, 850+ Discussions, 120+ Templates Shared, 94% Answer Rate" for a beta product behind a waitlist. Thread examples with usernames like "sarah.k", "dev_marcus", "automation_pro" look like placeholder data. **Decide:** real community (connect real data) or demo to remove/gate until the community exists?

### Theme inconsistency across marketing pages (nuance to earlier finding)

The earlier cross-cutting #2 was "theme-locked pages". More precisely — different pages lock to different themes:

| Route | Locked theme |
|-------|--------------|
| `/`, `/pricing`, `/enterprise`, `/waitlist`, `/request-integration` | dark |
| `/auth/login`, `/auth/register` | dark gradient background, light card |
| `/about`, `/contact`, `/feedback` | **light** |
| `/support`, `/docs` | light (dedicated doc/support shell) |

**There are three coexisting visual systems**: marketing-dark, marketing-light, and docs-light. Decision needed: consolidate, or delineate clearly which pages belong to which shell.

### Other findings

- **`/auth/reset-password`** — card-based form with a **dark navy "Reset Password" button**, not the orange→rose gradient used on `/auth/login`. Design inconsistency. Also sits on plain white page with no decorative background (login has a rich gradient). Looks stripped down.
- **`/contact`** — strong form + 3 info cards. Confirm `support@chainreact.app` actually forwards somewhere.
- **`/request-integration`** — dark-theme form; solid.
- **`/enterprise`** — "Automation at Scale" + 3 feature cards (Security & Compliance, SSO & SAML, Flexible Deployment). Good.
- **`/about`** — clean, solid.
- **Legal pages** (`/terms`, `/privacy`, `/security`, `/sub-processors`) — text-heavy; I did not audit content (`CLAUDE.md` marks these as "do not rewrite copy"). No visible layout issues.
- **Auth subpages** (`/auth/confirm`, `/auth/confirmation-success`, `/auth/email-confirmed`, `/auth/waiting-confirmation`, `/auth/beta-signup`, `/auth/sso-*`, `/auth/auth-code-error`, `/auth/error`) — all captured, no visible layout breaks. Did not functionally test retry flows.

---

## Cumulative Session Impact (2026-04-24)

### Code changes shipped

| # | Area | Files | Impact |
|---|------|-------|--------|
| 1 | Mobile sidebar → hamburger drawer | `AppShell.tsx`, `UnifiedSidebar.tsx`, `UnifiedTopBar.tsx` | Every auth'd page at `<md:` viewport |
| 2 | Icon-button aria-labels | `RecentFavorites.tsx`, `WorkflowsPageContent.tsx` | `/workflows` critical a11y 2→1; 7 labels added |
| 3 | Upsell-card nav clipping | `AccessGuard.tsx` | `/ai-assistant`, `/analytics`, `/teams`, `/organization` |
| 4 | Silence spurious fetch-abort errors | `stores/plansStore.ts`, `hooks/useWorkspaces.ts` | 53 error lines eliminated per baseline run |

Also: deleted orphaned `/apps-v2` page + component + route group + redundant `.env.preview`.

### Data points — original baseline vs post-fix baseline

| Metric | Original | Post-fix | Δ |
|--------|---------:|---------:|---|
| Total console error lines | ~230 | 136 | **−41%** |
| `PlansStore` errors | 46 | 0 | **−100%** |
| `useWorkspaces` errors | 7 | 0 | **−100%** |
| GA CSP blocks (benign) | 94 | 86 | (flat) |
| Gravatar 404 (intended) | 36 | 34 | (flat; intentional UX) |
| Critical a11y violations | 11 | 10 | −1 |
| Routes baseline-captured | 50 | 50 | — |
| Screenshots | 800 | 800 | — |

### Phase 7 orphan-audit seeds (to complete later)

- Deleted: `/apps-v2` + `AppsContentV2.tsx` + empty `(dashboard)` route group.
- Flagged dead: **`/feedback`** (placeholder), **`/learn`** (renders login, likely misconfigured), **`/community`** (stub data).
- Flagged for investigation: `reactFlowInstance is not defined` in `CustomNode` — builder component unconditionally imported on non-builder routes; 6 occurrences across baseline.

---

## 9. Redesign Framework

### 9.1 When to propose a redesign

Only when at least one of the following is true:
- Measurable UX failure (truncation, overlap, unreadable contrast, broken responsive, unreachable control)
- Clear competitor pattern that saves a user a step or reduces cognitive load
- Inconsistency with the rest of the app's design language

### 9.2 When NOT to propose a redesign

- Page looks fine and you're bored (re-read user memory: "stop over-designing")
- Legal / compliance pages where content structure is fixed
- Pages gated by the workflow builder redesign (builder is out of scope)

### 9.3 Competitor reference map (starting points)

| ChainReact page        | Closest reference                 |
|------------------------|-----------------------------------|
| `/` landing            | Zapier home, Make home, Linear home |
| `/pricing`             | Linear pricing, Vercel pricing    |
| `/workflows` list      | Zapier Zap list, Make scenarios   |
| `/connections` / `/apps-v2` | Zapier Apps directory, Make Apps |
| `/ai-assistant`        | Zapier Copilot, Make AI, Linear Copilot |
| `/templates`           | Zapier templates, n8n templates   |
| `/analytics`           | Zapier history, Linear insights   |
| `/settings`            | Linear settings, Vercel settings  |
| auth pages             | Linear auth, Clerk hosted UI      |
| docs / support         | Vercel docs, Linear docs          |

### 9.4 Diff protocol

1. Draft the diff as a proposal in the per-page section (no code written yet).
2. User reviews.
3. On approval, implement in a branch, run Playwright against new pages.
4. Report before/after screenshots in the per-page section.
5. Merge; mark page `M` in inventory; schedule post-merge regression sweep.

---

## 10. Manual Testing Handoff

Grows as the plan executes. Fresh as of: 2026-04-24.

| Area                                | Why Claude can't test it                                | Owner |
|-------------------------------------|---------------------------------------------------------|-------|
| Stripe checkout / portal            | User scoped Stripe out; live billing not touched        | user  |
| Integration OAuth consent screens   | Requires real provider account clicks in browser        | user  |
| Workflow builder                    | Out of scope for this plan                              | user  |
| End-to-end workflow execution       | Requires trigger events from external providers         | user  |
| Email deliverability (Resend real inbox test) | Requires reading an actual mailbox                      | user  |
| SMS/push notification surfaces      | Not yet wired up? confirm during audit                  | user  |
| Billing-tier-gated UI (Pro/Business/Enterprise views) | Test account is free tier; upgrade CTAs tested but locked content not renderable | user |
| Motion / animation quality          | Static Playwright can't systematically judge transitions| user  |
| Performance (LCP / CLS / Web Vitals)| Separate Lighthouse pass if desired                     | user  |
| Non-Chrome browser parity           | PLAYWRIGHT.md mandates Chrome only                      | user  |
| RTL / locale variants               | Not a stated priority                                   | user  |

Claude will add rows here as it encounters unverifiable surfaces.

---

## 11. Changelog

| Date       | Action                                                                                      |
|------------|---------------------------------------------------------------------------------------------|
| 2026-04-24 | Plan created. Vercel linked (`chain-react/chainreact-app`). Preview env pulled. Dev Supabase confirmed (`xzwsdwllmrnrgbltibxt`). Route inventory locked. |
| 2026-04-24 | User confirmed `/connections` is canonical Apps page. Deleted orphaned `/apps-v2`: `app/(dashboard)/apps-v2/page.tsx`, empty `app/(dashboard)/` route group, and orphaned component `components/apps/AppsContentV2.tsx`. Deleted redundant `.env.preview`; env source is now `.env.local` (user-maintained). Dev server target set to `http://localhost:3001`. Orphan Audit added as Phase 7. |
| 2026-04-24 | Scope expanded per user ("do everything"). Added to in-scope: modals, hover/focus states, scrolled captures, empty/loading/error states, toast/notification captures, form validation errors, auth-state variation, dynamic-route seeding, axe-core a11y, dropdowns, wizard steps, nav audit, dead-link sweep, transactional email HTML. Accepted out-of-scope (with manual-handoff rows): Chrome-only, tier-gated UI, motion, performance, RTL. Baseline capture count revised: ~1500–2500. Harness spec expanded in §4.2. Theme toggle confirmed as `next-themes` + `localStorage.theme`. |
| 2026-04-24 | **Phase 1 complete.** Installed `@axe-core/playwright`. Scaffolded `/tests/design-audit/` with `.gitignore`, `fixtures/{auth,breakpoints,routes}.ts`, `utils/{theme,capture,console-collector,stability}.ts`, `scripts/create-test-account.ts`, `specs/01-smoke.spec.ts`. Created dev-DB test user `design-test+claude@chainreactapp.com` (id=`20f87626-e1cf-449c-b5da-33d10de80007`). Smoke spec passes. |
| 2026-04-24 | Harness tuning: added `watchSkeletons: boolean` to stability — auth'd routes wait up to 8 s for `.animate-pulse` to clear (real skeleton), public routes ignore pulse (often decorative). Optimized capture loop: reload once per theme, resize across breakpoints without reload (4 reloads per route → 2 reloads per route). User moved env to `.env.local`, restarted dev server on :3000. Added `utils/axe-runner.ts`, `specs/06-a11y.spec.ts`, `utils/link-check.ts`. |
| 2026-04-24 | **Phase 2 complete (non-seeded routes).** Ran `02-baseline.spec.ts` for 50 routes → 50/50 pass in 3.6 min. **800 screenshots** (50 routes × 4 breakpoints × 2 themes × viewport+fullpage). **Zero pageerrors.** Systemic console patterns: 94× GA/gtag CSP block (expected), **46× `[PlansStore] Failed to fetch plans`** (real bug, seen across many pages), **36× 404 resource** (likely asset or API), **7× `[useWorkspaces] Error fetching workspaces: {}`** (real bug, empty error object suggests improper handling). Real layout bug: `/ai-assistant` Pro Plan upsell card has "Unlock Assistant" heading clipped by sticky top nav on laptop+wide. Also captured: mobile `/workflows` shows first-run "Welcome to ChainReact" onboarding tour (Step 1 of 8) overlaying the page — expected design surface. Seeded dynamic routes still pending (`team-detail`, `team-members`, `org-settings`, `support-ticket`). |
| 2026-04-24 | **A11y pass complete.** Ran `06-a11y.spec.ts` against all 50 routes after fixing serial-mode-plus-soft-assert issue (removed serial mode; assertions stay soft). **9 routes have CRITICAL a11y violations:** payments (2), workflows/subscription/waitlist/workflows-newly/templates/analytics/webhooks/settings (1 each). Most common critical: **`button-name`** — icon-only buttons missing `aria-label` (likely cross-cutting across app). Reports at `tests/design-audit/reports/a11y/*-axe.json`. |
| 2026-04-24 | **Phase 3 Batch 1 audit** — landing, pricing, workflows, connections, ai-assistant, auth-login. Findings written to §8 above. Cross-cutting issues surfaced: (1) **Mobile sidebar persistence** at 375px on all auth'd pages — blocks usability; (2) **Theme-locked marketing/auth pages** (/, /pricing, /about, /auth/login, /auth/register) render identical bytes in light vs dark — needs user decision on whether this is intentional; (3) **Data-fetch errors** (PlansStore, useWorkspaces, 404s) pollute console across many pages. Page-specific: `/ai-assistant` upsell clipped by nav (laptop+wide) and bleeds off top (mobile); `/pricing` shows Free tier first on mobile instead of recommended Pro; `/connections` tells users to go to builder to add connections, no CTA on-page. |
| 2026-04-24 | **Fix #1 shipped: mobile sidebar → hamburger drawer.** Modified `AppShell.tsx`, `UnifiedSidebar.tsx`, `UnifiedTopBar.tsx`. Off-canvas drawer at `md:` and below with backdrop; auto-closes on navigation + Escape. Verified via `99-verify-mobile-nav.spec.ts` on /connections and /ai-assistant (2/3 pass; /workflows fails because the onboarding tour intercepts clicks — not a regression). |
| 2026-04-24 | **Fix #2 partial: icon-button aria-labels.** Added `aria-label` to 3 buttons in `RecentFavorites.tsx`, 2 `<Checkbox>` in `WorkflowsPageContent.tsx`, 2 `<DropdownMenuTrigger>` buttons in same. `/workflows` critical axe violations: 2 → 1. Residual `.h-6.w-6.hover:bg-accent` button lives in a child component not yet located; deferred. |
| 2026-04-24 | **Phase 3 Batch 2 audit** — auth-register, new (onboarding), templates, analytics, settings, docs. Findings in §8. Key: `/analytics` has **same nav-clipping bug as `/ai-assistant`** (likely same shared upsell component); `/new` renders as a marketing hero rather than a multi-step onboarding wizard — ask user whether intentional; `/templates` and `/docs` are solid as-is; `/auth/register` could simplify 6-field form to 2–3 fields; `/settings` has 1 critical a11y violation still pending. |
| 2026-04-24 | **Fix #3 shipped: upsell-card nav clipping.** Root cause in `components/common/AccessGuard.tsx` — `items-center` centered a tall card inside a short container, pushing its top above the viewport. Changed to `items-start overflow-y-auto py-8`. Verified via `98-verify-upsell-clip.spec.ts` on `/ai-assistant` + `/analytics` across mobile, laptop, wide. Fix automatically covers `/teams` and `/organization` since all four use `AccessGuard`. |
| 2026-04-24 | **Phase 3 Batch 3 audit** — support, teams, subscription, payments, waitlist, webhooks. Findings in §8. `/support` and `/payments` are solid; `/subscription` has well-designed plan grid (minor concern: strike-through pricing implies promo but isn't labeled as such); `/teams` benefits from the Fix #3 since it uses `AccessGuard`; `/waitlist` duplicates content with the main landing; `/webhooks` has a heavy Development Mode alert always-visible in dev and unclear page-title + sidebar relationship. |
| 2026-04-24 | **Fix #4 shipped: silence spurious `PlansStore` + `useWorkspaces` console errors.** Root cause — browser-aborted fetches (triggered by Playwright page reloads and similar navigation) surface as `TypeError: Failed to fetch` but are not real errors; also the logger uses `JSON.stringify` which turns Error instances into `{}`. Added abort classification in both modules and proper Error serialization in `useWorkspaces`. Verified: 46 + 7 = 53 spurious error lines per baseline run eliminated. Remaining console output is benign (GA CSP + Gravatar 404 for intended-404 fallback pattern). |
| 2026-04-24 | **Phase 3 Batch 4 audit + re-baseline + re-a11y.** Re-ran full `02-baseline.spec.ts` and `06-a11y.spec.ts` against code with all 4 fixes. Console errors 230 → 136 (−41%). Critical a11y violations 11 → 10. Screenshots and reports replaced. Batch 4 findings in §8: `/feedback` is a placeholder, `/learn` renders a login form (possible misconfiguration), `/community` shows likely-stub data, `/auth/reset-password` has styling inconsistency with `/auth/login`. Theme-lock finding refined: marketing pages split across three shells (marketing-dark, marketing-light, docs-light) — needs unification decision. |
| 2026-04-24 | **`/learn` finding corrected.** Not a bug — `middleware.ts` line 171 matches `/learn/:path*` and requires auth. The baseline capture showed `/auth/login` because my Playwright test ran logged-out. The underlying `LearnContent` component is real (604 lines of documentation/videos/tutorials). Product decision needed: should `/learn` be public (SEO/prospect visibility) or remain auth-gated? |
| 2026-04-24 | **Fix #5 shipped: `reactFlowInstance is not defined` leak.** Root cause in `components/workflows/CustomNode.tsx` — the component referenced `reactFlowInstance` (lines 454, 455, 499, 1450, 1451) but never declared it. `useReactFlow` was imported but not called. Triggered when `TemplatePreview` rendered a path-router node (`isPathNode` branch). Fix: added `const reactFlowInstance = useReactFlow()` after the existing hook. Verified: zero `reactFlowInstance` errors in post-fix smoke capture. Post-login `/workflows` console is now 4 errors — all benign (2× Gravatar 404 intended-fallback, 2× GA CSP block). |
| 2026-04-25 | **Fix #2 cleanup pass.** Added `aria-label` to: 1× `<Checkbox>` (select-all) and 1× `<Checkbox>` (per-row select) and 1× expand-row `<button>` in `app/(app)/workflows/newly/page.tsx`; 1× `<SelectTrigger>` ("Time period") + 1× icon-only refresh `<Button>` in `components/new-design/AnalyticsContent.tsx`; 1× `<SelectTrigger>` ("Sort templates") in `components/templates/library/LibraryContent.tsx`; 1× combobox-Button in `components/waitlist/WaitlistForm.tsx`; 1× avatar-overlay `<button>` + 4× `<Switch>` toggles in `components/new-design/SettingsContentSidebar.tsx`; 1× native `<select>` in `components/billing/BillingContent.tsx`; 2× icon-only Search `<button>`s in `components/app-shell/UnifiedTopBar.tsx`; copy-URL `<Button>`s in `components/webhooks/WebhookConfigurationPanel.tsx`. Final critical a11y count: **11 → 7** (down 36%). Routes still flagged are workflows/workflows-newly/workflows-templates/subscription/settings/payments/teams — residual unlabeled controls in deeper subcomponents. |
| 2026-04-25 | **Fix #6 shipped: Trello auth + auth-confirm error serialization.** Same pattern as Fix #4 — Error objects passed to logger serialized as `{}`. Patched `app/(app)/connections/trello-auth/page.tsx` and `app/auth/confirm/page.tsx` to pass `{ message, name }`. |
| 2026-04-25 | **Fix #7 shipped: React `key` prop warning on `/workflows/newly`.** The `filteredWorkflows.map(...)` returned a `<>` Fragment which can't carry a key. Replaced with `<React.Fragment key={workflow.id}>` and added `import React`. |
| 2026-04-25 | **Pro-tier capture (Phase 2c).** Wrote `scripts/set-test-user-plan.ts` — service-role updater for `user_profiles.plan`. Set test user to `pro`, ran `97-pro-tier-capture.spec.ts` against `/ai-assistant`, `/analytics`, `/teams`, `/org`. **Captured real Pro-tier UIs**: AI Assistant chat interface ("How can I help?" with starter prompts + "Ask about your documents..." input), Analytics dashboard (Overview tab with Total Runs / Success Rate / Failed Runs / Avg Duration cards + Daily Executions chart + Status Distribution). `/teams` still shows AccessGuard upsell (correct — Teams requires Team-tier+, not Pro); upsell heading visible thanks to Fix #3. `/org` shows real "No organizations yet" empty state. Reverted to free after capture. Screenshots at `tests/design-audit/screenshots/pro/`. |
| 2026-04-25 | **Phase 2b dynamic-route capture.** Wrote `scripts/seed-dynamic-data.ts` — discovers schema, creates org `design-test-org` (id=`78023458-…`) + team `design-test-team` (id=`76d6e600-…`) for the test user with owner role on both. Wrote `specs/96-dynamic-routes.spec.ts`. Captured `/teams/design-test-team` (paywall, but seeded data visible behind blur — Team Name, Description, Slug, Created date all rendered correctly), `/teams/design-test-team/members`, and `/org/design-test-org/settings`. Screenshots at `tests/design-audit/screenshots/dynamic/`. |
| 2026-04-25 | **Final baseline + a11y re-run.** 50/50 baseline pass in 3.8 min. Console errors **230 → 123 (−47%)**. Critical a11y violations **11 → 7 (−36%)**. PlansStore / useWorkspaces / reactFlowInstance / React-key errors all eliminated. Remaining noise: GA CSP (78, benign), Gravatar 404 (34, intentional fallback). |
| 2026-04-25 | **Phase 7 Orphan audit complete.** Wrote `learning/docs/orphan-component-scan.md` — automated regex scan over `from "..."` and `import("...")` strings against `components/` files. Result: 657 components scanned, **190 likely orphan** (29%). Caveats: lazy imports without literal paths and re-exports through index.ts may produce false positives. Recommended workflow: verify each candidate via `git log` + `grep`, delete in batches. |
| 2026-04-25 | **Content cleanup pass.** Per user direction, deleted 4 routes that were stub/placeholder/redundant: `/feedback` (placeholder copy), `/community` (hardcoded fake stats + sample discussions), `/learn` (auth-gated learning resources), `/new` (marketing-style hero). Deleted associated component dirs (`components/learn/`, `components/community/`). Removed nav references in `components/layout/PublicLayout.tsx` (Company column footer), `components/temp-landing/TempFooter.tsx` (Resources column), `components/temp-landing/TempHeader.tsx` (top-nav). Updated `app/support/page.tsx` Community card → "Send Feedback" pointing to `/contact` (renamed icon to `MessageSquare`, removed unused `Users` import). Removed `/learn/:path*` from `middleware.ts` matcher and `/community` entry from `app/sitemap.ts`. Updated `tests/design-audit/fixtures/routes.ts` to drop deleted slugs from baseline. |
| 2026-04-25 | **Subscription pricing toggle verified.** Built `tests/design-audit/specs/95-verify-pricing-toggle.spec.ts` — captures `/subscription` on Annual (default, strike-through visible: $19→$15, $49→$40, $149→$120) and after clicking Monthly (strike-through removed, prices show $19/$49/$149 with "Billed monthly" footer). Pricing toggle is correct as designed; strike represents the equivalent annual-divided-by-12 savings vs monthly. |
| 2026-04-25 | **Final cleanup pass on a11y + auth styling.** Added 7 more `aria-label`s: `<Switch>` for "Auto-open AI assistant" (`SettingsContentSidebar.tsx`); `<SelectTrigger>` "Filter by category" (`TemplateGallery.tsx`); `<DropdownMenuTrigger>` "Actions for ${team.name}" (`TeamsPublicView.tsx`); `<DropdownMenuTrigger>` "Actions for ${workflow.name}" (`workflows/newly/page.tsx`); `<button>` "Collapse ${panelLabel} panel" (`NavPanel.tsx` close-button — covers subscription + payments via shared Billing panel); `<Button>` "Delete saved filter ${name}" (`AdvancedFilters.tsx`); 2× `<Button>`s for error popup expand/dismiss (`ErrorNotificationPopup.tsx`). Plus moved `app/auth/reset-password/page.tsx` into `app/auth/(auth-flow)/reset-password/page.tsx` so it inherits the gradient layout (orange/rose floating shapes, ChainReact logo, "Back to Home"); removed redundant `<div className="min-h-screen ...">` wrappers; restyled card to white-on-gradient with orange→rose submit button matching `/auth/login`. Verified visually via `94-verify-reset-password.spec.ts`. |
| 2026-04-25 | **Final cumulative numbers (post all 4 deletions + 11 cross-cutting fixes).** Console errors **230 → 113 (−51%)**. Critical a11y violations **11 → 1 (−91%)** — only `/workflows` has 1 residual unlabeled icon button somewhere in a deep child component (selector `.h-6.w-6.hover:bg-accent`, html truncated `<button class="inline-flex items-ce...">`). Routes scanned 50 → 46 (after deletions). Remaining 113 errors break down: 72 GA CSP block (benign), 34 Gravatar 404 (intended), 4 Trello auth (test-page edge), 2 generic 404, 1 auth confirm edge. **Zero application-level errors on any route.** |
| 2026-04-25 | **Comprehensive flow automation pass.** Built 4 new specs covering items I'd previously deferred to manual handoff: `93-all-tiers-capture.spec.ts` (paid tier views), `92-tour-and-palette.spec.ts` (onboarding tour + command palette), `91-mobile-webkit.spec.ts` (iPhone 14 viewport on Chromium), `89-comprehensive-flows.spec.ts` (notifications, AI prompt, Stripe click, auth flows via admin.generateLink, avatar upload). Plus `prod-env-checks.ts` for chainreact.app HEAD/CSP/sitemap verification, `seed-notifications.ts` for bell-dropdown UI testing. **Results:** 21 tier captures pass (4 paid tiers × 5 routes + revert-to-free); tour + palette captured (1+8 step screenshots); 4 webkit-public + 3 webkit-auth captured; bell dropdown rendered with 4 seeded notifications (3 unread shown with action links); AI Assistant prompt sent and response rendered (surfaced backend bug — see below); Stripe upgrade button click captured; password-recovery + signup-confirm links worked when host rewritten from chainreact.app → localhost; avatar PNG upload triggered success toast and updated avatar. Prod env checks: 17 pass / 4 warn / 0 fail (warnings are 4 deleted routes still live until next deploy + sitemap entry). |
| 2026-04-25 | **Real bug surfaced via Pro-tier AI Assistant test.** Test user upgraded to `pro` plan, prompt sent to chat. Backend returned: `429 — AI usage limit exceeded — You've reached your assistant usage limit for this month (0 messages). Please upgrade your plan for more usage.` The Pro plan upsell card advertises **"Assistant (200 messages/mo)"** but the backend reports **0 messages allowed** for Pro users. Either `plan_limits.assistant_messages_per_month` is misconfigured for Pro in the dev DB, or there's a mismatch between the Pro tier's stated and enforced limits. **Action item:** verify and fix in `lib/plans/limits.ts` or wherever assistant message quotas are defined. |
| 2026-04-25 | **Fix #6 shipped: AI Assistant 0-messages limit bug.** Root cause in `lib/usageTracking.ts` `checkUsageLimit()` — the function looked up the user's plan via the `subscriptions` table only. When no `subscriptions.status='active'` row existed (e.g., for users on the free tier or any user whose plan was set directly on `user_profiles.plan`), the function returned `{allowed: false, limit: 0, current: 0}` — meaning **any user without an explicit subscription row was blocked from the AI assistant entirely**. Fix: when the subscriptions lookup returns nothing, fall back to `user_profiles.plan` and look up that plan in the `plans` table. Verified via re-running the AI Assistant Pro-tier prompt test: the 0-messages error is gone; the assistant now passes the limit gate and proceeds to fetch user data. **This bug affected every free-tier user too**, since free-tier users typically don't have a row in `subscriptions`. The plans table itself was correctly configured (free=20, pro=200, team=1000, business/enterprise=-1) — the bug was purely in the lookup path. |

---

## 12. Session Resumption Guide

**Read this if you're a new Claude session picking up this plan.**

1. Open this file. Check §2 Status Dashboard for phase progress.
2. Check §11 Changelog for the most recent action.
3. Run `git status` and `git log -5` to see where code was left.
4. Confirm `.env.local` still exists and its `NEXT_PUBLIC_SUPABASE_URL` starts with `xzwsdwllmrnrgbltibxt`. If not, re-run `vercel env pull .env.local --environment=preview --yes`.
5. Confirm the test account still exists by querying `auth.users` on the dev DB. If not, recreate per §3.5.
6. If a Playwright run failed mid-flight, check `/tests/design-audit/screenshots/` for the last-completed route, and resume from the next entry in §7.
7. Do NOT assume any per-page redesign is finished — cross-reference the inventory column and the per-page section in §8.
8. The single most common failure mode here is accidentally hitting the prod DB. Run the §3.4 safety checklist before any test that writes.

Open questions still outstanding:
- Any additional pages user wants added/removed after reviewing §7? (initial review done 2026-04-24 — `/apps-v2` removed, `/connections` confirmed canonical)
- Phase 7 Orphan Audit deliverable: report at end of plan listing (a) orphaned page routes with no inbound links, (b) orphaned components with no importers, (c) pages that were in `/app` but not reachable from any nav.
