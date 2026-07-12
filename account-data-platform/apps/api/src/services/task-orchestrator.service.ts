import {
  commerceCardWorkflowSnapshotSchema,
  type CommerceCardEffectiveWorkflow,
  type CommerceCardWorkflowSnapshot,
  type CreateTaskAssignmentCommandPayload,
  type CreateTaskAssignmentPayload
} from "@pkg/types";
import { randomUUID } from "node:crypto";
import { config } from "../config";
import { findDeviceByCode, findDeviceById } from "../repositories/device.repository";
import { hasUnresolvedCommerceCardCommentActions } from "../repositories/commerce-card-execution.repository";
import {
  findLiveTargetDetail,
  getCommerceCardFeaturePreviewData
} from "../repositories/live-target.repository";
import { findCurrentTask } from "../repositories/task.repository";
import {
  AssignmentRuntimeError,
  createTaskAssignmentRuntimeAtomic,
  findTaskAssignmentById,
  findTaskAssignmentCommandByIdempotencyKey,
  issueTaskAssignmentCommandAtomic,
  listTaskAssignments
} from "../repositories/task-assignment.repository";
import {
  assertExecutionApprovalMatches,
  commerceCardAccountIdentityKey
} from "./commerce-card-execution-approval.service";
import { assertCommerceCardWorkflowV2Allowed } from "./feature-rollout-control.service";
import {
  buildCanonicalSha256,
  buildCommerceCardCommentPoolHash
} from "./live-target-config.service";

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

function defaultTargetContext(taskType: string) {
  if (taskType === "live_comment") return "target_live_room_context";
  if (taskType === "commerce_card_live_comment") return "commerce_card_live_context";
  if (taskType === "live") return "feed_context";
  return "video_playback_context";
}

function buildSnapshotHash(input: {
  assignmentId: string;
  targetId: string;
  targetCode: string;
  configRevision: number;
  configHash: string;
  configSnapshot: CommerceCardWorkflowSnapshot;
  executionApprovalId: string | null;
  expectedAccountId: string;
  expectedAccountName: string | null;
  expiresAt: Date;
}) {
  return buildCanonicalSha256({
    snapshotVersion: 1,
    assignmentId: input.assignmentId,
    workflowVersion: 2,
    selectedTargetId: input.targetId,
    targetCode: input.targetCode,
    configRevision: input.configRevision,
    configHash: input.configHash,
    configSnapshot: input.configSnapshot,
    executionApprovalId: input.executionApprovalId,
    expectedAccountId: input.expectedAccountId,
    expectedAccountName: input.expectedAccountName,
    expiresAt: input.expiresAt.toISOString()
  });
}

function assertTargetBoundToDevice(
  detail: NonNullable<Awaited<ReturnType<typeof findLiveTargetDetail>>>,
  deviceId: string
) {
  const bindings = detail.bindings.filter((binding) =>
    binding.featureType === "commerce_card_live_comment" && binding.enabled
  );
  if (bindings.length > 0 && !bindings.some((binding) => !binding.deviceId || binding.deviceId === deviceId)) {
    throw new AssignmentRuntimeError("LIVE_TARGET_NOT_BOUND_TO_DEVICE");
  }
}

