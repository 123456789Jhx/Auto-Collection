import { describe, expect, test } from "bun:test";
import {
  DEFAULT_BASE_OFFLINE_THRESHOLD_SECONDS,
  MAX_BASE_OFFLINE_THRESHOLD_SECONDS,
  MIN_BASE_OFFLINE_THRESHOLD_SECONDS,
  deriveBaseConnectivity
} from "./base-connectivity-status";

const now = new Date("2026-08-13T04:00:00.000Z");

describe("base connectivity status", () => {
  test("uses the confirmed threshold limits", () => {
    expect(MIN_BASE_OFFLINE_THRESHOLD_SECONDS).toBe(15);
    expect(MAX_BASE_OFFLINE_THRESHOLD_SECONDS).toBe(150);
    expect(DEFAULT_BASE_OFFLINE_THRESHOLD_SECONDS).toBe(15);
  });

  test("keeps a heartbeat online through six seconds", () => {
    expect(deriveBaseConnectivity({
      lastReceivedAt: new Date("2026-08-13T03:59:54.000Z"),
      offlineThresholdSeconds: 60,
      now
    })).toEqual({
      status: "ONLINE",
      reachable: true,
      elapsedSeconds: 6,
      offlineThresholdSeconds: 60,
      reconnectProgressPercent: 0
    });
  });

  test("shows reconnecting after six seconds and before the device limit", () => {
    expect(deriveBaseConnectivity({
      lastReceivedAt: new Date("2026-08-13T03:59:40.000Z"),
      offlineThresholdSeconds: 60,
      now
    })).toEqual({
      status: "RECONNECTING",
      reachable: false,
      elapsedSeconds: 20,
      offlineThresholdSeconds: 60,
      reconnectProgressPercent: 26
    });
  });

  test("marks the device offline at its configured limit", () => {
    expect(deriveBaseConnectivity({
      lastReceivedAt: new Date("2026-08-13T03:58:00.000Z"),
      offlineThresholdSeconds: 120,
      now
    })).toEqual({
      status: "OFFLINE",
      reachable: false,
      elapsedSeconds: 120,
      offlineThresholdSeconds: 120,
      reconnectProgressPercent: 100
    });
  });

  test("treats a device with no received heartbeat as offline", () => {
    expect(deriveBaseConnectivity({
      lastReceivedAt: null,
      offlineThresholdSeconds: 15,
      now
    })).toMatchObject({ status: "OFFLINE", reachable: false, elapsedSeconds: null });
  });
});
