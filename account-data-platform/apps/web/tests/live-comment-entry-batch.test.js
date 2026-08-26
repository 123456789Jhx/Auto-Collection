import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createLiveCommentEntryBatchPlan,
  dispatchLiveCommentEntryDevices,
  findUndispatchedLiveCommentEntryDevices,
  readLiveCommentEntryBatchPlan,
  withLiveCommentEntryDispatchErrors,
  writeLiveCommentEntryBatchPlan
} from "../src/lib/live-comment-entry-batch.ts";

const batchId = "6f646271-82da-47d1-8ca5-6de3c7394348";

function batchPlan() {
  return createLiveCommentEntryBatchPlan({
    batchId,
    targetKeyword: " 药材种植 ",
    minViewerCount: 300,
    devices: [
      { deviceCode: "device-a", deviceId: "uuid-a", deviceName: "设备 A" },
      { deviceCode: "device-b", deviceId: "uuid-b", deviceName: "设备 B" }
    ]
  });
}

test("persists the original batch config, devices and per-device dispatch errors", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const failed = withLiveCommentEntryDispatchErrors(batchPlan(), [
    { deviceCode: "device-b", message: "设备暂不可用" }
  ]);
  writeLiveCommentEntryBatchPlan(failed, storage);

  assert.deepEqual(readLiveCommentEntryBatchPlan(batchId, storage), failed);
  assert.equal(failed.targetKeyword, "药材种植");
  assert.equal(failed.devices.length, 2);
});

test("only reports devices without a command and matches either UUID or device code", () => {
  const failed = withLiveCommentEntryDispatchErrors(batchPlan(), [
    { deviceCode: "device-b", message: "请求超时" }
  ]);
  assert.deepEqual(findUndispatchedLiveCommentEntryDevices(failed, [{ deviceId: "uuid-a" }]), [{
    deviceCode: "device-b",
    deviceId: "uuid-b",
    deviceName: "设备 B",
    message: "请求超时"
  }]);
  assert.deepEqual(findUndispatchedLiveCommentEntryDevices(failed, [
    { deviceId: "uuid-a" },
    { deviceCode: "device-b" }
  ]), []);
});

test("dispatch keeps successful devices independent and returns errors by device", async () => {
  const sent = [];
  const result = await dispatchLiveCommentEntryDevices({
    batch: batchPlan(),
    deviceCodes: ["device-a", "device-b"],
    send: async (command) => {
      sent.push(command.deviceId);
      if (command.deviceId === "device-b") throw new Error("下发失败");
    }
  });

  assert.deepEqual(sent, ["device-a", "device-b"]);
  assert.deepEqual(result, {
    attemptedCount: 2,
    succeededCount: 1,
    failures: [{ deviceCode: "device-b", message: "下发失败" }]
  });
});
