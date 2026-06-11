import { collectorDevices, deviceLogFiles } from "@pkg/db/schema";
import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

type LogFileFilters = {
  deviceCode?: string;
  logDate?: string;
  createdFrom?: Date;
};

function logFileWhere(filters: LogFileFilters = {}) {
  const conditions = [eq(deviceLogFiles.tenantId, config.tenantId), isNull(deviceLogFiles.deletedAt)];
  if (filters.deviceCode) {
    conditions.push(eq(collectorDevices.deviceCode, filters.deviceCode));
  }
  if (filters.logDate) {
    conditions.push(eq(deviceLogFiles.logDate, filters.logDate));
  }
  if (filters.createdFrom) {
    conditions.push(gte(deviceLogFiles.createdAt, filters.createdFrom));
  }
  return and(...conditions);
}

export async function createDeviceLogFile(values: typeof deviceLogFiles.$inferInsert) {
  const [file] = await db.insert(deviceLogFiles).values(values).returning();
  return file;
}

export async function upsertDeviceLogFile(values: typeof deviceLogFiles.$inferInsert) {
  if (!values.deviceId) {
    return createDeviceLogFile(values);
  }

  const [existing] = await db
    .select({ id: deviceLogFiles.id })
    .from(deviceLogFiles)
    .where(and(
      eq(deviceLogFiles.tenantId, values.tenantId ?? config.tenantId),
      eq(deviceLogFiles.deviceId, values.deviceId),
      eq(deviceLogFiles.logDate, values.logDate),
      eq(deviceLogFiles.fileName, values.fileName),
      isNull(deviceLogFiles.deletedAt)
    ))
    .orderBy(desc(deviceLogFiles.createdAt))
    .limit(1);

  if (!existing) {
    return createDeviceLogFile(values);
  }

  const [file] = await db
    .update(deviceLogFiles)
    .set({
      taskId: values.taskId,
      content: values.content,
      fileSizeBytes: values.fileSizeBytes,
      infoCount: values.infoCount,
      warnCount: values.warnCount,
      errorCount: values.errorCount,
      lastErrorReason: values.lastErrorReason,
      uploadedAt: values.uploadedAt,
      updatedAt: new Date(),
      updatedBy: values.updatedBy ?? "mobile_agent"
    })
    .where(eq(deviceLogFiles.id, existing.id))
    .returning();
  return file;
}

export async function listDeviceLogFiles(filters: LogFileFilters = {}) {
  const rows = await db
    .select({
      id: deviceLogFiles.id,
      createdAt: deviceLogFiles.createdAt,
      logDate: deviceLogFiles.logDate,
      fileName: deviceLogFiles.fileName,
      fileSizeBytes: deviceLogFiles.fileSizeBytes,
      infoCount: deviceLogFiles.infoCount,
      warnCount: deviceLogFiles.warnCount,
      errorCount: deviceLogFiles.errorCount,
      lastErrorReason: deviceLogFiles.lastErrorReason,
      uploadedAt: deviceLogFiles.uploadedAt,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName
    })
    .from(deviceLogFiles)
    .leftJoin(collectorDevices, eq(deviceLogFiles.deviceId, collectorDevices.id))
    .where(logFileWhere(filters))
    .orderBy(desc(deviceLogFiles.logDate), desc(deviceLogFiles.createdAt));

  const latestByDayAndName = new Map<string, (typeof rows)[number]>();
  rows.forEach((row) => {
    const key = `${row.deviceCode ?? ""}:${row.logDate}:${row.fileName}`;
    const current = latestByDayAndName.get(key);
    const currentTime = current?.uploadedAt ?? current?.createdAt ?? new Date(0);
    const rowTime = row.uploadedAt ?? row.createdAt ?? new Date(0);
    if (!current || rowTime > currentTime) {
      latestByDayAndName.set(key, row);
    }
  });

  return Array.from(latestByDayAndName.values()).sort((left, right) => {
    if (left.logDate !== right.logDate) return right.logDate.localeCompare(left.logDate);
    const leftTime = (left.uploadedAt ?? left.createdAt ?? new Date(0)).getTime();
    const rightTime = (right.uploadedAt ?? right.createdAt ?? new Date(0)).getTime();
    return rightTime - leftTime;
  });
}

export async function listDeviceLogFileDates(deviceCode: string) {
  return db
    .select({
      logDate: deviceLogFiles.logDate,
      fileCount: count(),
      fileSizeBytes: sql<number>`coalesce(sum(${deviceLogFiles.fileSizeBytes}), 0)`,
      infoCount: sql<number>`coalesce(sum(${deviceLogFiles.infoCount}), 0)`,
      warnCount: sql<number>`coalesce(sum(${deviceLogFiles.warnCount}), 0)`,
      errorCount: sql<number>`coalesce(sum(${deviceLogFiles.errorCount}), 0)`,
      latestUploadedAt: sql<Date | null>`max(${deviceLogFiles.uploadedAt})`,
      lastErrorReason: sql<string | null>`max(${deviceLogFiles.lastErrorReason})`
    })
    .from(deviceLogFiles)
    .leftJoin(collectorDevices, eq(deviceLogFiles.deviceId, collectorDevices.id))
    .where(logFileWhere({ deviceCode }))
    .groupBy(deviceLogFiles.logDate)
    .orderBy(desc(deviceLogFiles.logDate));
}

export async function getLogFileDeviceSummaries(startAt = new Date(0)) {
  const rows = await db
    .select({
      deviceId: deviceLogFiles.deviceId,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName,
      fileCount: count(),
      fileSizeBytes: sql<number>`coalesce(sum(${deviceLogFiles.fileSizeBytes}), 0)`,
      latestUploadedAt: sql<Date | null>`max(${deviceLogFiles.uploadedAt})`,
      latestCreatedAt: sql<Date | null>`max(${deviceLogFiles.createdAt})`
    })
    .from(deviceLogFiles)
    .leftJoin(collectorDevices, eq(deviceLogFiles.deviceId, collectorDevices.id))
    .where(logFileWhere({ createdFrom: startAt }))
    .groupBy(deviceLogFiles.deviceId, collectorDevices.deviceCode, collectorDevices.deviceName)
    .orderBy(desc(sql`max(${deviceLogFiles.uploadedAt})`));

  return rows.map((row) => ({
    ...row,
    fileCount: Number(row.fileCount ?? 0),
    fileSizeBytes: Number(row.fileSizeBytes ?? 0)
  }));
}

export async function getDeviceLogFile(fileId: string) {
  const [file] = await db
    .select({
      id: deviceLogFiles.id,
      createdAt: deviceLogFiles.createdAt,
      logDate: deviceLogFiles.logDate,
      fileName: deviceLogFiles.fileName,
      content: deviceLogFiles.content,
      fileSizeBytes: deviceLogFiles.fileSizeBytes,
      infoCount: deviceLogFiles.infoCount,
      warnCount: deviceLogFiles.warnCount,
      errorCount: deviceLogFiles.errorCount,
      lastErrorReason: deviceLogFiles.lastErrorReason,
      uploadedAt: deviceLogFiles.uploadedAt,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName
    })
    .from(deviceLogFiles)
    .leftJoin(collectorDevices, eq(deviceLogFiles.deviceId, collectorDevices.id))
    .where(and(eq(deviceLogFiles.tenantId, config.tenantId), eq(deviceLogFiles.id, fileId), isNull(deviceLogFiles.deletedAt)))
    .limit(1);
  return file ?? null;
}
