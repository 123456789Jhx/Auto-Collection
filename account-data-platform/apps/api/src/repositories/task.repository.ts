import { collectionTasks, collectorDevices, deviceTaskConfigs } from "@pkg/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";
import { config } from "../config";
import { db } from "./db";

const defaultLiveCommentConfig = {
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

const defaultLiveCommentBotConfig = {
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
    question: ["这个品种高温天咋管理？", "你们那边这季怎么控旺？"],
    agree: ["这个说法挺实在。", "确实，田间管理要看苗情。"],
    experience_share: ["我们这边一般会先看天气。", "这种情况还是要结合地块情况。"],
    knowledge_tip: ["病虫害最好先分清类型再处理。", "水肥管理还是要结合长势看。"]
  }
};

const defaultP3ExtensionsConfig = {
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

function mergeNestedConfig(base: Record<string, unknown>, override?: Record<string, unknown> | null) {
  const result: Record<string, unknown> = { ...base };
  Object.entries(override || {}).forEach(([key, next]) => {
    const prev = result[key];
    if (prev && next && typeof prev === "object" && typeof next === "object" && !Array.isArray(prev) && !Array.isArray(next)) {
      result[key] = { ...(prev as Record<string, unknown>), ...(next as Record<string, unknown>) };
      return;
    }
    if (next !== undefined) {
      result[key] = next;
    }
  });
  return result;
}

export function resolveTaskConfig(task: typeof collectionTasks.$inferSelect, override?: Partial<typeof deviceTaskConfigs.$inferSelect> | null) {
  const mergedLiveCommentConfig = mergeNestedConfig(mergeNestedConfig(defaultLiveCommentConfig, task.liveCommentConfig), override?.liveCommentConfig);
  const liveCommentGroup = override?.liveCommentGroup ?? (typeof mergedLiveCommentConfig.groupName === "string" ? mergedLiveCommentConfig.groupName : null);
  const mergedLiveCommentBotConfig = mergeNestedConfig(
    mergeNestedConfig(defaultLiveCommentBotConfig, task.liveCommentBotConfig),
    override?.liveCommentBotConfig as Record<string, unknown> | null
  );

  return {
    ...task,
    videoMinutesMin: override?.videoMinutesMin ?? task.videoMinutesMin,
    videoMinutesMax: override?.videoMinutesMax ?? task.videoMinutesMax,
    liveMinutesMin: override?.liveMinutesMin ?? task.liveMinutesMin,
    liveMinutesMax: override?.liveMinutesMax ?? task.liveMinutesMax,
    autoStart: override?.autoStart ?? task.autoStart,
    collectComments: override?.collectComments ?? task.collectComments,
    commentLimit: override?.commentLimit ?? task.commentLimit,
    heartbeatMinutes: override?.heartbeatMinutes ?? task.heartbeatMinutes,
    liveCommentRole: override?.liveCommentRole ?? "none",
    liveCommentGroup,
    followedAccountName: override?.followedAccountName ?? null,
    followedAccountId: override?.followedAccountId ?? null,
    followedAliases: override?.followedAliases ?? [],
    liveCommentMode: override?.liveCommentMode ?? "agri_chatbot",
    liveCommentBotConfig: mergedLiveCommentBotConfig,
    liveCommentConfig: mergedLiveCommentConfig,
    p3ExtensionsConfig: mergeNestedConfig(mergeNestedConfig(defaultP3ExtensionsConfig, task.p3ExtensionsConfig), override?.p3ExtensionsConfig),
    // 设备画像覆盖原样透传给手机端，由手机端与 APK 内置画像合并后再使用。
    // 服务端不做字段合并，避免两端各有一套默认值而互相打架。
    deviceProfile: override?.deviceProfile ?? null
  };
}

const defaultSearchKeywords = ["水稻病虫害", "玉米病虫害", "大棚蔬菜"];
const defaultMatchKeywords = ["水稻", "玉米", "小麦", "农业", "农田", "病虫害", "农药", "大棚"];
const defaultTaskCode = "task_agri_interest_default";

export async function findCurrentTask(platform: string) {
  const [task] = await db
    .select()
    .from(collectionTasks)
    .where(
      and(
        eq(collectionTasks.tenantId, config.tenantId),
        eq(collectionTasks.platform, platform),
        eq(collectionTasks.status, "ENABLED"),
        isNull(collectionTasks.deletedAt)
      )
    )
    .orderBy(desc(collectionTasks.createdAt))
    .limit(1);

  if (task) {
    return task;
  }

  // 默认任务在租户内是单例（唯一键 tenant_id + task_code）。
  // 当设备 platform 与既有默认任务不一致（如 android）时，裸 INSERT 会触发唯一键冲突，
  // 进而让整个接口 500，所以这里必须做冲突兜底。
  const [created] = await db
    .insert(collectionTasks)
    .values({
      tenantId: config.tenantId,
      taskCode: defaultTaskCode,
      name: "农业兴趣浏览默认任务",
      platform,
      mode: "search",
      searchKeywords: defaultSearchKeywords,
      matchKeywords: defaultMatchKeywords,
      liveCommentConfig: defaultLiveCommentConfig,
      liveCommentBotConfig: defaultLiveCommentBotConfig,
      p3ExtensionsConfig: defaultP3ExtensionsConfig,
      heartbeatMinutes: 1,
      status: "ENABLED"
    })
    .onConflictDoNothing({ target: [collectionTasks.tenantId, collectionTasks.taskCode] })
    .returning();

  if (created) {
    return created;
  }

  // 唯一键已被占用：复用既有默认任务（platform 不同，或曾被软删除）
  const [existing] = await db
    .select()
    .from(collectionTasks)
    .where(and(eq(collectionTasks.tenantId, config.tenantId), eq(collectionTasks.taskCode, defaultTaskCode)))
    .orderBy(desc(collectionTasks.createdAt))
    .limit(1);

  if (existing && existing.deletedAt) {
    const [revived] = await db
      .update(collectionTasks)
      .set({ deletedAt: null, status: "ENABLED", updatedAt: new Date(), updatedBy: "system" })
      .where(eq(collectionTasks.id, existing.id))
      .returning();
    return revived ?? null;
  }

  return existing ?? null;
}

export async function findTaskByCode(taskCode: string) {
  const [task] = await db
    .select()
    .from(collectionTasks)
    .where(and(eq(collectionTasks.tenantId, config.tenantId), eq(collectionTasks.taskCode, taskCode), isNull(collectionTasks.deletedAt)))
    .limit(1);
  return task ?? null;
}

export async function listTasks() {
  return db
    .select()
    .from(collectionTasks)
    .where(and(eq(collectionTasks.tenantId, config.tenantId), isNull(collectionTasks.deletedAt)))
    .orderBy(desc(collectionTasks.createdAt));
}

export async function updateTask(taskId: string, values: Partial<typeof collectionTasks.$inferInsert>) {
  const [task] = await db
    .update(collectionTasks)
    .set({
      ...values,
      updatedAt: new Date(),
      updatedBy: "admin"
    })
    .where(and(eq(collectionTasks.tenantId, config.tenantId), eq(collectionTasks.id, taskId), isNull(collectionTasks.deletedAt)))
    .returning();
  return task ?? null;
}

export async function findDeviceTaskConfig(deviceCode: string, platform: string) {
  const task = await findCurrentTask(platform);
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .limit(1);

  if (!device) {
    return { task, device: null, config: null, followedConfigs: [] };
  }

  const [deviceConfig] = await db
    .select()
    .from(deviceTaskConfigs)
    .where(
      and(
        eq(deviceTaskConfigs.tenantId, config.tenantId),
        eq(deviceTaskConfigs.deviceId, device.id),
        eq(deviceTaskConfigs.taskId, task.id),
        isNull(deviceTaskConfigs.deletedAt)
      )
    )
    .limit(1);

  const followedConfigs = await db
    .select({
      config: deviceTaskConfigs,
      deviceCode: collectorDevices.deviceCode,
      deviceName: collectorDevices.deviceName
    })
    .from(deviceTaskConfigs)
    .leftJoin(collectorDevices, eq(deviceTaskConfigs.deviceId, collectorDevices.id))
    .where(
      and(
        eq(deviceTaskConfigs.tenantId, config.tenantId),
        eq(deviceTaskConfigs.taskId, task.id),
        eq(deviceTaskConfigs.liveCommentRole, "followed"),
        isNull(deviceTaskConfigs.deletedAt)
      )
    );

  return { task, device, config: deviceConfig ?? null, followedConfigs };
}

export async function upsertDeviceTaskConfig(deviceCode: string, platform: string, values: Partial<typeof deviceTaskConfigs.$inferInsert>) {
  const task = await findCurrentTask(platform);
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(eq(collectorDevices.tenantId, config.tenantId), eq(collectorDevices.deviceCode, deviceCode), isNull(collectorDevices.deletedAt)))
    .limit(1);

  if (!device) {
    return null;
  }

  const [existing] = await db
    .select()
    .from(deviceTaskConfigs)
    .where(
      and(
        eq(deviceTaskConfigs.tenantId, config.tenantId),
        eq(deviceTaskConfigs.deviceId, device.id),
        eq(deviceTaskConfigs.taskId, task.id),
        isNull(deviceTaskConfigs.deletedAt)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(deviceTaskConfigs)
      .set({
        ...values,
        updatedAt: new Date(),
        updatedBy: "admin"
      })
      .where(eq(deviceTaskConfigs.id, existing.id))
      .returning();
    return { task, device, config: updated };
  }

  const [created] = await db
    .insert(deviceTaskConfigs)
    .values({
      tenantId: config.tenantId,
      deviceId: device.id,
      taskId: task.id,
      videoMinutesMin: task.videoMinutesMin,
      videoMinutesMax: task.videoMinutesMax,
      liveMinutesMin: task.liveMinutesMin,
      liveMinutesMax: task.liveMinutesMax,
      autoStart: task.autoStart,
      collectComments: task.collectComments,
      commentLimit: task.commentLimit,
      heartbeatMinutes: task.heartbeatMinutes,
      ...values,
      createdBy: "admin",
      updatedBy: "admin"
    })
    .returning();

  return { task, device, config: created };
}
