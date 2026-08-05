# Account Warmup Shared Vocabulary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add tenant-scoped, permanent shared history for account-warmup related terms and comments, saved once after at least one command publishes successfully.

**Architecture:** A dedicated vocabulary table and admin API own persistence, soft deletion, restoration, and tenant isolation. The web page keeps tag entry behavior, loads shared options, allows confirmed deletion, and performs one idempotent merge after command dispatch reports at least one success.

**Tech Stack:** PostgreSQL, Drizzle ORM, Hono, Zod, React, TanStack Query, Ant Design, Bun/Node tests.

---

## Fixed API Contract

```ts
type AccountWarmupVocabularyKind = "RELATED_TERM" | "COMMENT";
type AccountWarmupVocabularyEntry = {
  id: string;
  kind: AccountWarmupVocabularyKind;
  value: string;
  lastUsedAt: string;
};

// GET /api/v1/admin/account-warmup/vocabulary?kind=RELATED_TERM&query=&limit=100
// -> AccountWarmupVocabularyEntry[]

// POST /api/v1/admin/account-warmup/vocabulary
// body: { relatedTerms: string[]; comments: string[] }
// -> AccountWarmupVocabularyEntry[]

// DELETE /api/v1/admin/account-warmup/vocabulary/:id
// -> { ok: true; id: string }
```

### Task 1: Backend Persistence And API

**Files:**
- Modify: `account-data-platform/packages/db/src/schema.ts`
- Create: `account-data-platform/packages/db/src/migrations/0029_account_warmup_vocabulary.sql`
- Modify: `account-data-platform/packages/db/src/migrations/meta/_journal.json`
- Modify: `account-data-platform/packages/types/src/domain/account-warmup.ts`
- Create: `account-data-platform/apps/api/src/repositories/account-warmup-vocabulary.repository.ts`
- Create: `account-data-platform/apps/api/src/services/account-warmup-vocabulary.service.ts`
- Modify: `account-data-platform/apps/api/src/routes/admin.ts`
- Create: `account-data-platform/apps/api/src/routes/account-warmup-vocabulary.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover tenant/type uniqueness, trimmed deduplication, query filtering, soft delete, restoration, and validation. Use the fixed response shapes above and existing `adminRequest` test helpers.

```ts
assert.equal(created.filter((item) => item.value === "当归").length, 1);
assert.equal((await list("RELATED_TERM")).some((item) => item.value === "当归"), true);
await remove(created[0].id);
assert.equal((await list("RELATED_TERM")).some((item) => item.id === created[0].id), false);
const restored = await merge({ relatedTerms: ["当归"], comments: [] });
assert.equal(restored[0].id, created[0].id);
```

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `bun test account-data-platform/apps/api/src/routes/account-warmup-vocabulary.test.ts`

Expected: failure because the table, service, and routes do not exist.

- [ ] **Step 3: Add schema and migration**

Define `accountWarmupVocabularyEntries` with UUID id, `tenantId`, `kind`, `value`, `normalizedValue`, `lastUsedAt`, and the repository audit columns. Add a non-partial unique index on `(tenant_id, kind, normalized_value)` so a deleted row can be restored rather than duplicated.

```sql
create table if not exists account_warmup_vocabulary_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id varchar(64) not null default 'default',
  kind varchar(32) not null,
  value varchar(100) not null,
  normalized_value varchar(100) not null,
  last_used_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by varchar(64) not null default 'system',
  updated_by varchar(64) not null default 'system',
  deleted_at timestamptz null,
  constraint chk_account_warmup_vocabulary_kind check (kind in ('RELATED_TERM', 'COMMENT'))
);
create unique index uniq_account_warmup_vocabulary_tenant_kind_value
  on account_warmup_vocabulary_entries (tenant_id, kind, normalized_value);
