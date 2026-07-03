var assert = require("assert");
var fs = require("fs");
var path = require("path");

var source = fs.readFileSync(path.join(__dirname, "../src/routes/LiveCommentsPage.tsx"), "utf8");

function targetRoomMutationSource() {
  var start = source.indexOf("const targetRoomMutation = useMutation");
  var end = source.indexOf("const modeMutation = useMutation", start);
  assert(start >= 0 && end > start, "target room mutation block must exist");
  return source.slice(start, end);
}

function saveTargetRoomSource() {
  var start = source.indexOf("function saveTargetRoom()");
  var end = source.indexOf("if (summaryQuery.isLoading)", start);
  assert(start >= 0 && end > start, "save target room function must exist");
  return source.slice(start, end);
}

function testSavingTargetRoomUsesReplyPoolMode() {
  var block = targetRoomMutationSource();
  assert.strictEqual(
    /liveCommentMode\s*:\s*["']agri_chatbot["']/.test(block),
    false,
    "saving target room must not force agri_chatbot mode"
  );
  assert(
    /const liveCommentMode\s*=\s*["']target_follow["']/.test(saveTargetRoomSource()),
    "saving target room should start target_follow mode so replies are selected from replyPools"
  );
}

testSavingTargetRoomUsesReplyPoolMode();

console.log("live-comments-page tests passed");
