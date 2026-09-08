import { describe, expect, test } from "bun:test";
import { cleanLiveCommentCandidates } from "./live-comment-candidate-cleaning";

describe("live comment candidate cleaning", () => {
  test("accepts Chinese text, digits and approved punctuation without changing the source", () => {
    expect(cleanLiveCommentCandidates([
      { id: "a", commentText: "新品123，值得买吗？", normalizedValue: "新品123，值得买吗？" },
      { id: "b", commentText: "第二条。", normalizedValue: "第二条。" }
    ])).toEqual({
      accepted: ["a", "b"],
      rejected: [],
      duplicates: []
    });
  });

  test("rejects a whole comment when any character is outside the whitelist", () => {
    expect(cleanLiveCommentCandidates([
      { id: "a", commentText: "保真#低价", normalizedValue: "保真#低价" },
      { id: "b", commentText: "欢迎进直播间", normalizedValue: "欢迎进直播间" }
    ])).toEqual({
      accepted: ["b"],
      rejected: ["a"],
      duplicates: []
    });
  });

  test("filters duplicate normalized values while retaining the first candidate", () => {
    expect(cleanLiveCommentCandidates([
      { id: "a", commentText: "好１", normalizedValue: "好1" },
      { id: "b", commentText: "好1", normalizedValue: "好1" }
    ])).toEqual({
      accepted: ["a"],
      rejected: [],
      duplicates: ["b"]
    });
  });
});
