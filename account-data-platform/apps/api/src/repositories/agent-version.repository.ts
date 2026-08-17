import { agentUpdateEvents, agentVersions, collectorDevices } from "@pkg/db/schema";
import type { AgentUpdateEventListQuery } from "@pkg/types";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export async function createAgentVersion(values: typeof agentVersions.$inferInsert) {
  const [version] = await db.insert(agentVersions).values(values).returning();
  return version;
}

export async function listAgentVersions(limit = 50, channel?: string) {
  return db
    .select()
    .from(agentVersions)
    .where(and(
      eq(agentVersions.tenantId, config.tenantId),
      channel ? eq(agentVersions.channel, channel) : undefined,
      isNull(agentVersions.deletedAt)
    ))
    .orderBy(desc(agentVersions.publishedAt), desc(agentVersions.createdAt))
    .limit(limit);
}

export async function findAgentVersion(channel: string, version: string) {
  const [savedVersion] = await db
    .select()
    .from(agentVersions)
    .where(and(
      eq(agentVersions.tenantId, config.tenantId),
      eq(agentVersions.channel, channel),
      eq(agentVersions.version, version),
      isNull(agentVersions.deletedAt)
    ))
    .limit(1);
  return savedVersion ?? null;
}

export async function findLatestPublishedAgentVersion(channel = "stable") {
  const [version] = await db
    .select()
    .from(agentVersions)
    .where(
      and(
        eq(agentVersions.tenantId, config.tenantId),
        eq(agentVersions.channel, channel),
        eq(agentVersions.status, "PUBLISHED"),
        isNull(agentVersions.deletedAt)
      )
    )
    .orderBy(desc(agentVersions.publishedAt), desc(agentVersions.createdAt))
    .limit(1);
  return version ?? null;
}

export async function createAgentUpdateEvent(values: typeof agentUpdateEvents.$inferInsert) {
  const [event] = await db.insert(agentUpdateEvents).values(values).returning();
  if (values.deviceId) {
    const patch: Partial<typeof collectorDevices.$inferInsert> = {
      targetVersion: values.toVersion,
      updateStatus: values.eventType,
      updatedAt: new Date()
    };
    if (values.eventType === "FAILED") {
      patch.lastErrorMessage = values.message;
    } else if (values.eventType === "APPLIED") {
      patch.lastErrorMessage = null;
    }
    await db.update(collectorDevices).set(patch).where(eq(collectorDevices.id, values.deviceId));
  }
  return event;
}

function updateChannelCondition(channel: string) {
  return channel === "stable"
    ? sql`coalesce(${agentUpdateEvents.payloadJson} ->> 'channel', 'stable') = 'stable'`
    : sql`${agentUpdateEvents.payloadJson} ->> 'channel' = ${channel}`;
}

export async function listAgentUpdateEvents(query: AgentUpdateEventListQuery) {
  const conditions = [
    eq(agentUpdateEvents.tenantId, config.tenantId),
    isNull(agentUpdateEvents.deletedAt),
    updateChannelCondition(query.channel),
    query.deviceCode ? eq(collectorDevices.deviceCode, query.deviceCode) : undefined,
    query.eventType ? eq(agentUpdateEvents.eventType, query.eventType) : undefined,
    query.version ? eq(agentUpdateEvents.toVersion, query.version) : undefined
  ];
  const where = and(...conditions);
  const selection = {
    id: agentUpdateEvents.id,
    agentVersionId: agentUpdateEvents.agentVersionId,
    deviceId: agentUpdateEvents.deviceId,
    deviceCode: collectorDevices.deviceCode,
    deviceName: collectorDevices.deviceName,
    fromVersion: agentUpdateEvents.fromVersion,
    toVersion: agentUpdateEvents.toVersion,
    eventType: agentUpdateEvents.eventType,
    message: agentUpdateEvents.message,
    payloadJson: agentUpdateEvents.payloadJson,
    reportedAt: agentUpdateEvents.reportedAt,
    createdAt: agentUpdateEvents.createdAt
  };
  const [data, totals] = await Promise.all([
    db.select(selection)
      .from(agentUpdateEvents)
      .innerJoin(collectorDevices, eq(agentUpdateEvents.deviceId, collectorDevices.id))
      .where(where)
      .orderBy(desc(agentUpdateEvents.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() })
      .from(agentUpdateEvents)
      .innerJoin(collectorDevices, eq(agentUpdateEvents.deviceId, collectorDevices.id))
      .where(where)
  ]);
  return { data, page: query.page, pageSize: query.pageSize, total: Number(totals[0]?.total ?? 0) };
}

export function listDevicesWithUpdateEvents(channel: string) {
  return db
    .select({
      deviceId: collectorDevices.id,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName,
      deviceStatus: collectorDevices.status,
      lastHeartbeatAt: collectorDevices.lastHeartbeatAt,
      fromVersion: agentUpdateEvents.fromVersion,
      toVersion: agentUpdateEvents.toVersion,
      updateStatus: agentUpdateEvents.eventType,
      eventMessage: agentUpdateEvents.message,
      eventCreatedAt: agentUpdateEvents.createdAt
    })
    .from(collectorDevices)
    .leftJoin(agentUpdateEvents, and(
      eq(agentUpdateEvents.deviceId, collectorDevices.id),
      eq(agentUpdateEvents.tenantId, config.tenantId),
      isNull(agentUpdateEvents.deletedAt),
      updateChannelCondition(channel)
    ))
    .where(and(
      eq(collectorDevices.tenantId, config.tenantId),
      isNull(collectorDevices.deletedAt)
    ))
    .orderBy(collectorDevices.deviceCode, desc(agentUpdateEvents.createdAt));
}
