import { describe, expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { createBizScriptReleaseService, runPowerShellBundle } from "./biz-script-release.service";

const paths = {
  bundleScriptPath: "D:/repo/scripts/bundle-autojs.ps1",
  outputDir: "D:/repo/apps/api/dist/agent",
  packageBaseUrl: "https://api.example.test/downloads/agent",
  baselineManifestPath: "D:/repo/dist/apk/biz-script-baseline.json"
};
const version = "20260808.020304567";
const fileName = `AgriVideoCollector-biz-scripts-${version}.zip`;
const sha256Text = (text: string) => createHash("sha256").update(text).digest("hex");
const baseline = {
  schemaVersion: 2, channel: "biz-scripts", version: "20260801.000000000", apkBuildId: "APK-FIXTURE",
  files: [{ path: "features/example.js", sha256: "a".repeat(64) }],
  baseFiles: [{ path: "core/helper.js", sha256: "b".repeat(64) }],
  sourceSha256: sha256Text(`features/example.js:${"a".repeat(64)}`),
  baseCompatibilityId: sha256Text(`autojs-biz-v2\ncore/helper.js:${"b".repeat(64)}`)
};
const now = () => new Date("2026-08-08T02:03:04.000Z");

function manifest(sha256 = "a".repeat(64)) {
  return {
    ...baseline,
    version,
    channel: "biz-scripts",
    fileName,
    packageUrl: `${paths.packageBaseUrl}/${fileName}`,
    sha256,
    entryFile: "biz-script-manifest.json",
    status: "PUBLISHED"
  };
}

describe("business script build release", () => {
  test("uses fixed paths, increments the latest version and publishes verified metadata", async () => {
    const calls: Array<[string, unknown]> = [];
    const service = createBizScriptReleaseService({
      paths,
      now,
      getLatestVersion: async () => "20260808.020304566",
      runBundle: async (input) => { calls.push(["bundle", input]); },
      readManifest: async (path) => {
        calls.push(["manifest", path]);
        if (path === paths.baselineManifestPath) return baseline;
        return manifest();
      },
      sha256File: async (path) => {
        calls.push(["sha256", path]);
        return "a".repeat(64);
      },
      publish: async (payload) => ({ id: "version-id", ...payload, idempotent: false }),
      cleanup: async (files) => { calls.push(["cleanup", files]); }
    });

    const result = await service.build({ releaseNote: "后台一键发布" });

    expect(result).toMatchObject({ id: "version-id", version, channel: "biz-scripts" });
    expect(calls.find(([name]) => name === "bundle")).toEqual(["bundle", {
      scriptPath: paths.bundleScriptPath,
      version,
      packageBaseUrl: paths.packageBaseUrl,
      outputDir: paths.outputDir,
      baselineManifestPath: paths.baselineManifestPath
    }]);
    expect(calls.some(([name]) => name === "cleanup")).toBe(false);
  });

  test("rejects a mismatched archive hash and cleans only this build outputs", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    let published = false;
    let cleaned: string[] = [];
    const service = createBizScriptReleaseService({
      paths,
      now,
      getLatestVersion: async () => "20260808.020304566",
      runBundle: async () => undefined,
      readManifest: async (path) => path === paths.baselineManifestPath ? baseline : manifest(),
      sha256File: async () => "b".repeat(64),
      publish: async () => {
        published = true;
        throw new Error("must not publish");
      },
      cleanup: async (files) => {
        cleaned = files;
        throw new Error("cleanup failed");
      }
    });

    await expect(service.build({})).rejects.toThrow("PACKAGE_HASH_MISMATCH");
    expect(published).toBe(false);
    expect(cleaned.map((path) => path.replaceAll("\\", "/"))).toEqual([
      `${paths.outputDir}/${fileName}`,
      `${paths.outputDir}/AgriVideoCollector-biz-scripts-${version}.json`,
      `${paths.outputDir}/${fileName}.sha256`
    ]);
    expect(warning).toHaveBeenCalledTimes(1);
    warning.mockRestore();
  });

  test("creates safe monotonic versions when there is no release history", async () => {
    let latest: string | null = null;
    const published: string[] = [];
    const service = createBizScriptReleaseService({
      paths,
      now: () => new Date("2026-08-08T02:03:04.567Z"),
      getLatestVersion: async () => latest,
      runBundle: async () => undefined,
      readManifest: async (path) => path === paths.baselineManifestPath ? baseline : ({
        ...manifest(),
        version: latest ? "20260808.020304568" : "20260808.020304567",
        fileName: `AgriVideoCollector-biz-scripts-${latest ? "20260808.020304568" : "20260808.020304567"}.zip`,
        packageUrl: `${paths.packageBaseUrl}/AgriVideoCollector-biz-scripts-${latest ? "20260808.020304568" : "20260808.020304567"}.zip`
      }),
      sha256File: async () => "a".repeat(64),
      publish: async (payload) => {
        latest = payload.version;
        published.push(payload.version);
        return { id: payload.version, ...payload, idempotent: false };
      },
      cleanup: async () => undefined
    });

    await service.build({});
    await service.build({});
    expect(published).toEqual(["20260808.020304567", "20260808.020304568"]);
    expect(Number(published[0]!.split(".").at(-1))).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });

  test("terminates a timed-out PowerShell build", async () => {
    const emitter = new EventEmitter();
    const stderr = new EventEmitter();
    let killed = false;
    const child = {
      stderr,
      once: emitter.once.bind(emitter),
      kill: () => {
        killed = true;
        emitter.emit("exit", null);
        return true;
      }
    };

    await expect(runPowerShellBundle({
      scriptPath: paths.bundleScriptPath,
      version,
      packageBaseUrl: paths.packageBaseUrl,
      outputDir: paths.outputDir,
      baselineManifestPath: paths.baselineManifestPath
    }, { spawnProcess: (() => child) as never, timeoutMs: 5 })).rejects.toThrow("BUILD_FAILED");
    expect(killed).toBe(true);
  });

  test("rejects concurrent builds before invoking the bundler", async () => {
    let releaseFirst: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    let runs = 0;
    const service = createBizScriptReleaseService({
      paths,
      now,
      getLatestVersion: async () => "20260808.020304566",
      runBundle: async () => {
        runs += 1;
        markStarted?.();
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      },
      readManifest: async (path) => path === paths.baselineManifestPath ? baseline : manifest(),
      sha256File: async () => "a".repeat(64),
      publish: async (payload) => ({ id: "version-id", ...payload, idempotent: false }),
      cleanup: async () => undefined
    });

    const first = service.build({});
    await started;
    await expect(service.build({})).rejects.toThrow("BUILD_IN_PROGRESS");
    expect(runs).toBe(1);
    releaseFirst?.();
    await first;
  });
});
