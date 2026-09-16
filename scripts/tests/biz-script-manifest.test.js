const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const helper = path.resolve(__dirname, "../biz-script-manifest.ps1");
const hash = (text) => createHash("sha256").update(text).digest("hex");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "biz-baseline-fixture-"));
  const source = path.join(root, "source");
  const contents = {
    "features/example.js": "module.exports = 'business';\n",
    "domain/model.js": "module.exports = 'domain';\n",
    "app/runtime.js": "module.exports = 'runtime';\n",
    "core/helper.js": "module.exports = 'core';\n",
    "platforms/adapter.js": "module.exports = 'platform';\n",
    "utils/path.js": "module.exports = 'path';\n",
    "main.module.js": "module.exports = 'main';\n",
    "config.js": "module.exports = { secret: 'local' };\n",
    "tests/ignored.js": "throw new Error('test');\n"
  };
  for (const [relative, text] of Object.entries(contents)) {
    const file = path.join(source, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  return { root, source, contents, output: path.join(root, "baseline.json") };
}

function invoke(command) {
  assert.equal(fs.existsSync(helper), true, "the isolated manifest helper must exist");
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
    `$ErrorActionPreference = 'Stop'; . ${quote(helper)}; ${command}`
  ], { encoding: "utf8" });
  return result;
}

function writeBaseline(f, version = "20260910.100000000") {
  const result = invoke(`Write-BizScriptBaselineManifest -SourceRoot ${quote(f.source)} `
    + `-OutputPath ${quote(f.output)} -Version ${quote(version)} -ApkBuildId 'FIXTURE-APK'`);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(fs.readFileSync(f.output, "utf8"));
}

