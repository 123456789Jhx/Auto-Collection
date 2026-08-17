import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  exitAgentAppBusinessResult,
  exitAgentAppStages,
  exitAgentAppTransportStatus,
  findActiveExitAgentAppCommand,
  isExitAgentAppCommandActive,
  readExitAgentAppCommandId,
  resolveExitAgentAppAction,
  selectExitAgentAppCommand,
  writeExitAgentAppCommandId
} from "../src/features/remote-wake/remote-wake-action-plan";

const online = {
  baseReachable: true,
  baseStatus: "online",
  baseConnectivityStatus: "ONLINE" as const,
  screenState: "unlocked",
  appUiState: "not_running",
  agentReachable: false
};

const webRoot = path.join(import.meta.dir, "../src");

describe("exit agent app action plan", () => {
  test("does not submit when the outer base is offline or state is incomplete", () => {
    expect(resolveExitAgentAppAction({
      ...online,
      baseReachable: false,
      baseStatus: "unknown",
      baseConnectivityStatus: "OFFLINE"
    })).toMatchObject({
      kind: "info",
      commandType: null,
      title: "设备离线等待接入"
    });
    expect(resolveExitAgentAppAction({ ...online, appUiState: "unknown" })).toMatchObject({
      kind: "info",
      commandType: null,
      title: "正在获取设备状态"
    });
  });

  test("reports Agent closed with no UI task as information only", () => {
    expect(resolveExitAgentAppAction(online)).toEqual({
      kind: "info",
      title: "无需退出",
      content: "当前 Agent 已关闭，无后台程序。",
      commandType: null,
      defaultLockScreen: false
    });
  });

  test("confirms clearing UI task when Agent is off but the App has a task", () => {
    expect(resolveExitAgentAppAction({ ...online, appUiState: "background" })).toMatchObject({
      kind: "confirm",
      title: "确认清除后台",
      commandType: "EXIT_AGENT_APP",
      defaultLockScreen: false
    });
  });

  test("confirms stopping Agent when Agent is on but no App task remains", () => {
    expect(resolveExitAgentAppAction({ ...online, agentReachable: true })).toMatchObject({
      kind: "confirm",
      title: "确认关闭 Agent",
      commandType: "EXIT_AGENT_APP",
      defaultLockScreen: false
    });
  });

  test("confirms the full exit flow when Agent and App task are both present", () => {
    expect(resolveExitAgentAppAction({
      ...online,
      appUiState: "foreground",
      agentReachable: true
    })).toMatchObject({
      kind: "confirm",
      content: "当前手机已解锁，Agent 已启动，且留有燎原星火后台，是否关闭 Agent 并清除后台？",
      commandType: "EXIT_AGENT_APP"
    });
  });
});

test("remote wake page exposes a separate exit command with optional lock screen payload", () => {
  const action = readFileSync(
    path.join(webRoot, "features/remote-wake/RemoteWakeDeviceAction.tsx"),
    "utf8"
  );
  const apiClient = readFileSync(path.join(webRoot, "lib/api-client.ts"), "utf8");

  expect(existsSync(path.join(webRoot, "features/remote-wake/RemoteWakeDeviceAction.tsx"))).toBe(true);
  expect(action).toContain("退出燎原星火");
  expect(action).toContain("resolveExitAgentAppAction");
  expect(action).toContain("EXIT_AGENT_APP");
  expect(action).toContain("退出后锁屏");
  expect(action).toContain('submitCommand("EXIT_AGENT_APP", { lockScreen })');
  expect(apiClient).toContain("\"EXIT_AGENT_APP\"");
});

test("retains an exit command id per device and rejects another device's command", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  };
  writeExitAgentAppCommandId("device-a", "command-a", storage);

  expect(readExitAgentAppCommandId("device-a", storage)).toBe("command-a");
  expect(selectExitAgentAppCommand([
    { id: "command-a", deviceId: "device-a", commandType: "EXIT_AGENT_APP", status: "RUNNING" },
    { id: "command-b", deviceId: "device-b", commandType: "EXIT_AGENT_APP", status: "DONE" }
  ], "command-a", { id: "device-a", deviceCode: "device-a" })).toMatchObject({ id: "command-a" });
  expect(selectExitAgentAppCommand([
    { id: "command-a", deviceId: "device-b", commandType: "EXIT_AGENT_APP", status: "DONE" }
  ], "command-a", { id: "device-a", deviceCode: "device-a" })).toBeNull();
});

test("wires typed command polling, exact lock payload, and all exit stages into the action cell", () => {
  const action = readFileSync(
    path.join(webRoot, "features/remote-wake/RemoteWakeDeviceAction.tsx"),
    "utf8"
  );
  const actionPlan = readFileSync(
    path.join(webRoot, "features/remote-wake/remote-wake-action-plan.ts"),
    "utf8"
  );
  const apiClient = readFileSync(path.join(webRoot, "lib/api-client.ts"), "utf8");

  expect(apiClient).toContain("export type MobileCommand");
  expect(apiClient).toContain("export function getMobileCommands");
  expect(action).toContain("getMobileCommands");
  expect(action).toContain("useQuery");
  expect(action).toContain('submitCommand("EXIT_AGENT_APP", { lockScreen })');
  for (const status of ["PENDING", "CLAIMED", "RUNNING", "DONE", "PARTIAL", "FAILED", "TIMED_OUT"]) {
    expect(actionPlan).toContain(status);
  }
  for (const stage of ["STOP_AGENT", "REMOVE_APP_TASK", "LOCK_SCREEN"]) {
    expect(actionPlan).toContain(stage);
  }
  expect(action).toContain("reason");
  expect(action).toContain("screenState");
  expect(action).toContain("appUiState");
});

