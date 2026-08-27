import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as accountWarmupForm from "../src/lib/account-warmup-form.ts";

const {
  buildVideoWarmupCommands,
  buildVideoWarmupStopCommands,
  clearVideoWarmupDeviceKeyword,
  readLastVideoWarmupKeyword,
  readVideoWarmupDeviceKeywords,
  resolveVideoWarmupKeyword,
  resolveVideoWarmupCommandState,
  selectOnlineVideoWarmupDevices,
  videoWarmupDeviceName,
  writeLastVideoWarmupKeyword,
  writeVideoWarmupDeviceKeyword
} = accountWarmupForm;

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("builds one video warmup command per selected device", () => {
  const commands = buildVideoWarmupCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "黄芪种植",
    deviceCodes: ["device-a", "device-b", "device-a"]
  });

  assert.deepEqual(commands.map((command) => command.deviceId), ["device-a", "device-b"]);
  assert(commands.every((command) => command.commandType === "ACCOUNT_WARMUP_RUN"));
  assert(commands.every((command) => command.payload.featureKey === "video_warmup"));
  assert(commands.every((command) => command.payload.config.targetKeyword === "黄芪种植"));
});

test("builds each device command with its override or the shared keyword", () => {
  const commands = buildVideoWarmupCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "  统一关键词  ",
    deviceCodes: [" device-a ", "device-b", "device-a"],
    deviceKeywords: {
      "device-a": "  黄芪种植  ",
      "device-b": "   "
    }
  });

  assert.deepEqual(commands.map((command) => ({
    deviceId: command.deviceId,
    targetKeyword: command.payload.config.targetKeyword
  })), [
    { deviceId: "device-a", targetKeyword: "黄芪种植" },
    { deviceId: "device-b", targetKeyword: "统一关键词" }
  ]);
});

test("does not build video warmup commands without a keyword", () => {
  assert.deepEqual(buildVideoWarmupCommands({
    batchId: "6f646271-82da-47d1-8ca5-6de3c7394348",
    targetKeyword: "   ",
    deviceCodes: ["device-a"]
  }), []);
});

test("remembers the last video warmup keyword", () => {
  assert.equal(typeof readLastVideoWarmupKeyword, "function");
  assert.equal(typeof writeLastVideoWarmupKeyword, "function");
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  assert.equal(readLastVideoWarmupKeyword(storage), "药材种植");
  writeLastVideoWarmupKeyword("  人参种植  ", storage);
  assert.equal(readLastVideoWarmupKeyword(storage), "人参种植");
});

test("remembers video warmup keywords by device code and supports clearing one device", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  assert.deepEqual(readVideoWarmupDeviceKeywords(storage), {});
  writeVideoWarmupDeviceKeyword(" device-a ", " 黄芪种植 ", storage);
  writeVideoWarmupDeviceKeyword("device-b", "人参种植", storage);
  assert.deepEqual(readVideoWarmupDeviceKeywords(storage), {
    "device-a": "黄芪种植",
    "device-b": "人参种植"
  });

  clearVideoWarmupDeviceKeyword("device-a", storage);
  assert.deepEqual(readVideoWarmupDeviceKeywords(storage), {
    "device-b": "人参种植"
  });
  clearVideoWarmupDeviceKeyword("device-b", storage);
  assert.deepEqual(readVideoWarmupDeviceKeywords(storage), {});
});

test("ignores invalid device keyword storage and resolves keyword priority", () => {
  const invalidStorage = {
    getItem: () => "not-json",
    setItem: () => {},
    removeItem: () => {}
  };

  assert.deepEqual(readVideoWarmupDeviceKeywords(invalidStorage), {});
  assert.equal(resolveVideoWarmupKeyword("device-a", "  统一关键词  ", {
    "device-a": "  独立关键词  "
  }), "独立关键词");
  assert.equal(resolveVideoWarmupKeyword("device-b", "  统一关键词  ", {}), "统一关键词");
  assert.equal(resolveVideoWarmupKeyword("device-c", "   ", {}), "药材种植");
});

test("keeps offline device keywords and falls back for newly connected devices", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key)
  };

  writeVideoWarmupDeviceKeyword("offline-device", "  丹参种植  ", storage);
  writeVideoWarmupDeviceKeyword("online-device", "黄芪种植", storage);
  assert.deepEqual(readVideoWarmupDeviceKeywords(storage), {
    "offline-device": "丹参种植",
    "online-device": "黄芪种植"
  });
  assert.equal(resolveVideoWarmupKeyword("new-device", "统一关键词", readVideoWarmupDeviceKeywords(storage)), "统一关键词");

  writeVideoWarmupDeviceKeyword("online-device", "   ", storage);
  assert.deepEqual(readVideoWarmupDeviceKeywords(storage), {
    "offline-device": "丹参种植"
  });
});

test("mounts video warmup as an independent submodule", () => {
  const moduleSource = fs.readFileSync(path.join(webRoot, "src/routes/AccountWarmupModulePage.tsx"), "utf8");
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/VideoWarmupPage.tsx"), "utf8");

  assert(moduleSource.includes('label: "视频养号"'));
  assert(moduleSource.includes("VideoWarmupPage"));
  for (const text of ["执行设备", "全选可用设备", "启动所选设备", "停止本批任务"]) {
    assert(pageSource.includes(text), `missing video warmup text: ${text}`);
  }
  assert(pageSource.includes("stopVideoWarmupDevice"));
  assert(pageSource.includes("selectedDeviceCodes"));
  assert(pageSource.includes("readLastVideoWarmupKeyword"));
  assert(pageSource.includes("writeLastVideoWarmupKeyword"));
  assert(pageSource.includes("readActiveVideoWarmupBatchId"));
  assert(pageSource.includes("hasReportedTask"));
  assert(!pageSource.includes('command.commandType === "ACCOUNT_WARMUP_RUN" && !isTerminal(command)'));
});

