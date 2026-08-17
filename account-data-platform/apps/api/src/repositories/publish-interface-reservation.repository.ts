import {
  collectorDevices,
  deviceTaskAssignments,
  publishRunBindings,
  publishRuns
} from "@pkg/db/schema";
import type { InterfacePublishRunStatus } from "@pkg/types";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  ne,
  notInArray,
  or
} from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

const TERMINAL_ASSIGNMENT_STATUSES = [
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "EXPIRED",
  "STOPPED",
  "SUPERSEDED",
  "COMPLETED"
];
const RESERVABLE_RUN_STATUSES = ["SCHEDULED", "RUNNING", "PAUSED"];
const ONLINE_HEARTBEAT_WINDOW_MS = 3 * 60 * 1000;

export type InterfacePublishReservationCandidate = {
  id: string;
  runId: string;
  deviceId: string;
  deviceCode: string;
  accountName: string;
  accountNo: string;
  externalAccountKey: string;
  noMaterialRetryMinutes: number;
  nextReservationRetryAt: Date | null;
};

export type InterfacePublishReserveResult =
  | { kind: "RESERVED"; assignmentId: string }
  | { kind: "DEVICE_OFFLINE" }
  | { kind: "DEVICE_BUSY" }
  | { kind: "RUN_INACTIVE" };

export interface PublishInterfaceReservationRepository {
  listCandidates(runId: string, now: Date): Promise<InterfacePublishReservationCandidate[]>;
  reserveOne(
    runBindingId: string,
    now: Date,
    nextRetryAt: Date,
    actor: string
  ): Promise<InterfacePublishReserveResult>;
  findRunStatus(runId: string): Promise<InterfacePublishRunStatus | null>;
  releaseAll(runId: string, actor: string): Promise<number>;
  listActiveRunIds(): Promise<string[]>;
}

export async function listInterfacePublishReservationCandidates(runId: string, now: Date) {
  return db.select({
    id: publishRunBindings.id,
    runId: publishRunBindings.runId,
    deviceId: publishRunBindings.deviceId,
    deviceCode: publishRunBindings.deviceCode,
    accountName: publishRunBindings.accountName,
    accountNo: publishRunBindings.accountNo,
    externalAccountKey: publishRunBindings.externalAccountKey,
    noMaterialRetryMinutes: publishRuns.noMaterialRetryMinutes,
    nextReservationRetryAt: publishRunBindings.nextReservationRetryAt
  }).from(publishRunBindings)
    .innerJoin(publishRuns, and(
      eq(publishRuns.tenantId, config.tenantId),
      eq(publishRuns.id, publishRunBindings.runId),
      inArray(publishRuns.status, RESERVABLE_RUN_STATUSES),
      isNull(publishRuns.deletedAt)
    ))
    .where(and(
      eq(publishRunBindings.tenantId, config.tenantId),
      eq(publishRunBindings.runId, runId),
      eq(publishRunBindings.skippedForRun, false),
      eq(publishRunBindings.reservationStatus, "WAITING_DEVICE"),
      or(
        isNull(publishRunBindings.nextReservationRetryAt),
        lte(publishRunBindings.nextReservationRetryAt, now)
      ),
      isNull(publishRunBindings.deletedAt)
    ))
    .orderBy(asc(publishRunBindings.createdAt));
}

async function markBindingWaiting(
  runBindingId: string,
  reason: "DEVICE_OFFLINE" | "DEVICE_BUSY",
  nextRetryAt: Date,
  actor: string
) {
  await db.update(publishRunBindings).set({
    reservationStatus: "WAITING_DEVICE",
    reservationReason: reason,
    nextReservationRetryAt: nextRetryAt,
    updatedAt: new Date(),
    updatedBy: actor
  }).where(and(
    eq(publishRunBindings.tenantId, config.tenantId),
    eq(publishRunBindings.id, runBindingId),
    ne(publishRunBindings.reservationStatus, "RELEASED"),
    isNull(publishRunBindings.deletedAt)
  ));
}

