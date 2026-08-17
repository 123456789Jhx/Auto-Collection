import {
  accountWarmupRunPayloadSchema,
  accountWarmupStopPayloadSchema,
  exitAgentAppPayloadSchema,
  exitAgentAppResultSchema,
  videoWarmupStopPayloadSchema,
  type CreateMobileCommandPayload,
  type MobileBaseCommandAckPayload,
  type MobileCommandAckPayload
} from "@pkg/types";
import { config } from "../config";
import {
  createMobileCommand,
  createExitAgentAppCommandAtomic,
  findBaseCommandForAck,
  findMobileCommandByIdempotencyKey,
  claimPendingCommandByDeviceId,
  ignorePendingCommandsByDeviceId,
  listMobileCommands,
  updateClaimedBaseCommandStatus
} from "../repositories/command.repository";
import { findDeviceByCode, markDeviceCommandIssued, resolveDeviceByToken, updateDesiredAgentState } from "../repositories/device.repository";
import { findTaskByCode } from "../repositories/task.repository";
import {
  acknowledgeTaskAssignmentCommandAtomic,
  AssignmentRuntimeError,
  findActiveTaskAssignmentForDeviceAny
} from "../repositories/task-assignment.repository";
import { supersededCommandTypesFor } from "./command-policy";
import { desiredAgentStateForCommand, supersededAgentControlCommandsFor } from "./agent-control";
import type { CommandExecutor } from "./command-executor";
import { buildCanonicalSha256 } from "./live-target-config.service";

export class BaseCommandAckValidationError extends Error {
  readonly details: Record<string, unknown>;

  constructor(details: Record<string, unknown>) {
    super("BASE_COMMAND_ACK_VALIDATION_FAILED");
    this.details = details;
  }
}

export class BaseCommandAckConflictError extends Error {
  readonly details: Record<string, unknown>;

  constructor(details: Record<string, unknown>) {
    super("BASE_COMMAND_ACK_CONFLICT");
    this.details = details;
  }
}

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

const assignmentStateCommandTypes = new Set(["START", "PAUSE", "RESUME", "STOP"]);

