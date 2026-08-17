const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "../..");
const packagerPath = path.join(repoRoot, "scripts", "package-autojs-apk.ps1");
const packager = fs.readFileSync(packagerPath, "utf8");

assert.match(packager, /\[ValidateSet\("development",\s*"production"\)\]\s*\[string\]\$Environment/);
assert.match(packager, /\[string\]\$ApiBaseUrl/);
assert.match(packager, /qk-api\.dafengchan\.top\/api\/v1/);
assert.match(packager, /base-connectivity\.json/);
assert.match(packager, /base-agent\.json/);
assert.match(packager, /development.*ApiBaseUrl|ApiBaseUrl.*development/s);
assert.match(packager, /SelectedEnvironment/);
assert.match(packager, /SelectedEnvironment\s*-eq\s*"development"/);
assert.match(packager, /localhost|127\.0\.0\.1/);

const autoJsRoot = path.resolve("D:/DevTools/Sources/AutoJs6");
if (fs.existsSync(autoJsRoot)) {
  const env = { ...process.env };
  delete env.MOBILE_REGISTRATION_SECRET;
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      packagerPath,
      "-Environment",
      "development",
      "-ApiBaseUrl",
      "http://192.168.50.10:3012/api/v1",
      "-SkipBuild"
    ],
    { cwd: repoRoot, env, encoding: "utf8" }
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

console.log("package-autojs-apk environment contract: PASS");
