import type {
  TaskAssignmentCompletePayload,
  TaskAssignmentEventPayload,
  TaskAssignmentProgressPayload,
  TaskAssignmentState
} from "@pkg/types";
import { resolveDeviceByToken } from "../repositories/device.repository";
import {
  appendTaskAssignmentEventAtomic,
  AssignmentRuntimeError,
  completeTaskAssignmentAtomic,
  findTaskAssignmentById,
  listTaskAssignmentEvents,
  updateTaskAssignmentProgressAtomic
} from "../repositories/task-assignment.repository";
import { buildCanonicalSha256 } from "./live-target-config.service";

const allowedTransitions: Record<TaskAssignmentState, TaskAssignmentState[]> = {
  PENDING: ["DISPATCHED", "CANCELLED", "EXPIRED"],
  DISPATCHED: ["RUNNING", "BLOCKED", "FAILED", "CANCELLED", "EXPIRED"],
  RUNNING: ["PAUSING", "BLOCKED", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"],
  PAUSING: ["PAUSED", "RUNNING", "BLOCKED", "CANCELLED", "EXPIRED"],
  PAUSED: ["RESUMING", "CANCELLED", "EXPIRED"],
  RESUMING: ["RUNNING", "PAUSED", "BLOCKED", "CANCELLED", "EXPIRED"],
  BLOCKED: ["RESUMING", "CANCELLED", "EXPIRED"],
  SUCCEEDED: [],
  FAILED: [],
  CANCELLED: [],
  EXPIRED: []
};

function parseAssignmentState(value: string): TaskAssignmentState {
  if (value in allowedTransitions) {
    return value as TaskAssignmentState;
  }
  throw new AssignmentRuntimeError("ASSIGNMENT_STATE_INVALID", { state: value });
}

function assertTransition(fromState: TaskAssignmentState, toState: TaskAssignmentState) {
  if (fromState === toState) {
    return;
  }
  if (!allowedTransitions[fromState].includes(toState)) {
    throw new AssignmentRuntimeError("ASSIGNMENT_STATE_TRANSITION_INVALID", { fromState, toState });
  }
}

async function resolveOwnedAssignment(assignmentId: string, deviceCode: string, deviceToken?: string) {
  const device = await resolveDeviceByToken({
    deviceToken: deviceToken || "",
    expectedDeviceCode: deviceCode
  });
  const assignment = await findTaskAssignmentById(assignmentId);
  if (!assignment || assignment.deviceId !== device.id) {
    throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
  }
  return { assignment, device };
}

export async function saveTaskAssignmentEvent(
  assignmentId: string,
  payload: TaskAssignmentEventPayload,
  deviceToken?: string
) {
  const { assignment, device } = await resolveOwnedAssignment(assignmentId, payload.deviceId, deviceToken);
  const currentState = parseAssignmentState(assignment.status);
  if (payload.fromState && payload.fromState !== currentState) {
    throw new AssignmentRuntimeError("ASSIGNMENT_STATE_CONFLICT", {
      currentState,
      receivedFromState: payload.fromState
    });
  }
  const nextState = payload.toState ?? currentState;
  assertTransition(currentState, nextState);
  const payloadHash = buildCanonicalSha256(payload);
  return appendTaskAssignmentEventAtomic({
    assignmentId,
    deviceId: device.id,
    expectedStateVersion: payload.expectedStateVersion,
    sequence: payload.sequence,
    idempotencyKey: payload.idempotencyKey,
    payloadHash,
    nextStatus: nextState,
    nextStage: payload.stage,
    blockReason: nextState === "BLOCKED" ? payload.reasonCode || "mobile_blocked" : undefined,
    event: {
      targetId: assignment.selectedTargetId,
      featureType: assignment.taskType,
      stage: payload.stage ?? assignment.currentStage,
      eventType: payload.eventType,
      fromState: currentState,
      toState: nextState,
      status: payload.status,
      reasonCode: payload.reasonCode ?? undefined,
      evidenceJson: {
        ...payload.evidence,
        retryable: payload.retryable,
        recoveryAction: payload.recoveryAction ?? null,
        configRevision: assignment.configRevision,
        configHash: assignment.configHash,
        snapshotHash: assignment.snapshotHash,
        stateVersion: payload.expectedStateVersion
      },
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date(),
      actor: "mobile",
      createdBy: "mobile_agent",
      updatedBy: "mobile_agent"
    }
  });
}

export async function saveTaskAssignmentProgress(
  assignmentId: string,
  payload: TaskAssignmentProgressPayload,
  deviceToken?: string
) {
  const { assignment, device } = await resolveOwnedAssignment(assignmentId, payload.deviceId, deviceToken);
  const checkpoint = payload.checkpoint;
  if (
    checkpoint.assignmentId !== assignment.id ||
    checkpoint.configRevision !== assignment.configRevision ||
    checkpoint.configHash !== assignment.configHash ||
    checkpoint.snapshotHash !== assignment.snapshotHash
  ) {
    throw new AssignmentRuntimeError("CHECKPOINT_IDENTITY_MISMATCH", {
      assignmentId: assignment.id,
      checkpointAssignmentId: checkpoint.assignmentId
    });
  }
  if (checkpoint.stateVersion !== payload.expectedStateVersion) {
    throw new AssignmentRuntimeError("CHECKPOINT_STATE_VERSION_MISMATCH", {
      checkpointStateVersion: checkpoint.stateVersion,
      expectedStateVersion: payload.expectedStateVersion
    });
  }
  const expectedHash = buildCanonicalSha256({
    ...checkpoint,
    checkpointHash: undefined
  });
  if (checkpoint.checkpointHash !== expectedHash) {
    throw new AssignmentRuntimeError("CHECKPOINT_HASH_MISMATCH");
  }

  return updateTaskAssignmentProgressAtomic({
    assignmentId,
    deviceId: device.id,
    expectedStateVersion: payload.expectedStateVersion,
    stage: payload.stage,
    checkpointSequence: checkpoint.checkpointSequence,
    checkpointHash: checkpoint.checkpointHash,
    checkpointSummary: checkpoint,
    progress: payload.progress
  });
}

export async function completeTaskAssignment(
  assignmentId: string,
  payload: TaskAssignmentCompletePayload,
  deviceToken?: string
) {
  const { device } = await resolveOwnedAssignment(assignmentId, payload.deviceId, deviceToken);
  return completeTaskAssignmentAtomic({
    assignmentId,
    deviceId: device.id,
    expectedStateVersion: payload.expectedStateVersion,
    state: payload.state,
    terminalReason: payload.terminalReason,
    finalProgress: payload.finalProgress,
    payloadHash: buildCanonicalSha256(payload),
    occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : new Date()
  });
}

export async function getTaskAssignmentEvents(assignmentId: string) {
  const assignment = await findTaskAssignmentById(assignmentId);
  if (!assignment) {
    throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
  }
  return listTaskAssignmentEvents(assignmentId);
}

