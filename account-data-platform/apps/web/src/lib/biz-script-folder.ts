import { bizScriptUploadLimits, type BizScriptBaseline, type BizScriptFileHash, type BizScriptPreviewInput } from "@pkg/types";

export type FolderFile = { webkitRelativePath: string; size: number; arrayBuffer(): Promise<ArrayBuffer> };
type FolderLimits = { maxFiles: number; maxFileBytes: number; maxTotalBytes: number; maxRequestBytes: number };
export type PreparedBizScriptFolder = {
  input: BizScriptPreviewInput;
  sourceSha256: string;
  totalBytes: number;
  folderName: string;
};

const businessPath = /^(features|domain)\/[A-Za-z0-9._/-]+\.js$/;
const basePath = /^(?:(?:app|core|platforms|utils)\/[A-Za-z0-9._/-]+|[A-Za-z0-9._-]+)\.js$/;
const allowedTree = /^(features|domain|app|core|platforms|utils)\//;
const encoder = new TextEncoder();

async function hash(bytes: ArrayBuffer) {
  if (!globalThis.crypto?.subtle) throw new Error("当前浏览器无法执行 SHA-256 校验");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function listHash(files: BizScriptFileHash[], prefix = "") {
  const content = prefix + files.map((file) => `${file.path}:${file.sha256}`).sort().join("\n");
  return hash(encoder.encode(content).buffer);
}

function validPath(path: string, base = false) {
  return (base ? basePath : businessPath).test(path) && !path.includes("..") && !path.includes("//")
    && !path.split("/").some((part) => part === ".") && !/(^|\/)config\.js$/i.test(path);
}

function selectedFiles(files: readonly FolderFile[]) {
  const roots = new Set<string>();
  for (const file of files) {
    const match = /(?:^|\/)autojs\//.exec(file.webkitRelativePath);
    if (match) roots.add(file.webkitRelativePath.slice(0, match.index + match[0].length));
  }
  if (roots.size > 1) throw new Error("目录中存在多个 autojs，请选择唯一的 mobile-agent/autojs 目录");
  const root = [...roots][0];
  if (!root) throw new Error("未找到 autojs 目录，请选择完整的 mobile-agent/autojs 目录");
  const selected: Array<{ file: FolderFile; path: string; base: boolean }> = [];
  const seen = new Set<string>();
  for (const file of files) {
    const raw = file.webkitRelativePath;
    if (!raw.startsWith(root)) continue;
    const path = raw.slice(root.length);
    if (!/\.js$/i.test(path) || /(^|[/\\])config\.js$/i.test(path)) continue;
    if (!allowedTree.test(path.replace(/\\/g, "/").toLowerCase()) && path.includes("/")) continue;
    const base = !/^(features|domain)\//.test(path);
    if (raw.includes("\\") || raw.split("/").some((part) => !part || part === "." || part === "..") || !validPath(path, base)) {
      throw new Error(`脚本路径无效：${path}`);
    }
    const key = path.toLowerCase();
    if (seen.has(key)) throw new Error(`脚本路径重复：${path}`);
    seen.add(key);
    selected.push({ file, path, base });
  }
  return { root, selected: selected.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0) };
}

export async function prepareBizScriptFolder(
  files: readonly FolderFile[], baseline: BizScriptBaseline, limits: FolderLimits = bizScriptUploadLimits
): Promise<PreparedBizScriptFolder> {
  const { root, selected } = selectedFiles(files);
  const business = selected.filter((entry) => !entry.base);
  const base = selected.filter((entry) => entry.base);
  if (!business.length) throw new Error("目录中没有可上传的业务 JS 文件");
  if (business.length > limits.maxFiles) throw new Error(`业务文件数量超过 ${limits.maxFiles} 个`);
  let totalBytes = 0;
  for (const { file, path } of business) {
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.maxFileBytes) throw new Error(`业务文件大小超限：${path}`);
    totalBytes += file.size;
  }
  if (totalBytes > limits.maxTotalBytes) throw new Error("业务文件合计大小超限");
  const expected = new Map(baseline.baseFiles.map((file) => [file.path, file.sha256]));
  if (!expected.size || expected.size !== baseline.baseFiles.length || base.length !== expected.size
    || base.some(({ path }) => !expected.has(path))
    || baseline.baseFiles.some((file) => !validPath(file.path, true) || !/^[a-f0-9]{64}$/.test(file.sha256))) {
    throw new Error("基座文件清单不完整或与 APK 基线不一致");
  }
  const baseFiles: BizScriptFileHash[] = [];
  for (const { file, path } of base) {
    const bytes = await file.arrayBuffer();
    const sha256 = await hash(bytes);
    if (bytes.byteLength !== file.size || sha256 !== expected.get(path)) throw new Error(`基座文件与 APK 基线不一致：${path}`);
    baseFiles.push({ path, sha256 });
  }
  if (await listHash(baseFiles, "autojs-biz-v2\n") !== baseline.baseCompatibilityId) throw new Error("基座兼容标识与 APK 基线不一致");
  const payloadFiles: BizScriptPreviewInput["files"] = [];
  const businessHashes: BizScriptFileHash[] = [];
  for (const { file, path } of business) {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== file.size) throw new Error(`业务文件大小发生变化：${path}`);
    const view = new Uint8Array(bytes);
    if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) throw new Error(`业务文件包含 UTF-8 BOM：${path}`);
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error(`业务文件不是有效 UTF-8：${path}`); }
    payloadFiles.push({ path, content });
    businessHashes.push({ path, sha256: await hash(bytes) });
  }
  const input: BizScriptPreviewInput = {
    baselineVersion: baseline.version, baseCompatibilityId: baseline.baseCompatibilityId,
    baseFiles, files: payloadFiles
  };
  if (encoder.encode(JSON.stringify(input)).byteLength > limits.maxRequestBytes) throw new Error("上传请求大小超限");
  return { input, totalBytes, sourceSha256: await listHash(businessHashes), folderName: root.slice(0, -1) };
}
