import { collectorDevices, liveCommentActions } from "@pkg/db/schema";
import { and, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type LiveCommentActionFilters = {
  deviceCode?: string;
  status?: string;
  keyword?: string;
  createdFrom?: Date;
  createdTo?: Date;
};

export async function createLiveCommentAction(values: typeof liveCommentActions.$inferInsert) {
  const [record] = await db.insert(liveCommentActions).values(values).returning();
  return record;
}

function actionWhere(filters: LiveCommentActionFilters = {}) {
  const conditions = [eq(liveCommentActions.tenantId, config.tenantId), isNull(liveCommentActions.deletedAt)];
  if (filters.deviceCode) {
    conditions.push(eq(collectorDevices.deviceCode, filters.deviceCode));
  }
  if (filters.status) {
    conditions.push(eq(liveCommentActions.status, filters.status));
  }
  if (filters.keyword) {
    const pattern = `%${filters.keyword}%`;
    conditions.push(
      sql`(${liveCommentActions.roomName} ilike ${pattern} or ${liveCommentActions.leaderAccountName} ilike ${pattern} or ${liveCommentActions.triggerText} ilike ${pattern} or ${liveCommentActions.replyText} ilike ${pattern})`
    );
  }
  if (filters.createdFrom) {
    conditions.push(gte(liveCommentActions.createdAt, filters.createdFrom));
  }
  if (filters.createdTo) {
    conditions.push(lt(liveCommentActions.createdAt, filters.createdTo));
  }
  return and(...conditions);
}

export async function listLiveCommentActions(page: number, pageSize: number, filters: LiveCommentActionFilters = {}) {
  const offset = (page - 1) * pageSize;
  const where = actionWhere(filters);
  const [total] = await db
    .select({ value: count() })
    .from(liveCommentActions)
    .leftJoin(collectorDevices, eq(liveCommentActions.deviceId, collectorDevices.id))
    .where(where);
  const data = await db
    .select({
      id: liveCommentActions.id,
      assignmentId: liveCommentActions.assignmentId,
      targetId: liveCommentActions.targetId,
      approvalId: liveCommentActions.approvalId,
      stage: liveCommentActions.stage,
      expectedAccountName: liveCommentActions.expectedAccountName,
      roomKeyVersion: liveCommentActions.roomKeyVersion,
      roomKey: liveCommentActions.roomKey,
      commentSlot: liveCommentActions.commentSlot,
      commentHash: liveCommentActions.commentHash,
      actionState: liveCommentActions.actionState,
      stateVersion: liveCommentActions.stateVersion,
      idempotencyKey: liveCommentActions.idempotencyKey,
      permitExpiresAt: liveCommentActions.permitExpiresAt,
      createdAt: liveCommentActions.createdAt,
      reportedAt: liveCommentActions.reportedAt,
      platform: liveCommentActions.platform,
      roomName: liveCommentActions.roomName,
      leaderAccountName: liveCommentActions.leaderAccountName,
      triggerText: liveCommentActions.triggerText,
      matchedKeywords: liveCommentActions.matchedKeywords,
      replyText: liveCommentActions.replyText,
      plannedDelayMs: liveCommentActions.plannedDelayMs,
      status: liveCommentActions.status,
      skipReason: liveCommentActions.skipReason,
      failureReason: liveCommentActions.failureReason,
      plannedAt: liveCommentActions.plannedAt,
      submittedAt: liveCommentActions.submittedAt,
      sentAt: liveCommentActions.sentAt,
      confirmedAt: liveCommentActions.confirmedAt,
      resolvedBy: liveCommentActions.resolvedBy,
      resolvedAt: liveCommentActions.resolvedAt,
      resolutionEvidence: liveCommentActions.resolutionEvidence,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName
    })
    .from(liveCommentActions)
    .leftJoin(collectorDevices, eq(liveCommentActions.deviceId, collectorDevices.id))
    .where(where)
    .orderBy(desc(liveCommentActions.createdAt))
    .limit(pageSize)
    .offset(offset);
  return { data, totalItems: total.value };
}

export async function getLiveCommentDeviceSummaries(startAt = new Date(0)) {
  const rows = await db
    .select({
      deviceId: liveCommentActions.deviceId,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName,
      totalCount: count(),
      plannedCount: sql<number>`count(*) filter (where ${liveCommentActions.status} = 'planned')`,
      sentCount: sql<number>`count(*) filter (where ${liveCommentActions.status} = 'sent')`,
      failedCount: sql<number>`count(*) filter (where ${liveCommentActions.status} = 'failed')`,
      skippedCount: sql<number>`count(*) filter (where ${liveCommentActions.status} = 'skipped')`,
      latestActionAt: sql<Date | null>`max(${liveCommentActions.createdAt})`
    })
    .from(liveCommentActions)
    .leftJoin(collectorDevices, eq(liveCommentActions.deviceId, collectorDevices.id))
    .where(actionWhere({ createdFrom: startAt }))
    .groupBy(liveCommentActions.deviceId, collectorDevices.deviceCode, collectorDevices.deviceName)
    .orderBy(desc(sql`max(${liveCommentActions.createdAt})`));

  return rows.map((row) => ({
    ...row,
    totalCount: Number(row.totalCount ?? 0),
    plannedCount: Number(row.plannedCount ?? 0),
    sentCount: Number(row.sentCount ?? 0),
    failedCount: Number(row.failedCount ?? 0),
    skippedCount: Number(row.skippedCount ?? 0)
  }));
}
