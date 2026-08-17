const assert = require("assert");
const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..");
const identityPath = path.join(projectRoot, "core", "agent-engine-identity.js");

assert.ok(fs.existsSync(identityPath), "shared Agent engine identity module must exist");

const identity = require(identityPath);
assert.strictEqual(identity.isEngineFileSource("main.js", "main.js"), true);
assert.strictEqual(identity.isEngineFileSource("/data/project/main.js", "main.js"), true);
assert.strictEqual(identity.isEngineFileSource("C:\\project\\main.js", "main.js"), true);
assert.strictEqual(identity.isEngineFileSource("main.module.js", "main.js"), false);
assert.strictEqual(identity.isEngineFileSource("/data/project/not-main.js", "main.js"), false);

const customNamedLauncher = {
  isDestroyed() {
    return false;
  },
  getSource() {
    return {
      getFile() {
        return {
          getCanonicalPath() {
            return "/data/user/0/com.agri.video.collector/files/project/launcher.js";
          }
        };
      },
      toString() {
        return "main.js";
      }
    };
  }
};
assert.strictEqual(
  identity.isEngineFile(customNamedLauncher, "main.js"),
  false,
  "a custom display name must not make launcher.js look like the Agent main.js engine"
);
assert.strictEqual(identity.isEngineFile(customNamedLauncher, "launcher.js"), true);

["watchdog.js", "main.js", "launcher.js"].forEach((fileName) => {
  const source = fs.readFileSync(path.join(projectRoot, fileName), "utf8");
  assert.match(source, /require\(files\.join\(SCRIPT_DIR, "core\/agent-engine-identity\.js"\)\)/);
  assert.doesNotMatch(source, /function isEngineFile\(/);
});

console.log("agent engine identity tests passed");
