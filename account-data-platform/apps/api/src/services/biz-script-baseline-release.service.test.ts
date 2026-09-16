import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { createBizScriptReleaseService, runPowerShellBundle } from "./biz-script-release.service";

const paths = {
  bundleScriptPath: "D:/fixture/bundle-autojs.ps1",
  outputDir: "D:/fixture/output",
  packageBaseUrl: "https://example.test/downloads/agent",
  baselineManifestPath: "D:/fixture/confirmed-apk/baseline.json"
};
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const files = [{ path: "features/example.js", sha256: "a".repeat(64) }];
const baseFiles = [{ path: "core/helper.js", sha256: "b".repeat(64) }];
const baseline = {
  schemaVersion: 2, channel: "biz-scripts", version: "20260910.100000000", apkBuildId: "APK-FIXTURE",
  files, baseFiles,
  sourceSha256: hash(`features/example.js:${"a".repeat(64)}`),
  baseCompatibilityId: hash(`autojs-biz-v2\ncore/helper.js:${"b".repeat(64)}`)
};

function setup(latest: string | null, savedBaseline: unknown = baseline, manifestOverride: Record<string, unknown> = {}) {
  const calls: { bundle: unknown[]; publish: unknown[]; cleanup: unknown[] } = { bundle: [], publish: [], cleanup: [] };
  let allocatedVersion = "";
  const service = createBizScriptReleaseService({
    paths,
    now: () => new Date("2026-09-10T09:00:00.000Z"),
    getLatestVersion: async () => latest,
    runBundle: async (input) => { allocatedVersion = input.version; calls.bundle.push(input); },
    readManifest: async (filePath) => {
      if (filePath === paths.baselineManifestPath) {
        if (savedBaseline instanceof Error) throw savedBaseline;
        return savedBaseline as never;
      }
      const fileName = `AgriVideoCollector-biz-scripts-${allocatedVersion}.zip`;
      return {
        ...baseline, version: allocatedVersion, fileName, mode: "full",
        packageUrl: `${paths.packageBaseUrl}/${fileName}`, sha256: "c".repeat(64),
        entryFile: "biz-script-manifest.json", status: "PUBLISHED", ...manifestOverride
      };
    },
    sha256File: async () => "c".repeat(64),
    publish: async (payload) => { calls.publish.push(payload); return { ...payload }; },
    cleanup: async (output) => { calls.cleanup.push(output); }
  });
  return { service, calls };
}

describe("APK baseline release contract", () => {
  test("allocates above the APK baseline when historical releases are older", async () => {
    const { service, calls } = setup("1.3.11.20260804144731");
    const result = await service.build({});
    expect(result.version).toBe("20260910.100000001");
    expect(calls.bundle[0]).toMatchObject({ baselineManifestPath: paths.baselineManifestPath });
  });

  test("allocates above the latest published release when it is newer than the baseline", async () => {
    const { service } = setup("20260910.110000005");
    expect((await service.build({})).version).toBe("20260910.110000006");
  });

  test("rejects missing, legacy and forged baselines before invoking the bundler", async () => {
    for (const invalid of [new Error("ENOENT"), {}, { ...baseline, schemaVersion: 1 }, { ...baseline, baseCompatibilityId: "0".repeat(64) }]) {
      const { service, calls } = setup(null, invalid);
      await expect(service.build({})).rejects.toThrow("BASELINE_INVALID");
      expect(calls.bundle).toHaveLength(0);
      expect(calls.publish).toHaveLength(0);
      expect(calls.cleanup).toHaveLength(0);
    }
  });

  test("passes the exact verified APK baseline to the child process", async () => {
    const emitter = new EventEmitter();
    let argumentsSent: string[] = [];
    const promise = runPowerShellBundle({
      scriptPath: paths.bundleScriptPath, version: "20260910.100000001",
      packageBaseUrl: paths.packageBaseUrl, outputDir: paths.outputDir,
      baselineManifestPath: paths.baselineManifestPath
    }, { spawnProcess: ((_command: string, args: string[]) => {
      argumentsSent = args;
      return { stderr: new EventEmitter(), once: emitter.once.bind(emitter), kill: () => true };
    }) as never });
    emitter.emit("exit", 0);
    await promise;
    expect(argumentsSent.slice(-2)).toEqual(["-BaselineManifestPath", paths.baselineManifestPath]);
  });

  test("rejects a built package with another base or an incorrect business fingerprint", async () => {
    for (const invalid of [{ baseCompatibilityId: "0".repeat(64) }, { sourceSha256: "0".repeat(64) }, { schemaVersion: 1 }]) {
      const { service, calls } = setup(null, baseline, invalid);
      await expect(service.build({})).rejects.toThrow("MANIFEST_INVALID");
      expect(calls.publish).toHaveLength(0);
      expect(calls.cleanup).toHaveLength(1);
    }
  });

  test("accepts a canonical inventory with prefixed file names", async () => {
    const businessFiles = [
      { path: "features/example.js", sha256: "a".repeat(64) },
      { path: "features/example.js.extra.js", sha256: "b".repeat(64) }
    ];
    const canonical = {
      ...baseline, files: businessFiles,
      sourceSha256: hash(`features/example.js.extra.js:${"b".repeat(64)}\nfeatures/example.js:${"a".repeat(64)}`)
    };
    const { service } = setup(null, canonical, { files: businessFiles, sourceSha256: canonical.sourceSha256 });
    expect((await service.build({})).version).toBe("20260910.100000001");
  });
});
