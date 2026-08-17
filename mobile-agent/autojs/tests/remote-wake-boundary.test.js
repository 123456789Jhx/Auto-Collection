const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const appDir = path.join(__dirname, "../app");
const boundaryPath = path.join(appDir, "remote-wake-boundary.js");

function listRemoteWakeSources() {
  return fs.readdirSync(appDir)
    .filter((fileName) => /^remote-wake.*\.js$/.test(fileName))
    .map((fileName) => path.join(appDir, fileName));
}

test("remote wake allows only the Liaoyuan Xinghuo package", () => {
  assert.equal(fs.existsSync(boundaryPath), true, "remote wake boundary module must exist");

  const boundary = require(boundaryPath);
  assert.equal(boundary.TARGET_PACKAGE, "com.agri.video.collector");
  assert.equal(
    boundary.assertAllowedTargetPackage("com.agri.video.collector"),
    "com.agri.video.collector"
  );
  assert.throws(
    () => boundary.assertAllowedTargetPackage("com.ss.android.ugc.aweme"),
    /remote_wake_target_not_allowed/
  );
});

test("remote wake production sources do not reference Douyin actions", () => {
  const sourcePaths = listRemoteWakeSources();
  assert(sourcePaths.length > 0, "at least one remote wake production source must exist");

  const forbiddenPatterns = [
    { label: "context.douyin", pattern: /context\s*\.\s*douyin/ },
    { label: "Douyin platform module", pattern: /platforms[\\/]+douyin/ },
    { label: "RESTART_APP command", pattern: /\bRESTART_APP\b/ },
    { label: "Douyin package", pattern: /com\.ss\.android\.ugc\.aweme/ }
  ];

  sourcePaths.forEach((sourcePath) => {
    const source = fs.readFileSync(sourcePath, "utf8");
    forbiddenPatterns.forEach(({ label, pattern }) => {
      assert.equal(
        pattern.test(source),
        false,
        `${path.basename(sourcePath)} must not reference ${label}`
      );
    });
  });
});

test("remote wake open flow never touches Android recent tasks", () => {
  const coordinator = fs.readFileSync(path.join(appDir, "remote-wake-coordinator.js"), "utf8");
  const bridge = fs.readFileSync(path.join(appDir, "remote-wake-command-bridge.js"), "utf8");
  assert.doesNotMatch(coordinator, /clearExistingTask|TASK_CLEARED|TASK_CLEAR_FAILED/);
  assert.doesNotMatch(bridge, /remote-wake-recents|createRemoteWakeRecents|recentsOptions/);
});

test("the inner Agent never executes the native-owned open command", () => {
  const bridge = fs.readFileSync(path.join(appDir, "remote-wake-command-bridge.js"), "utf8");
  assert.doesNotMatch(bridge, /coordinator\.execute\(command\)/);
});