async function createStartAssignment(
  payload: CreateTaskAssignmentPayload,
  device: NonNullable<Awaited<ReturnType<typeof findDeviceByCode>>>,
  task: NonNullable<Awaited<ReturnType<typeof findCurrentTask>>>
) {
  const assignmentId = randomUUID();
  const targetContext = payload.targetContext || defaultTargetContext(payload.taskType);
  const reason = payload.reason || "manual_assignment";
  let expiresAt = addSeconds(payload.expiresInSeconds);
  let desiredPayload: Record<string, unknown> = {
    ...(payload.payload || {}),
    source: "task_orchestrator",
    taskType: payload.taskType,
    targetContext,
    reason,
    workflowVersion: payload.workflowVersion
  };
  let assignmentFields: Partial<Parameters<typeof createTaskAssignmentRuntimeAtomic>[0]["assignment"]> = {
    workflowVersion: payload.workflowVersion
  };

  if (payload.workflowVersion === 2) {
    if (payload.taskType !== "commerce_card_live_comment" || !payload.targetId) {
      throw new AssignmentRuntimeError("COMMERCE_CARD_V2_TARGET_REQUIRED");
    }
    await assertCommerceCardWorkflowV2Allowed(device.deviceCode);
    const [preview, detail] = await Promise.all([
      getCommerceCardFeaturePreviewData(payload.targetId),
      findLiveTargetDetail(payload.targetId)
    ]);
    if (!preview || !detail || !preview.payload.targetId) {
      throw new AssignmentRuntimeError("COMMERCE_CARD_FEATURE_NOT_FOUND");
    }
    assertTargetBoundToDevice(detail, device.id);

    const expectedAccountId = commerceCardAccountIdentityKey(
      payload.expectedAccountId,
      payload.expectedAccountName
    );
    const expectedAccountName = payload.expectedAccountName ?? null;
    const runtimeConfig = {
      ...preview.runtimeConfig,
      executeEnabled: false
    };
    const selectedTarget = {
      ...preview.payload,
      runtimeConfig,
      executionEligible: true,
      executionBlockedReasons: []
    };
    const configSnapshot: CommerceCardWorkflowSnapshot = {
      target: selectedTarget,
      runtimeConfig,
      configSource: "target_center_v2"
    };
    const minimumExpirySeconds = (runtimeConfig.taskMaxActiveMinutes + 120) * 60;
    expiresAt = addSeconds(Math.max(payload.expiresInSeconds, minimumExpirySeconds));
    const executionApprovalId = payload.executionApprovalId ?? null;
    if (executionApprovalId) {
      await assertExecutionApprovalMatches({
        approvalId: executionApprovalId,
        targetId: payload.targetId,
        deviceId: device.id,
        expectedAccountId,
        configHash: preview.configHash,
        commentPoolHash: buildCommerceCardCommentPoolHash(runtimeConfig.commentPool)
      });
    }
    const snapshotHash = buildSnapshotHash({
      assignmentId,
      targetId: payload.targetId,
      targetCode: preview.payload.targetCode,
      configRevision: preview.revision,
      configHash: preview.configHash,
      configSnapshot,
      executionApprovalId,
      expectedAccountId,
      expectedAccountName,
      expiresAt
    });
    const initialStage = runtimeConfig.enabledStages[0];
    const effectiveWorkflow = {
      assignmentId,
      workflowVersion: 2 as const,
      selectedTarget,
      expectedAccount: {
        accountId: expectedAccountId,
        accountName: expectedAccountName
      },
      configRevision: preview.revision,
      configHash: preview.configHash,
      snapshotHash,
      executionApprovalId,
      expiresAt: expiresAt.toISOString(),
      state: "DISPATCHED" as const,
      stateVersion: 2,
      lastEventSeq: 1,
      configSnapshot
    };
    desiredPayload = {
      ...desiredPayload,
      effectiveWorkflow
    };
    assignmentFields = {
      ...assignmentFields,
      selectedTargetId: payload.targetId,
      targetCode: preview.payload.targetCode,
      configRevision: preview.revision,
      configHash: preview.configHash,
      configSnapshot,
      snapshotHash,
      executionApprovalId,
      expectedAccountId,
      expectedAccountName,
      currentStage: initialStage,
      progressJson: {
        checkpointVersion: 2,
        stage: initialStage,
        cycleIndex: 0
      }
    };
  }

  const commandIdempotencyKey = `assignment:${assignmentId}:command:1`;
  const issuedAt = new Date();
  const commandPayload = {
    ...desiredPayload,
    assignmentId,
    commandSequence: 1,
    expectedStateVersion: 2
  };
  return createTaskAssignmentRuntimeAtomic({
    assignment: {
      id: assignmentId,
      tenantId: config.tenantId,
      deviceId: device.id,
      taskId: task.id,
      taskType: payload.taskType,
      targetContext,
      status: "PENDING",
      priority: payload.priority,
      source: payload.source || "manual",
      reason,
      desiredPayload,
      expiresAt,
      stateVersion: 1,
      lastEventSeq: 0,
      checkpointSequence: 0,
      createdBy: "admin",
      updatedBy: "admin",
      ...assignmentFields
    },
    command: {
      tenantId: config.tenantId,
      taskId: task.id,
      deviceId: device.id,
      assignmentId,
      commandSequence: 1,
      idempotencyKey: commandIdempotencyKey,
      commandType: "START",
      status: "PENDING",
      payloadJson: commandPayload,
      issuedAt,
      expiresAt,
      createdBy: "admin",
      updatedBy: "admin"
    },
    event: {
      tenantId: config.tenantId,
      assignmentId,
      sequence: 1,
      deviceId: device.id,
      targetId: payload.targetId,
      featureType: payload.taskType,
      stage: assignmentFields.currentStage,
      eventType: "assignment_command_start",
      fromState: "PENDING",
      toState: "DISPATCHED",
      status: "started",
      reasonCode: reason,
      idempotencyKey: `${commandIdempotencyKey}:event`,
      payloadHash: buildCanonicalSha256(commandPayload),
      evidenceJson: { commandSequence: 1, workflowVersion: payload.workflowVersion },
      occurredAt: issuedAt,
      actor: "admin",
      createdBy: "task_orchestrator",
      updatedBy: "task_orchestrator"
    }
  });
}

