import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { BizScriptBaseline, BizScriptDevice, BizScriptPreview } from "@pkg/types";
import * as workspace from "./biz-script-workspace.service";

function harness() {
  const hash = (s: string) => createHash("sha256").update(s).digest("hex");
  const files = [{ path: "features/a.js", sha256: hash("module.exports = 1;") }];
  const baseFiles = [{ path: "core/a.js", sha256: hash("core") }];
  const baseline: BizScriptBaseline = { schemaVersion: 2, channel: "biz-scripts", version: "20260910.1", apkBuildId: "apk",
    files, baseFiles, sourceSha256: hash(`${files[0]!.path}:${files[0]!.sha256}`),
    baseCompatibilityId: hash(`autojs-biz-v2\n${baseFiles[0]!.path}:${baseFiles[0]!.sha256}`) };
  const records = new Map<string, BizScriptPreview & { archiveBase64: string }>();
  const devices: BizScriptDevice[] = [{ deviceId: "dev-1", deviceCode: "phone-1", deviceName: "test",
    enabled: true, fresh: true, lastHeartbeatAt: new Date().toISOString(), currentVersion: baseline.version,
    pendingVersion: null, source: "baseline", baseCompatibilityId: baseline.baseCompatibilityId,
    sourceSha256: baseline.sourceSha256, hotUpdateAllowed: true, targetVersion: null, state: "READY", eventMessage: null }];
  let validBaseline = true;
  const service = workspace.createBizScriptWorkspaceService({
    readBaseline: async () => { if (!validBaseline) throw new Error("not configured"); return baseline; },
    listPreviews: async () => [...records.values()],
    listPreviousVersions: async () => [...records.values()].map((r) => r.version),
    getPreview: async (id: string) => records.get(id) ?? null,
    savePreview: async (p: BizScriptPreview & { archiveBase64: string }) => { records.set(p.id, p); },
    transitionPreview: async (id: string, revision: number, stage: BizScriptPreview["stage"], testDeviceIds: string[], deviceIds: string[]) => {
      const p = records.get(id)!;
      if (revision !== p.revision) throw new Error("REVISION_CONFLICT");
      const next = { ...p, revision: revision + 1, stage, testDeviceIds, deviceIds };
      records.set(id, next); return next;
    },
    listDevices: async () => devices,
    now: () => new Date("2026-09-10T10:00:00Z")
  });
  const input = { baselineVersion: baseline.version, baseCompatibilityId: baseline.baseCompatibilityId,
    baseFiles, files: [{ path: "features/a.js", content: "module.exports = 2;" }] };
  return { service, records, devices, input, missingBaseline: () => { validBaseline = false; } };
}

test("workspace factory is available", () => expect(typeof workspace.createBizScriptWorkspaceService).toBe("function"));
test("preview is immutable DRAFT and never exposes the archived source", async () => {
  const f = harness();
  const preview = await f.service.preview(f.input, "operator");
  expect(preview.stage).toBe("DRAFT");
  expect(preview.deviceIds).toEqual([]);
  expect("archiveBase64" in preview).toBe(false);
  expect(await f.service.download(preview.id, preview.packageSha256)).toBeNull();
});
test("missing baseline disables workspace and prevents saving drafts", async () => {
  const f = harness(); f.missingBaseline();
  expect((await f.service.workspace()).ready).toBe(false);
  await expect(f.service.preview(f.input, "operator")).rejects.toThrow("BASELINE_INVALID");
  expect(f.records.size).toBe(0);
});
test("rejects empty unknown disabled stale and incompatible scopes", async () => {
  const f = harness(), p = await f.service.preview(f.input, "operator");
  for (const deviceIds of [[], ["not-owned"], ["dev-1", "dev-1"]]) {
    await expect(f.service.test(p.id, { revision: 0, deviceIds }, "operator")).rejects.toThrow("INVALID_SCOPE");
  }
  for (const patch of [{ enabled: false }, { fresh: false }, { baseCompatibilityId: "bad" }, { hotUpdateAllowed: false }]) {
    const old = { ...f.devices[0]! }; Object.assign(f.devices[0]!, patch);
    await expect(f.service.test(p.id, { revision: 0, deviceIds: ["dev-1"] }, "operator")).rejects.toThrow("DEVICE_NOT_READY");
    Object.assign(f.devices[0]!, old);
  }
});
test("promotion requires real overlay fingerprint, not APPLIED or a pending version", async () => {
  const f = harness(), p = await f.service.preview(f.input, "operator");
  const tested = await f.service.test(p.id, { revision: 0, deviceIds: ["dev-1"] }, "operator");
  f.devices[0]!.pendingVersion = p.version;
  f.devices[0]!.state = "PENDING_RESTART";
  await expect(f.service.promote(p.id, { revision: tested.revision, deviceIds: ["dev-1"] }, "operator")).rejects.toThrow("TEST_NOT_VERIFIED");
  Object.assign(f.devices[0]!, { source: "overlay", currentVersion: p.version, sourceSha256: "wrong" });
  await expect(f.service.promote(p.id, { revision: tested.revision, deviceIds: ["dev-1"] }, "operator")).rejects.toThrow("TEST_NOT_VERIFIED");
  f.devices[0]!.sourceSha256 = p.sourceSha256;
  const promoted = await f.service.promote(p.id, { revision: tested.revision, deviceIds: ["dev-1"] }, "operator");
  expect(promoted.stage).toBe("PROMOTED");
  expect(promoted.deviceIds).toEqual(["dev-1"]);
  expect(await f.service.download(p.id, "wrong")).toBeNull();
  expect(await f.service.download(p.id, p.packageSha256)).toBeInstanceOf(Uint8Array);
});
test("revocation stops downloads, rejects stale revision and cannot be republished", async () => {
  const f = harness(), p = await f.service.preview(f.input, "operator");
  await f.service.test(p.id, { revision: 0, deviceIds: ["dev-1"] }, "operator");
  await expect(f.service.revoke(p.id, 0, "operator")).rejects.toThrow("REVISION_CONFLICT");
  await f.service.revoke(p.id, 1, "operator");
  expect(await f.service.download(p.id, p.packageSha256)).toBeNull();
  await expect(f.service.test(p.id, { revision: 2, deviceIds: ["dev-1"] }, "operator")).rejects.toThrow("INVALID_STAGE");
});
