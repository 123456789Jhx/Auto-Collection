import { collectionTasks, collectorDevices, deviceHeartbeats, deviceTaskAssignmentEvents, deviceTaskAssignments, mobileCommands } from "@pkg/db/schema";
import { and, desc, eq, inArray, isNull, max, or } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

export const ACTIVE_ASSIGNMENT_STATUSES = ["PENDING", "DISPATCHED", "RUNNING", "PAUSING", "PAUSED", "RESUMING", "BLOCKED"] as const;
export const TERMINAL_ASSIGNMENT_STATUSES = ["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"] as const;
const LEGACY_INACTIVE_ASSIGNMENT_STATUSES = ["ACKED"] as const;

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class AssignmentRuntimeError extends Error {
  readonly details: Record<string, unknown>;

  constructor(code: string, details: Record<string, unknown> = {}) {
    super(code);
    this.details = details;
  }
}

async function lockAssignment(transaction: DatabaseTransaction, assignmentId: string) {
  const [assignment] = await transaction
    .select()
    .from(deviceTaskAssignments)
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.id, assignmentId),
      isNull(deviceTaskAssignments.deletedAt)
    ))
    .limit(1)
    .for("update");
  return assignment ?? null;
}

function assertAssignmentMutable(assignment: typeof deviceTaskAssignments.$inferSelect) {
  if (TERMINAL_ASSIGNMENT_STATUSES.includes(assignment.status as typeof TERMINAL_ASSIGNMENT_STATUSES[number])) {
    throw new AssignmentRuntimeError("ASSIGNMENT_TERMINAL", { state: assignment.status });
  }
}

export async function createTaskAssignmentRuntimeAtomic(input: {
  assignment: typeof deviceTaskAssignments.$inferInsert;
  command: typeof mobileCommands.$inferInsert;
  event: typeof deviceTaskAssignmentEvents.$inferInsert;
}) {
  return db.transaction(async (transaction) => {
    const [device] = await transaction
      .select({ id: collectorDevices.id })
      .from(collectorDevices)
      .where(and(
        eq(collectorDevices.tenantId, config.tenantId),
        eq(collectorDevices.id, input.assignment.deviceId),
        isNull(collectorDevices.deletedAt)
      ))
      .limit(1)
      .for("update");
    if (!device) {
      throw new AssignmentRuntimeError("DEVICE_UNREGISTERED");
    }

    const now = new Date();
    await transaction
      .update(deviceTaskAssignments)
      .set({
        status: "SUPERSEDED",
        terminalReason: "legacy_acked_superseded_by_new_start",
        completedAt: now,
        updatedAt: now,
        updatedBy: "task_orchestrator"
      })
      .where(and(
        eq(deviceTaskAssignments.tenantId, config.tenantId),
        eq(deviceTaskAssignments.deviceId, input.assignment.deviceId),
        inArray(deviceTaskAssignments.status, [...LEGACY_INACTIVE_ASSIGNMENT_STATUSES]),
        isNull(deviceTaskAssignments.deletedAt)
      ));

    const [active] = await transaction
      .select({ id: deviceTaskAssignments.id, status: deviceTaskAssignments.status })
      .from(deviceTaskAssignments)
      .where(and(
        eq(deviceTaskAssignments.tenantId, config.tenantId),
        eq(deviceTaskAssignments.deviceId, input.assignment.deviceId),
        inArray(deviceTaskAssignments.status, [...ACTIVE_ASSIGNMENT_STATUSES]),
        isNull(deviceTaskAssignments.deletedAt)
      ))
      .limit(1)
      .for("update");
    if (active) {
      throw new AssignmentRuntimeError("ACTIVE_ASSIGNMENT_EXISTS", {
        assignmentId: active.id,
        state: active.status
      });
    }

    const [assignment] = await transaction.insert(deviceTaskAssignments).values(input.assignment).returning();
    const [command] = await transaction.insert(mobileCommands).values(input.command).returning();
    const [event] = await transaction.insert(deviceTaskAssignmentEvents).values(input.event).returning();
    const [updatedAssignment] = await transaction
      .update(deviceTaskAssignments)
      .set({
        commandId: command.id,
        startCommandId: command.id,
        status: "DISPATCHED",
        issuedAt: command.issuedAt,
        stateVersion: 2,
        lastEventSeq: event.sequence,
        updatedAt: new Date(),
        updatedBy: "task_orchestrator"
      })
      .where(eq(deviceTaskAssignments.id, assignment.id))
      .returning();
    await transaction
      .update(collectorDevices)
      .set({ lastCommandAt: command.issuedAt, updatedAt: new Date() })
      .where(eq(collectorDevices.id, device.id));
    return { assignment: updatedAssignment ?? assignment, command, event, idempotent: false };
  });
}

