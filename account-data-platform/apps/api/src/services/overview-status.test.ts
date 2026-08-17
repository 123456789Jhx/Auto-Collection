import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapDeviceStatus } from "./admin.service";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(currentDir, "admin.service.ts"), "utf8");

function getOverviewSource() {
  const start = source.indexOf("export async function getOverview()");
  const end = source.indexOf("export async function getDevices()", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("overview function status data", () => {
  test("uses separate near-real-time expiry windows for Agent and native base heartbeats", () => {
    expect(source).toContain("const AGENT_OFFLINE_AFTER_MS = 32_000");
    expect(source).toContain("heartbeatAgeMs <= AGENT_OFFLINE_AFTER_MS");
    expect(source).toContain("deriveBaseConnectivity");
    expect(source).not.toContain("const DEVICE_OFFLINE_AFTER_MS = 45_000");
    expect(source).not.toContain("heartbeatAgeMinutes <= 3");
  });

  test("工作台 overview 聚合运行日志和完整日志同步状态", () => {
    const block = getOverviewSource();

    expect(block).toContain("getLogDeviceSummaries(todayStart)");
    expect(block).toContain("getLogFileDeviceSummaries(todayStart)");
    expect(block).toContain("latestLogAt");
    expect(block).toContain("latestFileUploadedAt");
    expect(block).toContain("todayErrorCount");
  });

  test("reports a reachable Agent separately from the legacy device status", () => {
    const heartbeatAt = new Date();
    const result = mapDeviceStatus({ lastHeartbeatAt: heartbeatAt, status: "paused" });

    expect(result.status).toBe("paused");
    expect(result.agentStatus).toBe("paused");
    expect(result.agentLastHeartbeatAt).toBe(heartbeatAt);
    expect(result.agentHeartbeatAge).toBeLessThanOrEqual(100);
    expect(result.agentReachable).toBe(true);
  });

  test("treats a fresh stopped Agent state as unavailable while the base remains online", () => {
    const now = new Date();
    const result = mapDeviceStatus({
      lastHeartbeatAt: now,
      status: "stopped",
      baseStatus: "online",
      baseLastHeartbeatAt: now,
      screenState: "unlocked"
    });

    expect(result.baseReachable).toBe(true);
    expect(result.agentReachable).toBe(false);
    expect(result.connectivityStatus).toBe("base_online_agent_unreachable");
  });

  test("never treats a stopped Agent as reachable even while its final state is fresh", () => {
    const result = mapDeviceStatus({ lastHeartbeatAt: new Date(), status: "stopped" });

    expect(result.agentReachable).toBe(false);
    expect(result.agentStatus).toBe("stopped");
  });

  test("keeps the native base status unknown until the base starts reporting", () => {
    const result = mapDeviceStatus({ lastHeartbeatAt: new Date(), status: "running" });

    expect(result.baseStatus).toBe("unknown");
    expect(result.baseLastHeartbeatAt).toBeNull();
    expect(result.baseReachable).toBe(false);
    expect(result.screenState).toBe("unknown");
    expect(result.desiredAgentState).toBe("running");
  });

  test("reports a fresh native base heartbeat independently from Agent heartbeat", () => {
    const baseHeartbeatAt = new Date();
    const result = mapDeviceStatus({
      lastHeartbeatAt: new Date(Date.now() - 32_001),
      status: "paused",
      baseStatus: "online",
      baseLastHeartbeatAt: baseHeartbeatAt,
      screenState: "locked",
      desiredAgentState: "stopped"
    });

    expect(result.baseStatus).toBe("online");
    expect(result.baseLastHeartbeatAt).toBe(baseHeartbeatAt);
    expect(result.baseReachable).toBe(true);
    expect(result.screenState).toBe("locked");
    expect(result.desiredAgentState).toBe("stopped");
    expect(result.agentStatus).toBe("agent_unreachable");
    expect(result.connectivityStatus).toBe("base_online_agent_unreachable");
  });

  test("enters reconnecting after six seconds without exposing stale child states", () => {
    const result = mapDeviceStatus({
      lastHeartbeatAt: new Date(Date.now() - 32_001),
      status: "paused",
      baseStatus: "online",
      baseLastHeartbeatAt: new Date(Date.now() - 29_000),
      baseOfflineThresholdSeconds: 30,
      screenState: "unlocked"
    });

    expect(result.baseReachable).toBe(false);
    expect(result.baseConnectivityStatus).toBe("RECONNECTING");
    expect(result.baseStatus).toBe("unknown");
    expect(result.screenState).toBe("unknown");
  });

  test("marks a silent base offline after the grace window", () => {
    const result = mapDeviceStatus({
      lastHeartbeatAt: new Date(Date.now() - 32_001),
      status: "paused",
      baseStatus: "online",
      baseLastHeartbeatAt: new Date(Date.now() - 30_001),
      screenState: "unlocked"
    });

    expect(result.baseReachable).toBe(false);
    expect(result.baseStatus).toBe("unknown");
    expect(result.connectivityStatus).toBe("unreachable");
  });

  test("classifies an online base with a fresh Agent heartbeat as running", () => {
    const result = mapDeviceStatus({
      lastHeartbeatAt: new Date(),
      status: "running",
      baseStatus: "online",
      baseLastHeartbeatAt: new Date(),
      screenState: "unlocked"
    });

    expect(result.connectivityStatus).toBe("base_online_agent_running");
    expect(result.baseReachable).toBe(true);
    expect(result.agentReachable).toBe(true);
  });

  test("classifies missing base heartbeat as unreachable", () => {
    const result = mapDeviceStatus({ lastHeartbeatAt: null, status: "offline" });
    expect(result.connectivityStatus).toBe("unreachable");
  });

  test("reports an expired heartbeat as Agent unreachable without claiming the phone is off", () => {
    const heartbeatAt = new Date(Date.now() - 45_001);
    const result = mapDeviceStatus({ lastHeartbeatAt: heartbeatAt, status: "paused" });

    expect(result.status).toBe("offline");
    expect(result.agentStatus).toBe("agent_unreachable");
    expect(result.agentLastHeartbeatAt).toBe(heartbeatAt);
    expect(result.agentHeartbeatAge).toBeGreaterThan(32_000);
    expect(result.agentReachable).toBe(false);
  });
});
