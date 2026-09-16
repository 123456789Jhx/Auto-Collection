const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHeartbeatService } = require("../app/heartbeat.js");

test("immediate and periodic heartbeats report the pinned engine and separate pending version", () => {
  const payloads = [];
  const state = { source: "overlay", version: "20260910.2", baselineVersion: "20260910.1",
    hotUpdateAllowed: true, baseCompatibilityId: "b".repeat(64), sourceSha256: "c".repeat(64), apkBuildId: "apk" };
  const context = {
    config: { runtime: { bizScriptsVersion: state.version, bizScriptRuntimeState: state, pendingBizScriptsVersion: "20260910.3" }, upload: { enabled: true } },
    logger: { info() {}, warn() {} }, uploader: { uploadHeartbeat(p) { payloads.push(p); return { success: true }; } },
    floatyControl: { state: { paused: false, stopRequested: false } },
    counters: { phaseStartedAt: new Date().toISOString(), currentPhase: "video", plannedVideoMinutes: 15 }, heartbeat: {},
    bizScriptUpdater: { check() { return { checked: true }; } }
  };
  const service = createHeartbeatService(context);
  service.reportImmediateHeartbeat("video", "running", "active");
  service.writeHeartbeat("video", Date.now() - 60_000, Date.now() + 60_000);
  assert.equal(payloads.length, 2);
  for (const p of payloads) {
    assert.deepEqual(p.bizScriptRuntime, state);
    assert.equal(p.bizScriptsVersion, "20260910.2");
    assert.equal(p.pendingBizScriptsVersion, "20260910.3");
  }
});
