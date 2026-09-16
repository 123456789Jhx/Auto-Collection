const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createBizScriptUpdater } = require("../app/biz-script-updater.js");
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fingerprint = (files) => sha(files.map((file) => `${file.path}:${file.sha256}`).sort().join("\n"));

function harness(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "biz-update-")).replace(/\\/g, "/");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  function write(file, content) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
  const files = [{ path: "features/example.js", sha256: sha("old") }];
  const baseFiles = [{ path: "core/example.js", sha256: sha("core") }];
  const compatibility = sha("autojs-biz-v2\n" + baseFiles.map((file) => `${file.path}:${file.sha256}`).join("\n"));
  const baseline = { schemaVersion: 2, channel: "biz-scripts", version: "20260910.100000000",
    files, sourceSha256: fingerprint(files), baseCompatibilityId: compatibility, baseFiles };
  write(`${root}/features/example.js`, "old");
  write(`${root}/core/example.js`, "core");
  write(`${root}/biz-script-baseline.json`, JSON.stringify(baseline));
  const nextFiles = [{ path: "features/example.js", sha256: sha("new") }];
  const next = { schemaVersion: 2, channel: "biz-scripts", version: "20260910.100000001",
    files: nextFiles, sourceSha256: fingerprint(nextFiles), baseCompatibilityId: compatibility };
  const events = [], queries = [], counts = { downloads: 0, restarts: 0 };
  const contents = { "features/example.js": "new" };
  const deps = {
    exists: fs.existsSync, readText: (file) => fs.readFileSync(file, "utf8"),
    writeText: write, sha256Text: sha, sha256File: (file) => sha(fs.readFileSync(file)),
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    copyFile: (from, to) => write(to, fs.readFileSync(from)),
    copyDir: (from, to) => fs.cpSync(from, to, { recursive: true }),
    renameDir: (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(from, to); },
    remove: (file) => fs.rmSync(file, { recursive: true, force: true }), now: () => 123,
    download: (_url, target) => { counts.downloads++; write(target, "zip"); return 3; },
    unzip: (_zip, target) => {
      Object.entries(contents).forEach(([file, content]) => write(`${target}/${file}`, content));
      write(`${target}/biz-script-manifest.json`, JSON.stringify(next));
    },
    restart: () => { counts.restarts++; return "unavailable"; }
  };
  const config = { app: { version: "1.0.95" }, device: { deviceId: "fixture" },
    runtime: { scriptDir: root }, upload: { versionChannel: "stable" } };
  const latest = { version: next.version, channel: "biz-scripts", packageUrl: "https://example.invalid/package.zip", sha256: sha("zip") };
  const updater = createBizScriptUpdater(config, { info() {}, warn() {} }, {
    checkAgentVersion() { queries.push(config.app.version); return { latestVersion: latest, updateAvailable: true }; },
    uploadAgentUpdateEvent(event) { events.push(event); }
  }, deps);
  return { root, baseline, next, latest, config, deps, updater, counts, events, queries, contents, write };
}

test("uses the real APK business baseline and rejects an old server package before download", (t) => {
  const f = harness(t);
  f.latest.version = "9.8.56232";
  const result = f.updater.check(true);
  assert.equal(f.updater.currentVersion(), "20260910.100000000");
  assert.deepEqual(f.queries, ["20260910.100000000"]);
  assert.equal(result.applied, false);
  assert.equal(f.counts.downloads, 0);
  assert.equal(f.config.app.version, "1.0.95");
});

for (const defect of ["legacy", "incompatible", "bad-inventory"]) {
  test(`does not activate a ${defect} package even with valid ZIP SHA`, (t) => {
    const f = harness(t);
    if (defect === "legacy") delete f.next.schemaVersion;
    if (defect === "incompatible") f.next.baseCompatibilityId = "b".repeat(64);
    if (defect === "bad-inventory") f.next.sourceSha256 = "c".repeat(64);
    const result = f.updater.applyVersion({ latestVersion: f.latest });
    assert.equal(result.applied, false);
    assert.equal(fs.existsSync(`${f.root}/biz-scripts/current/version.json`), false);
    assert.equal(f.counts.restarts, 0);
  });
}

test("staging a valid package does not claim its version is running when restart is unavailable", (t) => {
  const f = harness(t);
  const result = f.updater.applyVersion({ latestVersion: f.latest });
  assert.equal(result.applied, true);
  assert.equal(result.restartFailed, true);
  assert.equal(f.config.runtime.bizScriptsVersion, "20260910.100000000");
  assert.equal(f.config.runtime.pendingBizScriptsVersion, "20260910.100000001");
  const installed = JSON.parse(fs.readFileSync(`${f.root}/biz-scripts/current/version.json`, "utf8"));
  assert.equal(installed.schemaVersion, 2);
  assert.equal(installed.baseCompatibilityId, f.baseline.baseCompatibilityId);
  assert.equal(installed.sourceSha256, f.next.sourceSha256);
  assert.equal(f.events.find((event) => event.eventType === "APPLIED").payload.restartPending, true);
  assert.equal(f.events.find((event) => event.eventType === "FAILED").payload.phase, "restart");
});

test("a previously failed version is not downloaded again", (t) => {
  const f = harness(t);
  f.write(`${f.root}/biz-scripts/rejected.json`, JSON.stringify({ version: f.next.version,
    sourceSha256: f.next.sourceSha256, baseCompatibilityId: f.baseline.baseCompatibilityId }));
  const result = f.updater.applyVersion({ latestVersion: f.latest });
  assert.equal(result.applied, false);
  assert.equal(f.counts.downloads, 0);
  assert.match(result.message, /previously failed/i);
});

for (const defect of ["none", "wrong-base", "tampered-current", "tampered-copy"]) {
  test(`partial updates retain the verified base and reject ${defect} without changing the running version`, (t) => {
    const f = harness(t);
    f.contents["domain/unchanged.js"] = "unchanged";
    f.next.files.push({ path: "domain/unchanged.js", sha256: sha("unchanged") });
    f.next.sourceSha256 = fingerprint(f.next.files);
    assert.equal(f.updater.applyVersion({ latestVersion: f.latest }).applied, true);
    const current = `${f.root}/biz-scripts/current`;
    f.next.mode = "partial";
    f.next.baseVersion = f.next.version;
    f.next.version = f.latest.version = "20260910.100000002";
    f.contents["features/example.js"] = "later";
    delete f.contents["domain/unchanged.js"];
    f.next.files[0].sha256 = sha("later");
    f.next.deltaFiles = [f.next.files[0]];
    f.next.sourceSha256 = fingerprint(f.next.files);
    if (defect === "wrong-base") f.next.baseVersion = "20260910.100000000";
    if (defect === "tampered-current") f.write(`${current}/domain/unchanged.js`, "tampered");
    if (defect === "tampered-copy") {
      const copyDir = f.deps.copyDir;
      f.deps.copyDir = (from, to) => { copyDir(from, to); f.write(`${to}/domain/unchanged.js`, "tampered"); };
    }
    const result = f.updater.applyVersion({ latestVersion: f.latest });
    assert.equal(result.applied, defect === "none");
    assert.equal(fs.readFileSync(`${current}/features/example.js`, "utf8"), defect === "none" ? "later" : "new");
    assert.equal(f.config.runtime.bizScriptsVersion, f.baseline.version);
    if (defect === "none") assert.equal(fs.readFileSync(`${current}/domain/unchanged.js`, "utf8"), "unchanged");
  });
}
