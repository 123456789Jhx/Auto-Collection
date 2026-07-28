import { publishTasks } from "@pkg/db/schema";
import type { ExternalPublishPlatform } from "@pkg/types";
import type { WecomPublishClientOptions } from "./wecom-publish-client";
import {
  hasPublishTaskForSlot,
  listEnabledPublishVideoConfigs,
  savePublishTaskDispatched,
  savePublishTaskResult
} from "../repositories/publish-dispatch.repository";
import { findDeviceById } from "../repositories/device.repository";
import { getRemoteScriptConfig } from "./remote-script.service";
import { claimAndMatchPublishTask } from "./publish-match.service";
import { createPublishVideoTaskCommand, redispatchPublishVideoTaskCommand } from "./publish-command.service";
import { patchTaskStatus } from "./wecom-publish-client";
import { localSlotDate, localTimeSlot, publishVideoConfigSchema, type PublishVideoConfig } from "./publish-config";

type DispatchOptions = WecomPublishClientOptions & { scheduledSlot?: Date };
type PublishTaskRow = typeof publishTasks.$inferSelect;
const PUBLISH_PLATFORM_ORDER: ExternalPublishPlatform[] = ["抖音", "视频号"];
const completedSlotKeys = new Set<string>();
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function slotKey(configId: string, slot: Date) {
  return `${configId}:${slot.getFullYear()}-${slot.getMonth() + 1}-${slot.getDate()}:${slot.getHours()}:${slot.getMinutes()}`;
}

function externalPlatform(platform: string): ExternalPublishPlatform {
  return platform === "WECHAT_CHANNELS" ? "视频号" : "抖音";
}

async function reportWithoutDispatch(
  task: PublishTaskRow,
  publishConfig: PublishVideoConfig,
  scheduledSlot: Date,
  error: string,
  actor: string,
  options: WecomPublishClientOptions
) {
  await patchTaskStatus(publishConfig, task.taskId, {
    platform: externalPlatform(task.platform),
    status: "未发布",
    error
  }, options);
  return savePublishTaskResult(task.id, {
    status: "REPORTED",
    resultError: error,
    scheduledSlot,
    finishedAt: new Date(),
    reportedAt: new Date()
  }, actor);
}

export async function dispatchMatchedPublishTask(
  task: PublishTaskRow,
  publishConfig: PublishVideoConfig,
  scheduledSlot: Date,
  actor: string,
  options: WecomPublishClientOptions = {},
  redispatch = false
) {
  if (task.status === "TOPIC_PENDING") {
    return {
      outcome: "TOPIC_PENDING" as const,
      task: await savePublishTaskResult(task.id, { status: "TOPIC_PENDING", scheduledSlot }, actor)
    };
  }
  if (task.status === "UNMATCHED" || !task.matchedDeviceId) {
    const error = task.matchNote || "未命中：无绑定该账号设备";
    return { outcome: "REPORTED" as const, task: await reportWithoutDispatch(
      task,
      publishConfig,
      scheduledSlot,
      error,
      actor,
      options
    ) };
  }
  if (task.platform === "WECHAT_CHANNELS") {
    const device = await findDeviceById(task.matchedDeviceId);
    const channelsName = device?.accountProfile?.wechatChannelsName;
    if (typeof channelsName !== "string" || !channelsName.trim()) {
      const error = "未发布：该设备未绑定视频号";
      return { outcome: "REPORTED" as const, task: await reportWithoutDispatch(
        task,
        publishConfig,
        scheduledSlot,
        error,
        actor,
        options
      ) };
    }
  }

  if (redispatch) await redispatchPublishVideoTaskCommand(task, publishConfig, actor);
  else await createPublishVideoTaskCommand(task, publishConfig, actor);
  return {
    outcome: "DISPATCHED" as const,
    task: await savePublishTaskDispatched(task.id, scheduledSlot, actor)
  };
}

export async function dispatchPublishConfigNow(
  configId: string,
  actor: string,
  options: DispatchOptions = {}
) {
  const savedConfig = await getRemoteScriptConfig(configId);
  if (savedConfig.scriptKey !== "publish_video" || savedConfig.status !== "ENABLED") {
    throw new Error("PUBLISH_CONFIG_NOT_ENABLED");
  }
  const publishConfig = publishVideoConfigSchema.parse(savedConfig.configPayload) as PublishVideoConfig;
  const scheduledSlot = options.scheduledSlot ?? new Date();
  let dispatched = 0;
  let reported = 0;

  for (const platform of PUBLISH_PLATFORM_ORDER) {
    while (true) {
      const claimed = await claimAndMatchPublishTask(configId, actor, options, platform);
      if (!claimed.claimed || !claimed.task || !claimed.created) break;
      const result = await dispatchMatchedPublishTask(
        claimed.task,
        publishConfig,
        scheduledSlot,
        actor,
        options
      );
      if (result.outcome === "DISPATCHED") dispatched += 1;
      if (result.outcome === "REPORTED") reported += 1;
    }
  }

  return { configId, scheduledSlot, dispatched, reported };
}

export async function runPublishSchedulerTick(now = new Date()) {
  const timeSlot = localTimeSlot(now);
  const configs = await listEnabledPublishVideoConfigs();
  const results = [];
  for (const savedConfig of configs) {
    const parsed = publishVideoConfigSchema.safeParse(savedConfig.configPayload);
    if (!parsed.success || !(parsed.data as PublishVideoConfig).publishTimeSlots.includes(timeSlot)) continue;
    const scheduledSlot = localSlotDate(now, timeSlot);
    const key = slotKey(savedConfig.id, scheduledSlot);
    if (completedSlotKeys.has(key) || await hasPublishTaskForSlot(savedConfig.id, scheduledSlot)) continue;
    completedSlotKeys.add(key);
    try {
      results.push(await dispatchPublishConfigNow(savedConfig.id, "publish-scheduler", { scheduledSlot }));
    } catch (error) {
      completedSlotKeys.delete(key);
      console.error(JSON.stringify({ scope: "publish-scheduler", configId: savedConfig.id, error: String(error) }));
    }
  }
  return results;
}

export function startPublishScheduler() {
  if (schedulerTimer) return schedulerTimer;
  schedulerTimer = setInterval(() => void runPublishSchedulerTick(), 30_000);
  schedulerTimer.unref?.();
  return schedulerTimer;
}
