import { toPublishPlatform, toPublishTaskStatus } from "@pkg/types";
import { z } from "zod";
import {
  findEnabledDeviceByDouyinAccountName,
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
  const saved = await saveClaimedPublishTask({ configId, platform, task: externalTask }, actor);
  if (!saved.created) {
    return {
      claimed: true,
      created: false,
      externalStatus: toPublishTaskStatus(externalTask.status),
      task: saved.task
    };
  }

  const device = await findEnabledDeviceByDouyinAccountName(externalTask.accountName);
  const matchedTask = await savePublishTaskMatch(
    saved.task.id,
    device
      ? { matchedDeviceId: device.id }
      : { matchedDeviceId: null, matchNote: "未命中：无绑定该账号设备" },
    actor
  );
  return {
    claimed: true,
    created: true,
    externalStatus: toPublishTaskStatus(externalTask.status),
    task: matchedTask
  };
}
