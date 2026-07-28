import { describe, expect, test } from "bun:test";
import { validatePublishTopics } from "./publish-topics";

describe("publish topic validation", () => {
  test("requires the exact configured number of hash markers", () => {
    expect(validatePublishTopics("春耕 #一 #二 #三 #四", 5)).toEqual({
      valid: false,
      actualCount: 4,
      reason: "应有5个#，实际4个"
    });
    expect(validatePublishTopics("春耕 #一 #二 #三 #四 #五 #六", 5)).toEqual({
      valid: false,
      actualCount: 6,
      reason: "应有5个#，实际6个"
    });
  });

  test("rejects a hash marker without topic text and accepts five complete topics", () => {
    expect(validatePublishTopics("春耕 #一 #二 # #四 #五", 5)).toEqual({
      valid: false,
      actualCount: 5,
      reason: "第3个#后无文字"
    });
    expect(validatePublishTopics("春耕 #一 #二 #三 #四 #五", 5)).toEqual({
      valid: true,
      actualCount: 5,
      reason: ""
    });
  });
});
