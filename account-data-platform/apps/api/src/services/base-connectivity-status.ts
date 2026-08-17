export const BASE_RECONNECT_AFTER_SECONDS = 6;
export const MIN_BASE_OFFLINE_THRESHOLD_SECONDS = 15;
export const MAX_BASE_OFFLINE_THRESHOLD_SECONDS = 150;
export const DEFAULT_BASE_OFFLINE_THRESHOLD_SECONDS = 15;

export type BaseConnectivityStatus = "ONLINE" | "RECONNECTING" | "OFFLINE";

export function normalizeBaseOfflineThreshold(value: number | null | undefined) {
  if (!Number.isFinite(value)) return DEFAULT_BASE_OFFLINE_THRESHOLD_SECONDS;
  return Math.min(
    MAX_BASE_OFFLINE_THRESHOLD_SECONDS,
    Math.max(MIN_BASE_OFFLINE_THRESHOLD_SECONDS, Math.round(value as number))
  );
}

export function deriveBaseConnectivity(input: {
  lastReceivedAt: Date | string | null;
  offlineThresholdSeconds?: number | null;
  now?: Date;
}) {
  const offlineThresholdSeconds = normalizeBaseOfflineThreshold(input.offlineThresholdSeconds);
  const receivedAt = input.lastReceivedAt instanceof Date
    ? input.lastReceivedAt
    : input.lastReceivedAt
      ? new Date(input.lastReceivedAt)
      : null;

  if (!receivedAt || Number.isNaN(receivedAt.getTime())) {
    return {
      status: "OFFLINE" as const,
      reachable: false,
      elapsedSeconds: null,
      offlineThresholdSeconds,
      reconnectProgressPercent: 100
    };
  }

  const elapsedSeconds = Math.max(0, Math.floor(((input.now ?? new Date()).getTime() - receivedAt.getTime()) / 1000));
  if (elapsedSeconds <= BASE_RECONNECT_AFTER_SECONDS) {
    return {
      status: "ONLINE" as const,
      reachable: true,
      elapsedSeconds,
      offlineThresholdSeconds,
      reconnectProgressPercent: 0
    };
  }

  if (elapsedSeconds < offlineThresholdSeconds) {
    const reconnectWindowSeconds = offlineThresholdSeconds - BASE_RECONNECT_AFTER_SECONDS;
    const reconnectElapsedSeconds = elapsedSeconds - BASE_RECONNECT_AFTER_SECONDS;
    return {
      status: "RECONNECTING" as const,
      reachable: false,
      elapsedSeconds,
      offlineThresholdSeconds,
      reconnectProgressPercent: Math.min(99, Math.round((reconnectElapsedSeconds / reconnectWindowSeconds) * 100))
    };
  }

  return {
    status: "OFFLINE" as const,
    reachable: false,
    elapsedSeconds,
    offlineThresholdSeconds,
    reconnectProgressPercent: 100
  };
}
