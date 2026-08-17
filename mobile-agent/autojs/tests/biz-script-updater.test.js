const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  compareBizVersions,
  createBizScriptUpdater,
  restartCurrentEngine,
  validateManifest
} = require("../app/biz-script-updater.js");

const PACKAGE_SHA = "d".repeat(64);

test("force-stops the complete AutoJS engine before using exit fallback", () => {
  let forceStopCount = 0;
  let exitCount = 0;
  const result = restartCurrentEngine({
    myEngine() {
      return { forceStop() { forceStopCount += 1; } };
    }
  }, () => { exitCount += 1; });

  assert.equal(result, "force_stop");
  assert.equal(forceStopCount, 1);
  assert.equal(exitCount, 0);
});

test("uses exit only when complete-engine stop is unavailable", () => {
  let exitCount = 0;
  const result = restartCurrentEngine({}, () => { exitCount += 1; });

  assert.equal(result, "exit");
  assert.equal(exitCount, 1);
});

function createMockDeps() {
  const files = new Map([
    ["/runtime/biz-scripts/current/features/example.js", "old-feature"],
    ["/runtime/biz-scripts/current/version.json", JSON.stringify({ version: "1.0.0" })]
  ]);
  const dirs = new Set([
    "/runtime/biz-scripts/current",
    "/runtime/biz-scripts/current/features"
  ]);

  function descendants(path) {
    const prefix = `${path}/`;
    return [...files.entries()].filter(([key]) => key.startsWith(prefix));
  }

  return {
    files,
    removed: [],
    restarted: false,
    exists(path) {
      return files.has(path) || dirs.has(path) || descendants(path).length > 0;
    },
    ensureDir(path) {
      dirs.add(path);
    },
    remove(path) {
      this.removed.push(path);
      files.delete(path);
      [...files.keys()].filter((key) => key.startsWith(`${path}/`)).forEach((key) => files.delete(key));
      [...dirs].filter((key) => key === path || key.startsWith(`${path}/`)).forEach((key) => dirs.delete(key));
    },
    copyDir(source, target) {
      dirs.add(target);
      descendants(source).forEach(([key, value]) => {
        files.set(`${target}${key.slice(source.length)}`, value);
      });
    },
    copyFile(source, target) {
      if (!files.has(source)) throw new Error(`missing file: ${source}`);
      files.set(target, files.get(source));
    },
    renameDir(source, target) {
      if (!this.exists(source)) throw new Error(`missing directory: ${source}`);
      this.remove(target);
      this.copyDir(source, target);
      this.remove(source);
    },
    readText(path) {
      if (!files.has(path)) throw new Error(`missing file: ${path}`);
      return files.get(path);
    },
    writeText(path, value) {
      files.set(path, value);
    },
    sha256File(path) {
      if (path.endsWith("package.zip")) return PACKAGE_SHA;
      return files.get(path) === "new-feature" ? "b".repeat(64) : "c".repeat(64);
    },
    download(_url, target) {
      files.set(target, "zip-bytes");
      return 9;
    },
    unzip(_zip, target) {
      dirs.add(target);
      dirs.add(`${target}/features`);
      files.set(`${target}/features/example.js`, "new-feature");
      files.set(`${target}/biz-script-manifest.json`, JSON.stringify({
        version: "1.1.0",
        channel: "biz-scripts",
        entryFile: "biz-script-manifest.json",
        files: [{ path: "features/example.js", sha256: "a".repeat(64) }]
      }));
    },
    now() {
      return 123456;
    },
    restart() {
      this.restarted = true;
    }
  };
}

test("compares dotted biz-script versions", () => {
  assert.equal(compareBizVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareBizVersions("1.0", "1.0.0"), 0);
  assert.equal(compareBizVersions("2.0.0", "2.0.1"), -1);
});

test("uses seconds interval while development hot reload is enabled", () => {
  const deps = createMockDeps();
  let now = 0;
  let checkCount = 0;
  deps.now = () => now;
  const updater = createBizScriptUpdater({
    app: { version: "9.9.9" },
    device: { deviceId: "device-ready" },
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: { bizScriptHotReloadEnabled: true, bizScriptHotReloadIntervalSeconds: 5 }
  }, { info() {}, warn() {} }, {
    checkAgentVersion() { checkCount += 1; return { updateAvailable: false }; },
    uploadAgentUpdateEvent() {}
  }, deps);

  updater.check(false);
  assert.equal(checkCount, 1);
  now = 4999;
  updater.check(false);
  assert.equal(checkCount, 1);
  now = 5000;
  updater.check(false);

  assert.equal(checkCount, 2);
});