export async function reserveInterfacePublishDevice(
  runBindingId: string,
  now: Date,
  nextRetryAt: Date,
  actor: string
): Promise<InterfacePublishReserveResult> {
  try {
    return await db.transaction(async (transaction) => {
      const [binding] = await transaction.select().from(publishRunBindings).where(and(
        eq(publishRunBindings.tenantId, config.tenantId),
        eq(publishRunBindings.id, runBindingId),
        eq(publishRunBindings.skippedForRun, false),
        isNull(publishRunBindings.deletedAt)
      )).limit(1).for("update");
      if (!binding || binding.reservationStatus === "RELEASED") return { kind: "RUN_INACTIVE" };
      if (binding.reservationStatus === "RESERVED" && binding.assignmentId) {
        return { kind: "RESERVED", assignmentId: binding.assignmentId };
      }

      const [run] = await transaction.select({ status: publishRuns.status }).from(publishRuns).where(and(
        eq(publishRuns.tenantId, config.tenantId),
        eq(publishRuns.id, binding.runId),
        isNull(publishRuns.deletedAt)
      )).limit(1).for("update");
      if (!run || !RESERVABLE_RUN_STATUSES.includes(run.status)) return { kind: "RUN_INACTIVE" };

      const [device] = await transaction.select().from(collectorDevices).where(and(
        eq(collectorDevices.tenantId, config.tenantId),
        eq(collectorDevices.id, binding.deviceId),
        eq(collectorDevices.enabled, true),
        isNull(collectorDevices.deletedAt)
      )).limit(1).for("update");
      const offline = !device
        || device.status === "offline"
        || !device.lastHeartbeatAt
        || now.getTime() - device.lastHeartbeatAt.getTime() > ONLINE_HEARTBEAT_WINDOW_MS;
      if (offline) {
        await transaction.update(publishRunBindings).set({
          reservationStatus: "WAITING_DEVICE",
          reservationReason: "DEVICE_OFFLINE",
          nextReservationRetryAt: nextRetryAt,
          updatedAt: now,
          updatedBy: actor
        }).where(eq(publishRunBindings.id, binding.id));
        return { kind: "DEVICE_OFFLINE" };
      }

      const [activeAssignment] = await transaction.select({ id: deviceTaskAssignments.id })
        .from(deviceTaskAssignments)
        .where(and(
          eq(deviceTaskAssignments.tenantId, config.tenantId),
          eq(deviceTaskAssignments.deviceId, binding.deviceId),
          notInArray(deviceTaskAssignments.status, TERMINAL_ASSIGNMENT_STATUSES),
          isNull(deviceTaskAssignments.deletedAt)
        )).limit(1).for("update");
      if (activeAssignment) {
        await transaction.update(publishRunBindings).set({
          reservationStatus: "WAITING_DEVICE",
          reservationReason: "DEVICE_BUSY",
          nextReservationRetryAt: nextRetryAt,
          updatedAt: now,
          updatedBy: actor
        }).where(eq(publishRunBindings.id, binding.id));
        return { kind: "DEVICE_BUSY" };
      }

      const [assignment] = await transaction.insert(deviceTaskAssignments).values({
        tenantId: config.tenantId,
        deviceId: binding.deviceId,
        taskType: "publish_video_interface",
        status: "PENDING",
        source: "interface_publish",
        expectedAccountId: binding.accountNo,
        expectedAccountName: binding.accountName,
        desiredPayload: {
          runId: binding.runId,
          runBindingId: binding.id,
          accountName: binding.accountName,
          accountNo: binding.accountNo,
          externalAccountKey: binding.externalAccountKey
        },
        createdBy: actor,
        updatedBy: actor
      }).returning();

      await transaction.update(publishRunBindings).set({
        assignmentId: assignment.id,
        reservationStatus: "RESERVED",
        reservationReason: null,
        nextReservationRetryAt: null,
        reservedAt: now,
        updatedAt: now,
        updatedBy: actor
      }).where(eq(publishRunBindings.id, binding.id));
      return { kind: "RESERVED", assignmentId: assignment.id };
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      await markBindingWaiting(runBindingId, "DEVICE_BUSY", nextRetryAt, actor);
      return { kind: "DEVICE_BUSY" };
    }
    throw error;
  }
}

export async function findInterfacePublishReservationRunStatus(runId: string) {
  const [run] = await db.select({ status: publishRuns.status }).from(publishRuns).where(and(
    eq(publishRuns.tenantId, config.tenantId),
    eq(publishRuns.id, runId),
    isNull(publishRuns.deletedAt)
  )).limit(1);
  return (run?.status as InterfacePublishRunStatus | undefined) ?? null;
}

export async function releaseInterfacePublishReservations(runId: string, actor: string) {
  return db.transaction(async (transaction) => {
    const bindings = await transaction.select({
      id: publishRunBindings.id,
      assignmentId: publishRunBindings.assignmentId
    }).from(publishRunBindings).where(and(
      eq(publishRunBindings.tenantId, config.tenantId),
      eq(publishRunBindings.runId, runId),
      ne(publishRunBindings.reservationStatus, "RELEASED"),
      isNull(publishRunBindings.deletedAt)
    )).for("update");
    const assignmentIds = bindings.flatMap((binding) => binding.assignmentId ? [binding.assignmentId] : []);
    const now = new Date();
    if (assignmentIds.length) {
      await transaction.update(deviceTaskAssignments).set({
        status: "STOPPED",
        terminalReason: "interface_publish_run_stopped",
        completedAt: now,
        updatedAt: now,
        updatedBy: actor
      }).where(and(
        eq(deviceTaskAssignments.tenantId, config.tenantId),
        inArray(deviceTaskAssignments.id, assignmentIds),
        eq(deviceTaskAssignments.taskType, "publish_video_interface"),
        eq(deviceTaskAssignments.source, "interface_publish"),
        notInArray(deviceTaskAssignments.status, TERMINAL_ASSIGNMENT_STATUSES),
        isNull(deviceTaskAssignments.deletedAt)
      ));
    }
    if (bindings.length) {
      await transaction.update(publishRunBindings).set({
        reservationStatus: "RELEASED",
        reservationReason: "RUN_STOPPED",
        nextReservationRetryAt: null,
        releasedAt: now,
        updatedAt: now,
        updatedBy: actor
      }).where(and(
        eq(publishRunBindings.tenantId, config.tenantId),
        inArray(publishRunBindings.id, bindings.map((binding) => binding.id))
      ));
    }
    return bindings.length;
  });
}

export async function listActiveInterfacePublishRunIds() {
  const rows = await db.select({ id: publishRuns.id }).from(publishRuns).where(and(
    eq(publishRuns.tenantId, config.tenantId),
    inArray(publishRuns.status, ["SCHEDULED", "RUNNING", "PAUSED"]),
    isNull(publishRuns.deletedAt)
  ));
  return rows.map((row) => row.id);
}

export const publishInterfaceReservationRepository: PublishInterfaceReservationRepository = {
  listCandidates: listInterfacePublishReservationCandidates,
  reserveOne: reserveInterfacePublishDevice,
  findRunStatus: findInterfacePublishReservationRunStatus,
  releaseAll: releaseInterfacePublishReservations,
  listActiveRunIds: listActiveInterfacePublishRunIds
};
