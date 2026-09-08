const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const fixtures = path.join(__dirname, "fixtures");
const script = path.join(__dirname, "..", "install-apk-usb.ps1");
const device = [{ Serial: "test-usb-device", State: "device" }];

function runInstaller(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adb-installer-test-"));
  const logPath = path.join(tempDir, "adb.jsonl");
  const apkPath = path.join(tempDir, "missing.apk");
  if (options.install) fs.writeFileSync(apkPath, "fake APK fixture");
  const env = { ...process.env };
  delete env.ADB_SERVER_SOCKET;
  delete env.ANDROID_ADB_SERVER_PORT;
  Object.assign(env, options.env, {
    FAKE_ADB_LOG: logPath,
    FAKE_ADB_SCRIPT: script,
    FAKE_ADB_SERVERS: JSON.stringify(options.servers || {}),
    FAKE_ADB_USER_ENV: JSON.stringify(options.userEnv || {}),
    FAKE_ADB_LISTENER: options.listener ? "1" : "0",
    FAKE_ADB_ALLOW_MUTATIONS: options.install ? "1" : "0",
    FAKE_ADB_PARAMETERS: JSON.stringify({
      AdbPath: path.join(fixtures, "fake-adb.ps1"),
      ApkPath: apkPath,
      ...(options.install ? {} : { CheckOnly: true }),
      ...options.parameters,
    }),
  });
  try {
    const result = spawnSync("powershell.exe", [
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
      path.join(fixtures, "run-install-apk-test.ps1"),
    ], { encoding: "utf8", env, timeout: 15000 });
    assert.ifError(result.error);
    const calls = fs.existsSync(logPath)
      ? fs.readFileSync(logPath, "utf8").trim().split(/\r?\n/).map(JSON.parse)
      : [];
    return { ...result, calls };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function assertCheckOnly(result, servers) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(result.calls.map((call) => call.Server), servers);
  assert.ok(result.calls.every((call) => call.Arguments.at(-1) === "devices"));
}

test("empty default discovery selects an existing local 5038 server", () => {
  assertCheckOnly(runInstaller({
    listener: true,
    servers: { "tcp:127.0.0.1:5038": device },
  }), ["tcp:127.0.0.1:5037", "tcp:127.0.0.1:5038"]);
});

test("explicit server port overrides both environment settings", () => {
  assertCheckOnly(runInstaller({
    parameters: { AdbServerPort: 5040 },
    env: { ADB_SERVER_SOCKET: "tcp:127.0.0.1:5039", ANDROID_ADB_SERVER_PORT: "5041" },
    servers: { "tcp:127.0.0.1:5040": device },
  }), ["tcp:127.0.0.1:5040"]);
});

test("process socket takes precedence over process and persisted ports", () => {
  assertCheckOnly(runInstaller({
    env: { ADB_SERVER_SOCKET: "tcp:127.0.0.1:5042", ANDROID_ADB_SERVER_PORT: "5043" },
    userEnv: { ADB_SERVER_SOCKET: "tcp:127.0.0.1:5038" },
    servers: { "tcp:127.0.0.1:5042": device },
  }), ["tcp:127.0.0.1:5042"]);
});

test("process port takes precedence over persisted socket", () => {
  assertCheckOnly(runInstaller({
    env: { ANDROID_ADB_SERVER_PORT: "5043" },
    userEnv: { ADB_SERVER_SOCKET: "tcp:127.0.0.1:5038" },
    servers: { "tcp:127.0.0.1:5043": device },
  }), ["tcp:127.0.0.1:5043"]);
});

test("old terminals can use the persisted user socket", () => {
  assertCheckOnly(runInstaller({
    userEnv: { ADB_SERVER_SOCKET: "tcp:127.0.0.1:5038" },
    servers: { "tcp:127.0.0.1:5038": device },
  }), ["tcp:127.0.0.1:5038"]);
});

test("persisted user port is used when no socket is configured", () => {
  assertCheckOnly(runInstaller({
    userEnv: { ANDROID_ADB_SERVER_PORT: "5044" },
    servers: { "tcp:127.0.0.1:5044": device },
  }), ["tcp:127.0.0.1:5044"]);
});

test("CheckOnly does not resolve a missing APK or apply MIUI changes", () => {
  assertCheckOnly(runInstaller({
    parameters: { PrepareMiuiDeveloperInstall: true },
    servers: { "tcp:127.0.0.1:5037": device },
  }), ["tcp:127.0.0.1:5037"]);
});

test("automatic discovery does not start an absent fallback server", () => {
  const result = runInstaller({ servers: { "tcp:127.0.0.1:5038": device } });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No authorized USB devices/);
  assert.deepEqual(result.calls.map((call) => call.Server), ["tcp:127.0.0.1:5037"]);
});

test("a configured empty server fails without falling back to another server", () => {
  const result = runInstaller({
    listener: true,
    env: { ADB_SERVER_SOCKET: "tcp:127.0.0.1:5045" },
    servers: { "tcp:127.0.0.1:5038": device },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No authorized USB devices/);
  assert.deepEqual(result.calls.map((call) => call.Server), ["tcp:127.0.0.1:5045"]);
});

test("all installation and verification commands use the selected server", () => {
  const result = runInstaller({
    install: true,
    listener: true,
    servers: { "tcp:127.0.0.1:5038": device },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.calls[0].Server, "tcp:127.0.0.1:5037");
  assert.ok(result.calls.slice(1).every((call) => call.Server === "tcp:127.0.0.1:5038"));
  assert.equal(result.calls.filter((call) => call.Arguments.includes("install")).length, 1);
  assert.equal(result.calls.filter((call) => call.Arguments.includes("uninstall")).length, 1);
  assert.equal(result.calls.filter((call) => call.Arguments.includes("dumpsys")).length, 1);
});
