const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const vm = require("node:vm");
const { createBizScriptRuntime } = require("../app/biz-script-runtime.js");

const mainPath = path.join(__dirname, "../main.module.js");
const mainSource = fs.readFileSync(mainPath, "utf8");
const entryPath = "features/new-comment/command-bridge.js";
const businessPaths = Array.from(mainSource.matchAll(/localRequire\("((?:features|domain)\/[^\"]+)"\)/g), (match) => match[1]);
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const inventory = (files) => files.map((file) => `${file.path}:${file.sha256}`).sort().join("\n");

function fixture(t, defect) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "biz-startup-")).replace(/\\/g, "/");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const plainModule = "module.exports = {};";
  const files = businessPaths.map((relative) => {
    write(`${root}/${relative}`, plainModule);
    return { path: relative, sha256: sha(plainModule) };
  });
  assert.ok(businessPaths.includes(entryPath), "the fixture must exercise a real startup business import");
  write(`${root}/config.js`, plainModule);
  write(`${root}/core/accessibility.js`, plainModule);
  const deviceProfiles = 'module.exports = { resolveDeviceProfile: function () { return { key: "default", label: "未识别机型", matchedBy: "fallback", source: "builtin", values: { outputRoots: [] } }; } };';
  write(`${root}/device-profiles.js`, deviceProfiles);
  const baseFiles = [
    { path: "core/accessibility.js", sha256: sha(plainModule) },
    { path: "device-profiles.js", sha256: sha(deviceProfiles) }
  ];
  const baseline = {
    schemaVersion: 2, channel: "biz-scripts", version: "20260910.100000000",
    apkBuildId: "startup-fixture", files, baseFiles,
    sourceSha256: sha(inventory(files)),
    baseCompatibilityId: sha("autojs-biz-v2\n" + inventory(baseFiles))
  };
  write(`${root}/biz-script-baseline.json`, JSON.stringify(baseline));
  const currentDir = `${root}/biz-scripts/current`;
  const rejectionPath = `${root}/biz-scripts/rejected.json`;
  const deps = {
    exists: fs.existsSync, readText: (file) => fs.readFileSync(file, "utf8"),
    writeText: write, sha256Text: sha, sha256File: (file) => sha(fs.readFileSync(file)),
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    copyFile: (from, to) => write(to, fs.readFileSync(from)),
    remove: (file) => fs.rmSync(file, { recursive: true, force: true }), now: () => 123
  };
  function saveOverlay(version, failure) {
    const overlayFiles = [];
    businessPaths.forEach((relative) => {
      if (failure === "missing-entry" && relative === entryPath) return;
      const content = failure === "entry-throw" && relative === entryPath
        ? 'throw new Error("fixture business entry failed");' : plainModule;
      write(`${currentDir}/${relative}`, content);
      overlayFiles.push({ path: relative, sha256: sha(content) });
    });
    const metadata = {
      schemaVersion: 2, channel: "biz-scripts", version,
      files: overlayFiles, sourceSha256: sha(inventory(overlayFiles)),
      baseCompatibilityId: baseline.baseCompatibilityId
    };
    write(`${currentDir}/version.json`, JSON.stringify(metadata));
    return metadata;
  }
  const overlay = saveOverlay("20260910.100000001", defect);

  function boot(mode) {
    const config = { runtime: {}, output: {}, task: {}, deviceProfile: {} }, handlers = {};
    const initializerError = new Error("fixture initializer failed");
    const taskError = new Error("fixture task failed");
    let mainCalled = false, failure;
    // Dependency factories stay inert while the complete production bootstrap executes.
    let dependency;
    dependency = new Proxy(function () { return dependency; }, { get: () => dependency });
    const context = vm.createContext({
      console: { info() {} }, storages: { create: () => dependency },
      files: { cwd: () => root, exists: fs.existsSync, join: (...parts) => parts.join("/") },
      events: { on: (name, handler) => { handlers[name] = handler; } },
      require(target) {
        if (target === `${root}/config.js`) return config;
        if (target === `${root}/app/biz-script-runtime.js`) return { createBizScriptRuntime };
        if (target === `${root}/app/biz-script-updater.js`) {
          return { createDefaultDeps: () => deps, createBizScriptUpdater: () => dependency };
        }
        if (target === `${root}/core/logger.js` && mode === "initializer-throw") {
          return { createLogger() { throw initializerError; } };
        }
        if (target === `${root}/app/collector-app.js`) {
          return { createCollectorApp: () => ({ main() {
            mainCalled = true;
            if (mode === "task-throw") throw taskError;
          } }) };
        }
        if (/\/(features|domain)\//.test(target)) require(target);
        return dependency;
      }
    });
    try { vm.runInContext(mainSource, context, { filename: mainPath }); } catch (error) { failure = error; }
    assert.equal(typeof handlers.exit, "function");
    handlers.exit();
    return { config, failure, mainCalled, initializerError, taskError };
  }
  return { baseline, overlay, rejectionPath, currentDir, saveOverlay, boot };
}

for (const defect of ["missing-entry", "entry-throw", "initializer-throw"]) {
  test(`the real main quarantines ${defect}, boots the APK next, and accepts a repaired new version`, (t) => {
    const f = fixture(t, defect);
    const first = f.boot(defect);
    if (defect === "missing-entry") assert.match(String(first.failure), /not declared in manifest/);
    if (defect === "entry-throw") assert.match(String(first.failure), /fixture business entry failed/);
    if (defect === "initializer-throw") assert.equal(first.failure, first.initializerError);
    assert.equal(first.mainCalled, false);
    assert.equal(first.config.runtime.bizScriptRuntimeState.source, "overlay", "a failed engine must not mix sources");
    assert.equal(first.config.runtime.bizScriptsVersion, f.overlay.version);
    const rejection = JSON.parse(fs.readFileSync(f.rejectionPath, "utf8"));
    for (const field of ["version", "sourceSha256", "baseCompatibilityId"]) {
      assert.equal(rejection[field], f.overlay[field]);
    }
    assert.equal(fs.existsSync(`${f.currentDir}/version.json`), true);

    const fallback = f.boot("normal");
    assert.equal(fallback.failure, undefined);
    assert.equal(fallback.mainCalled, true);
    assert.equal(fallback.config.runtime.bizScriptRuntimeState.source, "baseline");
    assert.equal(fallback.config.runtime.bizScriptsVersion, f.baseline.version);

    const repaired = f.saveOverlay("20260910.100000002", "none");
    const recovered = f.boot("normal");
    assert.equal(recovered.failure, undefined);
    assert.equal(recovered.mainCalled, true);
    assert.equal(recovered.config.runtime.bizScriptRuntimeState.source, "overlay");
    assert.equal(recovered.config.runtime.bizScriptsVersion, repaired.version);
  });
}

test("an ordinary app.main task exception does not quarantine a successfully initialized overlay", (t) => {
  const f = fixture(t, "none");
  const first = f.boot("task-throw");
  assert.equal(first.failure, first.taskError);
  assert.equal(first.mainCalled, true);
  assert.equal(fs.existsSync(f.rejectionPath), false);
  const next = f.boot("normal");
  assert.equal(next.failure, undefined);
  assert.equal(next.mainCalled, true);
  assert.equal(next.config.runtime.bizScriptRuntimeState.source, "overlay");
  assert.equal(next.config.runtime.bizScriptsVersion, f.overlay.version);
});
