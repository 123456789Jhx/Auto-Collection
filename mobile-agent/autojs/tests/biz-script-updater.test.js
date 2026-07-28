const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  compareBizVersions,
  createBizScriptUpdater,
  validateManifest
} = require("../app/biz-script-updater.js");

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
    restarted: false,
    exists(path) {
      return files.has(path) || dirs.has(path) || descendants(path).length > 0;
    },
    ensureDir(path) {
      dirs.add(path);
    },
    remove(path) {
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
    moveDir(source, target) {
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
      if (path.endsWith("package.zip")) return "package-sha";
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

test("decodes URI paths while keeping updates inside business layers", () => {
  const files = validateManifest({
    version: "1.0.0",
    channel: "biz-scripts",
    files: [{ path: "features/%E7%83%AD%E6%9B%B4%E6%96%B0%E7%A4%BA%E4%BE%8B.js", sha256: "a".repeat(64) }]
  }, "1.0.0");
  assert.equal(files[0].path, "features/热更新示例.js");
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
      sha256: "package-sha",
      entryFile: "biz-script-manifest.json"
    }
  });

  assert.equal(result.applied, false);
  assert.equal(result.rolledBack, true);
  assert.equal(deps.files.get("/runtime/biz-scripts/current/features/example.js"), "old-feature");
  assert.equal(deps.restarted, false);
  assert.deepEqual(events.map((event) => event.eventType).slice(-2), ["FAILED", "ROLLBACK"]);
});
