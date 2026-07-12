import type { CreateMobileCommandPayload, MobileCommandAckPayload } from "@pkg/types";
import { config } from "../config";
import {
  createMobileCommand,
  findPendingCommandsByDeviceCode,
  ignorePendingCommandsByDeviceId,
  listMobileCommands,
  updateMobileCommandStatus
} from "../repositories/command.repository";
import { findDeviceByCode, markDeviceCommandIssued, resolveDeviceByToken } from "../repositories/device.repository";
import { findTaskByCode } from "../repositories/task.repository";
import { updateTaskAssignmentByCommand } from "../repositories/task-assignment.repository";
import { supersededCommandTypesFor } from "./command-policy";

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

export async function createCommand(payload: CreateMobileCommandPayload) {
  const [device, task] = await Promise.all([
    findDeviceByCode(payload.deviceId),
    payload.taskId ? findTaskByCode(payload.taskId) : Promise.resolve(null)
  ]);
  if (!device) {
    throw new Error("DEVICE_UNREGISTERED");
  }

  const supersededCommandTypes = supersededCommandTypesFor(payload.commandType);
  if (supersededCommandTypes.length > 0) {
    await ignorePendingCommandsByDeviceId(device.id, supersededCommandTypes, "superseded_by_new_state_command");
  }

  const command = await createMobileCommand({
    tenantId: config.tenantId,
    deviceId: device.id,
    taskId: task?.id,
    assignmentId: payload.assignmentId,
    commandSequence: payload.commandSequence,
    idempotencyKey: payload.idempotencyKey,
    commandType: payload.commandType,
    payloadJson: {
      ...(payload.payload ?? {}),
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
  return command;
}

export async function getCommands() {
  return listMobileCommands(100);
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

export async function pollCommands(deviceCode: string, deviceToken?: string) {
  const device = await resolveCommandDevice(deviceCode, deviceToken);
  const commands = await findPendingCommandsByDeviceCode(device.deviceCode);
  await Promise.all(commands.filter((item) => item.status === "PENDING").map((item) => updateMobileCommandStatus(item.id, "FETCHED")));
  return commands.map((item) => ({
    id: item.id,
    commandType: item.commandType,
    payload: item.payloadJson ?? {},
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt
  }));
}

export async function acknowledgeCommand(commandId: string, payload: MobileCommandAckPayload, deviceToken?: string) {
  const device = await resolveCommandDevice(payload.deviceId, deviceToken);
  const command = await updateMobileCommandStatus(commandId, payload.status, {
    resultJson: payload.result,
    updatedBy: "mobile_agent"
  }, device.id);
  if (!command) {
    throw new Error("COMMAND_NOT_FOUND");
  }
  const terminalAt = command.acknowledgedAt ?? new Date();
  const assignmentStatus = resolveAssignmentStatusFromCommandAck(command.commandType, payload.status);
  await updateTaskAssignmentByCommand(command, {
    status: assignmentStatus,
    acknowledgedAt: terminalAt,
    completedAt: assignmentStatus === "STOPPED" || assignmentStatus === "FAILED" || assignmentStatus === "SUPERSEDED" ? terminalAt : undefined,
    updatedBy: "mobile_agent"
  });
  return command;
}

function resolveAssignmentStatusFromCommandAck(commandType: string, status: MobileCommandAckPayload["status"]) {
  if (status === "FAILED") return "FAILED";
  if (status === "IGNORED") return "SUPERSEDED";
  if (commandType === "STOP") return "STOPPED";
  if (commandType === "PAUSE") return "PAUSED";
  if (commandType === "RESUME") return "ACKED";
  return "ACKED";
}
