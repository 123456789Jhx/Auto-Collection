const assert = require("assert");
const fs = require("fs");
const path = require("path");
const test = require("node:test");

const script = fs.readFileSync(path.join(__dirname, "..", "package-autojs-apk.ps1"), "utf8");

test("APK packaging sources the only outer base from the main project", () => {
  assert.match(script, /mobile-agent\\android-base/);
  assert.match(script, /Sync-AndroidBase/);
  assert.match(script, /androidBaseManifestPath/);
  assert.match(script, /\[xml\]\$androidBaseManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath \$AndroidBaseManifestPath/);
  assert.match(script, /androidBaseComponentLines/);
  assert.match(script, /base-connectivity\.json/);
  assert.doesNotMatch(script, /android:name="com\.agri\.video\.collector\.base\.BaseConnectivityService"/);
  assert.doesNotMatch(script, /android:name="com\.agri\.video\.collector\.base\.BaseConnectivityBootReceiver"/);
});

test("APK packaging removes the legacy command-enabled base agent", () => {
  assert.match(script, /org\\autojs\\autojs\\inrt\\baseagent/);
  assert.match(script, /Remove-Item -LiteralPath \$legacyBaseAgentRoot -Recurse -Force/);
  assert.match(script, /org\.autojs\.autojs\.inrt\.baseagent\.BaseAgentForegroundService/);
  assert.match(script, /org\.autojs\.autojs\.inrt\.baseagent\.BaseAgentSystemReceiver/);
  assert.match(script, /tools:node=""remove""/);
});

test("APK packaging rewires the existing app start entry to the new service", () => {
  assert.match(script, /BaseConnectivityService\.start\(this\)/);
  assert.match(script, /com\.agri\.video\.collector\.base\.BaseConnectivityService/);
  assert.doesNotMatch(script, /Copy-Item[^\n]+D:\\DevTools[^\n]+BaseConnectivity/);
});
