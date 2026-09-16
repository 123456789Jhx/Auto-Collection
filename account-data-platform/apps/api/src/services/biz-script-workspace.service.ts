import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { bizScriptUploadLimits, type BizScriptBaseline, type BizScriptDevice, type BizScriptPreview,
  type BizScriptScopeInput, type BizScriptStage, type BizScriptWorkspace } from "@pkg/types";
import { BizScriptWorkspaceError, createBizScriptArtifact, nextBizScriptVersion, validateBizScriptBaseline } from "./biz-script-artifact";

type Stored = BizScriptPreview & { archiveBase64: string };
type Deps = {
  readBaseline: () => Promise<unknown>;
  listPreviews: () => Promise<BizScriptPreview[]>;
  listPreviousVersions: () => Promise<string[]>;
  getPreview: (id: string) => Promise<Stored | null>;
  savePreview: (preview: Stored, actor: string) => Promise<void>;
  transitionPreview: (id: string, revision: number, stage: BizScriptStage, testDeviceIds: string[], deviceIds: string[], actor: string) => Promise<BizScriptPreview>;
  listDevices: () => Promise<BizScriptDevice[]>;
  now?: () => Date;
};
const scopeSchema = z.object({ revision: z.number().int().nonnegative(),
  deviceIds: z.array(z.string().min(1).max(100)).min(1).max(500).refine((ids) => new Set(ids).size === ids.length) }).strict();

function publicPreview(preview: BizScriptPreview): BizScriptPreview {
  // Keep archive bytes private even when an injected repository returns a stored row.
  const { id, version, stage, revision, baselineVersion, apkBuildId, baseCompatibilityId, sourceSha256,
    packageSha256, sizeBytes, files, changes, releaseNote, createdAt, testDeviceIds, deviceIds } = preview;
  return { id, version, stage, revision, baselineVersion, apkBuildId, baseCompatibilityId, sourceSha256,
    packageSha256, sizeBytes, files, changes, releaseNote, createdAt, testDeviceIds, deviceIds };
}

