import type { InterfacePublishBindingStatus } from "@pkg/types";
import {
  interfacePublishBindingRepository,
  type InterfacePublishBindingRepository,
  type InterfacePublishBindingRow
} from "../repositories/publish-interface-binding.repository";

const ONLINE_HEARTBEAT_WINDOW_MS = 3 * 60 * 1000;

type SaveBindingPayload = {
  accountName: string;
  accountNo: string;
  externalAccountKey: string;
  enabled: boolean;
};

export class PublishInterfaceBindingServiceError extends Error {
  constructor(
    readonly code: "DEVICE_NOT_FOUND" | "BINDING_INCOMPLETE" | "BINDING_CONFLICT" | "BINDING_NOT_FOUND",
    readonly userMessage: string
  ) {
    super(code);
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

function normalizeOptional(value: string | null) {
  return value?.trim() || null;
}

function duplicateKeys(rows: InterfacePublishBindingRow[]) {
  const accountCounts = new Map<string, number>();
  const deviceCounts = new Map<string, number>();
  for (const row of rows) {
    if (!row.bindingId || !row.bindingEnabled) continue;
    const accountName = normalizeOptional(row.accountName);
    if (accountName) accountCounts.set(accountName, (accountCounts.get(accountName) ?? 0) + 1);
    deviceCounts.set(row.deviceCode, (deviceCounts.get(row.deviceCode) ?? 0) + 1);
  }
  return {
    accounts: new Set([...accountCounts].filter(([, count]) => count > 1).map(([key]) => key)),
    devices: new Set([...deviceCounts].filter(([, count]) => count > 1).map(([key]) => key))
  };
}

function preflightStatus(
  row: InterfacePublishBindingRow,
  duplicates: ReturnType<typeof duplicateKeys>,
  currentTime: Date
): InterfacePublishBindingStatus {
  if (!row.bindingId || !row.bindingEnabled) return "UNBOUND";
  const accountName = normalizeOptional(row.accountName);
  const accountNo = normalizeOptional(row.accountNo);
  const externalAccountKey = normalizeOptional(row.externalAccountKey);
  if (!row.deviceId || !accountName || !accountNo || !externalAccountKey) return "BINDING_INCOMPLETE";
  if (duplicates.accounts.has(accountName) || duplicates.devices.has(row.deviceCode)) {
    return "BINDING_CONFLICT";
  }
  const heartbeatExpired = !row.lastHeartbeatAt
    || currentTime.getTime() - row.lastHeartbeatAt.getTime() > ONLINE_HEARTBEAT_WINDOW_MS;
  if (row.deviceStatus === "offline" || heartbeatExpired) return "DEVICE_OFFLINE";
  if (row.activeAssignmentId) return "DEVICE_BUSY";
  return "MATCHED";
}

export function createPublishInterfaceBindingService(
  repository: InterfacePublishBindingRepository = interfacePublishBindingRepository,
  currentTime: () => Date = () => new Date()
) {
  return {
    async list() {
      return repository.listBindings();
    },

    async save(deviceCodeInput: string, payload: SaveBindingPayload, actor: string) {
      const deviceCode = deviceCodeInput.trim();
      const accountName = payload.accountName.trim();
      const accountNo = payload.accountNo.trim();
      const externalAccountKey = payload.externalAccountKey.trim();
      if (!deviceCode || !accountName || !accountNo || !externalAccountKey) {
        throw new PublishInterfaceBindingServiceError(
          "BINDING_INCOMPLETE",
          "设备 ID、抖音名称、抖音号和外部接口查询标识均不能为空"
        );
      }
      const device = await repository.findDeviceByCode(deviceCode);
      if (!device?.deviceId) {
        throw new PublishInterfaceBindingServiceError("DEVICE_NOT_FOUND", "设备不存在或已停用");
      }
      try {
        return await repository.saveBinding({
          deviceCode,
          accountName,
          accountNo,
          externalAccountKey,
          enabled: payload.enabled,
          actor
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new PublishInterfaceBindingServiceError(
            "BINDING_CONFLICT",
            "该抖音账号或设备已经存在其他启用绑定"
          );
        }
        throw error;
      }
    },

    async remove(deviceCodeInput: string, actor: string) {
      const deviceCode = deviceCodeInput.trim();
      const deleted = await repository.softDeleteBinding(deviceCode, actor);
      if (!deleted) {
        throw new PublishInterfaceBindingServiceError("BINDING_NOT_FOUND", "接口发布绑定不存在");
      }
      return { deleted: true, deviceCode };
    },

    async preflight() {
      const rows = await repository.listActiveBindingsForPreflight();
      const duplicates = duplicateKeys(rows);
      const now = currentTime();
      return rows.map((row) => ({
        bindingId: row.bindingId,
        deviceId: row.deviceId,
        deviceCode: row.deviceCode,
        deviceName: row.deviceName,
        accountName: normalizeOptional(row.accountName),
        accountNo: normalizeOptional(row.accountNo),
        externalAccountKey: normalizeOptional(row.externalAccountKey),
        status: preflightStatus(row, duplicates, now)
      }));
    }
  };
}

export const publishInterfaceBindingService = createPublishInterfaceBindingService();
