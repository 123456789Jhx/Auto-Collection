var assert = require("assert");
var fs = require("fs");
var path = require("path");

var entryPath = path.join(__dirname, "../main.module.js");
var source = fs.readFileSync(entryPath, "utf8");

assert(source.indexOf('localRequire("app/remote-wake-command-bridge.js")') >= 0);
assert(source.indexOf("createRemoteWakeCommandBridge(context)") >= 0);
assert(source.indexOf("context.remoteWakeCommandBridge.install()") >= 0);
assert(
  source.indexOf("context.remoteWakeCommandBridge.install()") < source.indexOf("context.controlLoop = createControlLoop(context)"),
  "remote wake interception must be installed before the control loop is created"
);

console.log("remote wake entry wiring test passed");
