import { expect, test } from "bun:test";
import type { BizScriptDevice, BizScriptPreview } from "@pkg/types";
import { getDeviceScopeBlocker, getPromotionBlocker } from "../src/components/update-center/biz-script-workflow";

const preview = {
  id: "preview-1", version: "20260910.200", stage: "TESTING", revision: 2,
  baselineVersion: "20260910.100", apkBuildId: "apk-test", baseCompatibilityId: "base", sourceSha256: "source",
  packageSha256: "package", sizeBytes: 100, files: [], changes: { added: [], modified: [], removed: [] },
  releaseNote: "", createdAt: "2026-09-10T00:00:00Z", testDeviceIds: ["phone-1"], deviceIds: []
} satisfies BizScriptPreview;
const device = {
  deviceId: "phone-1", deviceCode: "D001", deviceName: "测试机", enabled: true,
  lastHeartbeatAt: "2026-09-10T00:00:00Z", currentVersion: preview.version, pendingVersion: null,
  source: "overlay", baseCompatibilityId: "base", sourceSha256: "source", hotUpdateAllowed: true,
  fresh: true, targetVersion: preview.version, state: "CURRENT", eventMessage: null
} satisfies BizScriptDevice;

test("promotion requires all test devices to report the exact running overlay", () => {
  expect(getPromotionBlocker(preview, [device])).toBeNull();
  for (const change of [
    { fresh: false }, { currentVersion: preview.baselineVersion }, { source: "baseline" as const },
    { sourceSha256: "old" }, { baseCompatibilityId: "old" }, { enabled: false }, { hotUpdateAllowed: false },
    { state: "PENDING_RESTART" as const, currentVersion: preview.baselineVersion, pendingVersion: preview.version }
  ]) expect(getPromotionBlocker(preview, [{ ...device, ...change }])).not.toBeNull();
  expect(getPromotionBlocker(preview, [])).not.toBeNull();
  expect(getPromotionBlocker({ ...preview, testDeviceIds: [] }, [device])).not.toBeNull();
  expect(getPromotionBlocker({ ...preview, stage: "DRAFT" }, [device])).not.toBeNull();
});

test("scope selection disables offline, incompatible, disabled and incapable devices", () => {
  expect(getDeviceScopeBlocker(device, preview)).toBeNull();
  for (const change of [{ fresh: false }, { enabled: false }, { baseCompatibilityId: null }, { hotUpdateAllowed: false }]) {
    expect(getDeviceScopeBlocker({ ...device, ...change }, preview)).not.toBeNull();
  }
});
