import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { BizScriptBaseline } from "@pkg/types";
import { prepareBizScriptFolder, type FolderFile } from "../src/lib/biz-script-folder";

const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const baseFiles = [{ path: "main.js", sha256: sha("base\r\n") }, { path: "core/runtime.js", sha256: sha("runtime") }];
const baseline: BizScriptBaseline = {
  schemaVersion: 2, channel: "biz-scripts", version: "20260910.100", apkBuildId: "apk-test",
  baseCompatibilityId: sha("autojs-biz-v2\ncore/runtime.js:" + sha("runtime") + "\nmain.js:" + sha("base\r\n")),
  sourceSha256: sha("features/old.js:" + sha("old")),
  files: [{ path: "features/old.js", sha256: sha("old") }], baseFiles
};

function file(path: string, content: string | Uint8Array): FolderFile {
  const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
  return { webkitRelativePath: path, size: bytes.byteLength, arrayBuffer: async () => bytes.slice().buffer };
}

function folder(prefix = "autojs/") {
  return [file(prefix + "main.js", "base\r\n"), file(prefix + "core/runtime.js", "runtime"), file(prefix + "features/new.js", "module.exports = '新';\r\n")];
}

describe("local business folder", () => {
  test("normalizes an ancestor selection and preserves exact UTF-8 business bytes", async () => {
    const result = await prepareBizScriptFolder(folder("repo/mobile-agent/autojs/"), baseline);
    expect(result.input.files).toEqual([{ path: "features/new.js", content: "module.exports = '新';\r\n" }]);
    expect(result.input.baseFiles).toEqual([baseFiles[1], baseFiles[0]]);
    expect(result.input.baselineVersion).toBe("20260910.100");
    expect(result.sourceSha256).toBe(sha("features/new.js:" + sha("module.exports = '新';\r\n")));
    expect(JSON.stringify(result.input)).not.toContain("base\\r\\n");
  });

  test("does not read config, non-script files, or scripts outside allowed trees", async () => {
    const blocked = ["autojs/config.js", "autojs/features/config.js", "autojs/features/.env", "autojs/README.md", "autojs/tests/test.js", "repo/.env"];
    const files = blocked.map((path) => ({ ...file(path, "secret"), arrayBuffer: async () => { throw new Error("secret was read"); } }));
    expect((await prepareBizScriptFolder([...folder(), ...files], baseline)).input.files).toHaveLength(1);
  });

  test.each(["autojs/features/../escape.js", "autojs/features//bad.js", "autojs/features/bad\\name.js", "autojs/features/中文.js", "autojs/features\\nested/bad.js", "autojs/Features/bad.js"])("rejects invalid relevant path %s", async (path) => {
    await expect(prepareBizScriptFolder([...folder(), file(path, "bad")], baseline)).rejects.toThrow("路径");
  });

  test("rejects duplicate normalized business paths", async () => {
    await expect(prepareBizScriptFolder([...folder(), file("autojs/features/new.js", "other")], baseline)).rejects.toThrow("重复");
  });

  test("rejects ambiguous autojs roots", async () => {
    await expect(prepareBizScriptFolder([...folder("repo/a/autojs/"), ...folder("repo/b/autojs/")], baseline)).rejects.toThrow("多个");
  });

  test("rejects missing, added, or modified base files", async () => {
    await expect(prepareBizScriptFolder(folder().slice(1), baseline)).rejects.toThrow("基座");
    await expect(prepareBizScriptFolder([...folder(), file("autojs/app/new.js", "base")], baseline)).rejects.toThrow("基座");
    await expect(prepareBizScriptFolder([file("autojs/main.js", "changed"), ...folder().slice(1)], baseline)).rejects.toThrow("基座");
  });

  test.each([new Uint8Array([0xef, 0xbb, 0xbf, 65]), new Uint8Array([0xc3, 0x28])])("rejects BOM or invalid UTF-8 bytes", async (bytes) => {
    await expect(prepareBizScriptFolder([...folder().slice(0, 2), file("autojs/domain/new.js", bytes)], baseline)).rejects.toThrow(/UTF-8|BOM/);
  });

  test("rejects file count and byte limits before reading content", async () => {
    const limits = { maxFiles: 1, maxFileBytes: 4, maxTotalBytes: 4, maxRequestBytes: 1000 };
    await expect(prepareBizScriptFolder(folder(), baseline, limits)).rejects.toThrow("大小");
    await expect(prepareBizScriptFolder([...folder(), file("autojs/domain/next.js", "a")], baseline, limits)).rejects.toThrow("数量");
  });

  test("rejects an empty business tree and a request exceeding serialized byte limit", async () => {
    await expect(prepareBizScriptFolder(folder().slice(0, 2), baseline)).rejects.toThrow("业务");
    await expect(prepareBizScriptFolder(folder(), baseline, { maxFiles: 500, maxFileBytes: 524288, maxTotalBytes: 8388608, maxRequestBytes: 20 })).rejects.toThrow("请求");
  });
});
