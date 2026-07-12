import type { CreateTaskAssignmentPayload } from "@pkg/types";
import { config } from "../config";
import { findDeviceByCode } from "../repositories/device.repository";
import { findCurrentTask } from "../repositories/task.repository";
import {
  appendTaskAssignmentEvent,
  createTaskAssignment,
  expireActiveAssignmentsByDevice,
  findActiveTaskAssignmentForDevice,
  findTaskAssignmentById,
  listTaskAssignments,
  nextAssignmentCommandSequence,
  updateTaskAssignment
} from "../repositories/task-assignment.repository";
import { createCommand } from "./command.service";
import { assertCommerceCardWorkflowV2Allowed } from "./feature-rollout-control.service";

const commandByAssignmentCommand: Record<CreateTaskAssignmentPayload["commandType"], "START" | "RESUME" | "PAUSE" | "STOP"> = {
  START: "START",
  RESUME: "RESUME",
  PAUSE: "PAUSE",
  STOP: "STOP"
};

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

function defaultTargetContext(taskType: string) {
  if (taskType === "live_comment") return "target_live_room_context";
  if (taskType === "commerce_card_live_comment") return "commerce_card_live_context";
  if (taskType === "live") return "feed_context";
  return "video_playback_context";
}

function assignmentStatusFromCommand(commandType: string) {
  if (commandType === "PAUSE") return "PAUSING";
  if (commandType === "RESUME") return "RESUMING";
  if (commandType === "STOP") return "STOPPING";
  return "ISSUED";
}

function terminalReasonFromCommand(commandType: string, reason: string | undefined) {
  if (commandType !== "STOP") return undefined;
  return reason || "manual_stop";
}

function requestedWorkflowVersion(payload: Record<string, unknown> | undefined) {
  if (!payload) return 1;
  const direct = Number(payload.workflowVersion ?? payload.configVersion);
  if (Number.isFinite(direct)) return direct;
  const effectiveWorkflow = payload.effectiveWorkflow;
  if (!effectiveWorkflow || typeof effectiveWorkflow !== "object" || Array.isArray(effectiveWorkflow)) return 1;
  const nested = Number((effectiveWorkflow as Record<string, unknown>).workflowVersion);
  return Number.isFinite(nested) ? nested : 1;
}

export async function createTaskAssignmentFromAdmin(payload: CreateTaskAssignmentPayload) {
  const [device, task] = await Promise.all([
    findDeviceByCode(payload.deviceId),
    findCurrentTask("douyin")
  ]);
  if (!device) {
    throw new Error("DEVICE_UNREGISTERED");
  }

  if (
    payload.taskType === "commerce_card_live_comment" &&
    (payload.commandType === "START" || payload.commandType === "RESUME") &&
    requestedWorkflowVersion(payload.payload) >= 2
  ) {
    await assertCommerceCardWorkflowV2Allowed(device.deviceCode);
  }

  const expiresAt = addSeconds(payload.expiresInSeconds);
  const targetContext = payload.targetContext || defaultTargetContext(payload.taskType);
  const desiredPayload = {
    ...(payload.payload || {}),
    source: "task_orchestrator",
    taskType: payload.taskType,
    targetContext,
    reason: payload.reason || "manual_assignment"
  };

  if (payload.commandType === "START") {
    await expireActiveAssignmentsByDevice(device.id, "superseded_by_new_assignment");
  }

  const assignment = payload.commandType === "START"
    ? await createTaskAssignment({
      tenantId: config.tenantId,
      deviceId: device.id,
      taskId: task.id,
      taskType: payload.taskType,
      targetContext,
      status: "PENDING",
      priority: payload.priority,
      source: payload.source || "manual",
      reason: payload.reason || "manual_assignment",
      desiredPayload,
      expiresAt,
      createdBy: "admin",
      updatedBy: "admin"
    })
    : payload.assignmentId
      ? await findTaskAssignmentById(payload.assignmentId)
      : await findActiveTaskAssignmentForDevice(device.id, payload.taskType);

  if (!assignment) {
    throw new Error("ACTIVE_ASSIGNMENT_NOT_FOUND");
  }

  if (assignment.deviceId !== device.id || assignment.taskType !== payload.taskType) {
    throw new Error("ASSIGNMENT_SCOPE_MISMATCH");
  }

  const commandSequence = await nextAssignmentCommandSequence(assignment.id);
  const idempotencyKey = `assignment:${assignment.id}:command:${commandSequence}`;
  const nextStatus = assignmentStatusFromCommand(payload.commandType);

  const command = await createCommand({
    deviceId: device.deviceCode,
    taskId: task.taskCode,
    assignmentId: assignment.id,
    commandSequence,
    idempotencyKey,
    commandType: commandByAssignmentCommand[payload.commandType],
    payload: {
      ...desiredPayload,
      assignmentId: assignment.id,
      commandSequence
    },
    expiresInSeconds: payload.expiresInSeconds
  });

  const updated = await updateTaskAssignment(assignment.id, {
    commandId: command.id,
    startCommandId: payload.commandType === "START" ? command.id : assignment.startCommandId ?? assignment.commandId,
    status: nextStatus,
    issuedAt: command.issuedAt,
    expiresAt: payload.commandType === "START" ? expiresAt : assignment.expiresAt,
    terminalReason: terminalReasonFromCommand(payload.commandType, payload.reason),
    stateVersion: assignment.stateVersion + 1,
    updatedBy: "task_orchestrator"
  });

  await appendTaskAssignmentEvent({
    tenantId: config.tenantId,
    assignmentId: assignment.id,
    sequence: assignment.lastEventSeq + 1,
    deviceId: device.id,
    featureType: payload.taskType,
    stage: assignment.currentStage,
    eventType: `assignment_command_${payload.commandType.toLowerCase()}`,
    fromState: assignment.status,
    toState: nextStatus,
    status: "issued",
    reasonCode: payload.reason || "manual_assignment",
    idempotencyKey: `assignment:${assignment.id}:event:${assignment.lastEventSeq + 1}`,
    evidenceJson: {
      commandId: command.id,
      commandSequence
    },
    actor: "admin",
    createdBy: "task_orchestrator",
    updatedBy: "task_orchestrator"
  });

  const finalAssignment = await updateTaskAssignment(assignment.id, {
    lastEventSeq: assignment.lastEventSeq + 1,
    updatedBy: "task_orchestrator"
  });

  return {
    assignment: finalAssignment ?? updated ?? assignment,
    command
  };
}

export async function getTaskAssignments() {
  return listTaskAssignments(200);
}