export function createBizScriptWorkspaceService(deps: Deps) {
  async function baseline(): Promise<BizScriptBaseline> {
    try { return validateBizScriptBaseline(await deps.readBaseline()); }
    catch { throw new BizScriptWorkspaceError("BASELINE_INVALID", "缺少有效 APK 配套基线，需完成联合构建并配置基线文件", 503); }
  }
  async function existing(id: string, revision: number) {
    const p = await deps.getPreview(id);
    if (!p) throw new BizScriptWorkspaceError("NOT_FOUND", "待发布版本不存在", 404);
    if (!Number.isInteger(revision) || revision < 0 || p.revision !== revision) throw new BizScriptWorkspaceError("REVISION_CONFLICT", "版本状态已改变，请刷新后重试", 409);
    return p;
  }
  async function scope(p: BizScriptPreview, input: BizScriptScopeInput) {
    if (!scopeSchema.safeParse(input).success) throw new BizScriptWorkspaceError("INVALID_SCOPE", "请选择不重复的设备范围");
    if ((await baseline()).baseCompatibilityId !== p.baseCompatibilityId) throw new BizScriptWorkspaceError("BASE_MISMATCH", "APK 基座已改变，请重新预览", 409);
    const all = await deps.listDevices();
    const selected = input.deviceIds.map((id) => all.find((d) => d.deviceId === id));
    if (selected.some((d) => !d)) throw new BizScriptWorkspaceError("INVALID_SCOPE", "设备不存在或不属于当前范围");
    if (selected.some((d) => !d!.enabled || !d!.fresh || !d!.hotUpdateAllowed || d!.baseCompatibilityId !== p.baseCompatibilityId)) {
      throw new BizScriptWorkspaceError("DEVICE_NOT_READY", "所选设备离线、未启用或 APK 基座不兼容", 409);
    }
    return all;
  }
  async function transition(p: BizScriptPreview, stage: BizScriptStage, tests: string[], devices: string[], actor: string) {
    try { return publicPreview(await deps.transitionPreview(p.id, p.revision, stage, tests, devices, actor)); }
    catch (error) {
      if (error instanceof Error && error.message === "REVISION_CONFLICT") throw new BizScriptWorkspaceError("REVISION_CONFLICT", "版本状态已改变，请刷新后重试", 409);
      throw error;
    }
  }
  return {
    async workspace(): Promise<BizScriptWorkspace> {
      try { return { ready: true, reason: null, baseline: await baseline(), limits: bizScriptUploadLimits }; }
      catch (error) { return { ready: false, reason: (error as BizScriptWorkspaceError).userMessage, baseline: null, limits: bizScriptUploadLimits }; }
    },
    async list() { return (await deps.listPreviews()).map(publicPreview); },
    devices: deps.listDevices,
    async preview(input: unknown, actor: string) {
      const base = await baseline();
      for (let attempt = 0; attempt < 3; attempt++) {
        const version = nextBizScriptVersion(await deps.listPreviousVersions(), base.version, (deps.now ?? (() => new Date()))());
        const result = createBizScriptArtifact(input, base, version);
        const p: Stored = { id: randomUUID(), version, stage: "DRAFT", revision: 0, baselineVersion: base.version,
          apkBuildId: base.apkBuildId, baseCompatibilityId: base.baseCompatibilityId, sourceSha256: result.sourceSha256,
          packageSha256: result.packageSha256, sizeBytes: result.bytes.length, files: result.files, changes: result.changes,
          releaseNote: result.releaseNote, createdAt: (deps.now ?? (() => new Date()))().toISOString(),
          testDeviceIds: [], deviceIds: [], archiveBase64: Buffer.from(result.bytes).toString("base64") };
        try { await deps.savePreview(p, actor); return publicPreview(p); }
        catch (error) { if (!(error instanceof Error) || error.message !== "VERSION_CONFLICT") throw error; }
      }
      throw new BizScriptWorkspaceError("VERSION_CONFLICT", "同时有其他版本提交，请稍后重试", 409);
    },
    async test(id: string, input: BizScriptScopeInput, actor: string) {
      const p = await existing(id, input.revision);
      if (p.stage !== "DRAFT") throw new BizScriptWorkspaceError("INVALID_STAGE", "该版本不处于待试运行状态", 409);
      await scope(p, input);
      return transition(p, "TESTING", input.deviceIds, [], actor);
    },
    async promote(id: string, input: BizScriptScopeInput, actor: string) {
      const p = await existing(id, input.revision);
      if (p.stage !== "TESTING") throw new BizScriptWorkspaceError("INVALID_STAGE", "该版本不处于试运行状态", 409);
      const devices = await scope(p, input);
      const verified = p.testDeviceIds.length > 0 && p.testDeviceIds.every((id) => {
        const d = devices.find((device) => device.deviceId === id);
        return d?.enabled && d.fresh && d.hotUpdateAllowed && d.source === "overlay"
          && d.currentVersion === p.version && d.sourceSha256 === p.sourceSha256 && d.baseCompatibilityId === p.baseCompatibilityId;
      });
      if (!verified) throw new BizScriptWorkspaceError("TEST_NOT_VERIFIED", "试运行设备尚未确认加载该版本及文件指纹", 409);
      return transition(p, "PROMOTED", p.testDeviceIds, [...new Set([...p.testDeviceIds, ...input.deviceIds])], actor);
    },
    async revoke(id: string, revision: number, actor: string) {
      const p = await existing(id, revision);
      if (p.stage === "REVOKED") throw new BizScriptWorkspaceError("INVALID_STAGE", "该版本已撤回", 409);
      return transition(p, "REVOKED", p.testDeviceIds, p.deviceIds, actor);
    },
    async download(id: string, sha256: string) {
      const p = await deps.getPreview(id);
      if (!p || !["TESTING", "PROMOTED"].includes(p.stage) || p.packageSha256 !== sha256) return null;
      const bytes = Buffer.from(p.archiveBase64, "base64");
      if (bytes.length !== p.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== p.packageSha256) {
        throw new BizScriptWorkspaceError("ARCHIVE_INVALID", "业务归档校验失败", 503);
      }
      return bytes;
    }
  };
}
