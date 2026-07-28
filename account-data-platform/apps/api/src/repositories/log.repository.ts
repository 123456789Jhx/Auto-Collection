import { collectorDevices, runtimeLogs } from "@pkg/db/schema";
import { and, count, desc, eq, gte, ilike, isNull, lt, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type LogFilters = {
  deviceCode?: string;
  level?: string;
  keyword?: string;
  createdFrom?: Date;
  createdTo?: Date;
};

export async function createRuntimeLog(values: typeof runtimeLogs.$inferInsert) {
  const [log] = await db.insert(runtimeLogs).values(values).returning();
  return log;
}

function logWhere(filters: LogFilters = {}) {
  const conditions = [eq(runtimeLogs.tenantId, config.tenantId), isNull(runtimeLogs.deletedAt)];
  if (filters.level) {
    conditions.push(eq(runtimeLogs.level, filters.level));
  }
  if (filters.deviceCode) {
    conditions.push(eq(collectorDevices.deviceCode, filters.deviceCode));
  }
  if (filters.keyword) {
    conditions.push(ilike(runtimeLogs.message, `%${filters.keyword}%`));
  }
  if (filters.createdFrom) {
    conditions.push(gte(runtimeLogs.createdAt, filters.createdFrom));
  }
  if (filters.createdTo) {
    conditions.push(lt(runtimeLogs.createdAt, filters.createdTo));
  }
  return and(...conditions);
}

export async function listRuntimeLogs(page: number, pageSize: number, filters: LogFilters = {}) {
  const offset = (page - 1) * pageSize;
  const where = logWhere(filters);
  const [total] = await db
    .select({ value: count() })
    .from(runtimeLogs)
    .leftJoin(collectorDevices, eq(runtimeLogs.deviceId, collectorDevices.id))
    .where(where);
  const data = await db
    .select({
      id: runtimeLogs.id,
      createdAt: runtimeLogs.createdAt,
      level: runtimeLogs.level,
      message: runtimeLogs.message,
      contextJson: runtimeLogs.contextJson,
      stopReason: runtimeLogs.stopReason,
      reportedAt: runtimeLogs.reportedAt,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName
    })
    .from(runtimeLogs)
    .leftJoin(collectorDevices, eq(runtimeLogs.deviceId, collectorDevices.id))
    .where(where)
    .orderBy(desc(runtimeLogs.createdAt))
    .limit(pageSize)
    .offset(offset);
  return { data, totalItems: total.value };
}

export async function countRuntimeLogs(filters: LogFilters = {}) {
  const [total] = await db.select({ value: count() }).from(runtimeLogs).where(logWhere(filters));
  return total.value;
}

export async function getLogDeviceSummaries(startAt = new Date(0)) {
  const rows = await db
    .select({
      deviceId: runtimeLogs.deviceId,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName,
      totalCount: count(),
      infoCount: sql<number>`count(*) filter (where ${runtimeLogs.level} = 'INFO')`,
      warnCount: sql<number>`count(*) filter (where ${runtimeLogs.level} = 'WARN')`,
      errorCount: sql<number>`count(*) filter (where ${runtimeLogs.level} = 'ERROR')`,
      latestLogAt: sql<Date | null>`max(${runtimeLogs.createdAt})`
    })
    .from(runtimeLogs)
    .leftJoin(collectorDevices, eq(runtimeLogs.deviceId, collectorDevices.id))
    .where(logWhere({ createdFrom: startAt }))
    .groupBy(runtimeLogs.deviceId, collectorDevices.deviceCode, collectorDevices.deviceName)
    .orderBy(desc(sql`max(${runtimeLogs.createdAt})`));

  return rows.map((row) => ({
    ...row,
    totalCount: Number(row.totalCount ?? 0),
    infoCount: Number(row.infoCount ?? 0),
    warnCount: Number(row.warnCount ?? 0),
    errorCount: Number(row.errorCount ?? 0)
  }));
}

export async function getLogDateSummaries(deviceCode: string) {
  const logDateExpr = sql<string>`to_char(${runtimeLogs.createdAt} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')`;
  const rows = await db
    .select({
      logDate: logDateExpr,
      totalCount: count(),
      infoCount: sql<number>`count(*) filter (where ${runtimeLogs.level} = 'INFO')`,
      warnCount: sql<number>`count(*) filter (where ${runtimeLogs.level} = 'WARN')`,
      errorCount: sql<number>`count(*) filter (where ${runtimeLogs.level} = 'ERROR')`,
      latestLogAt: sql<Date | null>`max(${runtimeLogs.createdAt})`
    })
    .from(runtimeLogs)
    .leftJoin(collectorDevices, eq(runtimeLogs.deviceId, collectorDevices.id))
    .where(logWhere({ deviceCode }))
    .groupBy(logDateExpr)
    .orderBy(desc(logDateExpr));

  return rows.map((row) => ({
    ...row,
    totalCount: Number(row.totalCount ?? 0),
    infoCount: Number(row.infoCount ?? 0),
    warnCount: Number(row.warnCount ?? 0),
    errorCount: Number(row.errorCount ?? 0)
  }));
}