export async function createCommand(payload: CreateMobileCommandPayload) {
  const [device, task] = await Promise.all([
    findDeviceByCode(payload.deviceId),
    payload.taskId ? findTaskByCode(payload.taskId) : Promise.resolve(null)
  ]);
  if (!device) {
    throw new Error("DEVICE_UNREGISTERED");
  }
  if (
    payload.assignmentId
    || payload.commandSequence
    || (payload.idempotencyKey && payload.commandType !== "EXIT_AGENT_APP")
  ) {
    throw new AssignmentRuntimeError("ASSIGNMENT_COMMAND_ROUTE_REQUIRED", {
      assignmentId: payload.assignmentId ?? null
    });
  }
  if (assignmentStateCommandTypes.has(payload.commandType)) {
    const activeAssignment = await findActiveTaskAssignmentForDeviceAny(device.id);
    if (activeAssignment) {
      throw new AssignmentRuntimeError("ASSIGNMENT_COMMAND_ROUTE_REQUIRED", {
        assignmentId: activeAssignment.id,
        state: activeAssignment.status
      });
    }
  }

  const supersededCommandTypes = [
    ...supersededCommandTypesFor(payload.commandType),
    ...supersededAgentControlCommandsFor(payload.commandType)
  ];
  if (supersededCommandTypes.length > 0) {
    await ignorePendingCommandsByDeviceId(device.id, supersededCommandTypes, "superseded_by_new_state_command");
  }

  const commandPayload = payload.commandType === "ACCOUNT_WARMUP_RUN"
    ? accountWarmupRunPayloadSchema.parse(payload.payload)
    : payload.commandType === "ACCOUNT_WARMUP_STOP"
      ? accountWarmupStopPayloadSchema.parse(payload.payload)
      : payload.commandType === "VIDEO_WARMUP_STOP"
        ? videoWarmupStopPayloadSchema.parse(payload.payload)
      : payload.commandType === "EXIT_AGENT_APP"
        ? exitAgentAppPayloadSchema.parse(payload.payload ?? {})
      : payload.payload ?? {};
  const videoBatchId = payload.commandType === "VIDEO_WARMUP_STOP"
    ? videoWarmupStopPayloadSchema.parse(payload.payload).batchId
    : undefined;
  const idempotencyKey = payload.commandType === "VIDEO_WARMUP_STOP"
    ? `video-warmup-stop:${videoBatchId}:${device.deviceCode}`
    : payload.idempotencyKey;

  if (payload.commandType === "EXIT_AGENT_APP") {
    const result = await createExitAgentAppCommandAtomic({
      tenantId: config.tenantId,
      deviceId: device.id,
      taskId: task?.id,
      commandType: payload.commandType,
      idempotencyKey,
      payloadJson: commandPayload,
      status: "PENDING",
      issuedAt: new Date(),
      expiresAt: addSeconds(payload.expiresInSeconds),
      createdBy: "admin",
      updatedBy: "admin"
    });
    if (result.outcome === "created") {
      await markDeviceCommandIssued(device.id);
    }
    return result.command;
  }

  if (idempotencyKey) {
    const existing = await findMobileCommandByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
  }

  try {
    const command = await createMobileCommand({
      tenantId: config.tenantId,
      deviceId: device.id,
      taskId: task?.id,
      assignmentId: payload.assignmentId,
      commandSequence: payload.commandSequence,
      idempotencyKey,
      commandType: payload.commandType,
      payloadJson: {
        ...commandPayload,
        ...(payload.assignmentId ? { assignmentId: payload.assignmentId } : {}),
        ...(payload.commandSequence ? { commandSequence: payload.commandSequence } : {})
      },
      status: "PENDING",
      issuedAt: new Date(),
      expiresAt: addSeconds(payload.expiresInSeconds),
      createdBy: "admin",
      updatedBy: "admin"
    });
    await markDeviceCommandIssued(device.id);
    const desiredAgentState = desiredAgentStateForCommand(payload.commandType);
    if (desiredAgentState) {
      await updateDesiredAgentState(device.id, desiredAgentState);
    }
    return command;
  } catch (error) {
    if (!idempotencyKey || !isUniqueViolation(error)) throw error;
    const raced = await findMobileCommandByIdempotencyKey(idempotencyKey);
    if (!raced) throw error;
    return raced;
  }
}

type ScriptConfigUpdatedCommandInput = {
  deviceId: string;
  configId: string;
  scriptKey: string;
  revision: number;
  configHash: string;
  eventKey: string;
  actor: string;
};

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

