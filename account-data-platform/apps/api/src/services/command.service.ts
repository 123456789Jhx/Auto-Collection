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
import { updateTaskAssignmentByCommandId } from "../repositories/task-assignment.repository";
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
    commandType: payload.commandType,
    payloadJson: payload.payload,
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
  const assignmentStatus = payload.status === "DONE" ? "ACKED" : (payload.status === "FAILED" ? "FAILED" : "SUPERSEDED");
  await updateTaskAssignmentByCommandId(commandId, {
    status: assignmentStatus,
    acknowledgedAt: command.acknowledgedAt ?? new Date(),
    completedAt: payload.status === "FAILED" || payload.status === "IGNORED" ? command.acknowledgedAt ?? new Date() : undefined,
    updatedBy: "mobile_agent"
  });
  return command;
}
