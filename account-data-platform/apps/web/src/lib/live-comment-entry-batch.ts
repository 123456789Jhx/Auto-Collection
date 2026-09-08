import { normalizeCaptureDuration } from "./live-comment-entry-form";

export type LiveCommentEntryBatchDevice = {
  deviceCode: string;
  deviceId: string;
  deviceName: string;
};

export type LiveCommentEntryDispatchFailure = LiveCommentEntryBatchDevice & {
  message: string;
};

export type LiveCommentEntryBatchPlan = {
  batchId: string;
  targetKeyword: string;
  minViewerCount: number;
  captureDurationMinutes: number;
  devices: LiveCommentEntryBatchDevice[];
  dispatchErrors: Array<{ deviceCode: string; message: string }>;
};

type BatchStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

type CommandDevice = { deviceId?: string; deviceCode?: string };
type DispatchCommand = {
  deviceId: string;
  payload: {
    featureKey: "isolated_live_comment_entry";
    batchId: string;
    config: { targetKeyword: string; minViewerCount: number; captureDurationMinutes: number };
  };
};

const batchStorageKey = "live-comment-entry-batch-plan";

function browserStorage(): BatchStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isBatchId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeDevice(value: unknown): LiveCommentEntryBatchDevice | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const deviceCode = textValue(row.deviceCode);
  if (!deviceCode) return null;
  return {
    deviceCode,
    deviceId: textValue(row.deviceId) || deviceCode,
    deviceName: textValue(row.deviceName) || deviceCode
  };
}

export function createLiveCommentEntryBatchPlan(input: {
  batchId: string;
  targetKeyword: string;
  minViewerCount: number;
  captureDurationMinutes?: number;
  devices: LiveCommentEntryBatchDevice[];
}): LiveCommentEntryBatchPlan {
  const devices = new Map<string, LiveCommentEntryBatchDevice>();
  input.devices.forEach((value) => {
    const device = normalizeDevice(value);
    if (device && !devices.has(device.deviceCode)) devices.set(device.deviceCode, device);
  });
  return {
    batchId: input.batchId.trim(),
    targetKeyword: input.targetKeyword.trim(),
    minViewerCount: input.minViewerCount,
    captureDurationMinutes: normalizeCaptureDuration(input.captureDurationMinutes),
    devices: [...devices.values()],
    dispatchErrors: []
  };
}

export function withLiveCommentEntryDispatchErrors(
  batch: LiveCommentEntryBatchPlan,
  failures: Array<{ deviceCode: string; message: string }>
): LiveCommentEntryBatchPlan {
  const allowedCodes = new Set(batch.devices.map((device) => device.deviceCode));
  const dispatchErrors = new Map<string, string>();
  failures.forEach((failure) => {
    const deviceCode = textValue(failure.deviceCode);
    if (allowedCodes.has(deviceCode) && !dispatchErrors.has(deviceCode)) {
      dispatchErrors.set(deviceCode, textValue(failure.message) || "任务下发失败");
    }
  });
  return {
    ...batch,
    dispatchErrors: [...dispatchErrors].map(([deviceCode, message]) => ({ deviceCode, message }))
  };
}

export function findUndispatchedLiveCommentEntryDevices(
  batch: LiveCommentEntryBatchPlan,
  commands: CommandDevice[]
): LiveCommentEntryDispatchFailure[] {
  const commandDeviceKeys = new Set<string>();
  commands.forEach((command) => {
    const deviceId = textValue(command.deviceId);
    const deviceCode = textValue(command.deviceCode);
    if (deviceId) commandDeviceKeys.add(deviceId);
    if (deviceCode) commandDeviceKeys.add(deviceCode);
  });
  const errorByCode = new Map(batch.dispatchErrors.map((failure) => [failure.deviceCode, failure.message]));
  return batch.devices.flatMap((device) => {
    if (commandDeviceKeys.has(device.deviceId) || commandDeviceKeys.has(device.deviceCode)) return [];
    return [{ ...device, message: errorByCode.get(device.deviceCode) || "未找到任务下发记录，请重试" }];
  });
}

export function readLiveCommentEntryBatchPlan(
  expectedBatchId: string,
  storage = browserStorage()
): LiveCommentEntryBatchPlan | null {
  if (!storage || !isBatchId(expectedBatchId.trim())) return null;
  try {
    const parsed = JSON.parse(storage.getItem(batchStorageKey) ?? "null") as Record<string, unknown> | null;
    if (!parsed || textValue(parsed.batchId) !== expectedBatchId.trim()) return null;
    const targetKeyword = textValue(parsed.targetKeyword).slice(0, 100);
    const minViewerCount = Number(parsed.minViewerCount);
    const devices = Array.isArray(parsed.devices)
      ? parsed.devices.map(normalizeDevice).filter((device): device is LiveCommentEntryBatchDevice => Boolean(device))
      : [];
    if (!targetKeyword || !Number.isInteger(minViewerCount) || minViewerCount < 0 || !devices.length) return null;
    const rawErrors = Array.isArray(parsed.dispatchErrors) ? parsed.dispatchErrors : [];
    return withLiveCommentEntryDispatchErrors(
      createLiveCommentEntryBatchPlan({
        batchId: expectedBatchId,
        targetKeyword,
        minViewerCount,
        captureDurationMinutes: normalizeCaptureDuration(parsed.captureDurationMinutes),
        devices
      }),
      rawErrors.map((value) => {
        const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
        return { deviceCode: textValue(row.deviceCode), message: textValue(row.message) };
      })
    );
  } catch {
    return null;
  }
}

export function writeLiveCommentEntryBatchPlan(
  batch: LiveCommentEntryBatchPlan,
  storage = browserStorage()
) {
  if (!storage) return;
  storage.setItem(batchStorageKey, JSON.stringify(batch));
}

export async function dispatchLiveCommentEntryDevices(input: {
  batch: LiveCommentEntryBatchPlan;
  deviceCodes: string[];
  send: (command: DispatchCommand) => Promise<unknown>;
}) {
  const deviceCodes = [...new Set(input.deviceCodes.map((value) => value.trim()).filter(Boolean))];
  const commands: DispatchCommand[] = deviceCodes.map((deviceId) => ({
    deviceId,
    payload: {
      featureKey: "isolated_live_comment_entry",
      batchId: input.batch.batchId,
      config: {
        targetKeyword: input.batch.targetKeyword,
        minViewerCount: input.batch.minViewerCount,
        captureDurationMinutes: normalizeCaptureDuration(input.batch.captureDurationMinutes)
      }
    }
  }));
  if (!commands.length) throw new Error("请至少选择一台可用设备");
  const outcomes = await Promise.allSettled(commands.map(input.send));
  const failures = outcomes.flatMap((outcome, index) => outcome.status === "rejected" ? [{
    deviceCode: commands[index].deviceId,
    message: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason || "任务下发失败")
  }] : []);
  return {
    attemptedCount: commands.length,
    succeededCount: commands.length - failures.length,
    failures
  };
}
