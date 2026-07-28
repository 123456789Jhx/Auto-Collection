import { collectorDevices } from "@pkg/db/schema";
import { toPublishPlatform, toPublishTaskStatus } from "@pkg/types";
import { and, asc, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { config as appConfig } from "../config";
import { db } from "../repositories/db";
import {
  saveClaimedPublishTask,
  savePublishTaskMatch
} from "../repositories/publish-task.repository";
import { getRemoteScriptConfig } from "./remote-script.service";
import {
  claimTask,
  type WecomPublishClientOptions
} from "./wecom-publish-client";

const publishClientConfigSchema = z.object({
  externalBaseUrl: z.string().url(),
  externalTokenEnv: z.string().min(1)
}).passthrough();

const ONLINE_HEARTBEAT_WINDOW_MS = 3 * 60 * 1000;

function onlineSince() {
  return new Date(Date.now() - ONLINE_HEARTBEAT_WINDOW_MS);
}

async function findOnlineDeviceByBinding(accountName: string) {
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(
      eq(collectorDevices.tenantId, appConfig.tenantId),
      eq(collectorDevices.enabled, true),
      isNull(collectorDevices.deletedAt),
      gte(collectorDevices.lastHeartbeatAt, onlineSince()),
      sql`btrim(coalesce(${collectorDevices.accountProfile}->>'douyinAccountName', '')) = ${accountName}`
    ))
    // collector_devices.updatedAt is the existing binding-edit timestamp; the earliest binding wins.
    .orderBy(asc(collectorDevices.updatedAt), asc(collectorDevices.id))
    .limit(1);
  return device ?? null;
}

async function findOnlineUnboundDevice() {
  const [device] = await db
    .select()
    .from(collectorDevices)
    .where(and(
      eq(collectorDevices.tenantId, appConfig.tenantId),
      eq(collectorDevices.enabled, true),
      isNull(collectorDevices.deletedAt),
      gte(collectorDevices.lastHeartbeatAt, onlineSince()),
      sql`nullif(btrim(coalesce(${collectorDevices.accountProfile}->>'douyinAccountName', '')), '') is null`
    ))
    // Unspecified-account tasks prefer the unbound device with the freshest heartbeat.
    .orderBy(desc(collectorDevices.lastHeartbeatAt), asc(collectorDevices.updatedAt), asc(collectorDevices.id))
    .limit(1);
  return device ?? null;
}

export class PublishMatchServiceError extends Error {
  constructor(
    code: "CONFIG_TYPE_INVALID" | "CONFIG_DISABLED" | "CONFIG_PAYLOAD_INVALID",
    readonly userMessage: string
  ) {
    super(code);
  }
}

export async function claimAndMatchPublishTask(
  configId: string,
  actor: string,
  options: WecomPublishClientOptions = {}
) {
  const config = await getRemoteScriptConfig(configId);
  if (config.scriptKey !== "publish_video") {
    throw new PublishMatchServiceError("CONFIG_TYPE_INVALID", "仅 publish_video 配置可领取发布任务");
  }
  if (config.status !== "ENABLED") {
    throw new PublishMatchServiceError("CONFIG_DISABLED", "发布视频配置已停用");
  }
  const parsedConfig = publishClientConfigSchema.safeParse(config.configPayload);
  if (!parsedConfig.success) {
    throw new PublishMatchServiceError("CONFIG_PAYLOAD_INVALID", "发布视频配置缺少外部接口参数");
  }

  const externalTask = await claimTask(parsedConfig.data, { platform: "抖音" }, options);
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

  const device = accountName
    ? await findOnlineDeviceByBinding(accountName)
    : await findOnlineUnboundDevice();
  const matchedTask = await savePublishTaskMatch(
    saved.task.id,
    device
      ? { matchedDeviceId: device.id }
      : {
        matchedDeviceId: null,
        matchNote: accountName ? `无绑定该抖音号的设备：${accountName}` : "无可用的未绑定设备"
      },
    actor
  );
  return {
    claimed: true,
    created: true,
    externalStatus: toPublishTaskStatus(externalTask.status),
    task: matchedTask
  };
}
