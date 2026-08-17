import { describe, expect, spyOn, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createBizScriptReleaseService, runPowerShellBundle } from "./biz-script-release.service";

const paths = {
  bundleScriptPath: "D:/repo/scripts/bundle-autojs.ps1",
  outputDir: "D:/repo/apps/api/dist/agent",
  packageBaseUrl: "https://api.example.test/downloads/agent"
};
const version = "1.3.11.20260804144731";
const fileName = `AgriVideoCollector-biz-scripts-${version}.zip`;

function manifest(sha256 = "a".repeat(64)) {
  return {
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
      getLatestVersion: async () => "1.3.11.20260804144730",
      runBundle: async (input) => { calls.push(["bundle", input]); },
      readManifest: async (path) => {
        calls.push(["manifest", path]);
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
    expect(calls[0]).toEqual(["bundle", {
      scriptPath: paths.bundleScriptPath,
      version,
      packageBaseUrl: paths.packageBaseUrl,
      outputDir: paths.outputDir
    }]);
    expect(calls.some(([name]) => name === "cleanup")).toBe(false);
  });

  test("rejects a mismatched archive hash and cleans only this build outputs", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => undefined);
    let published = false;
    let cleaned: string[] = [];
    const service = createBizScriptReleaseService({
      paths,
      getLatestVersion: async () => "1.3.11.20260804144730",
      runBundle: async () => undefined,
      readManifest: async () => manifest(),
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
      readManifest: async () => ({
        ...manifest(),
        version: latest ? "1.0.20260808020305" : "1.0.20260808020304",
        fileName: `AgriVideoCollector-biz-scripts-${latest ? "1.0.20260808020305" : "1.0.20260808020304"}.zip`,
        packageUrl: `${paths.packageBaseUrl}/AgriVideoCollector-biz-scripts-${latest ? "1.0.20260808020305" : "1.0.20260808020304"}.zip`
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
    expect(published).toEqual(["1.0.20260808020304", "1.0.20260808020305"]);
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
      outputDir: paths.outputDir
    }, { spawnProcess: (() => child) as never, timeoutMs: 5 })).rejects.toThrow("BUILD_FAILED");
    expect(killed).toBe(true);
  });

  test("rejects concurrent builds before invoking the bundler", async () => {
    let releaseFirst: (() => void) | undefined;
    let runs = 0;
    const service = createBizScriptReleaseService({
      paths,
      getLatestVersion: async () => "1.3.11.20260804144730",
      runBundle: async () => {
        runs += 1;
        await new Promise<void>((resolve) => { releaseFirst = resolve; });
      },
      readManifest: async () => manifest(),
      sha256File: async () => "a".repeat(64),
      publish: async (payload) => ({ id: "version-id", ...payload, idempotent: false }),
      cleanup: async () => undefined
    });

    const first = service.build({});
    await Promise.resolve();
    await expect(service.build({})).rejects.toThrow("BUILD_IN_PROGRESS");
    expect(runs).toBe(1);
    releaseFirst?.();
    await first;
  });
});
