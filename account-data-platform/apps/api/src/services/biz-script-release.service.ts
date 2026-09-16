import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bizScriptPathSchema, type BuildBizScriptReleasePayload, type CreateAgentVersionPayload } from "@pkg/types";
import { config } from "../config";
import { findLatestPublishedAgentVersion } from "../repositories/agent-version.repository";
import { publishAgentVersion } from "./agent-version.service";

type BuildPaths = {
  bundleScriptPath: string;
  outputDir: string;
  packageBaseUrl: string;
  baselineManifestPath: string;
};

export type BundleInput = {
  scriptPath: string;
  version: string;
  outputDir: string;
  packageBaseUrl: string;
  files?: string[];
  baseVersion?: string;
  baseManifestPath?: string;
  baselineManifestPath: string;
};

type BuildManifest = {
  version?: unknown;
  channel?: unknown;
  fileName?: unknown;
  packageUrl?: unknown;
  sha256?: unknown;
  entryFile?: unknown;
  status?: unknown;
  mode?: unknown;
  baseVersion?: unknown;
  deltaFiles?: unknown;
  files?: unknown;
  schemaVersion?: unknown;
  apkBuildId?: unknown;
  baseFiles?: unknown;
  sourceSha256?: unknown;
  baseCompatibilityId?: unknown;
};

type ReleaseDeps = {
  paths: BuildPaths;
  now?: () => Date;
  getLatestVersion: () => Promise<string | null>;
  runBundle: (input: BundleInput) => Promise<void>;
  readManifest: (path: string) => Promise<BuildManifest>;
  sha256File: (path: string) => Promise<string>;
  publish: (payload: CreateAgentVersionPayload) => Promise<Record<string, unknown>>;
  cleanup: (files: string[]) => Promise<void>;
};

type BuildReleaseInput = Partial<Pick<BuildBizScriptReleasePayload, "releaseNote" | "forceUpdate" | "files" | "baseVersion">>;

export class BizScriptBuildError extends Error {
  constructor(
    code: "BUILD_IN_PROGRESS" | "BUILD_FAILED" | "MANIFEST_INVALID" | "PACKAGE_HASH_MISMATCH" | "INVALID_FILE_SELECTION" | "BASE_VERSION_REQUIRED" | "BASELINE_INVALID",
    readonly userMessage: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(code);
  }
}

function versionParts(version: string) {
  const parts = version.split(".");
  if (parts.length < 2 || parts.some((part) => !/^\d+$/.test(part) || !Number.isSafeInteger(Number(part)))) {
    throw new Error("Invalid business script version");
  }
  return parts;
}