export async function issueTaskAssignmentCommandAtomic(input: {
  assignmentId: string;
  expectedStateVersion: number;
  commandType: "PAUSE" | "RESUME" | "STOP";
  commandIdempotencyKey: string;
  commandExpiresAt: Date;
  commandPayload: Record<string, unknown>;
  nextStatus: string | null;
  assignmentPatch?: Partial<typeof deviceTaskAssignments.$inferInsert>;
  eventType: string;
  reasonCode: string;
  payloadHash: string;
  actor: string;
}) {
  return db.transaction(async (transaction) => {
    const assignment = await lockAssignment(transaction, input.assignmentId);
    if (!assignment) {
      throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
    }

    const [existingCommand] = await transaction
      .select()
      .from(mobileCommands)
      .where(and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.idempotencyKey, input.commandIdempotencyKey),
        isNull(mobileCommands.deletedAt)
      ))
      .limit(1);
    if (existingCommand) {
      const existingPayload = existingCommand.payloadJson && typeof existingCommand.payloadJson === "object"
        ? existingCommand.payloadJson
        : {};
      const existingRequestHash = typeof existingPayload._requestHash === "string"
        ? existingPayload._requestHash
        : null;
      if (
        existingCommand.assignmentId !== assignment.id ||
        existingCommand.commandType !== input.commandType ||
        (existingRequestHash && existingRequestHash !== input.payloadHash)
      ) {
        throw new AssignmentRuntimeError("IDEMPOTENCY_CONFLICT", { idempotencyKey: input.commandIdempotencyKey });
      }
      return { assignment, command: existingCommand, event: null, idempotent: true };
    }

    assertAssignmentMutable(assignment);
    if (assignment.stateVersion !== input.expectedStateVersion) {
      throw new AssignmentRuntimeError("ASSIGNMENT_STATE_VERSION_CONFLICT", {
        expectedStateVersion: input.expectedStateVersion,
        currentStateVersion: assignment.stateVersion,
        state: assignment.status
      });
    }

    const [latest] = await transaction
      .select({ value: max(mobileCommands.commandSequence) })
      .from(mobileCommands)
      .where(and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.assignmentId, assignment.id),
        isNull(mobileCommands.deletedAt)
      ));
    const commandSequence = Number(latest?.value ?? 0) + 1;
    const issuedAt = new Date();

    await transaction
      .update(mobileCommands)
      .set({
        status: "IGNORED",
        resultJson: { reason: "superseded_by_new_state_command" },
        acknowledgedAt: issuedAt,
        updatedAt: issuedAt,
        updatedBy: input.actor
      })
      .where(and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.assignmentId, assignment.id),
        inArray(mobileCommands.commandType, ["START", "PAUSE", "RESUME", "STOP"]),
        inArray(mobileCommands.status, ["PENDING", "FETCHED"]),
        isNull(mobileCommands.deletedAt)
      ));

    const [command] = await transaction
      .insert(mobileCommands)
      .values({
        tenantId: config.tenantId,
        taskId: assignment.taskId,
        deviceId: assignment.deviceId,
        assignmentId: assignment.id,
        commandSequence,
        idempotencyKey: input.commandIdempotencyKey,
        commandType: input.commandType,
        status: "PENDING",
        payloadJson: {
          ...input.commandPayload,
          assignmentId: assignment.id,
          commandSequence,
          expectedStateVersion: assignment.stateVersion + 1,
          _requestHash: input.payloadHash
        },
        issuedAt,
        expiresAt: input.commandExpiresAt,
        createdBy: input.actor,
        updatedBy: input.actor
      })
      .returning();

    const nextStateVersion = assignment.stateVersion + 1;
    const eventSequence = assignment.lastEventSeq + 1;
    const nextStatus = input.nextStatus ?? assignment.status;
    const [event] = await transaction
      .insert(deviceTaskAssignmentEvents)
      .values({
        tenantId: config.tenantId,
        assignmentId: assignment.id,
        sequence: eventSequence,
        deviceId: assignment.deviceId,
        targetId: assignment.selectedTargetId,
        featureType: assignment.taskType,
        stage: assignment.currentStage,
        eventType: input.eventType,
        fromState: assignment.status,
        toState: nextStatus,
        status: "started",
        reasonCode: input.reasonCode,
        idempotencyKey: `${input.commandIdempotencyKey}:event`,
        payloadHash: input.payloadHash,
        evidenceJson: { commandId: command.id, commandSequence },
        actor: "admin",
        occurredAt: issuedAt,
        createdBy: input.actor,
        updatedBy: input.actor
      })
      .returning();

    const [updatedAssignment] = await transaction
      .update(deviceTaskAssignments)
      .set({
        ...input.assignmentPatch,
        commandId: command.id,
        status: nextStatus,
        stateVersion: nextStateVersion,
        lastEventSeq: eventSequence,
        updatedAt: issuedAt,
        updatedBy: input.actor
      })
      .where(eq(deviceTaskAssignments.id, assignment.id))
      .returning();
    await transaction
      .update(collectorDevices)
      .set({ lastCommandAt: issuedAt, updatedAt: issuedAt })
      .where(eq(collectorDevices.id, assignment.deviceId));

    return { assignment: updatedAssignment ?? assignment, command, event, idempotent: false };
  });
}

