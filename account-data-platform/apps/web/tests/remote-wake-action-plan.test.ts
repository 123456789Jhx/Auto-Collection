import { describe, expect, test } from "bun:test";
import { resolveRemoteWakeAction } from "../src/features/remote-wake/remote-wake-action-plan";

const online = {
  baseReachable: true,
  baseStatus: "online",
  baseConnectivityStatus: "ONLINE" as const,
  screenState: "unlocked",
  appUiState: "background",
  agentReachable: false
};

describe("remote wake action plan", () => {
  test("reports an unreachable device without creating a command", () => {
    expect(resolveRemoteWakeAction({
      ...online,
      baseReachable: false,
      baseStatus: "unknown",
      baseConnectivityStatus: "OFFLINE"
    })).toEqual({
      kind: "unavailable",
      title: "设备离线等待接入",
      content: "目前手机已关机，或者手机当前无网络或存在其他连接问题，无法打开燎原星火。",
      commandType: null
    });
  });

  test("starts Agent after confirming an unlocked Agent-off device", () => {
    expect(resolveRemoteWakeAction(online)).toMatchObject({
      kind: "confirm",
      content: "当前手机已解锁，Agent 未开启，是否开启 Agent？",
      commandType: "START_AGENT"
    });
  });

  test("unlocks and starts Agent after confirming a locked Agent-off device", () => {
    expect(resolveRemoteWakeAction({ ...online, screenState: "locked" })).toMatchObject({
      kind: "confirm",
      content: "当前手机已锁屏，Agent 未开启，是否解锁手机并开启 Agent？",
      commandType: "START_AGENT"
    });
  });

  test("ensures Agent while unlocking a locked Agent-on device", () => {
    expect(resolveRemoteWakeAction({
      ...online,
      screenState: "locked",
      agentReachable: true
    })).toMatchObject({
      kind: "confirm",
      content: "当前手机已锁屏，Agent 已开启，是否解锁手机并打开燎原星火？",
      commandType: "START_AGENT"
    });
  });

  test("starts Agent when the App was removed even if the last Agent heartbeat is still fresh", () => {
    expect(resolveRemoteWakeAction({
      ...online,
      screenState: "locked",
      appUiState: "not_running",
      agentReachable: true
    })).toMatchObject({
      kind: "confirm",
      commandType: "START_AGENT"
    });
  });

  test("ensures Agent while restoring an existing background App", () => {
    expect(resolveRemoteWakeAction({
      ...online,
      agentReachable: true
    })).toMatchObject({
      kind: "confirm",
      content: "Agent 已开启，燎原星火当前在后台，是否打开？",
      commandType: "START_AGENT"
    });
  });

  test("does nothing when the App, screen, and Agent are already ready", () => {
    expect(resolveRemoteWakeAction({
      ...online,
      appUiState: "foreground",
      agentReachable: true
    })).toEqual({
      kind: "ready",
      title: "设备状态正常",
      content: "手机已解锁，燎原星火位于前台，Agent 已开启，无需重复操作。",
      commandType: null
    });
  });

  test("refuses blind commands when the outer base cannot inspect device state", () => {
    expect(resolveRemoteWakeAction({ ...online, appUiState: "unknown" })).toMatchObject({
      kind: "unavailable",
      commandType: null
    });
    expect(resolveRemoteWakeAction({ ...online, screenState: "unknown" })).toMatchObject({
      kind: "unavailable",
      commandType: null
    });
  });
});
