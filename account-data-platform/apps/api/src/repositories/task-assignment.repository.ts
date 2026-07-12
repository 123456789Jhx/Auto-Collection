import { collectionTasks, collectorDevices, deviceHeartbeats, deviceTaskAssignmentEvents, deviceTaskAssignments, mobileCommands } from "@pkg/db/schema";
import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

const ACTIVE_ASSIGNMENT_STATUSES = ["PENDING", "ISSUED", "ACKED", "ACTIVE", "RUNNING", "PAUSING", "PAUSED", "RESUMING", "STOPPING", "BLOCKED"] as const;

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

export async function findTaskAssignmentById(assignmentId: string) {
  const [assignment] = await db
    .select()
    .from(deviceTaskAssignments)
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.id, assignmentId),
      isNull(deviceTaskAssignments.deletedAt)
    ))
    .limit(1);
  return assignment ?? null;
}

export async function findActiveTaskAssignmentForDevice(deviceId: string, taskType: string) {
  const [assignment] = await db
    .select()
    .from(deviceTaskAssignments)
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.deviceId, deviceId),
      eq(deviceTaskAssignments.taskType, taskType),
      inArray(deviceTaskAssignments.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
      isNull(deviceTaskAssignments.deletedAt)
    ))
    .orderBy(desc(deviceTaskAssignments.createdAt))
    .limit(1);
  return assignment ?? null;
}

export async function nextAssignmentCommandSequence(assignmentId: string) {
  const [row] = await db
    .select({ latest: max(mobileCommands.commandSequence) })
    .from(mobileCommands)
    .where(and(
      eq(mobileCommands.tenantId, config.tenantId),
      eq(mobileCommands.assignmentId, assignmentId),
      isNull(mobileCommands.deletedAt)
    ));
  return Number(row?.latest ?? 0) + 1;
}

export async function appendTaskAssignmentEvent(values: typeof deviceTaskAssignmentEvents.$inferInsert) {
  const [event] = await db.insert(deviceTaskAssignmentEvents).values(values).returning();
  return event;
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

export async function updateTaskAssignmentByCommand(command: typeof mobileCommands.$inferSelect, values: Partial<typeof deviceTaskAssignments.$inferInsert>) {
  if (command.assignmentId) {
    return updateTaskAssignment(command.assignmentId, values);
  }
  return updateTaskAssignmentByCommandId(command.id, values);
}

export async function expireActiveAssignmentsByDevice(deviceId: string, reason: string) {
  const now = new Date();
  return db
    .update(deviceTaskAssignments)
    .set({
      status: "SUPERSEDED",
      reason,
      completedAt: now,
      updatedAt: now,
      updatedBy: "admin"
    })
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.deviceId, deviceId),
      inArray(deviceTaskAssignments.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
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
      startCommandId: deviceTaskAssignments.startCommandId,
      selectedTargetId: deviceTaskAssignments.selectedTargetId,
      targetCode: deviceTaskAssignments.targetCode,
      configRevision: deviceTaskAssignments.configRevision,
      configHash: deviceTaskAssignments.configHash,
      snapshotHash: deviceTaskAssignments.snapshotHash,
      currentStage: deviceTaskAssignments.currentStage,
      progressJson: deviceTaskAssignments.progressJson,
      stateVersion: deviceTaskAssignments.stateVersion,
      lastEventSeq: deviceTaskAssignments.lastEventSeq,
      blockReason: deviceTaskAssignments.blockReason,
      terminalReason: deviceTaskAssignments.terminalReason,
      commandType: mobileCommands.commandType,
      commandStatus: mobileCommands.status,
      commandSequence: mobileCommands.commandSequence,
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
    const rawPayload = heartbeat?.rawPayload && typeof heartbeat.rawPayload === "object" ? heartbeat.rawPayload as Record<string, unknown> : {};
    const douyinAccountName = typeof rawPayload.douyinAccountName === "string" && rawPayload.douyinAccountName.trim()
      ? rawPayload.douyinAccountName.trim()
      : null;
    return {
      ...row,
      douyinAccountName,
      latestHeartbeat: heartbeat
    };
  });
}