test("renders and submits a keyword override for each video warmup device", () => {
  const pageSource = fs.readFileSync(path.join(webRoot, "src/routes/VideoWarmupPage.tsx"), "utf8");

  assert(pageSource.includes("readVideoWarmupDeviceKeywords"));
  assert(pageSource.includes("writeVideoWarmupDeviceKeyword"));
  assert(pageSource.includes("deviceKeywords"));
  assert(pageSource.includes('placeholder="留空使用统一关键词"'));
  assert(pageSource.includes("updateDeviceKeyword(device.deviceCode"));
  assert(pageSource.includes("event.target.value.trim()"));
});

test("builds video-only stop commands for active devices", () => {
  const commands = buildVideoWarmupStopCommands({
    batchId: "batch-1",
    rows: [
      { id: "run-a", deviceCode: "device-a", status: "FETCHED" },
      { id: "run-a-copy", deviceCode: "device-a", status: "PENDING" },
      { id: "run-b", deviceCode: "device-b", status: "DONE" },
      { id: "run-c", deviceCode: "device-c", status: "FAILED" }
    ]
  });

  assert.deepEqual(commands, [{
    deviceId: "device-a",
    commandType: "VIDEO_WARMUP_STOP",
    payload: {
      featureKey: "video_warmup",
      batchId: "batch-1",
      reason: "USER_REQUESTED"
    },
    expiresInSeconds: 600
  }]);
});

test("restores stopping, stopped and failed states from stop command records", () => {
  const run = { id: "run-a", deviceId: "device-id-a", status: "FETCHED", resultJson: null };
  const stop = (status, resultJson = null) => ({
    id: `stop-${status}`,
    deviceId: "device-id-a",
    commandType: "VIDEO_WARMUP_STOP",
    status,
    payloadJson: { featureKey: "video_warmup", batchId: "batch-1" },
    resultJson
  });

  assert.equal(resolveVideoWarmupCommandState(run, [stop("PENDING")], "batch-1").key, "stopping");
  assert.equal(resolveVideoWarmupCommandState(run, [stop("DONE")], "batch-1").key, "stopped");
  assert.equal(resolveVideoWarmupCommandState(run, [stop("FAILED")], "batch-1").key, "stop_failed");
  assert.equal(resolveVideoWarmupCommandState(run, [stop("DONE")], "another-batch").key, "running");
});

test("does not keep a timed-out run active when its pending stop request is expired", () => {
  const run = {
    id: "run-timeout",
    deviceId: "device-id-a",
    status: "TIMED_OUT",
    resultJson: null
  };
  const stop = {
    id: "stop-expired",
    deviceId: "device-id-a",
    commandType: "VIDEO_WARMUP_STOP",
    status: "PENDING",
    expiresAt: "2026-08-07T08:58:48.141Z",
    payloadJson: { featureKey: "video_warmup", batchId: "batch-1" },
    resultJson: null
  };

  const state = resolveVideoWarmupCommandState(run, [stop], "batch-1", Date.parse("2026-08-07T17:05:00.000Z"));
  assert.equal(state.active, false);
  assert.notEqual(state.key, "stopping");
});

test("treats a RUNNING video warmup command as an active running state", () => {
  const state = resolveVideoWarmupCommandState({
    id: "run-running",
    deviceId: "device-id-a",
    status: "RUNNING",
    resultJson: null
  }, [], "batch-1");

  assert.deepEqual(state, { key: "running", label: "刷视频中", color: "processing", active: true });
});

test("shows only enabled online devices and prefers the bound Douyin account name", () => {
  const devices = [
    {
      id: "online",
      deviceCode: "device-online",
      deviceName: "Device A",
      enabled: true,
      effectiveStatus: "paused",
      accountProfile: { douyinAccountName: "Account A" }
    },
    { id: "offline", deviceCode: "device-offline", enabled: true, effectiveStatus: "offline" },
    { id: "disabled", deviceCode: "device-disabled", enabled: false, effectiveStatus: "paused" }
  ];

  assert.deepEqual(selectOnlineVideoWarmupDevices(devices).map((device) => device.id), ["online"]);
  assert.equal(videoWarmupDeviceName(devices[0]), "Account A");
});

test("shows pending run stop as waiting cancellation", () => {
  const run = {
    id: "run-expired",
    deviceId: "device-id-a",
    status: "PENDING",
    expiresAt: "2026-08-07T08:58:48.141Z",
    resultJson: null
  };
  const stop = {
    id: "stop-pending",
    deviceId: "device-id-a",
    commandType: "VIDEO_WARMUP_STOP",
    status: "PENDING",
    payloadJson: { featureKey: "video_warmup", batchId: "batch-1" },
    resultJson: null
  };

  const state = resolveVideoWarmupCommandState(run, [stop], "batch-1", Date.parse("2026-08-07T17:05:00.000Z"));
  assert.equal(state.key, "waiting_cancel");
  assert.equal(state.active, true);
});
