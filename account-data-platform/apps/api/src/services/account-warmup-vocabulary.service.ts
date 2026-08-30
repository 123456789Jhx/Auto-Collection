import type {
  AccountWarmupVocabularyEntry,
  AccountWarmupVocabularyKind,
  AccountWarmupVocabularyQuery,
  AccountWarmupVocabularySavePayload
} from "@pkg/types";
import {
  listAccountWarmupVocabulary,
  softDeleteAccountWarmupVocabulary,
  upsertAccountWarmupVocabulary
} from "../repositories/account-warmup-vocabulary.repository";

export function normalizeVocabularyValue(value: string) {
  return value.normalize("NFKC").toLowerCase();
}

function serializeEntry(entry: {
  id: string;
  kind: AccountWarmupVocabularyKind;
  value: string;
  lastUsedAt: Date;
}): AccountWarmupVocabularyEntry {
  return {
    id: entry.id,
    kind: entry.kind,
    value: entry.value,
    lastUsedAt: entry.lastUsedAt.toISOString()
  };
}

export async function getAccountWarmupVocabulary(query: AccountWarmupVocabularyQuery) {
  const entries = await listAccountWarmupVocabulary({
    kind: query.kind,
    normalizedQuery: normalizeVocabularyValue(query.query),
    limit: query.limit
  });
  return entries.map(serializeEntry);
}

export async function saveAccountWarmupVocabulary(payload: AccountWarmupVocabularySavePayload) {
  const entries = [
    ...payload.relatedTerms.map((value) => ({
      kind: "RELATED_TERM" as const,
      value,
      normalizedValue: normalizeVocabularyValue(value)
    })),
    ...payload.comments.map((value) => ({
      kind: "COMMENT" as const,
      value,
      normalizedValue: normalizeVocabularyValue(value)
    }))
  ];
  return (await upsertAccountWarmupVocabulary(entries)).map(serializeEntry);
}

export async function deleteAccountWarmupVocabulary(id: string) {
  const deleted = await softDeleteAccountWarmupVocabulary(id);
  return deleted ? { ok: true as const, id: deleted.id } : null;
}