export async function appendTaskAssignmentEventAtomic(input: {
  assignmentId: string;
  deviceId: string;
  expectedStateVersion: number;
  sequence: number;
  idempotencyKey: string;
  payloadHash: string;
  event: Omit<typeof deviceTaskAssignmentEvents.$inferInsert, "tenantId" | "assignmentId" | "deviceId" | "sequence" | "idempotencyKey" | "payloadHash">;
  nextStatus?: string;
  nextStage?: string | null;
  blockReason?: string | null;
}) {
  return db.transaction(async (transaction) => {
    const assignment = await lockAssignment(transaction, input.assignmentId);
    if (!assignment || assignment.deviceId !== input.deviceId) {
      throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
    }

    const [existingEvent] = await transaction
      .select()
      .from(deviceTaskAssignmentEvents)
      .where(and(
        eq(deviceTaskAssignmentEvents.tenantId, config.tenantId),
        eq(deviceTaskAssignmentEvents.assignmentId, assignment.id),
        or(
          eq(deviceTaskAssignmentEvents.sequence, input.sequence),
          eq(deviceTaskAssignmentEvents.idempotencyKey, input.idempotencyKey)
        )
      ))
      .limit(1);
    if (existingEvent) {
      if (existingEvent.payloadHash !== input.payloadHash) {
        throw new AssignmentRuntimeError("IDEMPOTENCY_CONFLICT", {
          sequence: input.sequence,
          idempotencyKey: input.idempotencyKey
        });
      }
      return { assignment, event: existingEvent, idempotent: true };
    }

    assertAssignmentMutable(assignment);
    if (assignment.stateVersion !== input.expectedStateVersion) {
      throw new AssignmentRuntimeError("ASSIGNMENT_STATE_VERSION_CONFLICT", {
        expectedStateVersion: input.expectedStateVersion,
        currentStateVersion: assignment.stateVersion,
        state: assignment.status
      });
    }
    if (input.sequence !== assignment.lastEventSeq + 1) {
      throw new AssignmentRuntimeError("EVENT_SEQUENCE_GAP", {
        expectedSequence: assignment.lastEventSeq + 1,
        receivedSequence: input.sequence
      });
    }

    const nextStatus = input.nextStatus ?? assignment.status;
    const [event] = await transaction
      .insert(deviceTaskAssignmentEvents)
      .values({
        ...input.event,
        tenantId: config.tenantId,
        assignmentId: assignment.id,
        deviceId: assignment.deviceId,
        sequence: input.sequence,
        idempotencyKey: input.idempotencyKey,
        payloadHash: input.payloadHash,
        fromState: input.event.fromState ?? assignment.status,
        toState: input.event.toState ?? nextStatus
      })
      .returning();
    const [updatedAssignment] = await transaction
      .update(deviceTaskAssignments)
      .set({
        status: nextStatus,
        currentStage: input.nextStage === undefined ? assignment.currentStage : input.nextStage,
        blockReason: input.blockReason === undefined ? assignment.blockReason : input.blockReason,
        lastEventSeq: input.sequence,
        stateVersion: assignment.stateVersion + 1,
        startedAt: nextStatus === "RUNNING" ? assignment.startedAt ?? event.occurredAt : assignment.startedAt,
        updatedAt: new Date(),
        updatedBy: "mobile_agent"
      })
      .where(eq(deviceTaskAssignments.id, assignment.id))
      .returning();
    return { assignment: updatedAssignment ?? assignment, event, idempotent: false };
  });
}