test("retries a failed version query after a bounded backoff", () => {
  const deps = createMockDeps();
  let now = 0;
  let checkCount = 0;
  deps.now = () => now;
  const updater = createBizScriptUpdater({
    app: { version: "9.9.9" },
    device: { deviceId: "device-ready" },
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: { bizScriptVersionCheckIntervalMinutes: 30 }
  }, { info() {}, warn() {} }, {
    checkAgentVersion() { checkCount += 1; return null; },
    uploadAgentUpdateEvent() {}
  }, deps);

  updater.check(false);
  now = 59999;
  updater.check(false);
  assert.equal(checkCount, 1);
  now = 60000;
  updater.check(false);
  assert.equal(checkCount, 2);
});

test("accepts ASCII paths while keeping updates inside business layers", () => {
  const files = validateManifest({
    version: "1.0.0",
    channel: "biz-scripts",
    files: [{ path: "features/hot-update-example.js", sha256: "a".repeat(64) }]
  }, "1.0.0");
  assert.equal(files[0].path, "features/hot-update-example.js");
  assert.throws(() => validateManifest({
    version: "1.0.0",
    channel: "biz-scripts",
    files: [{ path: "config.js", sha256: "a".repeat(64) }]
  }, "1.0.0"), /outside business layers/);
});

test("uses the APK baseline version when no overlay exists", () => {
  const deps = createMockDeps();
  deps.remove("/runtime/biz-scripts/current");
  const updater = createBizScriptUpdater({
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: {}
  }, { info() {}, warn() {} }, { uploadAgentUpdateEvent() {} }, deps);
  assert.equal(updater.currentVersion(), "0.0.0");
});

test("queries biz-scripts without changing the APK version channel", () => {
  const deps = createMockDeps();
  const config = {
    app: { version: "9.9.9" },
    device: { deviceId: "device-ready" },
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: { versionChannel: "stable", bizScriptVersionCheckIntervalMinutes: 30 }
  };
  let observed;
  const updater = createBizScriptUpdater(config, { info() {}, warn() {} }, {
    checkAgentVersion() {
      observed = { version: config.app.version, channel: config.upload.versionChannel };
      return { updateAvailable: false };
    },
    uploadAgentUpdateEvent() {}
  }, deps);

  updater.check(true);
  assert.deepEqual(observed, { version: "1.0.0", channel: "biz-scripts" });
  assert.deepEqual({ version: config.app.version, channel: config.upload.versionChannel }, {
    version: "9.9.9",
    channel: "stable"
  });
});

test("defers biz-script checks until device registration has a device id", () => {
  const deps = createMockDeps();
  const config = {
    app: { version: "9.9.9" },
    device: { deviceId: "" },
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: { versionChannel: "stable", bizScriptVersionCheckIntervalMinutes: 30 }
  };
  let registered = false;
  let checkCount = 0;
  const updater = createBizScriptUpdater(config, { info() {}, warn() {} }, {
    isRegistered() {
      return registered;
    },
    checkAgentVersion() {
      checkCount += 1;
      return { updateAvailable: false };
    },
    uploadAgentUpdateEvent() {}
  }, deps);

  assert.deepEqual(updater.check(true), {
    checked: false,
    deferred: true,
    reason: "device_not_registered"
  });
  assert.equal(checkCount, 0);

  config.device.deviceId = "device-ready";
  registered = true;
  updater.check(true);
  assert.equal(checkCount, 1);
});

test("keeps the current overlay and reports rollback when file verification fails", () => {
  const deps = createMockDeps();
  const events = [];
  const updater = createBizScriptUpdater({
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: { bizScriptVersionCheckIntervalMinutes: 30 }
  }, { info() {}, warn() {} }, {
    uploadAgentUpdateEvent(event) {
      events.push(event);
    }
  }, deps);

  const result = updater.applyVersion({
    currentVersion: "1.0.0",
    latestVersion: {
      version: "1.1.0",
      channel: "biz-scripts",
      packageUrl: "http://localhost/package.zip",
      sha256: PACKAGE_SHA,
      entryFile: "biz-script-manifest.json"
    }
  });

  assert.equal(result.applied, false);
  assert.equal(result.rolledBack, false);
  assert.equal(deps.files.get("/runtime/biz-scripts/current/features/example.js"), "old-feature");
  assert.equal(deps.restarted, false);
  assert.equal(deps.removed.includes("/runtime/biz-scripts/current"), false);
  assert.deepEqual(events.map((event) => event.eventType).slice(-1), ["FAILED"]);
});