test("blocks duplicate active exits while keeping transport and business results distinct", () => {
  expect(isExitAgentAppCommandActive({
    id: "pending",
    deviceId: "device-a",
    commandType: "EXIT_AGENT_APP",
    status: "PENDING"
  })).toBe(true);
  expect(isExitAgentAppCommandActive({
    id: "ignored",
    deviceId: "device-a",
    commandType: "EXIT_AGENT_APP",
    status: "IGNORED"
  })).toBe(false);

  const partial = {
    id: "done-partial",
    deviceId: "device-a",
    commandType: "EXIT_AGENT_APP",
    status: "DONE",
    resultJson: { result: "PARTIAL" }
  } as const;
  expect(exitAgentAppTransportStatus(partial)).toBe("DONE");
  expect(exitAgentAppBusinessResult(partial)).toBe("PARTIAL");
  const action = readFileSync(
    path.join(webRoot, "features/remote-wake/RemoteWakeDeviceAction.tsx"),
    "utf8"
  );
  expect(action).toContain("isExitAgentAppCommandActive");
  expect(action).toContain("exitCommandActive");
  expect(action).toContain("Transport");
  expect(action).toContain("Result");
  expect(action).toContain("IGNORED");
});

test("always returns all exit stages with placeholders and preserves reported reasons", () => {
  expect(exitAgentAppStages({
    id: "pending",
    deviceId: "device-a",
    commandType: "EXIT_AGENT_APP",
    status: "PENDING"
  })).toEqual([
    { name: "STOP_AGENT", status: "NOT_REPORTED", reason: "" },
    { name: "REMOVE_APP_TASK", status: "NOT_REPORTED", reason: "" },
    { name: "LOCK_SCREEN", status: "NOT_REPORTED", reason: "" }
  ]);
  expect(exitAgentAppStages({
    id: "failed",
    deviceId: "device-a",
    commandType: "EXIT_AGENT_APP",
    status: "FAILED",
    resultJson: {
      stages: [
        { name: "STOP_AGENT", status: "SUCCESS" },
        { name: "REMOVE_APP_TASK", status: "FAILED", reason: "agent_not_stopped" }
      ]
    }
  })).toEqual([
    { name: "STOP_AGENT", status: "SUCCESS", reason: "" },
    { name: "REMOVE_APP_TASK", status: "FAILED", reason: "agent_not_stopped" },
    { name: "LOCK_SCREEN", status: "NOT_REPORTED", reason: "" }
  ]);
  const action = readFileSync(
    path.join(webRoot, "features/remote-wake/RemoteWakeDeviceAction.tsx"),
    "utf8"
  );
  expect(action).toContain("NOT_REPORTED");
  expect(action).toContain("stage.reason");
});

test("finds an active same-device exit without relying on the persisted command id", () => {
  const commands = [
    { id: "other-device", deviceId: "device-b", commandType: "EXIT_AGENT_APP", status: "RUNNING" },
    { id: "terminal-local", deviceId: "device-a", commandType: "EXIT_AGENT_APP", status: "DONE" },
    { id: "active-cross-tab", deviceId: "device-a", commandType: "EXIT_AGENT_APP", status: "CLAIMED" },
    { id: "wrong-type", deviceId: "device-a", commandType: "START_AGENT", status: "RUNNING" }
  ];

  expect(findActiveExitAgentAppCommand(commands, {
    id: "device-a",
    deviceCode: "device-code-a"
  })).toMatchObject({ id: "active-cross-tab", status: "CLAIMED" });
  expect(findActiveExitAgentAppCommand(commands, {
    id: "missing-device",
    deviceCode: "missing-code"
  })).toBeNull();

  const action = readFileSync(
    path.join(webRoot, "features/remote-wake/RemoteWakeDeviceAction.tsx"),
    "utf8"
  );
  expect(action).toContain("findActiveExitAgentAppCommand");
  expect(action).toContain("activeExitCommand");
});

test("treats localStorage access and method failures as optional persistence", () => {
  const throwingMethods = {
    getItem: () => { throw new DOMException("blocked", "SecurityError"); },
    setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
    removeItem: () => { throw new DOMException("blocked", "SecurityError"); }
  };
  expect(readExitAgentAppCommandId("device-a", throwingMethods)).toBe("");
  expect(() => writeExitAgentAppCommandId("device-a", "command-a", throwingMethods)).not.toThrow();

  const throwingWrites = {
    getItem: () => "{}",
    setItem: () => { throw new DOMException("full", "QuotaExceededError"); },
    removeItem: () => { throw new DOMException("blocked", "SecurityError"); }
  };
  expect(() => writeExitAgentAppCommandId("device-a", "command-a", throwingWrites)).not.toThrow();
  expect(() => writeExitAgentAppCommandId("device-a", "", throwingWrites)).not.toThrow();

  const originalWindow = globalThis.window;
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: Object.defineProperty({}, "localStorage", {
        get() { throw new DOMException("blocked", "SecurityError"); }
      })
    });
    expect(readExitAgentAppCommandId("device-a")).toBe("");
    expect(() => writeExitAgentAppCommandId("device-a", "command-a")).not.toThrow();
  } finally {
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  }
});
