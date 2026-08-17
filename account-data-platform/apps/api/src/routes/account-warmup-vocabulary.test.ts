import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { accountWarmupVocabulary } from "@pkg/db/schema";
import { sql } from "drizzle-orm";
import { app } from "../app";
import { db } from "../repositories/db";

const suffix = crypto.randomUUID().replaceAll("-", "");
const relatedTerm = `WarmupTerm-${suffix}`;
const comment = `WarmupComment-${suffix}`;
const lifecycleTerm = `WarmupLifecycle-${suffix}`;
let adminToken = "";

function adminRequest(path: string, method = "GET", body?: unknown) {
  return app.request(path, {
    method,
    headers: {
      Authorization: `Bearer ${adminToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

beforeAll(async () => {
  const response = await app.request("/api/v1/admin/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "root", password: "root" })
  });
  adminToken = (await response.json()).token;
});

afterAll(async () => {
  const [{ tableExists }] = await db.execute<{ tableExists: boolean }>(sql`
    select to_regclass('public.account_warmup_vocabulary') is not null as "tableExists"
  `);
  if (tableExists) {
    await db.execute(sql`
      delete from account_warmup_vocabulary
      where value in (${relatedTerm}, ${relatedTerm.toUpperCase()}, ${comment}, ${lifecycleTerm}, ${lifecycleTerm.toUpperCase()})
    `);
  }
});

describe("account warmup vocabulary admin API", () => {
  test("requires admin authentication", async () => {
    const response = await app.request(
      "/api/v1/admin/account-warmup/vocabulary?kind=RELATED_TERM&limit=100"
    );

    expect(response.status).toBe(401);
  });

  test("saves trimmed unique entries and lists them by kind and query", async () => {
    const saveResponse = await adminRequest(
      "/api/v1/admin/account-warmup/vocabulary",
      "POST",
      {
        relatedTerms: [`  ${relatedTerm}  `, relatedTerm],
        comments: [`  ${comment}  `, comment]
      }
    );
    const saved = await saveResponse.json();

    expect(saveResponse.status).toBe(200);
    expect(saved).toHaveLength(2);
    expect(saved).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "RELATED_TERM", value: relatedTerm }),
      expect.objectContaining({ kind: "COMMENT", value: comment })
    ]));
    for (const entry of saved) {
      expect(Object.keys(entry).sort()).toEqual(["id", "kind", "lastUsedAt", "value"]);
      expect(entry.id).toBeString();
      expect(entry.lastUsedAt).toBeString();
    }

    const listResponse = await adminRequest(
      `/api/v1/admin/account-warmup/vocabulary?kind=RELATED_TERM&query=${suffix}&limit=1`
    );
    const listed = await listResponse.json();

    expect(listResponse.status).toBe(200);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ kind: "RELATED_TERM", value: relatedTerm });
  });

  test("rejects batches over the per-kind limits", async () => {
    const response = await adminRequest(
      "/api/v1/admin/account-warmup/vocabulary",
      "POST",
      {
        relatedTerms: Array.from({ length: 51 }, (_, index) => `term-${index}`),
        comments: []
      }
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");

    const commentsResponse = await adminRequest(
      "/api/v1/admin/account-warmup/vocabulary",
      "POST",
      {
        relatedTerms: [],
        comments: Array.from({ length: 101 }, (_, index) => `comment-${index}`)
      }
    );
    expect(commentsResponse.status).toBe(400);
  });

  test("rejects invalid kinds, limits, and trimmed item lengths", async () => {
    const invalidKind = await adminRequest(
      "/api/v1/admin/account-warmup/vocabulary?kind=OTHER&limit=100"
    );
    expect(invalidKind.status).toBe(400);

    const invalidLimit = await adminRequest(
      "/api/v1/admin/account-warmup/vocabulary?kind=COMMENT&limit=101"
    );
    expect(invalidLimit.status).toBe(400);

    for (const value of ["   ", "x".repeat(101)]) {
      const response = await adminRequest(
        "/api/v1/admin/account-warmup/vocabulary",
        "POST",
        { relatedTerms: [value], comments: [] }
      );
      expect(response.status).toBe(400);
    }
  });

  test("returns a validation error for malformed JSON", async () => {
    const response = await app.request("/api/v1/admin/account-warmup/vocabulary", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${adminToken}`,
        "Content-Type": "application/json"
      },
      body: "{"
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });

  test("refreshes, soft deletes, and restores a normalized value with the same id", async () => {
    const firstResponse = await adminRequest(
      "/api/v1/admin/account-warmup/vocabulary",
      "POST",
      { relatedTerms: [lifecycleTerm], comments: [] }
    );
    const [first] = await firstResponse.json();
    await Bun.sleep(10);

    const refreshedResponse = await adminRequest(
      "/api/v1/admin/account-warmup/vocabulary",
      "POST",
      { relatedTerms: [lifecycleTerm.toUpperCase()], comments: [] }
    );
    const [refreshed] = await refreshedResponse.json();
    expect(refreshed.id).toBe(first.id);
    expect(refreshed.value).toBe(lifecycleTerm);
    expect(new Date(refreshed.lastUsedAt).getTime()).toBeGreaterThan(
      new Date(first.lastUsedAt).getTime()
    );

    const deleteResponse = await adminRequest(
      `/api/v1/admin/account-warmup/vocabulary/${first.id}`,
      "DELETE"
    );
    expect(deleteResponse.status).toBe(200);
    expect(await deleteResponse.json()).toEqual({ ok: true, id: first.id });

    const deletedList = await (
      await adminRequest(
        `/api/v1/admin/account-warmup/vocabulary?kind=RELATED_TERM&query=${suffix}&limit=100`
      )
    ).json();
    expect(deletedList.some((entry: { id: string }) => entry.id === first.id)).toBeFalse();

    const restoredResponse = await adminRequest(
      "/api/v1/admin/account-warmup/vocabulary",
      "POST",
      { relatedTerms: [lifecycleTerm], comments: [] }
    );
    const [restored] = await restoredResponse.json();
    expect(restored.id).toBe(first.id);
  });

  test("does not return the same normalized value from another tenant", async () => {
    const [foreignEntry] = await db.insert(accountWarmupVocabulary).values({
      tenantId: `other-${suffix}`,
      kind: "RELATED_TERM",
      value: relatedTerm,
      normalizedValue: relatedTerm.normalize("NFKC").toLowerCase(),
      createdBy: "test",
      updatedBy: "test"
    }).returning({ id: accountWarmupVocabulary.id });

    const response = await adminRequest(
      `/api/v1/admin/account-warmup/vocabulary?kind=RELATED_TERM&query=${suffix}&limit=100`
    );
    const entries = await response.json();

    expect(entries.filter((entry: { value: string }) => entry.value === relatedTerm)).toHaveLength(1);

    const deleteResponse = await adminRequest(
      `/api/v1/admin/account-warmup/vocabulary/${foreignEntry.id}`,
      "DELETE"
    );
    expect(deleteResponse.status).toBe(404);
  });

  test("enforces vocabulary kinds at the database boundary", async () => {
    const constraints = await db.execute<{ definition: string }>(sql`
      select pg_get_constraintdef(oid) as definition
      from pg_constraint
      where conname = 'account_warmup_vocabulary_kind_check'
        and conrelid = 'public.account_warmup_vocabulary'::regclass
    `);

    expect(constraints).toHaveLength(1);
    expect(constraints[0]?.definition).toContain("RELATED_TERM");
    expect(constraints[0]?.definition).toContain("COMMENT");
  });
});
