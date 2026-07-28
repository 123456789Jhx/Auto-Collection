const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { inflateRawSync } = require("node:zlib");
const { test } = require("node:test");

const repoRoot = path.resolve(__dirname, "../../..");
const bundleScript = path.join(repoRoot, "scripts", "bundle-autojs.ps1");
const bom = Buffer.from([0xef, 0xbb, 0xbf]);

function readZipEntries(zipPath) {
  const archive = fs.readFileSync(zipPath);
  const endOfCentralDirectory = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endOfCentralDirectory, -1, "ZIP end-of-central-directory record is missing");

  const entries = [];
  let cursor = archive.readUInt32LE(endOfCentralDirectory + 16);
  while (archive.readUInt32LE(cursor) === 0x02014b50) {
    const compressionMethod = archive.readUInt16LE(cursor + 10);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const localHeaderOffset = archive.readUInt32LE(cursor + 42);
    const name = archive.subarray(cursor + 46, cursor + 46 + fileNameLength).toString("utf8");

    assert.equal(archive.readUInt32LE(localHeaderOffset), 0x04034b50, `Invalid local header for ${name}`);
    const localNameLength = archive.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = archive.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = archive.subarray(dataStart, dataStart + compressedSize);
    const contents = compressionMethod === 0 ? compressed : inflateRawSync(compressed);

    entries.push({ name, contents });
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

test("business-script bundle contains no UTF-8 BOM in JavaScript or JSON entries", () => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "biz-script-bundle-"));
  const version = "bom-test";

  try {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        bundleScript,
        "-Version",
        version,
        "-PackageBaseUrl",
        "http://127.0.0.1:3136/downloads/agent",
        "-OutputDir",
        outputDir
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const zipPath = path.join(outputDir, `AgriVideoCollector-biz-scripts-${version}.zip`);
    const bomEntries = readZipEntries(zipPath)
      .filter((entry) => /\.(?:js|json)$/i.test(entry.name) && entry.contents.subarray(0, 3).equals(bom))
      .map((entry) => entry.name);

    assert.deepEqual(bomEntries, []);
  } finally {
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});
test("business-script bundle defaults to the API-served artifact directory", () => {
  const version = "default-output-test";
  const apiArtifactDir = path.join(repoRoot, "account-data-platform", "apps", "api", "dist", "agent");
  const legacyArtifactDir = path.join(repoRoot, "account-data-platform", "dist", "agent");
  const fileName = `AgriVideoCollector-biz-scripts-${version}.zip`;
  try {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        bundleScript,
        "-Version",
        version,
        "-PackageBaseUrl",
        "http://127.0.0.1:3136/downloads/agent"
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(apiArtifactDir, fileName)), true);
    assert.equal(fs.existsSync(path.join(legacyArtifactDir, fileName)), false);
  } finally {
    for (const directory of [apiArtifactDir, legacyArtifactDir]) {
      for (const extension of [".zip", ".json", ".zip.sha256"]) {
        fs.rmSync(path.join(directory, `AgriVideoCollector-biz-scripts-${version}${extension}`), { force: true });
      }
    }
  }
});