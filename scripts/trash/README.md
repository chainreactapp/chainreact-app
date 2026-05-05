# Trash Scripts

**Purpose:** This folder contains one-off scripts that have already been executed and can be safely deleted.

## Rules

1. **Any script in this folder can be deleted at any time**
2. All one-time migration/fix scripts should be placed here IMMEDIATELY after creating them
3. Once a script has been run successfully, it stays here until periodic cleanup
4. Scripts in this folder should NOT be referenced in package.json or production workflows
5. **Every script must start with a `RAN:` header marking when it was successfully executed.** Without it, the next cleanup pass cannot tell whether the script was executed or abandoned.

## RAN-header convention

Right after running a script successfully, prepend a one-line header
recording the date and a short note. The exact comment syntax depends on
the script language:

```ts
// RAN: 2026-05-04 — verified resume-lineage migration on prod
```

```sql
-- RAN: 2026-05-04 — applied via supabase db push
```

```js
// RAN: 2026-05-04 — fix applied to 12 affected rows
```

If a script has been edited and re-run, append a second `RAN:` line — do
not overwrite the original. A script with no `RAN:` header is presumed
**not yet executed** and must not be deleted during cleanup.

## Types of Scripts That Belong Here

- ✅ Database migrations that have been applied
- ✅ One-time fix scripts (fix-*, apply-*, update-*)
- ✅ Debug/test scripts for specific bugs
- ✅ Data transformation scripts
- ✅ Schema modification scripts
- ✅ Template/data cleanup scripts

## Types of Scripts That Do NOT Belong Here

- ❌ Scripts referenced in package.json
- ❌ Recurring maintenance scripts
- ❌ Development tools (build, dev server, logs)
- ❌ Testing infrastructure
- ❌ CLI tools for managing integrations/providers

## 🚨 Cleanup Policy - REGULAR MAINTENANCE REQUIRED

**This folder MUST be cleaned regularly to prevent accumulation.**

### Cleanup Schedule:
- **MONTHLY** - Review and delete old scripts
- **BEFORE MAJOR RELEASES** - Clean out all scripts
- **WHEN 5-10+ FILES** - Immediate cleanup required
- **QUARTERLY AT MINIMUM** - Even if few files

### How to Clean:
```bash
# Delete all scripts in trash (keeps README)
rm scripts/trash/*.{js,ts,cjs,mjs,sh,md} 2>/dev/null || true
# Or on Windows:
del scripts\trash\*.js scripts\trash\*.ts scripts\trash\*.cjs scripts\trash\*.mjs
```

### Before Deleting - Quick Checklist:

✅ Script has a `RAN:` header (see "RAN-header convention" above)
✅ Not referenced anywhere in the codebase
✅ Not documented as a recurring utility
✅ More than 1 week old (or confirmed one-time use)

**If a script has no `RAN:` header, do NOT delete it without confirming with the script's author** — it may not have been executed yet. Git preserves history once a script has been removed.

---

## Cleanup History

| Date | What was removed |
|---|---|
| January 2026 | 71 obsolete scripts |
| 2026-05-04 | 12 files: 3 PNG screenshots + 9 one-off scripts (check-migration-state, check-subscription-prices, deduct-tasks-rpc-baseline.sql, dump-deduct-tasks-rpc, push-overage-pack-migrations, reconcile-entitlements, test-create-workflow, verify-billing-schema, verify-resume-lineage). Most pre-dated the RAN-header convention; verify-resume-lineage was confirmed run in-session for resume-lineage Phase 0. |
