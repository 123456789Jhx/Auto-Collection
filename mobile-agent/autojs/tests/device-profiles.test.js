var assert = require("assert");
var profiles = require("../device-profiles.js");

function resolve(options) {
  return profiles.resolveDeviceProfile(options || {});
}

// 未识别的机型必须走 default，且取值与内置默认完全一致。
function testUnknownModelFallsBackToDefault() {
  var result = resolve({ device: { model: "SomeOtherPhone", brand: "generic" }, config: {} });

  assert.strictEqual(result.enabled, true, "默认应启用设备画像");
  assert.strictEqual(result.key, "default", "未识别机型应命中 default");
  assert.strictEqual(result.matchedBy, "default", "未识别机型匹配来源应为 default");
  assert.deepStrictEqual(result.values.capture, profiles.DEFAULT_VALUES.capture,
    "default 的截图策略应与内置默认一致");
  assert.deepStrictEqual(result.values.openDouyinWaitMs, [5000, 7000],
    "default 的打开抖音等待区间应为 5000~7000ms");
  assert(result.values.outputRoots.length > 0, "default 应保留公共目录候选");
}

// 机型匹配要忽略大小写与首尾空格。
function testModelMatchIgnoresCaseAndSpaces() {
  ["MI 8", "mi 8", " MI 8 ", "M1803E1A"].forEach(function (model) {
    var result = resolve({ device: { model: model }, config: {} });
    assert.strictEqual(result.key, "xiaomi_mi8", "机型 " + model + " 应命中小米8画像");
    assert.strictEqual(result.matchedBy, "model", "应按 model 命中");
  });

  ["23127PN0CC", "24129PN74C"].forEach(function (model) {
    var result = resolve({ device: { model: model }, config: {} });
    assert.strictEqual(result.key, "xiaomi_14", "机型 " + model + " 应命中小米14画像");
  });
}

// 小米14 未授予「所有文件访问」时公共目录不可写，画像里不保留候选，
// 避免每次启动都做 6 次注定失败的目录探测。
function testXiaomi14SkipsPublicOutputRoots() {
  var result = resolve({ device: { model: "23127PN0CC" }, config: {} });

  assert.deepStrictEqual(result.values.outputRoots, [], "小米14 应直接使用脚本目录");
  assert.strictEqual(result.values.capture.foregroundWaitMs, 1200,
    "小米14 拉起前台后应等待更久再弹授权");
  // 未被覆盖的字段必须继承默认值，保证画像可以只写差异项。
  assert.strictEqual(result.values.capture.useWorkerThread, true,
    "未覆盖的字段应继承默认值");
  assert.strictEqual(result.values.nodeQueryGraceMs, 0, "未覆盖的字段应继承默认值");
}

// 本地覆盖用于真机调试时临时改参数，优先级高于内置画像。
function testLocalOverrideBeatsBuiltIn() {
  var result = resolve({
    device: { model: "23127PN0CC" },
    config: { deviceProfile: { overrides: { openDouyinWaitMs: [8000, 9000] } } }
  });

  assert.strictEqual(result.source, "local_override", "本地覆盖应被标记");
  assert.deepStrictEqual(result.values.openDouyinWaitMs, [8000, 9000], "本地覆盖应生效");
  assert.strictEqual(result.values.capture.foregroundWaitMs, 1200,
    "本地覆盖不应影响未提到的内置差异项");
}

// 服务端下发的画像优先级最高，用于不重装 APK 就能调整机型行为。
function testServerOverrideBeatsEverything() {
  var result = resolve({
    device: { model: "23127PN0CC" },
    config: { deviceProfile: { overrides: { openDouyinWaitMs: [8000, 9000] } } },
    serverOverride: { openDouyinWaitMs: [2000, 3000], capture: { useWorkerThread: false } }
  });

  assert.strictEqual(result.source, "server_override", "服务端覆盖应被标记");
  assert.deepStrictEqual(result.values.openDouyinWaitMs, [2000, 3000], "服务端覆盖应压过本地覆盖");
  assert.strictEqual(result.values.capture.useWorkerThread, false, "服务端可覆盖嵌套字段");
  assert.strictEqual(result.values.capture.foregroundWaitMs, 1200,
    "服务端未提到的字段应保留画像值");
}

// forceKey 用于真机调试时把某台设备锁成指定画像。
function testForceKeyPinsProfile() {
  var result = resolve({
    device: { model: "MI 8" },
    config: { deviceProfile: { forceKey: "xiaomi_14" } }
  });

  assert.strictEqual(result.key, "xiaomi_14", "forceKey 应覆盖机型匹配结果");
  assert.strictEqual(result.matchedBy, "forceKey", "匹配来源应标记为 forceKey");
  assert.deepStrictEqual(result.values.outputRoots, [], "锁定画像后应使用该画像的取值");
}

// 一键停用：任何情况下都退回默认行为。
function testDisabledReturnsDefaults() {
  var result = resolve({
    device: { model: "23127PN0CC" },
    config: { deviceProfile: { enabled: false, overrides: { openDouyinWaitMs: [1, 2] } } }
  });

  assert.strictEqual(result.enabled, false, "停用后应标记 enabled=false");
  assert.deepStrictEqual(result.values.openDouyinWaitMs, [5000, 7000], "停用后应回到默认值");
  assert(result.values.outputRoots.length > 0, "停用后应回到默认目录候选");
}

// 画像写坏了不能让等待变成 0 或 NaN，必须回退。
function testPickWaitRangeRejectsInvalidValues() {
  var fallback = [5000, 7000];

  assert.deepStrictEqual(profiles.pickWaitRange([1000, 2000], fallback), [1000, 2000], "合法区间应透传");
  assert.deepStrictEqual(profiles.pickWaitRange(null, fallback), fallback, "空值应回退");
  assert.deepStrictEqual(profiles.pickWaitRange([1], fallback), fallback, "长度不足应回退");
  assert.deepStrictEqual(profiles.pickWaitRange(["a", "b"], fallback), fallback, "非数字应回退");
  assert.deepStrictEqual(profiles.pickWaitRange([-1, 100], fallback), fallback, "负数应回退");
  assert.deepStrictEqual(profiles.pickWaitRange([9000, 1000], fallback), fallback, "max 小于 min 应回退");
  assert.deepStrictEqual(profiles.pickWaitRange([0, 0], fallback), [0, 0], "0~0 是合法区间");
}

function testPickOutputRootsFiltersEmptyEntries() {
  assert.deepStrictEqual(profiles.pickOutputRoots({ values: { outputRoots: ["/a", "", null, "/b"] } }),
    ["/a", "/b"], "应过滤空值");
  assert.deepStrictEqual(profiles.pickOutputRoots({ values: { outputRoots: [] } }), [],
    "空数组应保持为空");
  assert.deepStrictEqual(profiles.pickOutputRoots(null), [], "画像缺失应返回空数组");
}

testUnknownModelFallsBackToDefault();
testModelMatchIgnoresCaseAndSpaces();
testXiaomi14SkipsPublicOutputRoots();
testLocalOverrideBeatsBuiltIn();
testServerOverrideBeatsEverything();
testForceKeyPinsProfile();
testDisabledReturnsDefaults();
testPickWaitRangeRejectsInvalidValues();
testPickOutputRootsFiltersEmptyEntries();

console.log("device profile tests passed");