export async function updateTaskAssignmentProgressAtomic(input: {
  assignmentId: string;
  deviceId: string;
  expectedStateVersion: number;
  stage: string;
  checkpointSequence: number;
  checkpointHash: string;
  checkpointSummary: Record<string, unknown>;
  progress: Record<string, unknown>;
}) {
  return db.transaction(async (transaction) => {
    const assignment = await lockAssignment(transaction, input.assignmentId);
    if (!assignment || assignment.deviceId !== input.deviceId) {
      throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
    }
    assertAssignmentMutable(assignment);
    if (assignment.stateVersion !== input.expectedStateVersion) {
      throw new AssignmentRuntimeError("ASSIGNMENT_STATE_VERSION_CONFLICT", {
        expectedStateVersion: input.expectedStateVersion,
        currentStateVersion: assignment.stateVersion
      });
    }
    if (input.checkpointSequence === assignment.checkpointSequence) {
      if (assignment.checkpointHash !== input.checkpointHash) {
        throw new AssignmentRuntimeError("CHECKPOINT_SEQUENCE_CONFLICT", {
          checkpointSequence: input.checkpointSequence
        });
      }
      return { assignment, idempotent: true };
    }
    if (input.checkpointSequence < assignment.checkpointSequence) {
      throw new AssignmentRuntimeError("CHECKPOINT_STALE", {
        currentCheckpointSequence: assignment.checkpointSequence,
        receivedCheckpointSequence: input.checkpointSequence
      });
    }
    if (input.checkpointSequence !== assignment.checkpointSequence + 1) {
      throw new AssignmentRuntimeError("CHECKPOINT_SEQUENCE_GAP", {
        expectedCheckpointSequence: assignment.checkpointSequence + 1,
        receivedCheckpointSequence: input.checkpointSequence
      });
    }

    const [updatedAssignment] = await transaction
      .update(deviceTaskAssignments)
      .set({
        currentStage: input.stage,
        checkpointSequence: input.checkpointSequence,
        checkpointHash: input.checkpointHash,
        checkpointSummary: input.checkpointSummary,
        progressJson: input.progress,
        stateVersion: assignment.stateVersion,
        updatedAt: new Date(),
        updatedBy: "mobile_agent"
      })
      .where(eq(deviceTaskAssignments.id, assignment.id))
      .returning();
    return { assignment: updatedAssignment ?? assignment, idempotent: false };
  });
}

export async function completeTaskAssignmentAtomic(input: {
  assignmentId: string;
  deviceId: string;
  expectedStateVersion: number;
  state: "SUCCEEDED" | "FAILED" | "CANCELLED" | "EXPIRED";
  terminalReason: string;
  finalProgress: Record<string, unknown>;
  payloadHash: string;
  occurredAt: Date;
}) {
  return db.transaction(async (transaction) => {
    const assignment = await lockAssignment(transaction, input.assignmentId);
    if (!assignment || assignment.deviceId !== input.deviceId) {
      throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
    }
    if (TERMINAL_ASSIGNMENT_STATUSES.includes(assignment.status as typeof TERMINAL_ASSIGNMENT_STATUSES[number])) {
      if (assignment.status === input.state && assignment.terminalReason === input.terminalReason) {
        const [existingEvent] = await transaction
          .select()
          .from(deviceTaskAssignmentEvents)
          .where(and(
            eq(deviceTaskAssignmentEvents.tenantId, config.tenantId),
            eq(deviceTaskAssignmentEvents.assignmentId, assignment.id),
            eq(deviceTaskAssignmentEvents.idempotencyKey, `assignment:${assignment.id}:complete:${input.expectedStateVersion}`),
            eq(deviceTaskAssignmentEvents.payloadHash, input.payloadHash)
          ))
          .limit(1);
        if (existingEvent) {
          return { assignment, event: existingEvent, idempotent: true };
        }
        throw new AssignmentRuntimeError("IDEMPOTENCY_CONFLICT", {
          assignmentId: assignment.id,
          operation: "complete"
        });
      }
      throw new AssignmentRuntimeError("ASSIGNMENT_TERMINAL", { state: assignment.status });
    }
    if (assignment.stateVersion !== input.expectedStateVersion) {
      throw new AssignmentRuntimeError("ASSIGNMENT_STATE_VERSION_CONFLICT", {
        expectedStateVersion: input.expectedStateVersion,
        currentStateVersion: assignment.stateVersion
      });
    }

    const sequence = assignment.lastEventSeq + 1;
    const [event] = await transaction
      .insert(deviceTaskAssignmentEvents)
      .values({
        tenantId: config.tenantId,
        assignmentId: assignment.id,
        sequence,
        deviceId: assignment.deviceId,
        targetId: assignment.selectedTargetId,
        featureType: assignment.taskType,
        stage: assignment.currentStage,
        eventType: "assignment_completed",
        fromState: assignment.status,
        toState: input.state,
        status: input.state === "SUCCEEDED" ? "succeeded" : "failed",
        reasonCode: input.terminalReason,
        idempotencyKey: `assignment:${assignment.id}:complete:${input.expectedStateVersion}`,
        payloadHash: input.payloadHash,
        evidenceJson: input.finalProgress,
        occurredAt: input.occurredAt,
        actor: "mobile",
        createdBy: "mobile_agent",
        updatedBy: "mobile_agent"
      })
      .returning();
    const [updatedAssignment] = await transaction
      .update(deviceTaskAssignments)
      .set({
        status: input.state,
        progressJson: input.finalProgress,
        terminalReason: input.terminalReason,
        completedAt: input.occurredAt,
        lastEventSeq: sequence,
        stateVersion: assignment.stateVersion + 1,
        updatedAt: new Date(),
        updatedBy: "mobile_agent"
      })
      .where(eq(deviceTaskAssignments.id, assignment.id))
      .returning();
    return { assignment: updatedAssignment ?? assignment, event, idempotent: false };
  });
}

