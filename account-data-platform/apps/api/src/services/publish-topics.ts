export type PublishTopicValidation = {
  valid: boolean;
  actualCount: number;
  reason: string;
};

const TOPIC_SEPARATOR_PATTERN = /[\s#，,。；;！!？?]/;

// Keep this rule in sync with mobile-agent/autojs/domain/话题校验.js.
export function validatePublishTopics(description: string, expectedTopicCount = 5): PublishTopicValidation {
  const text = String(description ?? "");
  const expected = Math.max(1, Math.trunc(Number(expectedTopicCount) || 5));
  const markers: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "#") markers.push(index);
  }
  if (markers.length !== expected) {
    return {
      valid: false,
      actualCount: markers.length,
      reason: `应有${expected}个#，实际${markers.length}个`
    };
  }
  for (let index = 0; index < markers.length; index += 1) {
    const next = text[markers[index] + 1] ?? "";
    if (!next || TOPIC_SEPARATOR_PATTERN.test(next)) {
      return {
        valid: false,
        actualCount: markers.length,
        reason: `第${index + 1}个#后无文字`
      };
    }
  }
  return { valid: true, actualCount: markers.length, reason: "" };
}

export class PublishTopicsValidationError extends Error {
  readonly code = "PUBLISH_TASK_TOPICS_INVALID";

  constructor(readonly userMessage: string) {
    super(userMessage);
  }
}
