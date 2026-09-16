import { describe, expect, test } from "bun:test";
import type { BizScriptDevice, BizScriptPreview } from "@pkg/types";
import { selectScopedBizScriptPreview } from "./biz-script-delivery.service";

const device: BizScriptDevice = {
  deviceId: "device-1", deviceCode: "phone-1", deviceName: null, enabled: true,
  lastHeartbeatAt: "2026-09-10T10:00:00Z", currentVersion: "20260910.1", pendingVersion: null,
  source: "baseline", baseCompatibilityId: "a".repeat(64), sourceSha256: "b".repeat(64),
  hotUpdateAllowed: true, fresh: true, targetVersion: null, state: "READY", eventMessage: null
};
function preview(version: string, overrides: Partial<BizScriptPreview> = {}): BizScriptPreview {
  return {
    id: version, version, stage: "TESTING", revision: 2, baselineVersion: "20260910.1",
    apkBuildId: "APK-1", baseCompatibilityId: "a".repeat(64), sourceSha256: "c".repeat(64),
    packageSha256: "d".repeat(64), sizeBytes: 100, files: [],
    changes: { added: [], modified: [], removed: [] }, releaseNote: "",
    createdAt: "2026-09-10T09:00:00Z", testDeviceIds: ["device-1"], deviceIds: [], ...overrides
  };
}

describe("scoped business delivery", () => {
  test("chooses the numerically newest compatible version in explicit scope", () => {
    const releases = [preview("20260910.10"), preview("20260910.9"), preview("20260910.99", { testDeviceIds: ["other"] })];
    expect(selectScopedBizScriptPreview(releases, device, "20260910.1")?.version).toBe("20260910.10");
  });
  test("never offers draft, revoked, empty-scope, incompatible or older versions", () => {
    const releases = [
      preview("20260910.10", { stage: "DRAFT" }), preview("20260910.11", { stage: "REVOKED" }),
      preview("20260910.12", { testDeviceIds: [] }), preview("20260910.13", { baseCompatibilityId: "other" }),
      preview("20260910.1")
    ];
    expect(selectScopedBizScriptPreview(releases, device, "20260910.1")).toBeNull();
  });
  test("blocks disabled, stale and hot-update-ineligible devices", () => {
    for (const patch of [{ enabled: false }, { fresh: false }, { hotUpdateAllowed: false }]) {
      expect(selectScopedBizScriptPreview([preview("20260910.10")], { ...device, ...patch }, "20260910.1")).toBeNull();
    }
  });
  test("cannot downgrade below actual runtime even when query current version is stale", () => {
    expect(selectScopedBizScriptPreview([preview("20260910.10")], { ...device, currentVersion: "20260910.20" }, "20260910.1")).toBeNull();
  });
  test("promoted versions retain explicit trial devices and add selected promotion devices", () => {
    const release = preview("20260910.10", { stage: "PROMOTED", deviceIds: ["device-2"] });
    expect(selectScopedBizScriptPreview([release], device, "20260910.1")?.version).toBe("20260910.10");
    expect(selectScopedBizScriptPreview([release], { ...device, deviceId: "device-2" }, "20260910.1")?.version).toBe("20260910.10");
    expect(selectScopedBizScriptPreview([release], { ...device, deviceId: "device-3" }, "20260910.1")).toBeNull();
  });
});
