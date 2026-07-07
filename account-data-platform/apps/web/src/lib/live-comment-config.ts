export const defaultLiveCommentConfig = {
  enabled: true,
  executeEnabled: false,
  manualExecutionApproved: false,
  groupName: "robot",
  leaderAccountNames: [],
  leaderAccountIds: [],
  triggerKeywords: ["水稻", "玉米", "蔬菜", "病虫害", "农机", "肥料"],
  replyPools: {
    A: ["这个要看苗情。", "这块经验挺实在。"],
    B: ["我们那边也遇到过。", "这个季节确实要多留意。"],
    C: ["先看地块情况更稳。", "不同地方处理不太一样。"]
  },
  sendDelayMinMs: 3000,
  sendDelayMaxMs: 12000,
  perDeviceCooldownSeconds: 120,
  localCommentCacheSize: 200,
  maxConsecutiveSendFailures: 3,
  perTaskMaxComments: 10,
  lowConfidenceAction: "skip"
};

export const defaultLiveCommentBotConfig = {
  enabled: true,
  botName: "三农聊天机器人",
  commentTypes: ["question", "agree", "experience_share", "knowledge_tip"],
  topicTags: ["水稻", "玉米", "蔬菜", "病虫害", "农机"],
  maxCommentsPerRoom: 3,
  maxCommentsPerHour: 10,
  minIntervalSeconds: 120,
  sendDelayMinMs: 3000,
  sendDelayMaxMs: 12000,
  roomRelevanceThreshold: 60,
  lowConfidenceAction: "skip",
  templatePools: {
    question: ["这个品种高温天咋管理？", "你们那边这季怎么控旺？", "这种情况先看苗情吗？"],
    agree: ["这个说法挺实在。", "确实，田间管理要看苗情。", "这点很多地块都能用上。"],
    experience_share: ["我们这边一般先看天气。", "这种还是要结合地块情况。", "水肥管理不能只按固定量。"],
    knowledge_tip: ["病虫害最好先分清类型。", "用肥还是要结合长势看。", "田里情况不一样，处理也要变。"]
  }
};

export function stringifyLiveCommentConfig(config?: Record<string, unknown> | null) {
  return JSON.stringify(config || defaultLiveCommentConfig, null, 2);
}

export type LiveCommentConfigParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

export function parseLiveCommentConfig(raw: string): LiveCommentConfigParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, error: "JSON 格式不正确" };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "直播评论配置必须是 JSON 对象" };
  }

  return { ok: true, value: parsed as Record<string, unknown> };
}

export function parseJsonObject(raw: string, label: string): LiveCommentConfigParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { ok: false, error: `${label} JSON 格式不正确` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: `${label} 必须是 JSON 对象` };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}

export const defaultP3ExtensionsConfig = {
  liveLike: {
    enabled: false,
    manualExecutionApproved: false,
    maxLikesPerLiveRoom: 0,
    minIntervalSeconds: 60,
    requireManualApproval: true
  },
  authorizedFollow: {
    enabled: false,
    manualExecutionApproved: false,
    requireEmployeeAuthorization: true,
    targetAccountId: "",
    targetAccountName: "",
    independentTaskOnly: true
  },
  linkage: {
    allowM1Input: false,
    allowM2Input: false,
    allowM3OutputToMaterialPool: false
  },
  commerceCardLiveComment: {
    enabled: false,
    executeEnabled: false,
    manualExecutionApproved: false,
    searchKeywords: ["夏橙"],
    matchKeywords: ["秭归", "夏橙"],
    liveSignals: ["直播中", "讲解中", "主播讲解", "进入直播间", "正在直播"],
    scanMinutesPerRound: 15,
    watchMinutesPerLive: 15,
    maxRounds: 3,
    maxCommentsPerRoom: 1,
    commentPool: ["111", "666", "👍", "🌹", "😊"]
  }
};

export function stringifyP3ExtensionsConfig(config?: Record<string, unknown> | null) {
  return JSON.stringify(config || defaultP3ExtensionsConfig, null, 2);
}

export function parseP3ExtensionsConfig(raw: string): LiveCommentConfigParseResult {
  return parseLiveCommentConfig(raw);
}