function assertControlState(commandType: "PAUSE" | "RESUME" | "STOP", state: string) {
  if (commandType === "PAUSE" && state !== "RUNNING") {
    throw new AssignmentRuntimeError("ASSIGNMENT_PAUSE_STATE_INVALID", { state });
  }
  if (commandType === "RESUME" && state !== "PAUSED" && state !== "BLOCKED") {
    throw new AssignmentRuntimeError("ASSIGNMENT_RESUME_STATE_INVALID", { state });
  }
  if (["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"].includes(state)) {
    throw new AssignmentRuntimeError("ASSIGNMENT_TERMINAL", { state });
  }
}

async function createControlCommand(
  payload: CreateTaskAssignmentPayload,
  device: NonNullable<Awaited<ReturnType<typeof findDeviceByCode>>>
) {
  const assignmentId = payload.assignmentId || "";
  const assignment = await findTaskAssignmentById(assignmentId);
  if (!assignment) {
    throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
  }
  if (assignment.deviceId !== device.id || assignment.taskType !== payload.taskType) {
    throw new AssignmentRuntimeError("ASSIGNMENT_SCOPE_MISMATCH");
  }
  const commandType = payload.commandType as "PAUSE" | "RESUME" | "STOP";
  const reason = payload.reason || `manual_${commandType.toLowerCase()}`;
  const requestHash = buildCanonicalSha256({
    assignmentId: assignment.id,
    commandType,
    expectedStateVersion: payload.expectedStateVersion,
    commandIdempotencyKey: payload.commandIdempotencyKey,
    reason,
    expiresInSeconds: payload.expiresInSeconds,
    payload: payload.payload || {}
  });
  const existingCommand = await findTaskAssignmentCommandByIdempotencyKey(payload.commandIdempotencyKey || "");
  if (existingCommand) {
    const existingPayload = existingCommand.payloadJson && typeof existingCommand.payloadJson === "object"
      ? existingCommand.payloadJson
      : {};
    const existingRequestHash = typeof existingPayload._requestHash === "string"
      ? existingPayload._requestHash
      : null;
    if (
      existingCommand.assignmentId !== assignment.id ||
      existingCommand.commandType !== commandType ||
      (existingRequestHash && existingRequestHash !== requestHash)
    ) {
      throw new AssignmentRuntimeError("IDEMPOTENCY_CONFLICT", {
        idempotencyKey: payload.commandIdempotencyKey
      });
    }
    return { assignment, command: existingCommand, event: null, idempotent: true };
  }
  assertControlState(commandType, assignment.status);
  let resumeEffectiveWorkflow: CommerceCardEffectiveWorkflow | null = null;
  if (commandType === "RESUME" && assignment.workflowVersion === 2) {
    await assertCommerceCardWorkflowV2Allowed(device.deviceCode);
    if (await hasUnresolvedCommerceCardCommentActions(assignment.id)) {
      throw new AssignmentRuntimeError("COMMENT_ACTION_RESOLUTION_REQUIRED");
    }
    if (!assignment.configSnapshot || !assignment.selectedTargetId || !assignment.configHash || !assignment.snapshotHash || !assignment.expiresAt) {
      throw new AssignmentRuntimeError("ASSIGNMENT_SNAPSHOT_INCOMPLETE");
    }
    if (assignment.expiresAt.getTime() <= Date.now()) {
      throw new AssignmentRuntimeError("ASSIGNMENT_EXPIRED");
    }
    const snapshot = commerceCardWorkflowSnapshotSchema.safeParse(assignment.configSnapshot);
    if (!snapshot.success || !assignment.configRevision || !assignment.expectedAccountId) {
      throw new AssignmentRuntimeError("ASSIGNMENT_SNAPSHOT_INVALID");
    }
    const expectedSnapshotHash = buildSnapshotHash({
      assignmentId: assignment.id,
      targetId: assignment.selectedTargetId,
      targetCode: assignment.targetCode || "",
      configRevision: assignment.configRevision,
      configHash: assignment.configHash,
      configSnapshot: snapshot.data,
      executionApprovalId: assignment.executionApprovalId,
      expectedAccountId: assignment.expectedAccountId,
      expectedAccountName: assignment.expectedAccountName,
      expiresAt: assignment.expiresAt
    });
    if (expectedSnapshotHash !== assignment.snapshotHash) {
      throw new AssignmentRuntimeError("ASSIGNMENT_SNAPSHOT_HASH_MISMATCH");
    }
    resumeEffectiveWorkflow = {
      assignmentId: assignment.id,
      workflowVersion: 2,
      selectedTarget: snapshot.data.target,
      expectedAccount: {
        accountId: assignment.expectedAccountId,
        accountName: assignment.expectedAccountName
      },
      configRevision: assignment.configRevision,
      configHash: assignment.configHash,
      snapshotHash: assignment.snapshotHash,
      executionApprovalId: assignment.executionApprovalId,
      expiresAt: assignment.expiresAt.toISOString(),
      state: "RESUMING",
      stateVersion: assignment.stateVersion + 1,
      lastEventSeq: assignment.lastEventSeq + 1,
      configSnapshot: snapshot.data
    };
  }

  const nextStatus = commandType === "PAUSE"
    ? "PAUSING"
    : commandType === "RESUME"
      ? "RESUMING"
      : null;
  const assignmentPatch = commandType === "RESUME"
    ? { blockReason: null }
    : commandType === "STOP"
      ? { blockReason: "stop_requested" }
      : {};
  const commandPayload = {
    ...(payload.payload || {}),
    taskType: assignment.taskType,
    targetContext: assignment.targetContext,
    reason,
    workflowVersion: assignment.workflowVersion,
    snapshotHash: assignment.snapshotHash,
    ...(resumeEffectiveWorkflow ? { effectiveWorkflow: resumeEffectiveWorkflow } : {})
  };
  return issueTaskAssignmentCommandAtomic({
    assignmentId: assignment.id,
    expectedStateVersion: payload.expectedStateVersion || 0,
    commandType,
    commandIdempotencyKey: payload.commandIdempotencyKey || "",
    commandExpiresAt: addSeconds(payload.expiresInSeconds),
    commandPayload,
    nextStatus,
    assignmentPatch,
    eventType: `assignment_command_${commandType.toLowerCase()}`,
    reasonCode: reason,
    payloadHash: requestHash,
    actor: "admin"
  });
}

