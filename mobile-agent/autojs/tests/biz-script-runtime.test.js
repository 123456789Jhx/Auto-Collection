const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { createBizScriptRuntime } = require("../app/biz-script-runtime.js");

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const fingerprint = (files) => sha(files.map((file) => `${file.path}:${file.sha256}`).sort().join("\n"));

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "biz-runtime-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (relative, text) => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, text);
  };
  const baselineCode = 'module.exports = { action: "baseline" };';
  const overlayCode = 'module.exports = { action: "curve", core: require("../../core/sample.js") };';
  const deviceProfilesCode = `module.exports = {
  resolveDeviceProfile() {
    return {
      key: "default",
      label: "未识别机型",
      matchedBy: "fallback",
      source: "builtin",
      values: { outputRoots: [] }
    };
  }
};`;
  put("features/video/entry.js", baselineCode);
  put("core/sample.js", 'module.exports = { origin: "apk", identity: {} };');
  put("device-profiles.js", deviceProfilesCode);
  const files = [{ path: "features/video/entry.js", sha256: sha(baselineCode) }];
  const baseFiles = [
    { path: "core/sample.js", sha256: sha(fs.readFileSync(path.join(root, "core/sample.js"))) },
    { path: "device-profiles.js", sha256: sha(deviceProfilesCode) }
  ];
  const baseline = {
    schemaVersion: 2, channel: "biz-scripts", version: "20260910.100000000",
    apkBuildId: "test-build", baseCompatibilityId: sha("autojs-biz-v2\n" + baseFiles.map((file) => `${file.path}:${file.sha256}`).sort().join("\n")),
    sourceSha256: fingerprint(files), files, baseFiles
  };
  const overlayFiles = [{ path: "features/video/entry.js", sha256: sha(overlayCode) }];
  const overlay = {
    schemaVersion: 2, channel: "biz-scripts", version: "20260910.100000001",
    baseCompatibilityId: baseline.baseCompatibilityId,
    sourceSha256: fingerprint(overlayFiles), files: overlayFiles
  };
  const currentDir = path.join(root, "biz-scripts/current").replace(/\\/g, "/");
  const deps = {
    exists: fs.existsSync,
    readText: (file) => fs.readFileSync(file, "utf8"),
    sha256File: (file) => sha(fs.readFileSync(file)),
    sha256Text: sha,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    copyFile: (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); },
    writeText: (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); },
    remove: (file) => fs.rmSync(file, { recursive: true, force: true }),
    now: () => 123
  };
  function save() {
    put("biz-script-baseline.json", JSON.stringify(baseline));
    put("biz-scripts/current/version.json", JSON.stringify(overlay));
    put("biz-scripts/current/features/video/entry.js", overlayCode);
  }
  save();
  return { root: root.replace(/\\/g, "/"), currentDir, baseline, overlay, deps, put, save,
    runtime: () => createBizScriptRuntime({ scriptDir: root.replace(/\\/g, "/"), currentDir, deps }) };
}

test("a newer compatible verified package loads relative core dependencies from the APK singleton", (t) => {
  const f = fixture(t);
  const runtime = f.runtime();
  const loaded = require(runtime.resolve("features/video/entry.js"));
  assert.equal(loaded.action, "curve");
  assert.strictEqual(loaded.core, require(path.join(f.root, "core/sample.js")));
  assert.equal(runtime.state.source, "overlay");
  assert.equal(runtime.state.version, "20260910.100000001");
  assert.equal(runtime.state.baselineVersion, "20260910.100000000");
});

test("the actual comment runtime imports its APK core dependencies through the verified view", (t) => {
  const f = fixture(t);
  for (const layer of ["core", "features/new-comment"]) {
    const sourceRoot = path.join(__dirname, "..", layer);
    for (const name of fs.readdirSync(sourceRoot, { recursive: true }).filter((name) => name.endsWith(".js"))) {
      const relative = `${layer}/${name.replace(/\\/g, "/")}`;
      const content = fs.readFileSync(path.join(sourceRoot, name), "utf8");
      const item = { path: relative, sha256: sha(content) };
      f.put(relative, content);
      if (layer === "core") f.baseline.baseFiles.push(item);
      else {
        f.baseline.files.push(item);
        f.overlay.files.push(item);
        f.put(`biz-scripts/current/${relative}`, content);
      }
    }
  }
  f.baseline.baseCompatibilityId = sha("autojs-biz-v2\n" + f.baseline.baseFiles.map((file) => `${file.path}:${file.sha256}`).sort().join("\n"));
  f.baseline.sourceSha256 = fingerprint(f.baseline.files);
  f.overlay.baseCompatibilityId = f.baseline.baseCompatibilityId;
  f.overlay.sourceSha256 = fingerprint(f.overlay.files);
  f.save();
  const runtime = f.runtime();
  assert.equal(runtime.state.source, "overlay");
  const comment = require(runtime.resolve("features/new-comment/runtime.js"));
  assert.equal(typeof comment.createIsolatedRuntime, "function");
  const coreProxy = path.resolve(path.dirname(runtime.resolve("features/new-comment/runtime.js")), "../../core/accessibility.js");
  assert.strictEqual(require(coreProxy), require(`${f.root}/core/accessibility.js`));
});

