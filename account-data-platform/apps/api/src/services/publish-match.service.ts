import { collectorDevices, publishTasks } from "@pkg/db/schema";
import { toPublishPlatform, toPublishTaskStatus, type ExternalPublishPlatform } from "@pkg/types";
import { and, asc, eq, gte, isNull, sql } from "drizzle-orm";
import { config as appConfig } from "../config";
import { db } from "../repositories/db";
import {
  saveClaimedPublishTask,
  savePublishTaskMaterialInvalid,
  savePublishTaskMatch,
  savePublishTaskTopicPending
} from "../repositories/publish-task.repository";
import { publishVideoConfigSchema } from "./publish-config";
import { validatePublishMaterial } from "./publish-material.service";
import { validatePublishTopics } from "./publish-topics";
import { getRemoteScriptConfig } from "./remote-script.service";
import {
  claimTask,
  patchTaskStatus,
  type WecomPublishClientOptions
} from "./wecom-publish-client";

const ONLINE_HEARTBEAT_WINDOW_MS = 3 * 60 * 1000;
type PublishTaskRow = typeof publishTasks.$inferSelect;
type CollectorDeviceRow = typeof collectorDevices.$inferSelect;
type ClaimAndMatchOptions = WecomPublishClientOptions & { accountName: string };

function onlineSince() {
  return new Date(Date.now() - ONLINE_HEARTBEAT_WINDOW_MS);
}

function externalPatchError(error: unknown) {
  return error instanceof Error ? error.message.slice(0, 2000) : "EXTERNAL_STATUS_PATCH_FAILED";
}

async function findOnlineDeviceByDouyinBinding(accountName: string) {
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(
      eq(collectorDevices.tenantId, appConfig.tenantId),
      eq(collectorDevices.enabled, true),
      isNull(collectorDevices.deletedAt),
      gte(collectorDevices.lastHeartbeatAt, onlineSince()),
      sql`(
        btrim(coalesce(${collectorDevices.accountProfile}->>'douyinAccountName', '')) = ${accountName}
        or btrim(coalesce(${collectorDevices.accountProfile}->>'douyinAccountId', '')) = ${accountName}
      )`
    ))
    // collector_devices.updatedAt is the existing binding-edit timestamp; the earliest binding wins.
    .orderBy(asc(collectorDevices.updatedAt), asc(collectorDevices.id))
    .limit(1);
  return device ?? null;
}

function hasWechatChannelsBinding(device: CollectorDeviceRow) {
  return typeof device.accountProfile?.wechatChannelsName === "string"
    && device.accountProfile.wechatChannelsName.trim().length > 0;
}

export class PublishMatchServiceError extends Error {
  constructor(
    code: "CONFIG_TYPE_INVALID" | "CONFIG_DISABLED" | "CONFIG_PAYLOAD_INVALID",
    readonly userMessage: string
  ) {
    super(code);
  }
}

export async function matchClaimedPublishTask(task: PublishTaskRow, actor: string) {
  const accountName = task.accountName.trim() || null;
  if (!accountName) {
    return savePublishTaskMatch(task.id, {
      matchedDeviceId: null,
      matchNote: "外部任务缺少抖音账号"
    }, actor);
  }

  const device = await findOnlineDeviceByDouyinBinding(accountName);
  if (task.platform === "WECHAT_CHANNELS" && device && !hasWechatChannelsBinding(device)) {
    return savePublishTaskMatch(task.id, {
      matchedDeviceId: null,
      matchNote: "未发布：该设备未绑定视频号"
    }, actor);
  }

  return savePublishTaskMatch(
    task.id,
    device
      ? { matchedDeviceId: device.id }
      : {
        matchedDeviceId: null,
        matchNote: "无绑定该抖音号的设备：" + accountName
      },
    actor
  );
}

export async function claimAndMatchPublishTask(
  configId: string,
  actor: string,
  options: ClaimAndMatchOptions,
  claimPlatform: ExternalPublishPlatform = "抖音"
) {
  const config = await getRemoteScriptConfig(configId);
  if (config.scriptKey !== "publish_video") {
    throw new PublishMatchServiceError("CONFIG_TYPE_INVALID", "仅 publish_video 配置可领取发布任务");
  }
  if (config.status !== "ENABLED") {
    throw new PublishMatchServiceError("CONFIG_DISABLED", "发布视频配置已停用");
  }
  const parsedConfig = publishVideoConfigSchema.safeParse(config.configPayload);
  if (!parsedConfig.success) {
    throw new PublishMatchServiceError("CONFIG_PAYLOAD_INVALID", "发布视频配置缺少外部接口参数");
  }

  if (parsedConfig.data.sourceMode !== "external_pull") {
    throw new PublishMatchServiceError("CONFIG_PAYLOAD_INVALID", "仅外部接口配置可领取发布任务");
  }
  const externalTask = await claimTask(parsedConfig.data, {
    platform: claimPlatform,
    accountName: options.accountName
  }, options);
  if (!externalTask) {
    return { claimed: false, created: false, task: null };
  }

  const platform = toPublishPlatform(externalTask.platform);
  const accountName = externalTask.accountName?.trim() || null;
  const saved = await saveClaimedPublishTask({
    configId,
    platform,
    task: { ...externalTask, accountName }
  }, actor);
  if (!saved.created) {
    return {
      claimed: true,
      created: false,
      externalStatus: toPublishTaskStatus(externalTask.status),
      task: saved.task
    };
  }
  const materialValidation = validatePublishMaterial(externalTask);
  if (!materialValidation.valid) {
    try {
      await patchTaskStatus(parsedConfig.data, externalTask.taskId, {
        platform: externalTask.platform,
        status: "未发布",
        error: materialValidation.code
      }, options);
      const task = await savePublishTaskMaterialInvalid(saved.task.id, materialValidation.code, actor, {
        status: "REPORTED",
        reportStatus: "REPORTED"
      });
      return {
        claimed: true,
        created: false,
        externalStatus: toPublishTaskStatus(externalTask.status),
        task
      };
    } catch (error) {
      await savePublishTaskMaterialInvalid(saved.task.id, materialValidation.code, actor, {
        status: "FAILED",
        reportStatus: "REPORT_FAILED",
        reportLastError: externalPatchError(error)
      });
      throw error;
    }
  }
  const topicValidation = validatePublishTopics(externalTask.description, parsedConfig.data.expectedTopicCount);
  const matchedTask = topicValidation.valid
    ? await matchClaimedPublishTask(saved.task, actor)
    : await savePublishTaskTopicPending(saved.task.id, topicValidation.reason, actor);
  return {
    claimed: true,
    created: true,
    externalStatus: toPublishTaskStatus(externalTask.status),
    task: matchedTask
  };
}
