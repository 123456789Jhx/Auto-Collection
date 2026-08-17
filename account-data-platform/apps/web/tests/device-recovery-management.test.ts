import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getLatestDeviceRecovery } from "../src/features/device-recovery/api-client-device-recovery";
import {
  deviceRecoveryErrorText,
  deviceRecoveryProgress,
  deviceRecoverySourceText,
  deviceRecoveryStageText,
  formatRecoveryDuration
} from "../src/features/device-recovery/device-recovery-view-model";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

describe("device recovery management", () => {
  beforeEach(() => {
    globalThis.window = {
      localStorage: { getItem: () => "admin-token", setItem() {}, removeItem() {} },
      setTimeout,
      clearTimeout,
      dispatchEvent: () => true
    } as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  });

  test("loads the latest unified recovery timeline for a device", async () => {
    let requested = "";
    globalThis.fetch = async (input) => {
      requested = String(input);
      return new Response(JSON.stringify({ data: null }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    };

    const result = await getLatestDeviceRecovery("device-mi8");

    expect(requested).toBe("/api/v1/admin/device-recovery/devices/device-mi8/latest");
    expect(result.data).toBeNull();
  });

  test("maps the shared lifecycle to operator-facing progress", () => {
    expect(deviceRecoverySourceText("AUTO_BOOT")).toBe("开机自动恢复");
    expect(deviceRecoverySourceText("MANUAL_WAKE")).toBe("后台手动唤醒");
    expect(deviceRecoveryStageText("WAITING_DEVICE")).toBe("等待 Agent 响应");
    expect(deviceRecoveryStageText("DEVICE_REGISTERED")).toBe("设备已注册");
    expect(deviceRecoveryProgress("DEVICE_REGISTERED")).toBe(67);
    expect(deviceRecoveryErrorText("DEVICE_UNREACHABLE", "Device did not become reachable.")).toBe("未收到 Agent 响应，无法确认手机是否开机");
    expect(deviceRecoveryErrorText("SECURE_KEYGUARD_REQUIRES_USER", undefined)).toContain("手动解锁");
    expect(formatRecoveryDuration(125_000)).toBe("2分5秒");
  });

  test("does not render stale historical recovery sessions in the remote wake device row", () => {
    const action = readFileSync(
      path.join(import.meta.dir, "../src/features/remote-wake/RemoteWakeDeviceAction.tsx"),
      "utf8"
    );
    expect(action).not.toContain("DeviceRecoveryProgress");
    expect(action).not.toContain("getLatestDeviceRecovery");
  });
});
