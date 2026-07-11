import type { CreateTaskAssignmentPayload } from "@pkg/types";
import { config } from "../config";
import { findDeviceByCode } from "../repositories/device.repository";
import { findCurrentTask } from "../repositories/task.repository";
import {
  createTaskAssignment,
  expireActiveAssignmentsByDevice,
  listTaskAssignments,
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
  if (commandType === "PAUSE") return "PAUSED";
  if (commandType === "STOP") return "STOPPED";
  return "ISSUED";
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

  await expireActiveAssignmentsByDevice(device.id, "superseded_by_new_assignment");
  const expiresAt = addSeconds(payload.expiresInSeconds);
  const targetContext = payload.targetContext || defaultTargetContext(payload.taskType);
  const desiredPayload = {
    ...(payload.payload || {}),
    source: "task_orchestrator",
    taskType: payload.taskType,
    targetContext,
    reason: payload.reason || "manual_assignment"
  };

  const assignment = await createTaskAssignment({
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
  });

  const command = await createCommand({
    deviceId: device.deviceCode,
    taskId: task.taskCode,
    commandType: commandByAssignmentCommand[payload.commandType],
    payload: {
      ...desiredPayload,
      assignmentId: assignment.id
    },
    expiresInSeconds: payload.expiresInSeconds
  });

  const updated = await updateTaskAssignment(assignment.id, {
    commandId: command.id,
    status: assignmentStatusFromCommand(payload.commandType),
    issuedAt: command.issuedAt,
    updatedBy: "task_orchestrator"
  });

  return {
    assignment: updated ?? assignment,
    command
  };
}

export async function getTaskAssignments() {
  return listTaskAssignments(200);
}