```

- [ ] **Step 4: Add shared schemas and service behavior**

Reuse the account-warmup limits: 50 related terms, 100 comments, and 100 characters per value. Normalize by trimming, dropping empty strings, and preserving the first display spelling. Upsert must set `deletedAt: null`, refresh `lastUsedAt`, and remain idempotent.

```ts
export const accountWarmupVocabularyKindSchema = z.enum(["RELATED_TERM", "COMMENT"]);
export const mergeAccountWarmupVocabularySchema = z.object({
  relatedTerms: z.array(z.string().trim().min(1).max(100)).max(50),
  comments: z.array(z.string().trim().min(1).max(100)).max(100)
});
```

- [ ] **Step 5: Add authenticated admin routes**

Parse GET query with bounded `limit` (default/max 100), POST body with the merge schema, and DELETE UUID params. Use `config.tenantId` in every repository operation and return 404 for an entry outside the current tenant or already deleted.

- [ ] **Step 6: Run backend verification**

Run:

```powershell
bun test account-data-platform/apps/api/src/routes/account-warmup-vocabulary.test.ts
bun --filter @app/api run typecheck
```

Expected: all new tests pass and API typecheck exits 0.

### Task 2: Frontend Shared Tag Selects

**Files:**
- Modify: `account-data-platform/apps/web/src/lib/api-client-account-warmup.ts`
- Modify: `account-data-platform/apps/web/src/lib/account-warmup-form.ts`
- Create: `account-data-platform/apps/web/src/components/account-warmup/SharedVocabularySelect.tsx`
- Modify: `account-data-platform/apps/web/src/routes/AccountWarmupPage.tsx`
- Modify: `account-data-platform/apps/web/src/styles.css`
- Modify: `account-data-platform/apps/web/tests/account-warmup-page.test.js`

- [ ] **Step 1: Write failing frontend tests**

Test API paths and exported helpers, then assert the page contains shared option loading, confirmed deletion, and one merge call guarded by `succeededCount > 0`.

```js
assert.match(clientSource, /account-warmup\/vocabulary/);
assert.match(pageSource, /succeededCount\s*>\s*0/);
assert.match(pageSource, /mergeAccountWarmupVocabulary/);
assert.match(selectSource, /Popconfirm/);
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `node --test account-data-platform/apps/web/tests/account-warmup-page.test.js`

Expected: failure because shared vocabulary APIs and the component do not exist.

- [ ] **Step 3: Add typed API client methods**

Implement the fixed GET/POST/DELETE contract. URL-encode kind, query, and id. Keep vocabulary types in this focused client unless a shared type is already exported without introducing a circular dependency.

- [ ] **Step 4: Add the reusable select component**

The component receives `value`, `onChange`, `entries`, `loading`, `placeholder`, and `onDelete`. Keep `Select mode="tags"`, searchable options, comma/Chinese comma/newline token separators, truncated comment labels with `Tooltip`, and a delete icon protected by `Popconfirm` plus `stopPropagation()`.

- [ ] **Step 5: Integrate page queries and delete mutations**

Load `RELATED_TERM` and `COMMENT` histories with separate TanStack Query keys. Query failure must not disable manual entry. Successful deletion invalidates both relevant vocabulary query keys; failure shows `message.error`.

- [ ] **Step 6: Save vocabulary once after publishing**

Keep the final normalized form values before dispatch. After `dispatchAccountWarmupCommands` returns, call one merge request only when `succeededCount > 0`. A merge failure must not change the task success count; show a separate warning and preserve form values.

```ts
const result = await dispatchAccountWarmupCommands(commands, dispatch);
if (result.succeededCount > 0) {
  try {
    await mergeAccountWarmupVocabulary({ relatedTerms, comments });
  } catch {
    message.warning("任务已发布，但共享词库保存失败");
  }
}
```

- [ ] **Step 7: Run frontend verification**

Run:

```powershell
node --test account-data-platform/apps/web/tests/account-warmup-page.test.js
bun --filter @app/web run typecheck
```

Expected: focused tests pass and web typecheck exits 0.

### Task 3: Integrated Vocabulary Verification

- [ ] Run the migration using the repository's existing migration command.
- [ ] Start or reuse the API and web dev servers.
- [ ] Verify two browser sessions see the same newly saved related term and comment.
- [ ] Verify removing a selected tag changes only the form, while deleting a dropdown history entry removes it for both sessions.
- [ ] Verify a deleted entry is restored after it is used in another successfully published task.
- [ ] Run `git diff --check` on every vocabulary-related file and review that unrelated dirty files remain untouched.