for (const defect of ["old", "same", "legacy", "incompatible", "tampered", "missing", "unlisted-dependency"]) {
  test(`rejects the whole ${defect} overlay before executing a business module`, (t) => {
    const f = fixture(t);
    if (defect === "old") f.overlay.version = "9.8.56232";
    if (defect === "same") f.overlay.version = f.baseline.version;
    if (defect === "legacy") delete f.overlay.schemaVersion;
    if (defect === "incompatible") f.overlay.baseCompatibilityId = "b".repeat(64);
    f.save();
    if (defect === "tampered") f.put("biz-scripts/current/features/video/entry.js", 'throw new Error("unverified");');
    if (defect === "missing") fs.unlinkSync(path.join(f.currentDir, "features/video/entry.js"));
    if (defect === "unlisted-dependency") {
      f.overlay.files.push({ path: "../core/injected.js", sha256: "c".repeat(64) });
      f.save();
    }
    const runtime = f.runtime();
    assert.equal(runtime.state.source, "baseline");
    assert.equal(require(runtime.resolve("features/video/entry.js")).action, "baseline");
    assert.equal(fs.existsSync(path.join(f.currentDir, "version.json")), true, "rejection must not delete the old package");
    assert.ok(runtime.state.rejectionReason);
  });
}

test("an unlisted business file never falls through to the baseline or loose current files", (t) => {
  const f = fixture(t);
  f.put("features/extra.js", "module.exports = 1;");
  f.put("biz-scripts/current/features/extra.js", "module.exports = 2;");
  const runtime = f.runtime();
  assert.throws(() => runtime.resolve("features/extra.js"), /not.*manifest|not.*declared/i);
  assert.throws(() => runtime.resolve("features/../core/sample.js"), /unsafe/i);
});

test("an activated current directory does not replace the running engine snapshot", (t) => {
  const f = fixture(t);
  const runtime = f.runtime();
  f.put("biz-scripts/current/features/video/entry.js", 'module.exports = { action: "later" };');
  assert.equal(require(runtime.resolve("features/video/entry.js")).action, "curve");
  assert.equal(runtime.state.version, "20260910.100000001");
  const resolved = runtime.resolve("features/video/entry.js");
  runtime.cleanup();
  assert.equal(fs.existsSync(resolved), false);
  assert.equal(fs.existsSync(path.join(f.currentDir, "version.json")), true);
});

test("missing baseline metadata keeps APK business available but disables overlay loading", (t) => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.root, "biz-script-baseline.json"));
  const runtime = f.runtime();
  assert.equal(runtime.state.source, "baseline");
  assert.equal(runtime.state.hotUpdateAllowed, false);
  assert.equal(require(runtime.resolve("features/video/entry.js")).action, "baseline");
});

test("an execution-failed package is quarantined on the next engine without mixing the current engine", (t) => {
  const f = fixture(t);
  const runtime = f.runtime();
  runtime.markFailed(new Error("business entry failed"));
  assert.equal(runtime.state.source, "overlay");
  runtime.cleanup();
  const nextEngine = f.runtime();
  assert.equal(nextEngine.state.source, "baseline");
  assert.match(nextEngine.state.rejectionReason, /previously failed/i);
  f.overlay.version = "20260910.100000002";
  f.save();
  assert.equal(f.runtime().state.source, "overlay", "a newly versioned fix can load");
});

test("a malformed current overlay records its manifest fingerprint when startup validation fails", (t) => {
  const f = fixture(t);
  f.put("biz-scripts/current/version.json", JSON.stringify({ version: f.overlay.version, sourceSha256: f.overlay.sourceSha256, baseCompatibilityId: f.overlay.baseCompatibilityId, files: [] }));
  const runtime = f.runtime();
  assert.equal(runtime.state.source, "baseline");
  runtime.markFailed(new Error("manifest validation failed"));
  const rejected = JSON.parse(fs.readFileSync(path.join(f.root, "biz-scripts", "rejected.json"), "utf8"));
  assert.equal(rejected.version, f.overlay.version);
  assert.equal(rejected.sourceSha256, f.overlay.sourceSha256);
  assert.equal(rejected.baseCompatibilityId, f.overlay.baseCompatibilityId);
});

for (const stale of [false, true]) {
  test(`main bootstrap selects a validated ${stale ? "baseline" : "overlay"} before its first business import`, (t) => {
    const f = fixture(t);
    if (stale) { f.overlay.version = "9.8.56232"; f.save(); }
    f.put("config.js", "module.exports = {};");
    f.put("core/accessibility.js", "module.exports = {};");
    const config = { runtime: {}, output: {}, deviceProfile: {} }, handlers = {};
    const stop = new Error("fixture reached application services");
    const context = vm.createContext({
      console: { info() {} },
      files: { cwd: () => f.root, exists: fs.existsSync, join: (...parts) => parts.join("/") },
      events: { on: (name, handler) => { handlers[name] = handler; } },
      require(target) {
        if (target === `${f.root}/config.js`) return config;
        if (target === `${f.root}/app/biz-script-runtime.js`) return { createBizScriptRuntime };
        if (target === `${f.root}/app/biz-script-updater.js`) return { createDefaultDeps: () => f.deps };
        if (target === `${f.root}/core/logger.js`) throw stop;
        return require(target);
      }
    });
    assert.throws(() => vm.runInContext(fs.readFileSync(path.join(__dirname, "../main.module.js"), "utf8"), context), (error) => error === stop);
    const loaded = context.localRequire("features/video/entry.js");
    assert.equal(loaded.action, stale ? "baseline" : "curve");
    assert.equal(config.runtime.bizScriptsVersion, stale ? f.baseline.version : f.overlay.version);
    if (!stale) assert.throws(() => context.localBaselineRequire("features/video/entry.js"), /mixed business/i);
    assert.equal(typeof handlers.exit, "function");
    handlers.exit();
    assert.equal(fs.existsSync(`${f.currentDir}/version.json`), true);
  });
}
