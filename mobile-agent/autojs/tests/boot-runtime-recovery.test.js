const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const launcher = fs.readFileSync(path.join(__dirname, "../launcher.js"), "utf8");
const watchdog = fs.readFileSync(path.join(__dirname, "../watchdog.js"), "utf8");
const project = JSON.parse(fs.readFileSync(path.join(__dirname, "../project.json"), "utf8"));
const packager = fs.readFileSync(path.join(__dirname, "../../../scripts/package-autojs-apk.ps1"), "utf8");

const managedRuntimeCalls = launcher.match(/ensureManagedRuntime\(\);/g) || [];
assert.equal(managedRuntimeCalls.length, 1, "only the one-tap button may start the inner Agent");
assert.match(launcher, /ui\.oneTapStart\.click\(function \(\) \{\s*ensureManagedRuntime\(\);\s*\}\);/);
assert.doesNotMatch(launcher, /\}\);\s*ensureManagedRuntime\(\);\s*refreshStatus\(\);/);
assert.match(packager, /runOnBoot\s*=\s*\$false/);
assert.match(launcher, /storages\.create\("AgriVideoCollectorWatchdog"\)\.remove\("lastBeat"\)/);
assert.equal(project.launchConfig.runOnBoot, false);
assert.doesNotMatch(watchdog, /recordStage\("SYSTEM_BOOTED"/);

console.log("base-only boot tests passed");
