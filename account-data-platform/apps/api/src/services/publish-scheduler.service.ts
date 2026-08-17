import { publishTasks } from "@pkg/db/schema";
import type { ExternalPublishPlatform } from "@pkg/types";
import type { WecomPublishClientOptions } from "./wecom-publish-client";
import {
  findPublishTaskContext,
  hasActivePublishForDevice,
  listDuePublishBusyTasks,
  savePublishTaskBusy,
  savePublishTaskDispatched,
  savePublishTaskResult
} from "../repositories/publish-dispatch.repository";
import { findDeviceById } from "../repositories/device.repository";
import { getRemoteScriptConfig } from "./remote-script.service";
import { claimAndMatchPublishTask, matchClaimedPublishTask } from "./publish-match.service";
import { createPublishVideoTaskCommand, redispatchPublishVideoTaskCommand } from "./publish-command.service";
import { patchTaskStatus } from "./wecom-publish-client";
import { publishVideoConfigSchema, type PublishVideoConfig } from "./publish-config";

type DispatchOptions = WecomPublishClientOptions & { scheduledSlot?: Date };
type ClaimDispatchOptions = DispatchOptions & { accountName: string };
type PublishTaskRow = typeof publishTasks.$inferSelect;
const PUBLISH_BUSY_RETRY_LIMIT = 3;
const PUBLISH_BUSY_RETRY_DELAY_MS = 5 * 60_000;
// platforms 仅决定启用范围；调度顺序始终固定为抖音 → 视频号。
const PUBLISH_PLATFORM_ORDER: ExternalPublishPlatform[] = ["抖音", "视频号"];
let schedulerTimer: ReturnType<typeof setInterval> | null = null;

function externalPlatform(platform: string): ExternalPublishPlatform {
  return platform === "WECHAT_CHANNELS" ? "视频号" : "抖音";
}

function externalPatchError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2000) : "EXTERNAL_STATUS_PATCH_FAILED";
}

async function reportWithoutDispatch(
  task: PublishTaskRow,
  publishConfig: PublishVideoConfig,
  scheduledSlot: Date,
  error: string,
  actor: string,
  options: WecomPublishClientOptions
) {
  try {
    await patchTaskStatus(publishConfig, task.taskId, {
      platform: externalPlatform(task.platform),
      status: "未发布",
      error
    }, options);
  } catch (patchError) {
    await savePublishTaskResult(task.id, {
      status: "FAILED",
      resultError: error,
      scheduledSlot,
      finishedAt: new Date(),
      reportedAt: null,
      reportStatus: "REPORT_FAILED",
      reportLastError: externalPatchError(patchError)
    }, actor);
    throw patchError;
  }
  return savePublishTaskResult(task.id, {
    status: "REPORTED",
    resultError: error,
    scheduledSlot,
    finishedAt: new Date(),
    reportedAt: new Date(),
    reportStatus: "REPORTED",
    reportLastError: null
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
  const busy = await hasActivePublishForDevice(task.matchedDeviceId, redispatch ? task.id : undefined);
  if (busy) {
    const retryCount = task.dispatchRetryCount + 1;
    if (retryCount > PUBLISH_BUSY_RETRY_LIMIT) {
      return { outcome: "REPORTED" as const, task: await reportWithoutDispatch(
        task,
        publishConfig,
        scheduledSlot,
        "PUBLISH_BUSY",
        actor,
        options
      ) };
    }
    return {
      outcome: "PUBLISH_BUSY" as const,
      task: await savePublishTaskBusy(
        task.id,
        retryCount,
        new Date(Date.now() + PUBLISH_BUSY_RETRY_DELAY_MS),
        actor
      )
    };
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

export async function dispatchExistingPublishTaskNow(
  taskId: string,
  actor: string,
  options: DispatchOptions = {}
) {
  const context = await findPublishTaskContext(taskId);
  if (!context) throw new Error("PUBLISH_TASK_NOT_FOUND");
  if (context.task.source !== "EXTERNAL_PULL") {
    throw new Error("PUBLISH_TASK_DIRECT_DISPATCH_SOURCE_INVALID");
  }
  if (!["CLAIMED", "MATCHED", "UNMATCHED", "PENDING"].includes(context.task.status)) {
    throw new Error("PUBLISH_TASK_DIRECT_DISPATCH_STATE_INVALID");
  }

  const savedConfig = await getRemoteScriptConfig(context.task.configId);
  if (savedConfig.scriptKey !== "publish_video" || savedConfig.status !== "ENABLED") {
    throw new Error("PUBLISH_CONFIG_NOT_ENABLED");
  }
  const publishConfig = publishVideoConfigSchema.parse(savedConfig.configPayload);
  if (publishConfig.sourceMode !== "external_pull") {
    throw new Error("PUBLISH_CONFIG_SOURCE_MODE_INVALID");
  }

  const matchedTask = await matchClaimedPublishTask(context.task, actor);
  if (!matchedTask.matchedDeviceId) {
    throw new Error("PUBLISH_TASK_DEVICE_NOT_MATCHED");
  }
  return dispatchMatchedPublishTask(matchedTask, publishConfig, new Date(), actor, options);
}

export async function dispatchPublishConfigNow(
  configId: string,
  actor: string,
  options: ClaimDispatchOptions
) {
  const savedConfig = await getRemoteScriptConfig(configId);
  if (savedConfig.scriptKey !== "publish_video" || savedConfig.status !== "ENABLED") {
    throw new Error("PUBLISH_CONFIG_NOT_ENABLED");
  }
  const publishConfig = publishVideoConfigSchema.parse(savedConfig.configPayload);
  if (publishConfig.sourceMode !== "external_pull") {
    throw new Error("PUBLISH_CONFIG_SOURCE_MODE_INVALID");
  }
  const scheduledSlot = options.scheduledSlot ?? new Date();
  let claimedCount = 0;
  let dispatched = 0;
  let reported = 0;
  let busy = 0;

  for (const platform of PUBLISH_PLATFORM_ORDER.filter((candidate) => publishConfig.platforms.includes(candidate))) {
    while (true) {
      const claimed = await claimAndMatchPublishTask(configId, actor, options, platform);
      if (!claimed.claimed || !claimed.task || !claimed.created) break;
      claimedCount += 1;
      const result = await dispatchMatchedPublishTask(
        claimed.task,
        publishConfig,
        scheduledSlot,
        actor,
        options
      );
      if (result.outcome === "DISPATCHED") dispatched += 1;
      if (result.outcome === "REPORTED") reported += 1;
      if (result.outcome === "PUBLISH_BUSY") busy += 1;
    }
  }

  return { configId, scheduledSlot, claimedCount, dispatched, reported, busy };
}

export async function runPublishSchedulerTick(now = new Date()) {
  const retried = [];
  for (const task of await listDuePublishBusyTasks(now)) {
    const config = await getRemoteScriptConfig(task.configId);
    const publishConfig = publishVideoConfigSchema.safeParse(config.configPayload);
    if (!publishConfig.success || publishConfig.data.sourceMode !== "external_pull") continue;
    retried.push(await dispatchMatchedPublishTask(
      task,
      publishConfig.data,
      task.scheduledSlot ?? now,
      "publish-scheduler-retry",
      {},
      true
    ));
  }

  return { scheduled: [], retried, deviceScheduled: [] };
}

export function startPublishScheduler() {
  if (schedulerTimer) return schedulerTimer;
  schedulerTimer = setInterval(() => void runPublishSchedulerTick(), 30_000);
  schedulerTimer.unref?.();
  return schedulerTimer;
}