export async function createScriptConfigUpdatedCommand(input: ScriptConfigUpdatedCommandInput) {
  const idempotencyKey = `rs:${input.configId}:${input.revision}:${input.deviceId}:${input.eventKey}`;
  const existing = await findMobileCommandByIdempotencyKey(idempotencyKey);
  if (existing) return { command: existing, idempotent: true };
  try {
    const command = await createMobileCommand({
      tenantId: config.tenantId,
      deviceId: input.deviceId,
      idempotencyKey,
      commandType: "SCRIPT_CONFIG_UPDATED",
      payloadJson: {
        config_id: input.configId,
        script_key: input.scriptKey,
        revision: input.revision,
        config_hash: input.configHash
      },
      status: "PENDING",
      issuedAt: new Date(),
      expiresAt: addSeconds(86400),
      createdBy: input.actor,
      updatedBy: input.actor
    });
    if (!command) throw new Error("SCRIPT_CONFIG_COMMAND_CREATE_FAILED");
    await markDeviceCommandIssued(input.deviceId);
    return { command, idempotent: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await findMobileCommandByIdempotencyKey(idempotencyKey);
    if (!raced) throw error;
    return { command: raced, idempotent: true };
  }
}

export async function getCommands(filter: { batchId?: string; featureKey?: string } = {}) {
  return listMobileCommands(100, filter);
}

async function resolveCommandDevice(deviceCode: string, deviceToken?: string) {
  if (deviceToken) {
    return resolveDeviceByToken({ deviceToken, expectedDeviceCode: deviceCode });
  }

  const device = await findDeviceByCode(deviceCode);
  if (!device) {
    throw new Error("DEVICE_UNREGISTERED");
  }
  if (!device.enabled) {
    throw new Error("DEVICE_DISABLED");
  }
  return device;
}

export async function pollCommands(deviceCode: string, executorType: CommandExecutor, deviceToken?: string) {
  const device = await resolveCommandDevice(deviceCode, deviceToken);
  const command = await claimPendingCommandByDeviceId(device.id, executorType);
  if (!command) return [];
  return [{
    id: command.id,
    assignmentId: command.assignmentId,
    commandSequence: command.commandSequence,
    commandType: command.commandType,
    payload: command.payloadJson ?? {},
    claimToken: command.claimToken,
    issuedAt: command.issuedAt,
    expiresAt: command.expiresAt
  }];
}

export async function acknowledgeBaseCommand(
  commandId: string,
  payload: MobileBaseCommandAckPayload,
  deviceToken?: string
) {
  const device = await resolveCommandDevice(payload.deviceId, deviceToken);
  const command = await findBaseCommandForAck(commandId, device.id, payload.claimToken);
  if (!command) throw new Error("BASE_COMMAND_CLAIM_NOT_FOUND");

  const result = validateBaseCommandAck(command.commandType, payload.status, payload.result);
  if (command.status === "DONE" || command.status === "FAILED") {
    if (command.status === payload.status && equivalentCommandResult(command.resultJson, result)) {
      return command;
    }
    throw new BaseCommandAckConflictError({
      commandId: command.id,
      storedStatus: command.status,
      requestedStatus: payload.status
    });
  }

  if (command.status !== "CLAIMED" && command.status !== "RUNNING") {
    throw new Error("BASE_COMMAND_CLAIM_NOT_FOUND");
  }

  const updated = await updateClaimedBaseCommandStatus(
    commandId,
    device.id,
    payload.claimToken,
    payload.status,
    result
  );
  if (updated) return updated;

  const raced = await findBaseCommandForAck(commandId, device.id, payload.claimToken);
  if (raced?.status === payload.status
    && (raced.status === "DONE" || raced.status === "FAILED")
    && equivalentCommandResult(raced.resultJson, result)) {
    return raced;
  }
  if (raced?.status === "DONE" || raced?.status === "FAILED") {
    throw new BaseCommandAckConflictError({
      commandId: raced.id,
      storedStatus: raced.status,
      requestedStatus: payload.status
    });
  }
  throw new Error("BASE_COMMAND_CLAIM_NOT_FOUND");
}

function validateBaseCommandAck(
  commandType: string,
  status: MobileBaseCommandAckPayload["status"],
  result: Record<string, unknown> | undefined
) {
  const normalizedResult = result ?? {};
  if (commandType !== "EXIT_AGENT_APP") {
    if (normalizedResult.commandType === "EXIT_AGENT_APP") {
      throw new BaseCommandAckValidationError({ message: "exit_result_requires_exit_agent_app_command" });
    }
    return normalizedResult;
  }

  const parsed = exitAgentAppResultSchema.safeParse(result);
  if (!parsed.success) {
    throw new BaseCommandAckValidationError({ issues: parsed.error.issues });
  }
  const expectedTransportStatus = parsed.data.result === "FAILED" ? "FAILED" : "DONE";
  if (status !== expectedTransportStatus) {
    throw new BaseCommandAckValidationError({
      message: "exit_ack_transport_status_mismatch",
      expectedStatus: expectedTransportStatus,
      receivedStatus: status
    });
  }
  return parsed.data;
}

function equivalentCommandResult(left: Record<string, unknown> | null, right: Record<string, unknown>) {
  return buildCanonicalSha256(left ?? {}) === buildCanonicalSha256(right);
}

export async function acknowledgeCommand(commandId: string, payload: MobileCommandAckPayload, deviceToken?: string) {
  const device = await resolveCommandDevice(payload.deviceId, deviceToken);
  const result = await acknowledgeTaskAssignmentCommandAtomic({
    commandId,
    deviceId: device.id,
    status: payload.status,
    result: payload.result ?? {},
    payloadHash: buildCanonicalSha256(payload)
  });
  return result;
}
