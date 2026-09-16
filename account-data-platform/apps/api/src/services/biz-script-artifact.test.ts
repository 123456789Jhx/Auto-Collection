import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { unzipSync, strFromU8 } from "fflate";
import { createRequire } from "node:module";
import type { BizScriptBaseline, BizScriptPreviewInput } from "@pkg/types";
import * as artifact from "./biz-script-artifact";

const hash = (text: string | Uint8Array) => createHash("sha256").update(text).digest("hex");
export function fixture() {
  const files = [{ path: "features/entry.js", sha256: hash("module.exports = 1;") },
    { path: "domain/removed.js", sha256: hash("module.exports = 0;") }];
  const baseFiles = [{ path: "core/example.js", sha256: hash("core") }];
  const baseline: BizScriptBaseline = { schemaVersion: 2, channel: "biz-scripts", version: "20260910.100000000",
    apkBuildId: "apk-fixture", files, baseFiles,
    sourceSha256: hash(files.map((f) => `${f.path}:${f.sha256}`).sort().join("\n")),
    baseCompatibilityId: hash(`autojs-biz-v2\n${baseFiles[0]!.path}:${baseFiles[0]!.sha256}`) };
  const input: BizScriptPreviewInput = { baselineVersion: baseline.version, baseCompatibilityId: baseline.baseCompatibilityId,
    baseFiles, files: [{ path: "features/entry.js", content: "module.exports = 2;" },
      { path: "domain/new.js", content: "module.exports = '中文';" }] };
  return { baseline, input };
}

describe("portable full business artifact", () => {
  test("produces only approved files with hashes accepted by the real mobile policy", () => {
    expect(typeof artifact.createBizScriptArtifact).toBe("function");
    const { baseline, input } = fixture();
    const result = artifact.createBizScriptArtifact(input, baseline, "20260910.100000001");
    const archive = unzipSync(result.bytes);
    expect(Object.keys(archive).sort()).toEqual(["biz-script-manifest.json", "domain/new.js", "features/entry.js"]);
    expect(strFromU8(archive["domain/new.js"]!)).toBe("module.exports = '中文';");
    expect(result.packageSha256).toBe(hash(result.bytes));
    expect(result.changes).toEqual({ added: ["domain/new.js"], modified: ["features/entry.js"], removed: ["domain/removed.js"] });
    const manifest = JSON.parse(strFromU8(archive["biz-script-manifest.json"]!));
    const require = createRequire(import.meta.url);
    const policy = require("../../../../../mobile-agent/autojs/app/biz-script-policy.js");
    expect(policy.assertCompatible(manifest, baseline, { sha256Text: hash })).toEqual(result.files);
    for (const f of manifest.files) expect(hash(archive[f.path]!)).toBe(f.sha256);
  });

  test.each(["../x.js", "core/x.js", "features/../x.js", "features//x.js", "features/config.js", "features/a\\x.js"])("rejects forbidden path %s", (path) => {
    const { input, baseline } = fixture();
    input.files[0]!.path = path;
    expect(() => artifact.createBizScriptArtifact(input, baseline, "20260910.100000001")).toThrow("INVALID_SOURCE");
  });

  test("rejects duplicate paths and case aliases", () => {
    const { input, baseline } = fixture();
    input.files.push({ ...input.files[0]!, path: "features/ENTRY.js" });
    expect(() => artifact.createBizScriptArtifact(input, baseline, "20260910.100000001")).toThrow("INVALID_SOURCE");
  });

  test("rejects modified or missing base files even if client claims compatibility", () => {
    const { input, baseline } = fixture();
    input.baseFiles = [{ ...input.baseFiles[0]!, sha256: "a".repeat(64) }];
    expect(() => artifact.createBizScriptArtifact(input, baseline, "20260910.100000001")).toThrow("BASE_MISMATCH");
    input.baseFiles = [];
    expect(() => artifact.createBizScriptArtifact(input, baseline, "20260910.100000001")).toThrow("BASE_MISMATCH");
  });

  test.each(["var = ;", "const x = () => 1;", "\ufeffmodule.exports = 1;", "var x = '\ud800';"])("rejects unsupported syntax or non-roundtrip text", (content) => {
    const { input, baseline } = fixture();
    input.files[0]!.content = content;
    expect(() => artifact.createBizScriptArtifact(input, baseline, "20260910.100000001")).toThrow("INVALID_SOURCE");
  });

  test("validates without executing the uploaded source", () => {
    const { input, baseline } = fixture();
    input.files[0]!.content = "throw new Error('never execute');";
    expect(artifact.createBizScriptArtifact(input, baseline, "20260910.100000001").files).toHaveLength(2);
  });

  test("rejects oversized files and malformed APK baseline", () => {
    const { input, baseline } = fixture();
    input.files[0]!.content = " ".repeat(512 * 1024 + 1);
    expect(() => artifact.createBizScriptArtifact(input, baseline, "20260910.100000001")).toThrow("SOURCE_TOO_LARGE");
    expect(() => artifact.validateBizScriptBaseline({ ...baseline, sourceSha256: "a".repeat(64) })).toThrow("BASELINE_INVALID");
  });

  test("allocates above both baseline and numerically greatest historical version", () => {
    expect(artifact.nextBizScriptVersion(["20260910.9", "20260910.100000005"], "20260910.100000000", new Date("2026-09-09Z"))).toBe("20260910.100000006");
    expect(() => artifact.nextBizScriptVersion(["bad"], "20260910.1", new Date())).toThrow("VERSION_INVALID");
  });
});
