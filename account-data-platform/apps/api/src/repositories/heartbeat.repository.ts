import { collectorDevices, deviceHeartbeats } from "@pkg/db/schema";
import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export async function createHeartbeat(values: typeof deviceHeartbeats.$inferInsert) {
  const [heartbeat] = await db.insert(deviceHeartbeats).values(values).returning();
  if (values.deviceId) {
    const patch: Partial<typeof collectorDevices.$inferInsert> = {
      status: values.status,
      lastHeartbeatAt: values.reportedAt ?? new Date(),
      updatedAt: new Date()
    };
    const rawPayload = values.rawPayload as Record<string, unknown> | null | undefined;
    const appVersion = rawPayload && typeof rawPayload.appVersion === "string" ? rawPayload.appVersion : undefined;
    if (appVersion) {
      patch.appVersion = appVersion;
    }
    await db.update(collectorDevices).set(patch).where(eq(collectorDevices.id, values.deviceId));
  }
  return heartbeat;
}

export async function listLatestHeartbeats(limit = 10) {
  const rows = await db
    .select()
    .from(deviceHeartbeats)
    .orderBy(desc(deviceHeartbeats.createdAt))
    .limit(limit);
  const seen = new Set<string>();
  const latest = [];
  for (const row of rows) {
    if (!row.deviceId || seen.has(row.deviceId)) {
      continue;
    }
    seen.add(row.deviceId);
    latest.push(row);
  }
  return latest;
}

export async function listLatestHeartbeatsByDeviceIds(deviceIds: string[]) {
  if (!deviceIds.length) {
    return [];
  }
  const rows = await db
    .select()
    .from(deviceHeartbeats)
    .where(inArray(deviceHeartbeats.deviceId, deviceIds))
    .orderBy(desc(deviceHeartbeats.createdAt));

  const seen = new Set<string>();
  const latest = [];
  for (const row of rows) {
    if (!row.deviceId || seen.has(row.deviceId)) {
      continue;
    }
    seen.add(row.deviceId);
    latest.push(row);
  }
  return latest;
}

export async function findLatestHeartbeatByDeviceId(deviceId: string) {
  const [heartbeat] = await db
    .select()
    .from(deviceHeartbeats)
    .where(eq(deviceHeartbeats.deviceId, deviceId))
    .orderBy(desc(deviceHeartbeats.reportedAt), desc(deviceHeartbeats.createdAt))
    .limit(1);
  return heartbeat ?? null;
}

export async function listDeviceHeartbeats(deviceCode: string, limit = 50) {
  return db
    .select({
      id: deviceHeartbeats.id,
      status: deviceHeartbeats.status,
      sceneType: deviceHeartbeats.sceneType,
      elapsedMinutes: deviceHeartbeats.elapsedMinutes,
      remainingMinutes: deviceHeartbeats.remainingMinutes,
      viewedCount: deviceHeartbeats.viewedCount,
      liveViewedCount: deviceHeartbeats.liveViewedCount,
      capturedCount: deviceHeartbeats.capturedCount,
      lastMessage: deviceHeartbeats.lastMessage,
      expectedEndAt: deviceHeartbeats.expectedEndAt,
      rawPayload: deviceHeartbeats.rawPayload,
      reportedAt: deviceHeartbeats.reportedAt,
      createdAt: deviceHeartbeats.createdAt,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName
    })
    .from(deviceHeartbeats)
    .leftJoin(collectorDevices, eq(deviceHeartbeats.deviceId, collectorDevices.id))
    .where(and(
      eq(deviceHeartbeats.tenantId, config.tenantId),
      eq(collectorDevices.deviceCode, deviceCode),
      isNull(collectorDevices.deletedAt),
      isNull(deviceHeartbeats.deletedAt)
    ))
    .orderBy(desc(deviceHeartbeats.reportedAt), desc(deviceHeartbeats.createdAt))
    .limit(limit);
}

