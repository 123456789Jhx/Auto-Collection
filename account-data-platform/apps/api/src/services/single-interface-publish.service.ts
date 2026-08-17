import type { ManualPublishTestPayload } from "@pkg/types";
import { listActiveInterfacePublishBindingsForPreflight } from "../repositories/publish-interface-binding.repository";
import {
  cancelPendingSingleInterfacePublishCommand,
  closeCancelledSingleInterfacePublishTask,
  createSingleInterfacePublishDispatch,
  createSingleInterfaceMobileCommand,
  inspectSingleInterfacePublishCommand,
  inspectSingleInterfacePublishTask,
  recoverLatestSingleInterfacePublishRun
} from "../repositories/single-interface-publish.repository";
import { publishVideoConfigSchema } from "./publish-config";
import { validatePublishMaterial } from "./publish-material.service";
import { getRemoteScriptConfig, getRemoteScriptConfigForDevice } from "./remote-script.service";
import {
  fetchSingleDouyinPublishTask,
  type SingleDouyinPublishTask
} from "./single-interface-publish-client";

const TEST_DOUYIN_ID = "23362504586";
const TEST_ACCOUNT_NAME = "勤能致富";

type DispatchPayload = Pick<ManualPublishTestPayload,
  "configId" | "deviceId" | "platform" | "videoUrl" | "coverUrl" | "title" | "description"> & {
    deviceCode: string;
    deviceStatus: string;
    douyinId: string;
  };

type Binding = {
  deviceId: string | null;
  deviceCode: string;
  deviceName?: string | null;
  deviceStatus: string;
  accountName: string | null;
  accountNo: string | null;
  externalAccountKey?: string | null;
  bindingEnabled: boolean | null;
};

type Dependencies = {
  loadBindings: () => Promise<Binding[]>;
  loadConfig: (deviceCode: string) => Promise<{ id: string; configPayload?: unknown } | null>;
  fetchTask: (douyinId: string) => Promise<SingleDouyinPublishTask | null>;
  dispatch: (payload: DispatchPayload, actor: string, task: SingleDouyinPublishTask, runId: string) => Promise<{
    task: { id: string; status: string };
    command: { id: string; status: string };
  }>;
  inspectCommand: (commandId: string) => Promise<{ status: string } | null>;
  inspectTask: (taskId: string) => Promise<{ status: string; resultError: string | null } | null>;
  recover: typeof recoverLatestSingleInterfacePublishRun;
  cancelPendingCommand: (commandId: string, actor: string) => Promise<boolean>;
  closeCancelledTask: (taskId: string, actor: string) => Promise<void>;
  createStopCommand: (run: RunSnapshot, actor: string) => Promise<{ id: string; status: string }>;
};

type RunSnapshot = {
  status: "RUNNING" | "STOPPING" | "STOPPED" | "SUCCEEDED" | "FAILED";
  runId: string;
  externalTaskId: string;
  taskId: string;
  commandId: string;
  deviceId: string;
  deviceCode: string;
  deviceName: string | null;
  deviceStatus: string;
  accountName: string;
  douyinId: string;
  title: string;
  stopMode?: "CANCELLED_BEFORE_FETCH" | "DEDICATED_STOP";
  stopCommandId?: string;
  bestEffort?: boolean;
  error?: string | null;
  updatedAt: string;
};

export class SingleInterfacePublishServiceError extends Error {
  constructor(readonly code: string, readonly userMessage: string) {
    super(code);
  }
}

async function defaultDispatch(payload: DispatchPayload, actor: string, external: SingleDouyinPublishTask, runId: string) {
  const config = await getRemoteScriptConfig(payload.configId);
  if (!config) throw new SingleInterfacePublishServiceError("PUBLISH_CONFIG_NOT_ENABLED", "设备未绑定启用的发布配置");
  const commandConfig = publishVideoConfigSchema.parse(config.configPayload);
  const material = validatePublishMaterial(payload);
  if (!material.valid) {
    throw new SingleInterfacePublishServiceError("MATERIAL_INVALID", material.code);
  }
  return createSingleInterfacePublishDispatch({
    runId,
    configId: payload.configId,
    externalTaskId: external.taskId,
    accountName: external.accountName,
    title: payload.title,
    description: payload.description,
    videoUrl: payload.videoUrl,
    coverUrl: payload.coverUrl,
    deviceId: payload.deviceId,
    rawPayload: { ...external, runId, deviceCode: payload.deviceCode, deviceStatus: payload.deviceStatus, douyinId: payload.douyinId },
    actor,
    commandPayload: {
      platform: "DOUYIN",
      title: payload.title,
      description: payload.description,
      coverUrl: material.coverUrl,
      videoUrl: material.videoUrl,
      responseDelayMsMin: commandConfig.responseDelayMsMin,
      responseDelayMsMax: commandConfig.responseDelayMsMax,
      actionWaitMsMin: commandConfig.actionWaitMsMin,
      actionWaitMsMax: commandConfig.actionWaitMsMax,
      expectedTopicCount: commandConfig.expectedTopicCount,
      topicResolveTimeoutMinutes: commandConfig.topicResolveTimeoutMinutes,
      downloadDir: commandConfig.downloadDir ?? ""
    },
    commandIdempotencyKey: `single-interface-publish:${runId}`
  });
}

