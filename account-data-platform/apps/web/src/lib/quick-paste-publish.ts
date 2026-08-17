import type { ManualPublishTestPayload } from "./api-client-publish-tasks";
import { parseMediaUrlPair, type MediaCoverSource } from "./media-url-pair";

export type QuickPastePlatform = "抖音" | "视频号";

export type QuickPastePublishData = {
  videoUrl: string;
  videoId: string;
  coverUrl: string;
  coverSource: MediaCoverSource;
  title: string;
  description: string;
  topics: string[];
};

export type QuickPasteParseResult = {
  value: QuickPastePublishData | null;
  errors: string[];
};

type PayloadInput = {
  configId: string;
  deviceId: string;
  platforms: QuickPastePlatform[];
  parsed: QuickPastePublishData;
};

type ParsedLines = {
  mediaText: string;
  title: string | null;
  description: string | null;
  errors: string[];
};

function parseLabeledLine(line: string, labels: string[]) {
  for (const label of labels) {
    const match = line.match(new RegExp("^\\s*" + label + "\\s*[:：]\\s*(.*?)\\s*$"));
    if (match) return match[1];
  }
  return null;
}

function normalizedBusinessLines(rawText: string) {
  const lines = rawText.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

function parseBusinessLines(lines: string[]): ParsedLines {
  if (lines.length === 3) {
    const mediaText = parseLabeledLine(lines[0], ["成片/封面"]);
    const title = parseLabeledLine(lines[1], ["抖音标题", "标题"]);
    const description = parseLabeledLine(lines[2], ["抖音描述", "描述"]);
    const errors: string[] = [];
    if (mediaText === null) errors.push("第 1 行必须以“成片/封面：”开头");
    if (title === null) errors.push("第 2 行必须以“抖音标题：”或“标题：”开头");
    if (description === null) errors.push("第 3 行必须以“抖音描述：”或“描述：”开头");
    return { mediaText: mediaText ?? "", title, description, errors };
  }

  if (lines.length === 4) {
    const videoUrl = parseLabeledLine(lines[0], ["成片"]);
    const coverUrl = parseLabeledLine(lines[1], ["封面"]);
    const title = parseLabeledLine(lines[2], ["抖音标题", "标题"]);
    const description = parseLabeledLine(lines[3], ["抖音描述", "描述"]);
    const errors: string[] = [];
    if (videoUrl === null) errors.push("第 1 行必须以“成片：”开头");
    if (coverUrl === null) errors.push("第 2 行必须以“封面：”开头");
    if (title === null) errors.push("第 3 行必须以“抖音标题：”或“标题：”开头");
    if (description === null) errors.push("第 4 行必须以“抖音描述：”或“描述：”开头");
    return { mediaText: [videoUrl, coverUrl].filter(Boolean).join("\n"), title, description, errors };
  }

  return {
    mediaText: "",
    title: null,
    description: null,
    errors: ["粘贴内容必须包含 3 行或 4 行"]
  };
}

export function extractVideoId(videoUrl: string) {
  return parseMediaUrlPair(videoUrl).videoId;
}

export function deriveCoverUrl(videoUrl: string) {
  return parseMediaUrlPair(videoUrl).coverUrl;
}

export function extractTopics(description: string) {
  return Array.from(description.matchAll(/#([^\s#]+)/g), (match) => match[1]);
}

export type TopicDescriptionValidation = {
  valid: boolean;
  actualCount: number;
  reason: string;
};

const TOPIC_SEPARATOR_PATTERN = /[\s#，,。；;！!？?]/;

export function validatePublishDescriptionTopics(description: string, expectedTopicCount = 5): TopicDescriptionValidation {
  const text = String(description ?? "");
  const expected = Math.max(1, Math.trunc(Number(expectedTopicCount) || 5));
  const markers = Array.from(text).reduce<number[]>((indexes, character, index) => {
    if (character === "#") indexes.push(index);
    return indexes;
  }, []);
  if (markers.length !== expected) {
    return { valid: false, actualCount: markers.length, reason: "应有" + expected + "个#，实际" + markers.length + "个" };
  }
  for (let index = 0; index < markers.length; index += 1) {
    const next = text[markers[index] + 1] ?? "";
    if (!next || TOPIC_SEPARATOR_PATTERN.test(next)) {
      return { valid: false, actualCount: markers.length, reason: "第" + (index + 1) + "个#后无文字" };
    }
  }
  return { valid: true, actualCount: markers.length, reason: "" };
}

export const validateTopicDescription = validatePublishDescriptionTopics;

type DirectMaterialConfig = {
  id: string;
  status: string;
  configPayload: Record<string, unknown>;
};

export function resolveDefaultDirectMaterialConfig<T extends DirectMaterialConfig>(configs: T[]) {
  const directConfigs = configs.filter((config) => (
    config.status === "ENABLED" && config.configPayload.sourceMode === "direct_material"
  ));
  const defaultConfigs = directConfigs.filter((config) => config.configPayload.isDefault === true);
  if (defaultConfigs.length > 1) return { config: null, issue: "multiple" as const };
  if (defaultConfigs.length === 1) return { config: defaultConfigs[0], issue: null };
  if (directConfigs.length) return { config: directConfigs[0], issue: "fallback" as const };
  return { config: null, issue: "missing" as const };
}

export function parseQuickPasteText(rawText: string, expectedTopicCount = 5): QuickPasteParseResult {
  const parsedLines = parseBusinessLines(normalizedBusinessLines(rawText));
  if (parsedLines.errors.length || parsedLines.title === null || parsedLines.description === null) {
    return { value: null, errors: parsedLines.errors };
  }

  const media = parseMediaUrlPair(parsedLines.mediaText);
  const errors = [...media.errors];
  const title = parsedLines.title.trim();
  const description = parsedLines.description.trim();
  if (!title) errors.push("标题不能为空");
  if (title.length > 500) errors.push("标题不能超过 500 字");
  if (!description) errors.push("描述不能为空");

  const topicValidation = validatePublishDescriptionTopics(description, expectedTopicCount);
  if (!topicValidation.valid) {
    if (topicValidation.actualCount !== Math.max(1, Math.trunc(Number(expectedTopicCount) || 5))) {
      errors.push("描述必须恰好包含 " + expectedTopicCount + " 个 #话题");
    } else {
      errors.push("每个 # 后必须紧跟非空话题文字");
    }
  }
  const topics = extractTopics(description);

  if (errors.length || !media.videoUrl || !media.videoId || !media.coverUrl) {
    return { value: null, errors };
  }

  return {
    value: {
      videoUrl: media.videoUrl,
      videoId: media.videoId,
      coverUrl: media.coverUrl,
      coverSource: media.coverSource,
      title,
      description,
      topics
    },
    errors: []
  };
}

export function buildManualPublishPayloads({
  configId,
  deviceId,
  platforms,
  parsed
}: PayloadInput): ManualPublishTestPayload[] {
  return platforms.map((platform) => ({
    configId,
    deviceId,
    platform,
    source: "QUICK_PASTE",
    videoUrl: parsed.videoUrl,
    coverUrl: parsed.coverUrl,
    title: parsed.title,
    description: parsed.description
  }));
}
