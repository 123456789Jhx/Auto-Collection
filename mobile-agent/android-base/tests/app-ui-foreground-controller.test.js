const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const javaRoot = path.join(
  __dirname,
  "..",
  "src",
  "main",
  "java",
  "com",
  "agri",
  "video",
  "collector",
  "base"
);
const source = () => fs.readFileSync(path.join(javaRoot, "AppUiForegroundController.kt"), "utf8");

test("keeps an already foreground App unchanged", () => {
  const controller = source();

  assert.match(controller, /AppUiState\.FOREGROUND\s*->\s*Result\.ALREADY_FOREGROUND/);
  assert.match(controller, /fun ensureForeground\(state: AppUiState\)/);
});

test("restores an existing background task instead of launching the package again", () => {
  const controller = source();
  const manifest = fs.readFileSync(path.join(__dirname, "..", "src", "main", "AndroidManifest.xml"), "utf8");
  const packaging = fs.readFileSync(path.join(__dirname, "..", "..", "..", "scripts", "package-autojs-apk.ps1"), "utf8");

  assert.match(controller, /AppUiState\.BACKGROUND\s*->\s*restoreExistingTask/);
  assert.match(controller, /appTask\.moveToFront\(\)/);
  const foregroundBlock = controller.slice(
    controller.indexOf("fun ensureForeground(state: AppUiState)"),
    controller.indexOf("fun removeTask()"),
  );
  assert.doesNotMatch(foregroundBlock, /finishAndRemoveTask/);
  assert.match(manifest, /android\.permission\.REORDER_TASKS/);
  assert.doesNotMatch(packaging, /"android\.permission\.REORDER_TASKS",/);
});

test("removes only the App UI task for exit without force-stopping the package", () => {
  const controller = source();

  assert.match(controller, /fun removeTask\(\)/);
  assert.match(controller, /fun removeTask\(state: AppUiState\)/);
  assert.match(controller, /AppUiState\.NOT_RUNNING\s*->\s*Result\.NO_UI_TASK/);
  assert.match(controller, /finishAndRemoveTask\(\)/);
  assert.match(controller, /Result\.REMOVED_EXISTING_TASK/);
  assert.match(controller, /Result\.REMOVE_TASK_FAILED/);
  assert.doesNotMatch(controller, /killProcess|am force-stop|stopService/i);
});

test("launches one task only when the App UI is not running", () => {
  const controller = source();

  assert.match(controller, /AppUiState\.NOT_RUNNING\s*->\s*launchNewTask/);
  assert.match(controller, /getLaunchIntentForPackage\(context\.packageName\)/);
  assert.match(controller, /Intent\.FLAG_ACTIVITY_NEW_TASK/);
  assert.match(controller, /Intent\.FLAG_ACTIVITY_CLEAR_TOP/);
  assert.match(controller, /Intent\.FLAG_ACTIVITY_SINGLE_TOP/);
  assert.match(controller, /context\.startActivity\(launchIntent\)/);
});

test("refuses to launch when task inspection is unknown", () => {
  const controller = source();

  assert.match(controller, /AppUiState\.UNKNOWN\s*->\s*Result\.STATE_UNKNOWN/);
  assert.match(controller, /@Synchronized/);
});