const defaultDependencies: Dependencies = {
  loadBindings: listActiveInterfacePublishBindingsForPreflight,
  loadConfig: (deviceCode) => getRemoteScriptConfigForDevice(deviceCode, "publish_video"),
  fetchTask: fetchSingleDouyinPublishTask,
  dispatch: defaultDispatch,
  inspectCommand: inspectSingleInterfacePublishCommand,
  inspectTask: inspectSingleInterfacePublishTask,
  recover: recoverLatestSingleInterfacePublishRun,
  cancelPendingCommand: cancelPendingSingleInterfacePublishCommand,
  closeCancelledTask: closeCancelledSingleInterfacePublishTask,
  createStopCommand: (run, actor) => createSingleInterfaceMobileCommand({
    deviceId: run.deviceId,
    idempotencyKey: `single-interface-publish-stop:${run.runId}:${run.commandId}`,
    commandType: "SINGLE_INTERFACE_PUBLISH_STOP",
    actor,
    payload: {
      runId: run.runId,
      taskId: run.taskId,
      externalTaskId: run.externalTaskId,
      targetCommandId: run.commandId
    }
  })
};

export function createSingleInterfacePublishService(deps: Dependencies = defaultDependencies) {
  let current: RunSnapshot | null = null;

  async function ensureCurrent() {
    if (current) return current;
    const recovered = await deps.recover();
    if (!recovered?.publishCommand) return null;
    const raw = (recovered.task.rawPayload ?? {}) as Record<string, unknown>;
    const publishPayload = (recovered.publishCommand.payloadJson ?? {}) as Record<string, unknown>;
    const recoveredStatus: RunSnapshot["status"] = recovered.stopCommand?.status === "DONE"
      ? "STOPPED"
      : recovered.stopCommand && !["FAILED", "IGNORED"].includes(recovered.stopCommand.status)
        ? "STOPPING"
        : recovered.task.status === "SUCCEEDED" || recovered.task.status === "REPORTED"
          ? "SUCCEEDED"
          : recovered.task.status === "FAILED"
            ? recovered.task.resultError === "STOPPED_BEFORE_FETCH" ? "STOPPED" : "FAILED"
            : "RUNNING";
    current = {
      status: recoveredStatus,
      runId: String(raw.runId ?? publishPayload.runId ?? ""),
      externalTaskId: String(raw.taskId ?? publishPayload.externalTaskId ?? ""),
      taskId: recovered.task.id,
      commandId: recovered.publishCommand.id,
      deviceId: recovered.task.matchedDeviceId!,
      deviceCode: String(raw.deviceCode ?? ""),
      deviceName: null,
      deviceStatus: String(raw.deviceStatus ?? "unknown"),
      accountName: recovered.task.accountName,
      douyinId: String(raw.douyinId ?? TEST_DOUYIN_ID),
      title: recovered.task.title,
      ...(recovered.stopCommand ? {
        stopMode: "DEDICATED_STOP" as const,
        stopCommandId: recovered.stopCommand.id,
        bestEffort: false
      } : {}),
      updatedAt: recovered.task.updatedAt.toISOString()
    };
    return current;
  }

  return {
    async start(actor: string) {
      const active = await ensureCurrent();
      if (active?.status === "RUNNING" || active?.status === "STOPPING") {
        throw new SingleInterfacePublishServiceError("RUN_ALREADY_ACTIVE", "A single interface publish run is already active");
      }
      const bindings = await deps.loadBindings();
      const matchingBindings = bindings.filter((item) =>
        item.accountNo === TEST_DOUYIN_ID && item.accountName === TEST_ACCOUNT_NAME
      );
      if (matchingBindings.length !== 1) {
        throw new SingleInterfacePublishServiceError(
          "TEST_ACCOUNT_BINDING_REQUIRED",
          `测试基座要求且只允许一个 ${TEST_ACCOUNT_NAME}(${TEST_DOUYIN_ID}) 启用绑定`
        );
      }
      const binding = matchingBindings[0];
      if (!binding.deviceId || !binding.accountName || !binding.accountNo || !binding.bindingEnabled) {
        throw new SingleInterfacePublishServiceError("BINDING_INCOMPLETE", "测试设备绑定缺少 deviceId、账号名称或 douyinId");
      }
      const config = await deps.loadConfig(binding.deviceCode);
      if (!config) {
        throw new SingleInterfacePublishServiceError("PUBLISH_CONFIG_NOT_ENABLED", "测试设备未绑定启用的发布配置");
      }
      const external = await deps.fetchTask(binding.accountNo);
      if (!external) {
        throw new SingleInterfacePublishServiceError("NO_UNPUBLISHED_MATERIAL", "勤能致富当前没有未发布素材");
      }
      const runId = crypto.randomUUID();
      const dispatched = await deps.dispatch({
        configId: config.id,
        deviceId: binding.deviceId,
        deviceCode: binding.deviceCode,
        deviceStatus: binding.deviceStatus,
        douyinId: binding.accountNo,
        platform: "抖音",
        videoUrl: external.videoUrl,
        coverUrl: external.coverUrl,
        title: external.title,
        description: external.description
      }, actor, external, runId);
      current = {
        status: "RUNNING",
        runId,
        externalTaskId: external.taskId,
        taskId: dispatched.task.id,
        commandId: dispatched.command.id,
        deviceId: binding.deviceId,
        deviceCode: binding.deviceCode,
        deviceName: binding.deviceName ?? null,
        deviceStatus: binding.deviceStatus,
        accountName: binding.accountName,
        douyinId: binding.accountNo,
        title: external.title,
        updatedAt: new Date().toISOString()
      };
      return current;
    },

    async current() {
      await ensureCurrent();
      if (!current) return { status: "IDLE" as const };
      if (current.status === "STOPPING" && current.stopCommandId) {
        const stopCommand = await deps.inspectCommand(current.stopCommandId);
        if (stopCommand?.status === "DONE") {
          current = { ...current, status: "STOPPED", updatedAt: new Date().toISOString() };
        } else if (stopCommand?.status === "FAILED" || stopCommand?.status === "IGNORED") {
          const task = await deps.inspectTask(current.taskId);
          current = task?.status === "SUCCEEDED"
            ? { ...current, status: "SUCCEEDED", error: null, updatedAt: new Date().toISOString() }
            : { ...current, status: task?.status === "FAILED" ? "FAILED" : "STOPPED", error: task?.resultError ?? `STOP_${stopCommand.status}`, updatedAt: new Date().toISOString() };
        }
      }
      if (current.status === "RUNNING") {
        const task = await deps.inspectTask(current.taskId);
        if (task?.status === "SUCCEEDED" || task?.status === "REPORTED") {
          current = { ...current, status: "SUCCEEDED", error: null, updatedAt: new Date().toISOString() };
        } else if (task?.status === "FAILED") {
          current = { ...current, status: "FAILED", error: task.resultError, updatedAt: new Date().toISOString() };
        }
      }
      return current;
    },

    async stop(actor: string) {
      await ensureCurrent();
      if (!current) throw new SingleInterfacePublishServiceError("NO_ACTIVE_RUN", "当前没有接口发布任务");
      const command = await deps.inspectCommand(current.commandId);
      if (command?.status === "PENDING" && await deps.cancelPendingCommand(current.commandId, actor)) {
        await deps.closeCancelledTask(current.taskId, actor);
        current = { ...current, status: "STOPPED", stopMode: "CANCELLED_BEFORE_FETCH", bestEffort: false, updatedAt: new Date().toISOString() };
        return current;
      }
      const stopCommand = await deps.createStopCommand(current, actor);
      current = {
        ...current,
        status: "STOPPING",
        stopMode: "DEDICATED_STOP",
        stopCommandId: stopCommand.id,
        bestEffort: false,
        updatedAt: new Date().toISOString()
      };
      return current;
    }
  };
}

export const singleInterfacePublishService = createSingleInterfacePublishService();
