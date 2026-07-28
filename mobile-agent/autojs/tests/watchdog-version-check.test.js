var assert = require("assert");
var fs = require("fs");
var path = require("path");

function testWatchdogDefersVersionCheckUntilRegistrationCompletes() {
  var source = fs.readFileSync(path.join(__dirname, "../watchdog.js"), "utf8");
  var uploaderIndex = source.indexOf("var uploader = createUploader(config, logger, storage);");
  var readinessIndex = source.indexOf("var registrationReady =");
  var guardIndex = source.indexOf("if (!registrationReady)");
  var checkIndex = source.indexOf("uploader.checkAgentVersion();");

  assert(uploaderIndex >= 0, "watchdog should create an uploader before checking versions");
  assert(readinessIndex > uploaderIndex, "watchdog should derive registration readiness from the uploader");
  assert(guardIndex > readinessIndex, "watchdog should return before version checks when registration is incomplete");
  assert(checkIndex > guardIndex, "watchdog must not call checkAgentVersion before registration is ready");
}

testWatchdogDefersVersionCheckUntilRegistrationCompletes();

console.log("watchdog version check tests passed");
