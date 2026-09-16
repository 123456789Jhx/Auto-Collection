import { describe, expect, test } from "bun:test";
import type { BizScriptPreview } from "@pkg/types";
import { deriveBizScriptDevice, isBizScriptActuallyLoaded, type BizScriptDeviceEvidence } from "./biz-script-device-state";

const now = new Date("2026-09-10T10:00:00Z");
const preview: BizScriptPreview = {
  id: "release-1", version: "20260910.2", stage: "TESTING", revision: 2,
  baselineVersion: "20260910.1", apkBuildId: "APK-1", baseCompatibilityId: "a".repeat(64),
  sourceSha256: "b".repeat(64), packageSha256: "c".repeat(64), sizeBytes: 100,
  files: [], changes: { added: [], modified: [], removed: [] }, releaseNote: "",
  createdAt: "2026-09-10T09:00:00Z", testDeviceIds: ["device-1"], deviceIds: []
};

function evidence(overrides: Partial<BizScriptDeviceEvidence> = {}): BizScriptDeviceEvidence {
  return {
    deviceId: "device-1", deviceCode: "phone-1", deviceName: null, enabled: true,
    heartbeatAt: new Date("2026-09-10T09:59:50Z"),
    rawPayload: { bizScriptRuntime: {
      version: "20260910.1", baselineVersion: "20260910.1", source: "baseline",
      apkBuildId: "APK-1", baseCompatibilityId: "a".repeat(64),
      sourceSha256: "d".repeat(64), hotUpdateAllowed: true, rejectionReason: null
    } },
    latestEvent: null, latestFailure: null, ...overrides
  };
}

describe("business script actual runtime evidence", () => {
  test("APPLIED only marks a pending restart and cannot change the actual version", () => {
    const input = evidence({ latestEvent: {
      eventType: "APPLIED", toVersion: preview.version, message: "written to disk",
      createdAt: new Date("2026-09-10T09:59:55Z"), payloadJson: {}
    } });
    const result = deriveBizScriptDevice(input, preview, [preview], now);
    expect(result.currentVersion).toBe("20260910.1");
    expect(result.state).toBe("PENDING_RESTART");
    expect(isBizScriptActuallyLoaded(result, preview)).toBe(false);
  });

  test("requires a fresh overlay heartbeat with matching version and both fingerprints", () => {
    const input = evidence();
    input.rawPayload!.bizScriptRuntime = {
      ...(input.rawPayload!.bizScriptRuntime as object), source: "overlay",
      version: preview.version, sourceSha256: preview.sourceSha256
    };
    const device = deriveBizScriptDevice(input, preview, [preview], now);
    expect(device.state).toBe("CURRENT");
    expect(isBizScriptActuallyLoaded(device, preview)).toBe(true);
    expect(isBizScriptActuallyLoaded({ ...device, sourceSha256: "wrong" }, preview)).toBe(false);
    expect(isBizScriptActuallyLoaded({ ...device, source: "baseline" }, preview)).toBe(false);
    expect(isBizScriptActuallyLoaded({ ...device, fresh: false }, preview)).toBe(false);
    expect(isBizScriptActuallyLoaded({ ...device, state: "FAILED" }, preview)).toBe(false);
    expect(isBizScriptActuallyLoaded({ ...device, state: "REJECTED" }, preview)).toBe(false);
  });

  test("ordinary CHECKED and unrelated runtime heartbeats retain the last failure", () => {
    const result = deriveBizScriptDevice(evidence({
      latestEvent: { eventType: "CHECKED", toVersion: preview.version, message: "checked", createdAt: now, payloadJson: {} },
      latestFailure: { eventType: "FAILED", toVersion: preview.version, message: "engine restart failed",
        createdAt: new Date("2026-09-10T09:59:40Z"), payloadJson: {} }
    }), preview, [preview], now);
    expect(result.state).toBe("FAILED");
    expect(result.eventMessage).toBe("engine restart failed");
  });

  test("clears failure only after a newer heartbeat actually loads the failed fingerprint", () => {
    const input = evidence({ latestFailure: {
      eventType: "FAILED", toVersion: preview.version, message: "failed",
      createdAt: new Date("2026-09-10T09:59:40Z"), payloadJson: {}
    } });
    input.rawPayload!.bizScriptRuntime = {
      ...(input.rawPayload!.bizScriptRuntime as object), source: "overlay",
      version: preview.version, sourceSha256: preview.sourceSha256
    };
    expect(deriveBizScriptDevice(input, preview, [preview], now).state).toBe("CURRENT");
    input.heartbeatAt = new Date("2026-09-10T09:59:30Z");
    expect(deriveBizScriptDevice(input, preview, [preview], now).state).toBe("FAILED");
  });

  test("uses server receipt time and refuses incomplete runtime metadata", () => {
    expect(deriveBizScriptDevice(evidence({ heartbeatAt: new Date("2026-09-10T09:58:00Z") }), preview, [preview], now).state).toBe("OFFLINE");
    const device = deriveBizScriptDevice(evidence({ rawPayload: { bizScriptsVersion: preview.version } }), preview, [preview], now);
    expect(device.currentVersion).toBeNull();
    expect(device.hotUpdateAllowed).toBe(false);
    expect(device.state).toBe("NEEDS_APK");
  });

  test("a newer fixed release with actual matching heartbeat clears a quarantined version failure", () => {
    const fixed = { ...preview, id: "release-2", version: "20260910.3", sourceSha256: "e".repeat(64) };
    const input = evidence({ latestFailure: {
      eventType: "FAILED", toVersion: preview.version, message: "bad version quarantined",
      createdAt: new Date("2026-09-10T09:59:40Z"), payloadJson: {}
    } });
    input.rawPayload!.bizScriptRuntime = {
      ...(input.rawPayload!.bizScriptRuntime as object), source: "overlay",
      version: fixed.version, sourceSha256: fixed.sourceSha256
    };
    expect(deriveBizScriptDevice(input, fixed, [preview, fixed], now).state).toBe("CURRENT");
    input.rawPayload!.bizScriptRuntime = {
      ...(input.rawPayload!.bizScriptRuntime as object), sourceSha256: "wrong"
    };
    expect(deriveBizScriptDevice(input, fixed, [preview, fixed], now).state).toBe("FAILED");
  });
});
