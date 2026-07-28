import { toPublishPlatform, type ManualPublishTestPayload } from "@pkg/types";
import { db } from "../repositories/db";
import { findDeviceById } from "../repositories/device.repository";
import { saveManualPublishTaskDispatched } from "../repositories/publish-task.repository";
import { createPublishVideoTaskCommand } from "./publish-command.service";
import { publishVideoConfigSchema } from "./publish-config";
import { getRemoteScriptConfig } from "./remote-script.service";

type ManualPublishTestErrorCode =
  | "PUBLISH_CONFIG_NOT_ENABLED"
  | "PUBLISH_CONFIG_PAYLOAD_INVALID"
  | "PUBLISH_DEVICE_NOT_FOUND";

export class ManualPublishTestServiceError extends Error {
  constructor(
    code: ManualPublishTestErrorCode,
    readonly userMessage: string
  ) {
    super(code);
  }
}

type ManualPublishTestOptions = {
  createCommand?: typeof createPublishVideoTaskCommand;
};

export async function createManualPublishTest(
  payload: ManualPublishTestPayload,
  actor: string,
  options: ManualPublishTestOptions = {}
) {
  const savedConfig = await getRemoteScriptConfig(payload.configId);
  if (savedConfig.scriptKey !== "publish_video" || savedConfig.status !== "ENABLED") {
    throw new ManualPublishTestServiceError(
      "PUBLISH_CONFIG_NOT_ENABLED",
      "仅已启用的 publish_video 配置可用于手动测试"
    );
  }
  const commandConfig = publishVideoConfigSchema.safeParse(savedConfig.configPayload);
  if (!commandConfig.success) {
    throw new ManualPublishTestServiceError(
      "PUBLISH_CONFIG_PAYLOAD_INVALID",
      "发布视频配置缺少下发参数"
    );
  }
  const device = await findDeviceById(payload.deviceId);
  if (!device) {
    throw new ManualPublishTestServiceError("PUBLISH_DEVICE_NOT_FOUND", "设备不存在");
  }

  const createCommand = options.createCommand ?? createPublishVideoTaskCommand;
  return db.transaction(async (transaction) => {
    const task = await saveManualPublishTaskDispatched({
      ...payload,
      platform: toPublishPlatform(payload.platform)
    }, actor, transaction);
    const commandResult = await createCommand(task, commandConfig.data, actor, transaction);
    return { task, ...commandResult };
  });
}