test("installs only files declared by the verified manifest", () => {
  const deps = createMockDeps();
  const originalUnzip = deps.unzip;
  deps.unzip = (zip, target) => {
    originalUnzip(zip, target);
    deps.files.set(`${target}/features/unlisted.js`, "unverified-code");
    deps.files.set(`${target}/biz-script-manifest.json`, JSON.stringify({
      version: "1.1.0",
      channel: "biz-scripts",
      files: [{ path: "features/example.js", sha256: "b".repeat(64) }]
    }));
  };
  const updater = createBizScriptUpdater({
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: {}
  }, { info() {}, warn() {} }, { uploadAgentUpdateEvent() {} }, deps);

  const result = updater.applyVersion({
    latestVersion: {
      version: "1.1.0",
      channel: "biz-scripts",
      packageUrl: "http://localhost/package.zip",
      sha256: PACKAGE_SHA
    }
  });

  assert.equal(result.applied, true);
  assert.equal(deps.files.get("/runtime/biz-scripts/current/features/example.js"), "new-feature");
  assert.equal(deps.files.has("/runtime/biz-scripts/current/features/unlisted.js"), false);
});

test("rejects downgrade and unsafe version identifiers before downloading", () => {
  const deps = createMockDeps();
  let downloads = 0;
  deps.download = () => { downloads += 1; };
  const updater = createBizScriptUpdater({
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: {}
  }, { info() {}, warn() {} }, { uploadAgentUpdateEvent() {} }, deps);

  const downgrade = updater.applyVersion({ latestVersion: {
    version: "0.9.0", channel: "biz-scripts", packageUrl: "http://localhost/old.zip", sha256: "a".repeat(64)
  } });
  const unsafe = updater.applyVersion({ latestVersion: {
    version: "../1.2.0", channel: "biz-scripts", packageUrl: "http://localhost/unsafe.zip", sha256: "a".repeat(64)
  } });
  const missingSha = updater.applyVersion({ latestVersion: {
    version: "1.2.0", channel: "biz-scripts", packageUrl: "http://localhost/no-sha.zip"
  } });
  const unsafeManifest = updater.applyVersion({ latestVersion: {
    version: "1.2.0", channel: "biz-scripts", packageUrl: "http://localhost/unsafe-manifest.zip",
    sha256: "a".repeat(64), entryFile: "../manifest.json"
  } });

  assert.equal(downgrade.applied, false);
  assert.match(downgrade.message, /newer/);
  assert.equal(unsafe.applied, false);
  assert.match(unsafe.message, /invalid biz-scripts version/);
  assert.match(missingSha.message, /sha256/);
  assert.match(unsafeManifest.message, /manifest entry/);
  assert.equal(downloads, 0);
});

test("restores the previous overlay when atomic activation fails", () => {
  const deps = createMockDeps();
  const originalUnzip = deps.unzip;
  const originalRename = deps.renameDir;
  deps.unzip = (zip, target) => {
    originalUnzip(zip, target);
    deps.files.set(`${target}/biz-script-manifest.json`, JSON.stringify({
      version: "1.1.0",
      channel: "biz-scripts",
      files: [{ path: "features/example.js", sha256: "b".repeat(64) }]
    }));
  };
  deps.renameDir = function (source, target) {
    if (/\/next$/.test(source) && /\/current$/.test(target)) throw new Error("activation failed");
    return originalRename.call(this, source, target);
  };
  const events = [];
  const updater = createBizScriptUpdater({
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: {}
  }, { info() {}, warn() {} }, {
    uploadAgentUpdateEvent(event) { events.push(event); }
  }, deps);

  const result = updater.applyVersion({ latestVersion: {
    version: "1.1.0", channel: "biz-scripts", packageUrl: "http://localhost/package.zip", sha256: PACKAGE_SHA
  } });

  assert.equal(result.applied, false);
  assert.equal(result.rolledBack, true);
  assert.equal(deps.files.get("/runtime/biz-scripts/current/features/example.js"), "old-feature");
  assert.deepEqual(events.map((event) => event.eventType).slice(-2), ["FAILED", "ROLLBACK"]);
});

test("does not start a second check while an update is downloading", () => {
  const deps = createMockDeps();
  const originalDownload = deps.download;
  let updater;
  let nestedResult;
  let queryCount = 0;
  deps.download = (url, target) => {
    nestedResult = updater.check(true);
    return originalDownload(url, target);
  };
  updater = createBizScriptUpdater({
    app: { version: "9.9.9" },
    device: { deviceId: "device-ready" },
    runtime: { scriptDir: "/runtime", bizScriptRoot: "/runtime/biz-scripts" },
    upload: {}
  }, { info() {}, warn() {} }, {
    checkAgentVersion() {
      queryCount += 1;
      return { updateAvailable: true, latestVersion: {
        version: "1.1.0", channel: "biz-scripts", packageUrl: "http://localhost/package.zip", sha256: PACKAGE_SHA
      } };
    },
    uploadAgentUpdateEvent() {}
  }, deps);

  updater.check(true);

  assert.deepEqual(nestedResult, { checked: false, skipped: true, reason: "check_in_progress" });
  assert.equal(queryCount, 1);
});
