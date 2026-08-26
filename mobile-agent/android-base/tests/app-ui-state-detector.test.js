const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const javaRoot = path.join(root, "src", "main", "java", "com", "agri", "video", "collector", "base");
const read = (name) => fs.readFileSync(path.join(javaRoot, name), "utf8");

test("defines the four App UI states independently from Agent state", () => {
  const model = read("AppUiState.kt");

  assert.match(model, /FOREGROUND\("foreground"\)/);
  assert.match(model, /BACKGROUND\("background"\)/);
  assert.match(model, /NOT_RUNNING\("not_running"\)/);
  assert.match(model, /UNKNOWN\("unknown"\)/);
  assert.doesNotMatch(model, /agent|heartbeat/i);
});

test("classifies foreground, background, missing task, and inspection failure", () => {
  const model = read("AppUiState.kt");

  assert.match(model, /if \(!inspectionSucceeded\) return UNKNOWN/);
  assert.match(model, /if \(!hasAppTask\) return NOT_RUNNING/);
  assert.match(model, /if \(hasForegroundActivity\) FOREGROUND else BACKGROUND/);
});

test("detector checks the top activity instead of foreground-service process importance", () => {
  const detector = read("AppUiStateDetector.kt");

  assert.match(detector, /activityManager\.appTasks/);
  assert.match(detector, /baseIntent\?\.component\?\.packageName/);
  assert.match(detector, /context\.packageName/);
  assert.match(detector, /getRunningTasks\(1\)/);
  assert.match(detector, /\?\.topActivity\s*\n\s*\?\.packageName/);
  assert.doesNotMatch(detector, /runningAppProcesses|IMPORTANCE_FOREGROUND/);
  assert.match(detector, /AppUiState\.classify/);
  assert.doesNotMatch(detector, /UsageStats|PACKAGE_USAGE_STATS|QUERY_ALL_PACKAGES/);
});

test("screen detector reports locked, unlocked, or unknown without accessibility", () => {
  const detector = read("ScreenStateDetector.kt");

  assert.match(detector, /KeyguardManager/);
  assert.match(detector, /PowerManager/);
  assert.match(detector, /isInteractive/);
  assert.match(detector, /if \(!powerManager\.isInteractive\) return ScreenState\.LOCKED/);
  assert.match(detector, /isKeyguardLocked/);
  assert.match(detector, /ScreenState\.LOCKED/);
  assert.match(detector, /ScreenState\.UNLOCKED/);
  assert.match(detector, /ScreenState\.UNKNOWN/);
  assert.doesNotMatch(detector, /AccessibilityService/);
});
