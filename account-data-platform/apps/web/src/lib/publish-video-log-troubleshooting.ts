export type PublishTroubleshootingRuntimeLog = {
  id: string;
  createdAt?: string | null;
  reportedAt?: string | null;
  level?: string | null;
  message?: string | null;
  stopReason?: string | null;
  contextJson?: Record<string, unknown> | null;
  deviceCode?: string | null;
  deviceName?: string | null;
};

export type PublishMilestoneKey = "preload" | "materialDownload" | "gateStart" | "gateDone" | "gateTimeout";

export type PublishMilestoneSummary = {
  key: PublishMilestoneKey;
  label: string;
  matched: boolean;
  count: number;
  firstAt?: string;
  lastAt?: string;
  latestLevel?: string;
};

type MilestoneDefinition = {
  key: PublishMilestoneKey;
  label: string;
  patterns: RegExp[];
};

export const publishTroubleshootingPresetKeywords = [
  "backend sync ready",
  "publish module preload ready",
  "发布素材下载开始",
  "发布素材下载完成",
  "发布素材下载失败",
  "发布前准备打开App",
  "抖音发布入口已点击",
  "抖音相机页已就绪",
  "发布动作闸口开始",
  "发布动作闸口完成",
  "等待选择发布素材目标状态超时",
  "publish video handler is not preloaded"
];

export const publishMilestoneDefinitions: MilestoneDefinition[] = [
  {
    key: "preload",
    label: "后台同步/预加载",
    patterns: [
      /backend\s+sync\s+ready/i,
      /publish\s+module\s+preload\s+ready/i,
      /publish\s+video\s+handler\s+is\s+not\s+preloaded/i,
      /publish\s+video\s+task/i,
      /预加载/,
      /发布任务.*开始/,
      /收到发布任务/
    ]
  },
  {
    key: "materialDownload",
    label: "素材下载",
    patterns: [
      /material\s+download/i,
      /download\s+material/i,
      /发布素材下载/,
      /素材下载/,
      /下载素材/,
      /视频下载/,
      /封面下载/
    ]
  },
  {
    key: "gateStart",
    label: "选择素材闸口开始",
    patterns: [
      /gate\s+start/i,
      /publish\s+gate\s+start/i,
      /发布动作闸口开始/,
      /门禁开始/,
      /开始门禁/,
      /等待门禁/
    ]
  },
  {
    key: "gateDone",
    label: "选择素材闸口完成",
    patterns: [
      /gate\s+(finish|done|pass|complete)/i,
      /publish\s+gate\s+(finish|done|pass|complete)/i,
      /发布动作闸口完成/,
      /门禁完成/,
      /门禁通过/,
      /门禁结束/
    ]
  },
  {
    key: "gateTimeout",
    label: "选择素材闸口超时",
    patterns: [
      /gate\s+timeout/i,
      /publish\s+gate\s+timeout/i,
      /等待选择发布素材目标状态超时/,
      /门禁超时/,
      /等待.*超时/
    ]
  }
];

const taskIdContextKeys = new Set([
  "taskId",
  "publishTaskId",
  "publishTaskDbId",
  "externalTaskId",
  "commandTaskId"
]);

const classificationContextKeys = new Set([
  "phase",
  "stage",
  "event",
  "action",
  "actionName",
  "status",
  "reason",
  "failureReason",
  "stopReason",
  "currentTask",
  "currentTaskType",
  "taskType"
]);

function stringifyValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalize(value: unknown) {
  return stringifyValue(value).toLowerCase();
}

function collectContextValues(value: unknown, keys: Set<string>, output: string[] = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectContextValues(item, keys, output));
    return output;
  }
  Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
    if (keys.has(key)) {
      output.push(stringifyValue(child));
    }
    collectContextValues(child, keys, output);
  });
  return output;
}

function buildClassificationText(log: PublishTroubleshootingRuntimeLog) {
  return [
    log.message,
    log.stopReason,
    ...collectContextValues(log.contextJson, classificationContextKeys)
  ].filter(Boolean).map(String).join(" ");
}

export function parseTroubleshootingKeywords(value: string) {
  return value
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function buildRuntimeLogSearchText(log: PublishTroubleshootingRuntimeLog) {
  return [
    log.message,
    log.stopReason,
    log.deviceCode,
    log.deviceName,
    stringifyValue(log.contextJson)
  ].filter(Boolean).map(String).join(" ");
}

export function matchesPublishTaskId(log: PublishTroubleshootingRuntimeLog, taskId: string) {
  const normalizedTaskId = taskId.trim().toLowerCase();
  if (!normalizedTaskId) return true;
  const knownContextValues = collectContextValues(log.contextJson, taskIdContextKeys).join(" ");
  return normalize([buildRuntimeLogSearchText(log), knownContextValues].join(" ")).includes(normalizedTaskId);
}

export function matchesTroubleshootingKeywords(log: PublishTroubleshootingRuntimeLog, keywords: string[]) {
  const normalizedKeywords = keywords.map((keyword) => keyword.trim().toLowerCase()).filter(Boolean);
  if (normalizedKeywords.length === 0) return true;
  const searchText = normalize(buildRuntimeLogSearchText(log));
  return normalizedKeywords.some((keyword) => searchText.includes(keyword));
}

export function classifyPublishLogMilestones(log: PublishTroubleshootingRuntimeLog) {
  const classificationText = buildClassificationText(log);
  return publishMilestoneDefinitions
    .filter((definition) => definition.patterns.some((pattern) => pattern.test(classificationText)))
    .map((definition) => definition.key);
}

function logTime(log: PublishTroubleshootingRuntimeLog) {
  return log.createdAt || log.reportedAt || "";
}

function timeValue(value?: string) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function summarizePublishMilestones(logs: PublishTroubleshootingRuntimeLog[]) {
  return publishMilestoneDefinitions.map<PublishMilestoneSummary>((definition) => {
    const matchedLogs = logs
      .filter((log) => classifyPublishLogMilestones(log).includes(definition.key))
      .sort((left, right) => timeValue(logTime(left)) - timeValue(logTime(right)));
    const latestWarnOrError = [...matchedLogs].reverse().find((log) => log.level === "WARN" || log.level === "ERROR");
    const latest = latestWarnOrError ?? matchedLogs[matchedLogs.length - 1];
    return {
      key: definition.key,
      label: definition.label,
      matched: matchedLogs.length > 0,
      count: matchedLogs.length,
      firstAt: matchedLogs[0] ? logTime(matchedLogs[0]) || undefined : undefined,
      lastAt: matchedLogs[matchedLogs.length - 1] ? logTime(matchedLogs[matchedLogs.length - 1]) || undefined : undefined,
      latestLevel: latest?.level || undefined
    };
  });
}