export async function createTaskAssignmentFromAdmin(payload: CreateTaskAssignmentPayload) {
  const [device, task] = await Promise.all([
    findDeviceByCode(payload.deviceId),
    findCurrentTask("douyin")
  ]);
  if (!device) {
    throw new AssignmentRuntimeError("DEVICE_UNREGISTERED");
  }
  if (!task) {
    throw new AssignmentRuntimeError("TASK_NOT_FOUND");
  }
  if (payload.commandType === "START") {
    return createStartAssignment(payload, device, task);
  }
  return createControlCommand(payload, device);
}

export async function createTaskAssignmentCommandFromAdmin(
  assignmentId: string,
  payload: CreateTaskAssignmentCommandPayload
) {
  const assignment = await findTaskAssignmentById(assignmentId);
  if (!assignment) {
    throw new AssignmentRuntimeError("ASSIGNMENT_NOT_FOUND");
  }
  const device = await findDeviceById(assignment.deviceId);
  if (!device) {
    throw new AssignmentRuntimeError("DEVICE_UNREGISTERED");
  }
  return createControlCommand({
    deviceId: device.deviceCode,
    taskType: assignment.taskType as CreateTaskAssignmentPayload["taskType"],
    commandType: payload.commandType,
    assignmentId,
    workflowVersion: assignment.workflowVersion === 2 ? 2 : 1,
    expectedStateVersion: payload.expectedStateVersion,
    commandIdempotencyKey: payload.commandIdempotencyKey,
    reason: payload.reason,
    priority: payload.priority,
    source: "manual",
    targetContext: assignment.targetContext ?? undefined,
    payload: payload.payload,
    expiresInSeconds: payload.expiresInSeconds
  }, device);
}

export async function getTaskAssignments() {
  return listTaskAssignments(200);
}