test("baseline hashes actual business files and only declared base scripts", () => {
  const f = fixture();
  try {
    const manifest = writeBaseline(f);
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.channel, "biz-scripts");
    assert.equal(manifest.apkBuildId, "FIXTURE-APK");
    assert.equal(manifest.version, "20260910.100000000");
    const expectedBusiness = ["domain/model.js", "features/example.js"];
    const expectedBase = ["app/runtime.js", "core/helper.js", "main.module.js", "platforms/adapter.js", "utils/path.js"];
    assert.deepEqual(manifest.files, expectedBusiness.map((relative) => ({ path: relative, sha256: hash(f.contents[relative]) })));
    assert.deepEqual(manifest.baseFiles, expectedBase.map((relative) => ({ path: relative, sha256: hash(f.contents[relative]) })));
    assert.equal(manifest.sourceSha256, hash(expectedBusiness.map((relative) => `${relative}:${hash(f.contents[relative])}`).join("\n")));
    assert.equal(manifest.baseCompatibilityId, hash("autojs-biz-v2\n" + expectedBase.map((relative) => `${relative}:${hash(f.contents[relative])}`).join("\n")));
    assert.notEqual(fs.readFileSync(f.output).subarray(0, 3).toString("hex"), "efbbbf");
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("business changes preserve compatibility while base changes invalidate it", () => {
  const f = fixture();
  try {
    const before = writeBaseline(f);
    fs.writeFileSync(path.join(f.source, "features/example.js"), "module.exports = 'new business';\n");
    const businessChanged = writeBaseline(f);
    assert.notEqual(businessChanged.sourceSha256, before.sourceSha256);
    assert.equal(businessChanged.baseCompatibilityId, before.baseCompatibilityId);
    fs.writeFileSync(path.join(f.source, "config.js"), "module.exports = { secret: 'changed' };\n");
    assert.equal(writeBaseline(f).baseCompatibilityId, before.baseCompatibilityId);
    fs.writeFileSync(path.join(f.source, "core/helper.js"), "module.exports = 'new core';\n");
    assert.notEqual(writeBaseline(f).baseCompatibilityId, before.baseCompatibilityId);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("bundle eligibility requires a newer version and the actual APK base", () => {
  const f = fixture();
  try {
    writeBaseline(f);
    const validate = (version) => invoke(`Assert-BizScriptBuildBaseline -SourceRoot ${quote(f.source)} `
      + `-BaselineManifestPath ${quote(f.output)} -Version ${quote(version)} | Out-Null`);
    assert.equal(validate("20260910.100000001").status, 0);
    assert.notEqual(validate("20260910.100000000").status, 0);
    fs.writeFileSync(path.join(f.source, "core/helper.js"), "module.exports = 'other APK';\n");
    assert.notEqual(validate("20260910.100000001").status, 0);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("baseline rejects forged fingerprints, missing metadata and unsafe paths", () => {
  const f = fixture();
  try {
    const baseline = writeBaseline(f);
    for (const changed of [
      { ...baseline, sourceSha256: "0".repeat(64) },
      { ...baseline, baseCompatibilityId: "0".repeat(64) },
      { ...baseline, schemaVersion: 1 },
      { ...baseline, schemaVersion: "2" },
      { ...baseline, version: "20260910.9007199254740992" },
      { ...baseline, files: baseline.files[0] },
      { ...baseline, files: [{ path: "../escape.js", sha256: "a".repeat(64) }] }
    ]) {
      fs.writeFileSync(f.output, JSON.stringify(changed));
      const result = invoke(`Assert-BizScriptBuildBaseline -SourceRoot ${quote(f.source)} `
        + `-BaselineManifestPath ${quote(f.output)} -Version '20260910.100000001' | Out-Null`);
      assert.notEqual(result.status, 0);
    }
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("inventory fingerprint sorts whole path-hash lines for prefixed file names", () => {
  const f = fixture();
  try {
    fs.writeFileSync(path.join(f.source, "features/example.js.extra.js"), "module.exports = 'extra';\n");
    const manifest = writeBaseline(f);
    const expectedLines = [
      `domain/model.js:${hash(f.contents["domain/model.js"])}`,
      `features/example.js.extra.js:${hash("module.exports = 'extra';\n")}`,
      `features/example.js:${hash(f.contents["features/example.js"])}`
    ];
    assert.equal(manifest.sourceSha256, hash(expectedLines.join("\n")));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test("partial releases cannot inherit an incompatible or stale full manifest", () => {
  const f = fixture();
  try {
    const baseline = writeBaseline(f);
    const base = { ...baseline, version: "20260910.100000001", mode: "full" };
    const manifestPath = path.join(f.root, "full.json");
    const validate = (manifest) => {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest));
      return invoke(`$baseline = Read-BizScriptBaselineManifest ${quote(f.output)}; `
        + `$full = Get-Content -Raw ${quote(manifestPath)} | ConvertFrom-Json; `
        + "Assert-BizScriptPartialBaseline -Manifest $full -ApkBaseline $baseline -BaseVersion '20260910.100000001'");
    };
    assert.equal(validate(base).status, 0);
    assert.notEqual(validate({ ...base, baseCompatibilityId: "0".repeat(64) }).status, 0);
    assert.notEqual(validate({ ...base, mode: "partial" }).status, 0);
    assert.notEqual(validate({ ...base, sourceSha256: "0".repeat(64) }).status, 0);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

function archiveFixture(f, archivePath) {
  const result = invoke("Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; "
    + `$archive = [IO.Compression.ZipFile]::Open(${quote(archivePath)}, [IO.Compression.ZipArchiveMode]::Create); `
    + `try { [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, ${quote(f.output)}, 'assets/project/biz-script-baseline.json') | Out-Null; `
    + `$root = ${quote(f.source)}; Get-ChildItem -LiteralPath $root -Recurse -File -Filter '*.js' | ForEach-Object { `
    + "$relative = $_.FullName.Substring($root.Length).TrimStart('\\').Replace('\\', '/'); "
    + "[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, ('assets/project/' + $relative)) | Out-Null } "
    + "} finally { $archive.Dispose() }");
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("default baseline is promoted only from an APK whose embedded scripts match", () => {
  const f = fixture();
  try {
    writeBaseline(f);
    const validApk = path.join(f.root, "synthetic-valid.apk");
    const invalidApk = path.join(f.root, "synthetic-invalid.apk");
    const defaultPath = path.join(f.root, "promoted", "baseline.json");
    archiveFixture(f, validApk);
    const promote = (archivePath) => invoke(`$expected = Get-Content -Raw ${quote(f.output)}; `
      + `Export-BizScriptApkBaseline -ApkPath ${quote(archivePath)} -ExpectedBaselineText $expected -DefaultManifestPath ${quote(defaultPath)}`);
    const success = promote(validApk);
    assert.equal(success.status, 0, success.stderr || success.stdout);
    assert.equal(fs.readFileSync(defaultPath, "utf8"), fs.readFileSync(f.output, "utf8"));
    assert.equal(fs.readFileSync(`${validApk}.biz-script-baseline.json`, "utf8"), fs.readFileSync(f.output, "utf8"));
    const replaced = promote(validApk);
    assert.equal(replaced.status, 0, replaced.stderr || replaced.stdout);
    fs.writeFileSync(path.join(f.source, "features/example.js"), "module.exports = 'unconfirmed';\n");
    archiveFixture(f, invalidApk);
    assert.notEqual(promote(invalidApk).status, 0);
    assert.equal(fs.existsSync(`${invalidApk}.biz-script-baseline.json`), false);
    assert.equal(fs.readFileSync(defaultPath, "utf8"), fs.readFileSync(f.output, "utf8"));
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
