import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLiveCommentVocabularyBatches,
  collectLiveCommentCandidates,
  saveLiveCommentVocabularyBatches
} from "../src/lib/live-comment-entry-candidates.ts";

test("merges equal comment bodies across devices and preserves every source", () => {
  const candidates = collectLiveCommentCandidates([
    {
      id: "command-a",
      deviceId: "device-id-a",
      deviceCode: "device-a",
      deviceName: "设备 A",
      resultJson: {
        comments: [{
          commentId: "comment-a",
          roomKey: "room-1",
          commentText: "  这个方法 很实用  ",
          sources: [
            { pageIndex: 0, userName: "用户甲" },
            { pageIndex: 2, userName: "用户乙" }
          ]
        }]
      }
    },
    {
      id: "command-b",
      deviceId: "device-id-b",
      deviceCode: "device-b",
      deviceName: "设备 B",
      resultJson: {
        comments: [
          { pageIndex: 1, userName: "用户丙", commentText: "这个方法 很实用" },
          { pageIndex: 3, userName: "用户丁", commentText: "怎么买" }
        ]
      }
    }
  ]);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].commentText, "这个方法 很实用");
  assert.equal(candidates[0].sources.length, 3);
  assert.deepEqual(candidates[0].sources.map((source) => source.deviceName), ["设备 A", "设备 A", "设备 B"]);
  assert.deepEqual(candidates[0].sources.map((source) => source.pageIndex), [0, 2, 1]);
  assert.equal(candidates[1].commentText, "怎么买");
});

test("uses the command device UUID instead of the mobile device-code scope", () => {
  const [candidate] = collectLiveCommentCandidates([{
    id: "command-a",
    deviceId: "database-device-uuid",
    deviceCode: "phone-device-code",
    deviceName: "设备 A",
    resultJson: {
      comments: [{
        deviceId: "phone-device-code",
        commentText: "候选评论",
        sources: [{ deviceId: "phone-device-code", pageIndex: 0, userName: "用户甲" }]
      }]
    }
  }]);

  assert.equal(candidate.sources[0].deviceId, "database-device-uuid");
  assert.equal(candidate.sources[0].deviceCode, "phone-device-code");
});

test("builds unique vocabulary requests of at most one hundred comments", () => {
  const values = Array.from({ length: 205 }, (_, index) => `评论 ${index}`);
  values.push(" 评论 0 ");
  const batches = buildLiveCommentVocabularyBatches(values);

  assert.deepEqual(batches.map((batch) => batch.length), [100, 100, 5]);
  assert.equal(batches.flat().length, 205);
  assert.throws(
    () => buildLiveCommentVocabularyBatches(["x".repeat(101)]),
    /超过 100 字/
  );
});

test("deduplicates with the vocabulary trim, NFKC and lowercase key while preserving first text", () => {
  const candidates = collectLiveCommentCandidates([{
    id: "command-a",
    deviceId: "device-a",
    resultJson: { comments: [
      { commentText: "  ＨＥＬＬＯ  ", userName: "甲" },
      { commentText: "hello", userName: "乙" }
    ] }
  }]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].commentText, "ＨＥＬＬＯ");
  assert.equal(candidates[0].sources.length, 2);
  assert.deepEqual(buildLiveCommentVocabularyBatches([" ＡＢＣ ", "abc", "Abc"]), [["ＡＢＣ"]]);
});

test("reports failed vocabulary batches so only those batches can be retried", async () => {
  const batches = [["评论 1", "评论 2"], ["评论 3"], ["评论 4"]];
  const attempted = [];
  const result = await saveLiveCommentVocabularyBatches(batches, async (comments) => {
    attempted.push(comments);
    if (comments.includes("评论 3")) throw new Error("temporary failure");
  });

  assert.equal(result.savedCount, 3);
  assert.deepEqual(result.failures, [{ comments: ["评论 3"], message: "temporary failure" }]);
  assert.deepEqual(attempted, batches);

  const retry = await saveLiveCommentVocabularyBatches(
    result.failures.map((failure) => failure.comments),
    async () => undefined
  );
  assert.deepEqual(retry, { savedCount: 1, failures: [] });
});

test("counts unique API entry ids instead of attempted comments", async () => {
  const result = await saveLiveCommentVocabularyBatches([["评论 1", "评论 2"]], async () => [
    { id: "entry-a" },
    { id: "entry-a" }
  ]);
  assert.deepEqual(result, { savedCount: 1, failures: [] });

  const withoutIds = await saveLiveCommentVocabularyBatches([["评论 3"]], async () => [{}]);
  assert.deepEqual(withoutIds, { savedCount: 1, failures: [] });
});
