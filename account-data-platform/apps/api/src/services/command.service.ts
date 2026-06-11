import type { CreateMobileCommandPayload, MobileCommandAckPayload } from "@pkg/types";
import { config } from "../config";
import {
  createMobileCommand,
  findPendingCommandsByDeviceCode,
  ignorePendingCommandsByDeviceId,
  listMobileCommands,
  updateMobileCommandStatus
} from "../repositories/command.repository";
import { markDeviceCommandIssued, upsertDevice, upsertDeviceByToken } from "../repositories/device.repository";
import { findTaskByCode } from "../repositories/task.repository";

const STATE_COMMAND_TYPES = ["START", "RESUME", "PAUSE", "STOP"];

function addSeconds(seconds: number) {
  return new Date(Date.now() + seconds * 1000);
}

export async function createCommand(payload: CreateMobileCommandPayload) {
  const [device, task] = await Promise.all([
    upsertDevice(payload.deviceId),
    payload.taskId ? findTaskByCode(payload.taskId) : Promise.resolve(null)
  ]);

  if (STATE_COMMAND_TYPES.includes(payload.commandType)) {
    await ignorePendingCommandsByDeviceId(device.id, STATE_COMMAND_TYPES, "superseded_by_new_state_command");
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
    return upsertDeviceByToken({ deviceToken, preferredDeviceCode: deviceCode });
  }
  return upsertDevice(deviceCode);
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
  await resolveCommandDevice(payload.deviceId, deviceToken);
  return updateMobileCommandStatus(commandId, payload.status, {
    resultJson: payload.result,
    updatedBy: "mobile_agent"
  });
}
