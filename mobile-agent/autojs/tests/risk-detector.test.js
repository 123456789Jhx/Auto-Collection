var assert = require("assert");
var riskDetector = require("../domain/risk-detector.js");

function testDetectsImagePlatformVerification() {
  var result = riskDetector.detectRisk({}, "具有旋转特性的东西\n请选择所有符合上述描述的图片\n拖拽到这里");
  assert.deepStrictEqual(result, {
    detected: true,
    reasonCode: "PLATFORM_VERIFICATION",
    message: "出现平台验证"
  });
}

function testKeepsExistingRiskDetectionCompatible() {
  assert.strictEqual(riskDetector.containsRisk({}, "请完成验证"), true);
  assert.deepStrictEqual(riskDetector.detectRisk({}, "直播间正常内容"), { detected: false });
}

testDetectsImagePlatformVerification();
testKeepsExistingRiskDetectionCompatible();
console.log("risk detector tests passed");
