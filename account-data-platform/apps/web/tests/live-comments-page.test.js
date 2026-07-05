import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "bun:test";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(currentDir, "../src/routes/LiveCommentsPage.tsx"), "utf8");

function targetRoomMutationSource() {
  const start = source.indexOf("const targetRoomMutation = useMutation");
  const end = source.indexOf("const modeMutation = useMutation", start);
  assert(start >= 0 && end > start, "target room mutation block must exist");
  return source.slice(start, end);
}

function saveTargetRoomSource() {
  const start = source.indexOf("function saveTargetRoom()");
  const end = source.indexOf("if (summaryQuery.isLoading)", start);
  assert(start >= 0 && end > start, "save target room function must exist");
  return source.slice(start, end);
}

function testSavingTargetRoomUsesReplyPoolMode() {
  const block = targetRoomMutationSource();
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

function testTargetRoomConfigUsesKeywordFieldsOnly() {
  const formSourceStart = source.indexOf("type TargetRoomFormValues");
  const formSourceEnd = source.indexOf("type CommandType", formSourceStart);
  const formSource = source.slice(formSourceStart, formSourceEnd);
  const builderStart = source.indexOf("function buildTargetRoomConfig");
  const builderEnd = source.indexOf("export function LiveCommentsPage", builderStart);
  const builderSource = source.slice(builderStart, builderEnd);

  assert(formSourceStart >= 0 && formSourceEnd > formSourceStart, "target room form values type must exist");
  assert(builderStart >= 0 && builderEnd > builderStart, "target room config builder must exist");
  assert(/searchKeywords/.test(formSource), "target room form should expose searchKeywords");
  assert(/matchKeywords/.test(formSource), "target room form should expose matchKeywords");
  assert(/searchKeywords\s*:\s*splitLines/.test(builderSource), "target room config should save searchKeywords");
  assert(/matchKeywords\s*:\s*splitLines/.test(builderSource), "target room config should save matchKeywords");
  assert.strictEqual(/allowRealSend/.test(formSource + builderSource), false, "target room config must not keep real-send switch");
}

test("保存目标直播间时使用话术库模式", () => {
  testSavingTargetRoomUsesReplyPoolMode();
});

test("目标直播间配置只保留关键词字段", () => {
  testTargetRoomConfigUsesKeywordFieldsOnly();
});
