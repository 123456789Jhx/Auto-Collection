import { createHash } from "node:crypto";
import { parse } from "acorn";
import { zipSync } from "fflate";
import { z } from "zod";
import { bizScriptUploadLimits as limits, type BizScriptBaseline, type BizScriptFileHash } from "@pkg/types";

export class BizScriptWorkspaceError extends Error {
  constructor(code: string, readonly userMessage: string, readonly status: 400 | 404 | 409 | 413 | 503 = 400) {
    super(code);
  }
}

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const shaSchema = z.string().regex(/^[0-9a-f]{64}$/);
const versionSchema = z.string().max(64).regex(/^\d+(?:\.\d+)+$/)
  .refine((v) => v.split(".").every((part) => Number.isSafeInteger(Number(part))));
const fileHashSchema = z.object({ path: z.string().max(240), sha256: shaSchema }).strict();
const inputSchema = z.object({
  baselineVersion: versionSchema,
  baseCompatibilityId: shaSchema,
  baseFiles: z.array(fileHashSchema).max(2000),
  files: z.array(z.object({ path: z.string().max(240), content: z.string() }).strict()).min(1).max(limits.maxFiles),
  releaseNote: z.string().max(5000).optional()
}).strict();
const baselineSchema = z.object({
  schemaVersion: z.literal(2), channel: z.literal("biz-scripts"), version: versionSchema,
  apkBuildId: z.string().trim().min(1).max(200), baseCompatibilityId: shaSchema, sourceSha256: shaSchema,
  files: z.array(fileHashSchema).min(1).max(limits.maxFiles), baseFiles: z.array(fileHashSchema).min(1).max(2000)
});

function allowedPath(path: string, base: boolean) {
  const pattern = base ? /^(?:(?:app|core|platforms|utils)\/)?[A-Za-z0-9._/-]+\.js$/ : /^(features|domain)\/[A-Za-z0-9._/-]+\.js$/;
  return pattern.test(path) && !path.split("/").some((part) => !part || part === "." || part === "..")
    && !/(^|\/)config\.js$/i.test(path)
    && (!base || !path.includes("/") || /^(app|core|platforms|utils)\//.test(path));
}

function inventory(files: BizScriptFileHash[], base = false) {
  const paths = new Set<string>();
  for (const file of files) {
    const key = file.path.toLowerCase();
    if (!allowedPath(file.path, base) || paths.has(key)) throw new Error("Invalid inventory path");
    paths.add(key);
  }
  return hash(`${base ? "autojs-biz-v2\n" : ""}${files.map((f) => `${f.path}:${f.sha256}`).sort().join("\n")}`);
}

export function validateBizScriptBaseline(value: unknown): BizScriptBaseline {
  try {
    const baseline = baselineSchema.parse(value);
    if (inventory(baseline.files) !== baseline.sourceSha256 || inventory(baseline.baseFiles, true) !== baseline.baseCompatibilityId) {
      throw new Error("Fingerprint mismatch");
    }
    return baseline;
  } catch {
    throw new BizScriptWorkspaceError("BASELINE_INVALID", "缺少有效 APK 配套基线，需完成联合构建并配置基线文件", 503);
  }
}

function compareVersions(left: string, right: string) {
  const a = versionSchema.parse(left).split(".").map(Number), b = versionSchema.parse(right).split(".").map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

export function nextBizScriptVersion(previous: string[], baseline: string, now: Date) {
  try {
    const stamp = now.toISOString().replace(/\D/g, "");
    const candidate = `${stamp.slice(0, 8)}.${stamp.slice(8, 17)}`;
    const floor = previous.reduce((max, v) => compareVersions(v, max) > 0 ? v : max, baseline);
    if (compareVersions(candidate, floor) > 0) return candidate;
    const parts = floor.split(".");
    const last = Number(parts.at(-1)) + 1;
    if (!Number.isSafeInteger(last)) throw new Error("Overflow");
    parts[parts.length - 1] = String(last).padStart(parts.at(-1)!.length, "0");
    return versionSchema.parse(parts.join("."));
  } catch {
    throw new BizScriptWorkspaceError("VERSION_INVALID", "现有业务版本无法安全递增", 409);
  }
}

export function createBizScriptArtifact(value: unknown, baselineValue: BizScriptBaseline, version: string) {
  const baseline = validateBizScriptBaseline(baselineValue);
  const parsed = inputSchema.safeParse(value);
  if (!parsed.success) throw new BizScriptWorkspaceError("INVALID_SOURCE", "业务目录或上传内容格式不正确");
  const input = parsed.data;
  let baseMatches = false;
  try { baseMatches = input.baseFiles.length > 0 && inventory(input.baseFiles, true) === baseline.baseCompatibilityId; } catch { /* Rejected below. */ }
  if (input.baselineVersion !== baseline.version || input.baseCompatibilityId !== baseline.baseCompatibilityId || !baseMatches) {
    throw new BizScriptWorkspaceError("BASE_MISMATCH", "本机基座文件与 APK 不一致，需联合构建 APK 后再更新", 409);
  }
  if (compareVersions(version, baseline.version) <= 0) throw new BizScriptWorkspaceError("VERSION_INVALID", "业务版本必须高于 APK 基线", 409);
  const entries: Record<string, Uint8Array> = Object.create(null);
  const files: BizScriptFileHash[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const { path, content } of input.files) {
    if (!allowedPath(path, false) || seen.has(path.toLowerCase())) throw new BizScriptWorkspaceError("INVALID_SOURCE", `业务路径无效或重复：${path}`);
    seen.add(path.toLowerCase());
    const bytes = Buffer.from(content, "utf8");
    total += bytes.length;
    if (bytes.length > limits.maxFileBytes || total > limits.maxTotalBytes) throw new BizScriptWorkspaceError("SOURCE_TOO_LARGE", "业务脚本超过大小限制", 413);
    if (content.charCodeAt(0) === 0xfeff || bytes.toString("utf8") !== content) throw new BizScriptWorkspaceError("INVALID_SOURCE", `文件不是无 BOM 的有效 UTF-8：${path}`);
    try { parse(content, { ecmaVersion: 5, sourceType: "script", allowReturnOutsideFunction: true }); }
    catch { throw new BizScriptWorkspaceError("INVALID_SOURCE", `业务脚本语法不兼容：${path}`); }
    entries[path] = bytes;
    files.push({ path, sha256: hash(bytes) });
  }
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const sourceSha256 = inventory(files);
  const old = new Map(baseline.files.map((f) => [f.path, f.sha256]));
  const current = new Set(files.map((f) => f.path));
  const changes = {
    added: files.filter((f) => !old.has(f.path)).map((f) => f.path),
    modified: files.filter((f) => old.has(f.path) && old.get(f.path) !== f.sha256).map((f) => f.path),
    removed: baseline.files.filter((f) => !current.has(f.path)).map((f) => f.path).sort()
  };
  const manifest = { schemaVersion: 2, channel: "biz-scripts", version, mode: "full", files,
    apkBuildId: baseline.apkBuildId, baseCompatibilityId: baseline.baseCompatibilityId, sourceSha256 };
  entries["biz-script-manifest.json"] = Buffer.from(JSON.stringify(manifest), "utf8");
  const bytes = zipSync(entries, { level: 6, mtime: new Date("2000-01-01T00:00:00Z") });
  return { bytes, packageSha256: hash(bytes), sourceSha256, files, changes, releaseNote: input.releaseNote ?? "" };
}