function compareVersions(left: string, right: string) {
  const a = versionParts(left).map(Number);
  const b = versionParts(right).map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

function nextVersion(latest: string | null, baselineVersion: string, now: Date) {
  const stamp = now.toISOString().replace(/\D/g, "");
  const timestampVersion = `${stamp.slice(0, 8)}.${stamp.slice(8, 17)}`;
  let floor = baselineVersion;
  try {
    if (latest && compareVersions(latest, floor) > 0) floor = latest;
    if (compareVersions(timestampVersion, floor) > 0) return timestampVersion;
  } catch {
    throw new BizScriptBuildError("BUILD_FAILED", "现有业务脚本版本格式不合法，无法生成单调新版本", { latest });
  }
  const parts = versionParts(floor);
  const last = Number(parts.at(-1));
  if (!Number.isSafeInteger(last) || last >= Number.MAX_SAFE_INTEGER) {
    throw new BizScriptBuildError("BUILD_FAILED", "现有业务脚本版本号无法安全递增", { latest });
  }
  parts[parts.length - 1] = String(last + 1).padStart(parts[parts.length - 1]!.length, "0");
  return parts.join(".");
}

function manifestFingerprint(value: unknown, base = false) {
  if (!Array.isArray(value) || !value.length) throw new Error("Manifest file list is required");
  const paths = new Set<string>();
  const lines = value.map((file: unknown) => {
    if (!file || typeof file !== "object" || !("path" in file) || !("sha256" in file)) throw new Error("Invalid manifest file");
    const { path, sha256 } = file;
    const pattern = base
      ? /^(?:(?:app|core|platforms|utils)\/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+)\.js$/
      : /^(features|domain)\/[A-Za-z0-9._/-]+\.js$/;
    if (typeof path !== "string" || !pattern.test(path) || path.includes("..") || path.includes("//")
      || (base ? path === "config.js" : path.endsWith("/config.js")) || paths.has(path)
      || typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Invalid manifest path or SHA-256");
    paths.add(path);
    return { path, sha256 };
  });
  const text = lines.map((file) => `${file.path}:${file.sha256}`).sort().join("\n");
  return createHash("sha256").update(`${base ? "autojs-biz-v2\n" : ""}${text}`).digest("hex");
}

async function readBaseline(deps: ReleaseDeps) {
  try {
    if (!deps.paths.baselineManifestPath) throw new Error("APK baseline path is required");
    const baseline = await deps.readManifest(deps.paths.baselineManifestPath);
    if (baseline.schemaVersion !== 2 || baseline.channel !== "biz-scripts"
      || typeof baseline.version !== "string" || typeof baseline.apkBuildId !== "string" || !baseline.apkBuildId.trim()
      || baseline.sourceSha256 !== manifestFingerprint(baseline.files)
      || baseline.baseCompatibilityId !== manifestFingerprint(baseline.baseFiles, true)) throw new Error("Invalid APK baseline metadata");
    versionParts(baseline.version);
    return baseline as BuildManifest & { version: string; baseCompatibilityId: string };
  } catch (error) {
    throw new BizScriptBuildError("BASELINE_INVALID", "缺少有效的 APK 业务基线，请先完成联合 APK 构建并指定配套基线文件", {
      path: deps.paths.baselineManifestPath,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

function outputFiles(paths: BuildPaths, version: string) {
  const baseName = `AgriVideoCollector-biz-scripts-${version}`;
  return {
    fileName: `${baseName}.zip`,
    zipPath: join(paths.outputDir, `${baseName}.zip`),
    manifestPath: join(paths.outputDir, `${baseName}.json`),
    shaPath: join(paths.outputDir, `${baseName}.zip.sha256`)
  };
}

export function validateBizScriptSelection(files: unknown) {
  if (files === undefined) return undefined;
  if (!Array.isArray(files) || files.length === 0) {
    throw new BizScriptBuildError("INVALID_FILE_SELECTION", "指定业务脚本文件列表不能为空");
  }
  const selected = files.map((file) => {
    const parsed = bizScriptPathSchema.safeParse(file);
    if (!parsed.success) {
      throw new BizScriptBuildError("INVALID_FILE_SELECTION", "业务脚本路径不合法", { file });
    }
    return parsed.data;
  });
  if (new Set(selected).size !== selected.length) {
    throw new BizScriptBuildError("INVALID_FILE_SELECTION", "业务脚本文件列表不能重复");
  }
  return selected;
}

function manifestPaths(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => item && typeof item === "object" && "path" in item ? String(item.path) : "");
}

function assertManifest(
  manifest: BuildManifest,
  paths: BuildPaths,
  version: string,
  fileName: string,
  baseline: BuildManifest,
  selectedFiles?: string[],
  baseVersion?: string
) {
  const expectedUrl = `${paths.packageBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(fileName)}`;
  let fingerprintValid = false;
  try { fingerprintValid = manifest.sourceSha256 === manifestFingerprint(manifest.files); }
  catch { fingerprintValid = false; }
  const invalid = manifest.schemaVersion !== 2
    || manifest.baseCompatibilityId !== baseline.baseCompatibilityId
    || !fingerprintValid
    || manifest.version !== version
    || manifest.channel !== "biz-scripts"
    || manifest.entryFile !== "biz-script-manifest.json"
    || manifest.fileName !== fileName
    || manifest.packageUrl !== expectedUrl
    || manifest.status !== "PUBLISHED"
    || typeof manifest.sha256 !== "string"
    || !/^[0-9a-f]{64}$/i.test(manifest.sha256);
  const partialInvalid = selectedFiles !== undefined && (
    manifest.mode !== "partial"
    || manifest.baseVersion !== baseVersion
    || JSON.stringify(manifestPaths(manifest.deltaFiles)) !== JSON.stringify(selectedFiles)
    || !Array.isArray(manifest.files)
    || !selectedFiles.every((file) => manifestPaths(manifest.files).includes(file))
  );
  const fullInvalid = selectedFiles === undefined && manifest.mode === "partial";
  if (invalid || partialInvalid || fullInvalid) {
    throw new BizScriptBuildError("MANIFEST_INVALID", "业务脚本 manifest 与本次构建不一致", {
      version,
      fileName
    });
  }
  return manifest as Required<Pick<BuildManifest,
    "version" | "channel" | "entryFile" | "fileName" | "packageUrl" | "status" | "sha256">>;
}

export function createBizScriptReleaseService(deps: ReleaseDeps) {
  let building = false;
  return {
    async build(payload: BuildReleaseInput) {
      if (building) {
        throw new BizScriptBuildError("BUILD_IN_PROGRESS", "已有业务脚本正在构建，请稍后重试");
      }
      building = true;
      let files: ReturnType<typeof outputFiles> | null = null;
      try {
        const baseline = await readBaseline(deps);
        const version = nextVersion(await deps.getLatestVersion(), baseline.version, (deps.now ?? (() => new Date()))());
        files = outputFiles(deps.paths, version);
        const selectedFiles = validateBizScriptSelection(payload.files);
        if (selectedFiles !== undefined && !payload.baseVersion) {
          throw new BizScriptBuildError("BASE_VERSION_REQUIRED", "增量业务脚本更新必须指定 baseVersion");
        }
        await deps.runBundle({
          scriptPath: deps.paths.bundleScriptPath,
          version,
          packageBaseUrl: deps.paths.packageBaseUrl,
          outputDir: deps.paths.outputDir,
          baselineManifestPath: deps.paths.baselineManifestPath,
          files: selectedFiles,
          baseVersion: payload.baseVersion,
          baseManifestPath: payload.baseVersion
            ? join(deps.paths.outputDir, `AgriVideoCollector-biz-scripts-${payload.baseVersion}.json`)
            : undefined
        });
        const manifest = assertManifest(
          await deps.readManifest(files.manifestPath),
          deps.paths,
          version,
          files.fileName,
          baseline,
          selectedFiles,
          payload.baseVersion
        );
        const actualSha256 = (await deps.sha256File(files.zipPath)).toLowerCase();
        if (actualSha256 !== String(manifest.sha256).toLowerCase()) {
          throw new BizScriptBuildError("PACKAGE_HASH_MISMATCH", "业务脚本 ZIP 的 SHA-256 与 manifest 不一致", {
            expected: manifest.sha256,
            actual: actualSha256
          });
        }
        return await deps.publish({
          version,
          channel: "biz-scripts",
          packageUrl: String(manifest.packageUrl),
          sha256: actualSha256,
          entryFile: "biz-script-manifest.json",
          releaseNote: payload.releaseNote,
          forceUpdate: payload.forceUpdate ?? false,
          status: "PUBLISHED"
        });
      } catch (error) {
        if (files) {
          try {
            await deps.cleanup([files.zipPath, files.manifestPath, files.shaPath]);
          } catch (cleanupError) {
            console.warn(JSON.stringify({
              scope: "biz-script-release",
              event: "cleanup_failed",
              version: files.fileName,
              error: String(cleanupError instanceof Error ? cleanupError.message : cleanupError)
            }));
          }
        }
        throw error;
      } finally {
        building = false;
      }
    }
  };
}

export async function listBizScriptFiles() {
  const root = resolve(fileURLToPath(new URL("../../../../..", import.meta.url)), "mobile-agent/autojs");
  const result: string[] = [];
  async function visit(relativeRoot: string) {
    const absoluteRoot = join(root, relativeRoot);
    for (const entry of await readdir(absoluteRoot, { withFileTypes: true })) {
      const relative = `${relativeRoot}/${entry.name}`;
      if (entry.isDirectory()) await visit(relative);
      else if (entry.isFile() && relative.endsWith(".js")) result.push(relative);
    }
  }
  await visit("features");
  await visit("domain");
  return result.sort();
}

type BundleChildProcess = {
  stderr: { on: (event: string, listener: (chunk: unknown) => void) => unknown };
  once: (event: string, listener: (value: unknown) => void) => unknown;
  kill: () => unknown;
};

type BundleSpawn = (
  command: string,
  args: string[],
  options: { windowsHide: boolean; stdio: ["ignore", "ignore", "pipe"] }
) => BundleChildProcess;

export function runPowerShellBundle(
  input: BundleInput,
  options: { spawnProcess?: BundleSpawn; timeoutMs?: number } = {}
) {
  return new Promise<void>((resolveRun, rejectRun) => {
    const spawnProcess = options.spawnProcess ?? (spawn as unknown as BundleSpawn);
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy", "Bypass",
      "-File", input.scriptPath,
      "-Version", input.version,
      "-PackageBaseUrl", input.packageBaseUrl,
      "-OutputDir", input.outputDir,
      "-BaselineManifestPath", input.baselineManifestPath
    ];
    if (input.files !== undefined) args.push("-Files", input.files.join(","));
    if (input.baseVersion) args.push("-BaseVersion", input.baseVersion);
    if (input.baseManifestPath) args.push("-BaseManifestPath", input.baseManifestPath);
    const child = spawnProcess("powershell.exe", args, { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectRun(new BizScriptBuildError(
        "BUILD_FAILED",
        "业务脚本构建超时，已终止构建进程",
        { timeoutMs: options.timeoutMs ?? 300_000 }
      ));
    }, options.timeoutMs ?? 300_000);
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      rejectRun(error);
    };
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", (error) => rejectOnce(new BizScriptBuildError(
      "BUILD_FAILED",
      "无法启动业务脚本构建器",
      { reason: error instanceof Error ? error.message : String(error) }
    )));
    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolveRun();
      else rejectRun(new BizScriptBuildError(
        "BUILD_FAILED",
        "业务脚本构建失败",
        { exitCode: code, reason: stderr.trim().slice(-1000) }
      ));
    });
  });
}

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const productionPaths: BuildPaths = {
  bundleScriptPath: join(repositoryRoot, "scripts", "bundle-autojs.ps1"),
  outputDir: resolve(process.cwd(), config.agentDownloadDir),
  baselineManifestPath: process.env.BIZ_SCRIPT_BASELINE_MANIFEST
    ? resolve(process.env.BIZ_SCRIPT_BASELINE_MANIFEST)
    : join(repositoryRoot, "dist", "apk", "biz-script-baseline.json"),
  packageBaseUrl: `${config.publicBaseUrl.replace(/\/$/, "")}/downloads/agent`
};

export const bizScriptReleaseService = createBizScriptReleaseService({
  paths: productionPaths,
  getLatestVersion: async () => (await findLatestPublishedAgentVersion("biz-scripts"))?.version ?? null,
  runBundle: async (input) => {
    await mkdir(input.outputDir, { recursive: true });
    await runPowerShellBundle(input);
  },
  readManifest: async (path) => JSON.parse(await readFile(path, "utf8")) as BuildManifest,
  sha256File: async (path) => createHash("sha256").update(await readFile(path)).digest("hex"),
  publish: publishAgentVersion,
  cleanup: async (files) => { await Promise.all(files.map((path) => rm(path, { force: true }))); }
});
