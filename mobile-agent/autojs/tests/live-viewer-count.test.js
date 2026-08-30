var assert = require("assert");
var viewerCount = require("../domain/live-viewer-count.js");

function testParsesPeopleAndWanUnits() {
  assert.strictEqual(viewerCount.parseViewerCount("在线 356 人"), 356);
  assert.strictEqual(viewerCount.parseViewerCount("1.2万人气"), 12000);
  assert.strictEqual(viewerCount.parseViewerBadgeCount("8500"), 8500);
  assert.strictEqual(viewerCount.parseViewerCount("1万+"), 10000);
  assert.strictEqual(viewerCount.parseViewerCount("观看 3,205"), 3205);
  assert.strictEqual(viewerCount.parseViewerCount("1.2W"), 12000);
}

function testRejectsUnrelatedText() {
  assert.strictEqual(viewerCount.parseViewerCount("直播间正常内容"), null);
  assert.strictEqual(viewerCount.parseViewerCount("300"), null);
  assert.strictEqual(viewerCount.parseViewerCount("0人"), 0);
  assert.strictEqual(viewerCount.parseViewerBadgeCount("18"), 18);
  assert.strictEqual(viewerCount.parseViewerBadgeCount("18 >"), 18);
}

testParsesPeopleAndWanUnits();
testRejectsUnrelatedText();
console.log("live viewer count tests passed");
