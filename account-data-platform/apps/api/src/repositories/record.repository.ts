import { collectionRecords, collectorDevices } from "@pkg/db/schema";
import { and, count, desc, eq, gte, ilike, isNull, lt, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type RecordFilters = {
  deviceCode?: string;
  sceneType?: string;
  keyword?: string;
  createdFrom?: Date;
  createdTo?: Date;
};

export async function createCollectionRecord(values: typeof collectionRecords.$inferInsert) {
  const [record] = await db.insert(collectionRecords).values(values).returning();
  return record;
}

function recordWhere(filters: RecordFilters = {}) {
  const conditions = [eq(collectionRecords.tenantId, config.tenantId), isNull(collectionRecords.deletedAt)];
  if (filters.sceneType) {
    conditions.push(eq(collectionRecords.sceneType, filters.sceneType));
  }
  if (filters.deviceCode) {
    conditions.push(eq(collectorDevices.deviceCode, filters.deviceCode));
  }
  if (filters.keyword) {
    conditions.push(ilike(collectionRecords.titleText, `%${filters.keyword}%`));
  }
  if (filters.createdFrom) {
    conditions.push(gte(collectionRecords.createdAt, filters.createdFrom));
  }
  if (filters.createdTo) {
    conditions.push(lt(collectionRecords.createdAt, filters.createdTo));
  }
  return and(...conditions);
}

export async function listCollectionRecords(page: number, pageSize: number, filters: RecordFilters = {}) {
  const offset = (page - 1) * pageSize;
  const where = recordWhere(filters);
  const [total] = await db
    .select({ value: count() })
    .from(collectionRecords)
    .leftJoin(collectorDevices, eq(collectionRecords.deviceId, collectorDevices.id))
    .where(where);
  const data = await db
    .select({
      id: collectionRecords.id,
      createdAt: collectionRecords.createdAt,
      platform: collectionRecords.platform,
      sceneType: collectionRecords.sceneType,
      keyword: collectionRecords.keyword,
      matchedKeywords: collectionRecords.matchedKeywords,
      authorName: collectionRecords.authorName,
      titleText: collectionRecords.titleText,
      subtitleText: collectionRecords.subtitleText,
      metricsText: collectionRecords.metricsText,
      hotCommentsJson: collectionRecords.hotCommentsJson,
      screenText: collectionRecords.screenText,
      capturedAt: collectionRecords.capturedAt,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName
    })
    .from(collectionRecords)
    .leftJoin(collectorDevices, eq(collectionRecords.deviceId, collectorDevices.id))
    .where(where)
    .orderBy(desc(collectionRecords.createdAt))
    .limit(pageSize)
    .offset(offset);
  return { data, totalItems: total.value };
}

export async function countCollectionRecords(filters: RecordFilters = {}) {
  const [total] = await db.select({ value: count() }).from(collectionRecords).where(recordWhere(filters));
  return total.value;
}

export async function getSceneCountsSince(startAt: Date) {
  const rows = await db
    .select({
      sceneType: collectionRecords.sceneType,
      value: count()
    })
    .from(collectionRecords)
    .where(recordWhere({ createdFrom: startAt }))
    .groupBy(collectionRecords.sceneType);

  return rows.reduce(
    (result, row) => {
      if (row.sceneType === "video") result.video += row.value;
      if (row.sceneType === "live") result.live += row.value;
      return result;
    },
    { video: 0, live: 0 }
  );
}

export async function getRecordDeviceSummaries(startAt = new Date(0)) {
  const rows = await db
    .select({
      deviceId: collectionRecords.deviceId,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName,
      totalCount: count(),
      videoCount: sql<number>`count(*) filter (where ${collectionRecords.sceneType} = 'video')`,
      liveCount: sql<number>`count(*) filter (where ${collectionRecords.sceneType} = 'live')`,
      latestRecordAt: sql<Date | null>`max(${collectionRecords.createdAt})`
    })
    .from(collectionRecords)
    .leftJoin(collectorDevices, eq(collectionRecords.deviceId, collectorDevices.id))
    .where(recordWhere({ createdFrom: startAt }))
    .groupBy(collectionRecords.deviceId, collectorDevices.deviceCode, collectorDevices.deviceName)
    .orderBy(desc(sql`max(${collectionRecords.createdAt})`));

  return rows.map((row) => ({
    ...row,
    totalCount: Number(row.totalCount ?? 0),
    videoCount: Number(row.videoCount ?? 0),
    liveCount: Number(row.liveCount ?? 0)
  }));
}

export async function getRecordDateSummaries(deviceCode: string) {
  const rows = await db
    .select({
      recordDate: sql<string>`to_char(${collectionRecords.createdAt}, 'YYYY-MM-DD')`,
      totalCount: count(),
      videoCount: sql<number>`count(*) filter (where ${collectionRecords.sceneType} = 'video')`,
      liveCount: sql<number>`count(*) filter (where ${collectionRecords.sceneType} = 'live')`,
      latestRecordAt: sql<Date | null>`max(${collectionRecords.createdAt})`
    })
    .from(collectionRecords)
    .leftJoin(collectorDevices, eq(collectionRecords.deviceId, collectorDevices.id))
    .where(recordWhere({ deviceCode }))
    .groupBy(sql`to_char(${collectionRecords.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${collectionRecords.createdAt}, 'YYYY-MM-DD')`));

  return rows.map((row) => ({
    ...row,
    totalCount: Number(row.totalCount ?? 0),
    videoCount: Number(row.videoCount ?? 0),
    liveCount: Number(row.liveCount ?? 0)
  }));
}