export async function getDeviceDailyProgressSummaries(deviceCode: string, limit = 30) {
  const rows = await db
    .select({
      progressDate: sql<string>`to_char(${deviceHeartbeats.reportedAt}, 'YYYY-MM-DD')`,
      heartbeatCount: count(),
      latestHeartbeatAt: sql<Date | null>`max(${deviceHeartbeats.reportedAt})`,
      firstHeartbeatAt: sql<Date | null>`min(${deviceHeartbeats.reportedAt})`,
      maxVideoElapsedMinutes: sql<number>`coalesce(max(coalesce(case when (${deviceHeartbeats.rawPayload}->>'videoElapsedMinutes') ~ '^[0-9]+$' then (${deviceHeartbeats.rawPayload}->>'videoElapsedMinutes')::int end, case when ${deviceHeartbeats.sceneType} = 'video' then ${deviceHeartbeats.elapsedMinutes} else 0 end)), 0)`,
      maxVideoPlannedMinutes: sql<number>`coalesce(max(coalesce(case when (${deviceHeartbeats.rawPayload}->>'plannedVideoMinutes') ~ '^[0-9]+$' then (${deviceHeartbeats.rawPayload}->>'plannedVideoMinutes')::int end, 0)), 0)`,
      maxLiveElapsedMinutes: sql<number>`coalesce(max(coalesce(case when (${deviceHeartbeats.rawPayload}->>'liveElapsedMinutes') ~ '^[0-9]+$' then (${deviceHeartbeats.rawPayload}->>'liveElapsedMinutes')::int end, case when ${deviceHeartbeats.sceneType} = 'live' then ${deviceHeartbeats.elapsedMinutes} else 0 end)), 0)`,
      maxLivePlannedMinutes: sql<number>`coalesce(max(coalesce(case when (${deviceHeartbeats.rawPayload}->>'plannedLiveMinutes') ~ '^[0-9]+$' then (${deviceHeartbeats.rawPayload}->>'plannedLiveMinutes')::int end, 0)), 0)`,
      maxViewedCount: sql<number>`coalesce(max(${deviceHeartbeats.viewedCount}), 0)`,
      maxLiveViewedCount: sql<number>`coalesce(max(${deviceHeartbeats.liveViewedCount}), 0)`,
      maxCapturedCount: sql<number>`coalesce(max(${deviceHeartbeats.capturedCount}), 0)`,
      runningCount: sql<number>`count(*) filter (where ${deviceHeartbeats.status} = 'running')`,
      pausedCount: sql<number>`count(*) filter (where ${deviceHeartbeats.status} = 'paused')`,
      stoppedCount: sql<number>`count(*) filter (where ${deviceHeartbeats.status} = 'stopped')`,
      errorCount: sql<number>`count(*) filter (where ${deviceHeartbeats.status} = 'error')`,
      lastMessage: sql<string | null>`(array_agg(${deviceHeartbeats.lastMessage} order by ${deviceHeartbeats.reportedAt} desc nulls last, ${deviceHeartbeats.createdAt} desc))[1]`
    })
    .from(deviceHeartbeats)
    .leftJoin(collectorDevices, eq(deviceHeartbeats.deviceId, collectorDevices.id))
    .where(and(
      eq(deviceHeartbeats.tenantId, config.tenantId),
      eq(collectorDevices.deviceCode, deviceCode),
      isNull(collectorDevices.deletedAt),
      isNull(deviceHeartbeats.deletedAt)
    ))
    .groupBy(sql`to_char(${deviceHeartbeats.reportedAt}, 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${deviceHeartbeats.reportedAt}, 'YYYY-MM-DD')`))
    .limit(limit);

  return rows.map((row) => {
    const videoPlanned = Number(row.maxVideoPlannedMinutes ?? 0);
    const livePlanned = Number(row.maxLivePlannedMinutes ?? 0);
    const videoElapsed = Number(row.maxVideoElapsedMinutes ?? 0);
    const liveElapsed = Number(row.maxLiveElapsedMinutes ?? 0);
    return {
      ...row,
      heartbeatCount: Number(row.heartbeatCount ?? 0),
      maxVideoElapsedMinutes: videoElapsed,
      maxVideoPlannedMinutes: videoPlanned,
      videoCompletionPercent: videoPlanned > 0 ? Math.min(100, Math.round((videoElapsed / videoPlanned) * 100)) : 0,
      maxLiveElapsedMinutes: liveElapsed,
      maxLivePlannedMinutes: livePlanned,
      liveCompletionPercent: livePlanned > 0 ? Math.min(100, Math.round((liveElapsed / livePlanned) * 100)) : 0,
      maxViewedCount: Number(row.maxViewedCount ?? 0),
      maxLiveViewedCount: Number(row.maxLiveViewedCount ?? 0),
      maxCapturedCount: Number(row.maxCapturedCount ?? 0),
      runningCount: Number(row.runningCount ?? 0),
      pausedCount: Number(row.pausedCount ?? 0),
      stoppedCount: Number(row.stoppedCount ?? 0),
      errorCount: Number(row.errorCount ?? 0)
    };
  });
}
