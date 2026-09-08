import { liveCommentCandidates } from "@pkg/db/schema";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export type CandidateSource = Record<string, unknown>;

export async function upsertLiveCommentCandidate(input: {
  batchId: string;
  taskId?: string | null;
  commandId: string;
  deviceId: string;
  commentText: string;
  normalizedValue: string;
  source: CandidateSource;
}) {
  const [row] = await db
    .insert(liveCommentCandidates)
    .values({
      tenantId: config.tenantId,
      batchId: input.batchId,
      taskId: input.taskId ?? null,
      commandId: input.commandId,
      deviceId: input.deviceId,
      commentText: input.commentText,
      normalizedValue: input.normalizedValue,
      sourcesJson: [input.source],
      createdBy: "mobile_agent",
      updatedBy: "mobile_agent"
    })
    .onConflictDoUpdate({
      target: [liveCommentCandidates.tenantId, liveCommentCandidates.batchId, liveCommentCandidates.normalizedValue],
      set: {
        sourcesJson: sql`case when coalesce(${liveCommentCandidates.sourcesJson}, '[]'::jsonb) @> ${JSON.stringify([input.source])}::jsonb then coalesce(${liveCommentCandidates.sourcesJson}, '[]'::jsonb) else coalesce(${liveCommentCandidates.sourcesJson}, '[]'::jsonb) || ${JSON.stringify([input.source])}::jsonb end`,
        updatedAt: new Date(),
        updatedBy: "mobile_agent"
      }
    })
    .returning();
  return row;
}

export async function listLiveCommentCandidates(batchId: string) {
  return db.select().from(liveCommentCandidates).where(and(
    eq(liveCommentCandidates.tenantId, config.tenantId),
    eq(liveCommentCandidates.batchId, batchId),
    isNull(liveCommentCandidates.deletedAt)
  )).orderBy(liveCommentCandidates.createdAt);
}

export async function markLiveCommentCandidatesImported(ids: string[], vocabularyById: Map<string, string>) {
  if (!ids.length) return [];
  const now = new Date();
  const rows = [];
  for (const id of ids) {
    const vocabularyId = vocabularyById.get(id);
    if (!vocabularyId) continue;
    const [row] = await db.update(liveCommentCandidates).set({
      status: "IMPORTED",
      vocabularyEntryId: vocabularyId,
      importedAt: now,
      updatedAt: now,
      updatedBy: "admin"
    }).where(and(
      eq(liveCommentCandidates.tenantId, config.tenantId),
      eq(liveCommentCandidates.id, id),
      isNull(liveCommentCandidates.deletedAt)
    )).returning();
    if (row) rows.push(row);
  }
  return rows;
}

export async function findLiveCommentCandidatesByIds(ids: string[], batchId: string) {
  if (!ids.length) return [];
  return db.select().from(liveCommentCandidates).where(and(
    eq(liveCommentCandidates.tenantId, config.tenantId),
    eq(liveCommentCandidates.batchId, batchId),
    inArray(liveCommentCandidates.id, ids),
    isNull(liveCommentCandidates.deletedAt)
  ));
}
