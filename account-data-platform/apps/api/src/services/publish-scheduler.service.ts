import type { WecomPublishClientOptions } from "./wecom-publish-client";
import {
  countAccountTasksSince,
  hasPublishTaskForSlot,
  listEnabledPublishVideoConfigs,
  savePublishTaskDispatched,
  savePublishTaskResult
} from "../repositories/publish-dispatch.repository";
import { getRemoteScriptConfig } from "./remote-script.service";
import { claimAndMatchPublishTask } from "./publish-match.service";
import { createPublishVideoTaskCommand } from "./publish-command.service";
import { patchTaskStatus } from "./wecom-publish-client";
import { localSlotDate, localTimeSlot, publishVideoConfigSchema, startOfLocalDay, type PublishVideoConfig } from "./publish-config";

type DispatchOptions = WecomPublishClientOptions & { scheduledSlot?: Date };
const completedSlotKeys = new Set<string>();
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function slotKey(configId: string, slot: Date) {
  return `${configId}:${slot.getFullYear()}-${slot.getMonth() + 1}-${slot.getDate()}:${slot.getHours()}:${slot.getMinutes()}`;
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
  const dayStart = startOfLocalDay(scheduledSlot);
  let dispatched = 0;
  let reported = 0;

  while (true) {
    const claimed = await claimAndMatchPublishTask(configId, actor, options);
    if (!claimed.claimed || !claimed.task) break;
    if (!claimed.created) break;
    const task = claimed.task;
    const dailyCount = await countAccountTasksSince(configId, task.accountName, dayStart);
    if (dailyCount > publishConfig.dailyLimitPerAccount) {
      const error = "未发布：已达账号每日上限";
      await patchTaskStatus(publishConfig, task.taskId, { platform: "抖音", status: "未发布", error }, options);
      await savePublishTaskResult(task.id, {
        status: "REPORTED",
        resultError: error,
        scheduledSlot,
        finishedAt: new Date(),
        reportedAt: new Date()
      }, actor);
      reported += 1;
      break;
    }

    if (task.status === "UNMATCHED" || !task.matchedDeviceId) {
      const error = task.matchNote || "未命中：无绑定该账号设备";
      await patchTaskStatus(publishConfig, task.taskId, { platform: "抖音", status: "未发布", error }, options);
      await savePublishTaskResult(task.id, {
        status: "REPORTED",
        resultError: error,
        scheduledSlot,
        finishedAt: new Date(),
        reportedAt: new Date()
      }, actor);
      reported += 1;
      continue;
    }

    await createPublishVideoTaskCommand(task, publishConfig, actor);
    await savePublishTaskDispatched(task.id, scheduledSlot, actor);
    dispatched += 1;
    if (dailyCount >= publishConfig.dailyLimitPerAccount) break;
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
