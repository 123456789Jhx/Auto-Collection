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
import {
  acknowledgeTaskAssignmentCommandAtomic,
  AssignmentRuntimeError,
  findActiveTaskAssignmentForDeviceAny
} from "../repositories/task-assignment.repository";
import { supersededCommandTypesFor } from "./command-policy";
import { buildCanonicalSha256 } from "./live-target-config.service";

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
  if (payload.assignmentId || payload.commandSequence || payload.idempotencyKey) {
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
    assignmentId: item.assignmentId,
    commandSequence: item.commandSequence,
    commandType: item.commandType,
    payload: item.payloadJson ?? {},
    issuedAt: item.issuedAt,
    expiresAt: item.expiresAt
  }));
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
