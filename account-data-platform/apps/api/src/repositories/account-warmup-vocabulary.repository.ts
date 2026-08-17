import { accountWarmupVocabulary } from "@pkg/db/schema";
import type { AccountWarmupVocabularyKind } from "@pkg/types";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type VocabularyValue = {
  kind: AccountWarmupVocabularyKind;
  value: string;
  normalizedValue: string;
};

const entrySelection = {
  id: accountWarmupVocabulary.id,
  kind: accountWarmupVocabulary.kind,
  value: accountWarmupVocabulary.value,
  lastUsedAt: accountWarmupVocabulary.lastUsedAt
};

export async function listAccountWarmupVocabulary(values: {
  kind: AccountWarmupVocabularyKind;
  normalizedQuery: string;
  limit: number;
}) {
  const conditions = [
    eq(accountWarmupVocabulary.tenantId, config.tenantId),
    eq(accountWarmupVocabulary.kind, values.kind),
    isNull(accountWarmupVocabulary.deletedAt)
  ];
  if (values.normalizedQuery) {
    conditions.push(sql`position(${values.normalizedQuery} in ${accountWarmupVocabulary.normalizedValue}) > 0`);
  }

  return db
    .select(entrySelection)
    .from(accountWarmupVocabulary)
    .where(and(...conditions))
    .orderBy(desc(accountWarmupVocabulary.lastUsedAt), asc(accountWarmupVocabulary.value))
    .limit(values.limit);
}

export async function upsertAccountWarmupVocabulary(values: VocabularyValue[]) {
  if (values.length === 0) return [];
  const now = new Date();
  const rows = await db
    .insert(accountWarmupVocabulary)
    .values(values.map((entry) => ({
      ...entry,
      tenantId: config.tenantId,
      lastUsedAt: now,
      createdBy: "admin",
      updatedBy: "admin"
    })))
    .onConflictDoUpdate({
      target: [
        accountWarmupVocabulary.tenantId,
        accountWarmupVocabulary.kind,
        accountWarmupVocabulary.normalizedValue
      ],
      set: {
        lastUsedAt: now,
        updatedAt: now,
        updatedBy: "admin",
        deletedAt: null
      }
    })
    .returning(entrySelection);

  const byKey = new Map(rows.map((row) => [
    `${row.kind}:${row.value.normalize("NFKC").toLowerCase()}`,
    row
  ]));
  return values.flatMap((entry) => byKey.get(`${entry.kind}:${entry.normalizedValue}`) ?? []);
}

export async function softDeleteAccountWarmupVocabulary(id: string) {
  const now = new Date();
  const [deleted] = await db
    .update(accountWarmupVocabulary)
    .set({
      deletedAt: now,
      updatedAt: now,
      updatedBy: "admin"
    })
    .where(and(
      eq(accountWarmupVocabulary.tenantId, config.tenantId),
      eq(accountWarmupVocabulary.id, id),
      isNull(accountWarmupVocabulary.deletedAt)
    ))
    .returning({ id: accountWarmupVocabulary.id });
  return deleted ?? null;
}
