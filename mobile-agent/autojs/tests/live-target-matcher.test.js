var assert = require("assert");
var matcher = require("../domain/live-target-matcher.js");

function testNormalizesRoomNamesBeforeSimilarity() {
  assert.strictEqual(matcher.normalizeLiveTargetText("秭归 夏橙（官方）直播间"), "秭归夏橙");
  assert.strictEqual(matcher.normalizeLiveTargetText("ZIGUI-XIA CHENG 直播"), "ziguixiacheng");
}

function testMatchesTargetNameAtNinetyPercentSimilarity() {
  var result = matcher.findBestLiveTargetMatch("秭归夏橙直播", [
    {
      targetCode: "zigui_xiacheng",
      targetName: "秭归夏橙直播间",
      similarityThreshold: 0.9,
      aliases: []
    }
  ]);

  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.targetCode, "zigui_xiacheng");
  assert(result.similarity >= 0.9);
}

function testMatchesAliasInsteadOfOnlyExactKeyword() {
  var result = matcher.findBestLiveTargetMatch("夏橙助农专场 直播中", [
    {
      targetCode: "zigui_xiacheng",
      targetName: "秭归夏橙直播间",
      similarityThreshold: 0.9,
      aliases: [
        { aliasText: "夏橙助农", aliasType: "card_title", weight: 80 }
      ]
    }
  ]);

  assert.strictEqual(result.matched, true);
  assert.strictEqual(result.matchedAlias, "夏橙助农");
}

function testRejectsForbiddenKeywords() {
  var result = matcher.findBestLiveTargetMatch("秭归夏橙直播回放", [
    {
      targetCode: "zigui_xiacheng",
      targetName: "秭归夏橙直播间",
      similarityThreshold: 0.9,
      forbiddenKeywords: ["回放"],
      aliases: []
    }
  ]);

  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.reason, "forbidden_keyword");
}

function testProtectsVeryShortCandidateNames() {
  var result = matcher.findBestLiveTargetMatch("夏橙", [
    {
      targetCode: "zigui_xiacheng",
      targetName: "秭归夏橙直播间",
      similarityThreshold: 0.9,
      aliases: []
    }
  ]);

  assert.strictEqual(result.matched, false);
  assert.strictEqual(result.reason, "below_threshold");
}

testNormalizesRoomNamesBeforeSimilarity();
testMatchesTargetNameAtNinetyPercentSimilarity();
testMatchesAliasInsteadOfOnlyExactKeyword();
testRejectsForbiddenKeywords();
testProtectsVeryShortCandidateNames();

console.log("live-target-matcher tests passed");