export async function acknowledgeTaskAssignmentCommandAtomic(input: {
  commandId: string;
  deviceId: string;
  status: "FETCHED" | "DONE" | "FAILED" | "IGNORED";
  result: Record<string, unknown>;
  payloadHash: string;
}) {
  return db.transaction(async (transaction) => {
    const [command] = await transaction
      .select()
      .from(mobileCommands)
      .where(and(
        eq(mobileCommands.tenantId, config.tenantId),
        eq(mobileCommands.id, input.commandId),
        eq(mobileCommands.deviceId, input.deviceId),
        isNull(mobileCommands.deletedAt)
      ))
      .limit(1)
      .for("update");
    if (!command) {
      throw new AssignmentRuntimeError("COMMAND_NOT_FOUND");
    }
    if (["DONE", "FAILED", "IGNORED"].includes(command.status)) {
      const previousHash = command.resultJson && typeof command.resultJson._ackHash === "string"
        ? command.resultJson._ackHash
        : "";
      if (command.status === input.status && previousHash === input.payloadHash) {
        const assignment = command.assignmentId ? await lockAssignment(transaction, command.assignmentId) : null;
        return { command, assignment, event: null, idempotent: true };
      }
      throw new AssignmentRuntimeError("COMMAND_ACK_CONFLICT", { currentStatus: command.status });
    }

    const now = new Date();
    const [updatedCommand] = await transaction
      .update(mobileCommands)
      .set({
        status: input.status,
        resultJson: { ...input.result, _ackHash: input.payloadHash },
        fetchedAt: input.status === "FETCHED" ? now : command.fetchedAt,
        acknowledgedAt: input.status === "DONE" || input.status === "FAILED" || input.status === "IGNORED" ? now : command.acknowledgedAt,
        updatedAt: now,
        updatedBy: "mobile_agent"
      })
      .where(eq(mobileCommands.id, command.id))
      .returning();
    if (!command.assignmentId || input.status === "FETCHED") {
      return { command: updatedCommand ?? command, assignment: null, event: null, idempotent: false };
    }

    const assignment = await lockAssignment(transaction, command.assignmentId);
    if (!assignment) {
      return { command: updatedCommand ?? command, assignment: null, event: null, idempotent: false };
    }
    if (input.status === "IGNORED") {
      return { command: updatedCommand ?? command, assignment, event: null, idempotent: false };
    }

    let nextStatus = assignment.status;
    let blockReason: string | null | undefined;
    let terminalReason: string | null | undefined;
    let completedAt: Date | null | undefined;
    if (input.status === "DONE") {
      if (command.commandType === "START") {
        if (assignment.status !== "DISPATCHED") {
          throw new AssignmentRuntimeError("COMMAND_ACK_STATE_CONFLICT", { state: assignment.status, commandType: command.commandType });
        }
        nextStatus = "RUNNING";
        blockReason = null;
      } else if (command.commandType === "PAUSE") {
        if (assignment.status !== "PAUSING" || input.result.checkpointStable !== true) {
          throw new AssignmentRuntimeError("PAUSE_CHECKPOINT_REQUIRED", { state: assignment.status });
        }
        nextStatus = "PAUSED";
        blockReason = null;
      } else if (command.commandType === "RESUME") {
        if (assignment.status !== "RESUMING") {
          throw new AssignmentRuntimeError("COMMAND_ACK_STATE_CONFLICT", { state: assignment.status, commandType: command.commandType });
        }
        nextStatus = "RUNNING";
        blockReason = null;
      } else if (command.commandType === "STOP") {
        nextStatus = "CANCELLED";
        terminalReason = typeof input.result.reason === "string" ? input.result.reason : "stop_command_applied";
        completedAt = now;
        blockReason = null;
      }
    } else if (input.status === "FAILED") {
      if (command.commandType === "START") {
        nextStatus = "FAILED";
        terminalReason = typeof input.result.reason === "string" ? input.result.reason : "start_command_failed";
        completedAt = now;
      } else if (command.commandType === "PAUSE") {
        nextStatus = "RUNNING";
        blockReason = null;
      } else if (command.commandType === "RESUME") {
        nextStatus = "PAUSED";
      } else if (command.commandType === "STOP") {
        nextStatus = "BLOCKED";
        blockReason = "stop_command_failed";
      }
    }

    const sequence = assignment.lastEventSeq + 1;
    const [event] = await transaction
      .insert(deviceTaskAssignmentEvents)
      .values({
        tenantId: config.tenantId,
        assignmentId: assignment.id,
        sequence,
        deviceId: assignment.deviceId,
        targetId: assignment.selectedTargetId,
        featureType: assignment.taskType,
        stage: assignment.currentStage,
        eventType: `assignment_command_${command.commandType.toLowerCase()}_${input.status.toLowerCase()}`,
        fromState: assignment.status,
        toState: nextStatus,
        status: input.status === "DONE" ? "succeeded" : "failed",
        reasonCode: typeof input.result.reason === "string" ? input.result.reason : input.status.toLowerCase(),
        idempotencyKey: `${command.idempotencyKey || command.id}:ack:${input.status.toLowerCase()}`,
        payloadHash: input.payloadHash,
        evidenceJson: { commandId: command.id, commandSequence: command.commandSequence, result: input.result },
        occurredAt: now,
        actor: "mobile",
        createdBy: "mobile_agent",
        updatedBy: "mobile_agent"
      })
      .returning();
    const [updatedAssignment] = await transaction
      .update(deviceTaskAssignments)
      .set({
        status: nextStatus,
        acknowledgedAt: now,
        startedAt: command.commandType === "START" && input.status === "DONE" ? assignment.startedAt ?? now : assignment.startedAt,
        blockReason,
        terminalReason,
        completedAt,
        lastEventSeq: sequence,
        stateVersion: assignment.stateVersion + 1,
        updatedAt: now,
        updatedBy: "mobile_agent"
      })
      .where(eq(deviceTaskAssignments.id, assignment.id))
      .returning();
    return {
      command: updatedCommand ?? command,
      assignment: updatedAssignment ?? assignment,
      event,
      idempotent: false
    };
  });
}

export async function listTaskAssignmentEvents(assignmentId: string, limit = 500) {
  return db
    .select()
    .from(deviceTaskAssignmentEvents)
    .where(and(
      eq(deviceTaskAssignmentEvents.tenantId, config.tenantId),
      eq(deviceTaskAssignmentEvents.assignmentId, assignmentId),
      isNull(deviceTaskAssignmentEvents.deletedAt)
    ))
    .orderBy(deviceTaskAssignmentEvents.sequence)
    .limit(limit);
}

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

export async function findTaskAssignmentCommandByIdempotencyKey(idempotencyKey: string) {
  const [command] = await db
    .select()
    .from(mobileCommands)
    .where(and(
      eq(mobileCommands.tenantId, config.tenantId),
      eq(mobileCommands.idempotencyKey, idempotencyKey),
      isNull(mobileCommands.deletedAt)
    ))
    .limit(1);
  return command ?? null;
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

export async function findActiveTaskAssignmentForDeviceAny(deviceId: string) {
  const [assignment] = await db
    .select()
    .from(deviceTaskAssignments)
    .where(and(
      eq(deviceTaskAssignments.tenantId, config.tenantId),
      eq(deviceTaskAssignments.deviceId, deviceId),
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
