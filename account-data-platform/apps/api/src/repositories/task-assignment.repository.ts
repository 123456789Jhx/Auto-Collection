import { collectionTasks, collectorDevices, deviceHeartbeats, deviceTaskAssignments, mobileCommands } from "@pkg/db/schema";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export async function createTaskAssignment(values: typeof deviceTaskAssignments.$inferInsert) {
  const [assignment] = await db.insert(deviceTaskAssignments).values(values).returning();
  return assignment;
}

export async function updateTaskAssignment(assignmentId: string, values: Partial<typeof deviceTaskAssignments.$inferInsert>) {
  const [assignment] = await db
    .update(deviceTaskAssignments)
    .set({
      ...values,
      updatedAt: new Date()
    })
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.id, assignmentId),
      isNull(deviceTaskAssignments.deletedAt)
    ))
    .returning();
  return assignment ?? null;
}

export async function updateTaskAssignmentByCommandId(commandId: string, values: Partial<typeof deviceTaskAssignments.$inferInsert>) {
  const [assignment] = await db
    .update(deviceTaskAssignments)
    .set({
      ...values,
      updatedAt: new Date()
    })
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.commandId, commandId),
      isNull(deviceTaskAssignments.deletedAt)
    ))
    .returning();
  return assignment ?? null;
}

export async function expireActiveAssignmentsByDevice(deviceId: string, reason: string) {
  const now = new Date();
  return db
    .update(deviceTaskAssignments)
    .set({
      status: "SUPERSEDED",
      completedAt: now,
      updatedAt: now,
      updatedBy: "admin"
    })
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.deviceId, deviceId),
      inArray(deviceTaskAssignments.status, ["PENDING", "ISSUED", "ACKED", "ACTIVE"]),
      isNull(deviceTaskAssignments.deletedAt)
    ))
    .returning();
}

export async function listTaskAssignments(limit = 200) {
  const rows = await db
    .select({
      id: deviceTaskAssignments.id,
      deviceId: deviceTaskAssignments.deviceId,
      taskType: deviceTaskAssignments.taskType,
      targetContext: deviceTaskAssignments.targetContext,
      status: deviceTaskAssignments.status,
      priority: deviceTaskAssignments.priority,
      source: deviceTaskAssignments.source,
      reason: deviceTaskAssignments.reason,
      desiredPayload: deviceTaskAssignments.desiredPayload,
      issuedAt: deviceTaskAssignments.issuedAt,
      acknowledgedAt: deviceTaskAssignments.acknowledgedAt,
      expiresAt: deviceTaskAssignments.expiresAt,
      completedAt: deviceTaskAssignments.completedAt,
      createdAt: deviceTaskAssignments.createdAt,
      updatedAt: deviceTaskAssignments.updatedAt,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName,
      deviceStatus: collectorDevices.status,
      lastHeartbeatAt: collectorDevices.lastHeartbeatAt,
      taskCode: collectionTasks.taskCode,
      taskName: collectionTasks.name,
      commandId: mobileCommands.id,
      commandType: mobileCommands.commandType,
      commandStatus: mobileCommands.status,
      commandFetchedAt: mobileCommands.fetchedAt,
      commandAcknowledgedAt: mobileCommands.acknowledgedAt,
      commandResult: mobileCommands.resultJson
    })
    .from(deviceTaskAssignments)
    .innerJoin(collectorDevices, eq(deviceTaskAssignments.deviceId, collectorDevices.id))
    .leftJoin(collectionTasks, eq(deviceTaskAssignments.taskId, collectionTasks.id))
    .leftJoin(mobileCommands, eq(deviceTaskAssignments.commandId, mobileCommands.id))
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      isNull(deviceTaskAssignments.deletedAt),
      isNull(collectorDevices.deletedAt)
    ))
    .orderBy(desc(deviceTaskAssignments.createdAt))
    .limit(limit);

  const deviceIds = Array.from(new Set(rows.map((row) => row.deviceId)));
  const heartbeats = deviceIds.length
    ? await db
      .select({
        deviceId: deviceHeartbeats.deviceId,
        status: deviceHeartbeats.status,
        sceneType: deviceHeartbeats.sceneType,
        lastMessage: deviceHeartbeats.lastMessage,
        rawPayload: deviceHeartbeats.rawPayload,
        reportedAt: deviceHeartbeats.reportedAt,
        createdAt: deviceHeartbeats.createdAt
      })
      .from(deviceHeartbeats)
      .where(and(
        eq(deviceHeartbeats.tenantId, config.tenantId),
        inArray(deviceHeartbeats.deviceId, deviceIds),
        isNull(deviceHeartbeats.deletedAt)
      ))
      .orderBy(desc(deviceHeartbeats.reportedAt), desc(deviceHeartbeats.createdAt))
      .limit(deviceIds.length * 20)
    : [];

  const latestHeartbeatByDeviceId = new Map<string, (typeof heartbeats)[number]>();
  for (const heartbeat of heartbeats) {
    if (!heartbeat.deviceId || latestHeartbeatByDeviceId.has(heartbeat.deviceId)) {
      continue;
    }
    latestHeartbeatByDeviceId.set(heartbeat.deviceId, heartbeat);
  }

  return rows.map((row) => {
    const heartbeat = latestHeartbeatByDeviceId.get(row.deviceId) ?? null;
    return {
      ...row,
      latestHeartbeat: heartbeat
    };
  });
}
