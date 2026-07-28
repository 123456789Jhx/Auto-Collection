import { agentUpdateEvents, agentVersions, collectorDevices } from "@pkg/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export async function createAgentVersion(values: typeof agentVersions.$inferInsert) {
  const [version] = await db.insert(agentVersions).values(values).returning();
  return version;
}

export async function listAgentVersions(limit = 50) {
  return db
    .select()
    .from(agentVersions)
    .where(and(eq(agentVersions.tenantId, config.tenantId), isNull(agentVersions.deletedAt)))
    .orderBy(desc(agentVersions.publishedAt), desc(agentVersions.createdAt))
    .limit(limit);
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
    }
    await db.update(collectorDevices).set(patch).where(eq(collectorDevices.id, values.deviceId));
  }
  return event;
}
