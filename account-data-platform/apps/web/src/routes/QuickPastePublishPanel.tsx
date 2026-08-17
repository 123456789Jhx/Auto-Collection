import { Alert, Button, Checkbox, Form, Input, Select, Space, message } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { createManualPublishTest } from "../lib/api-client-publish-tasks";
import type { RemoteScriptConfig } from "../lib/api-client-remote-scripts";
import {
  buildManualPublishPayloads,
  parseQuickPasteText,
  resolveDefaultDirectMaterialConfig,
  type QuickPastePlatform
} from "../lib/quick-paste-publish";
import type { DeviceRow } from "./DeviceList";
import { QuickPastePublishPreview, type QuickPasteCoverStatus } from "./QuickPastePublishPreview";

type Props = {
  configs: RemoteScriptConfig[];
  devices: DeviceRow[];
  selectedConfigId?: string;
  loading?: boolean;
  onTaskCreated: () => void;
};

type CoverCheck = {
  status: QuickPasteCoverStatus;
  message?: string;
  httpStatus?: number;
};

type SubmissionResult = {
  successfulPlatforms: QuickPastePlatform[];
  failedPlatforms: Array<{ platform: QuickPastePlatform; reason: string }>;
};

function isOnline(device: DeviceRow) {
  return ["online", "running"].includes((device.effectiveStatus || device.status).toLowerCase());
}

function profileValue(device: DeviceRow, key: string) {
  const value = device.accountProfile?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function deviceOptionLabel(device: DeviceRow) {
  const deviceName = device.deviceName || device.deviceCode;
  const status = isOnline(device) ? "在线" : "离线";
  const douyin = profileValue(device, "douyinAccountName") || profileValue(device, "douyinAccountId");
  const channels = profileValue(device, "wechatChannelsName");
  return deviceName + " · " + status + " · 抖音：" + (douyin || "未绑定") + " · 视频号：" + (channels || "未绑定");
}

async function verifyCoverUrl(coverUrl: string): Promise<CoverCheck> {
  try {
    const response = await fetch(coverUrl, { method: "HEAD", redirect: "follow" });
    if (response.ok || (response.status >= 300 && response.status < 400)) {
      return { status: "ok", httpStatus: response.status, message: "封面地址校验通过" };
    }
    if (response.status === 404 || response.status === 410) {
      return { status: "missing", httpStatus: response.status, message: "封面不存在，无法创建发布任务" };
    }
    if (response.status === 403) {
      return { status: "warning", httpStatus: response.status, message: "封面返回 403，浏览器无法确认，可继续下发" };
    }
    if (response.status === 405) {
      return { status: "warning", httpStatus: response.status, message: "封面服务器不支持 HEAD 校验，可继续下发" };
    }
    return { status: "warning", httpStatus: response.status, message: "封面返回 HTTP " + response.status + "，可继续下发" };
  } catch (error) {
    if (error instanceof TypeError) {
      return { status: "warning", message: "浏览器受 CORS 限制，无法确认封面，可继续下发" };
    }
    return { status: "warning", message: "封面网络校验异常，可继续下发" };
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "创建任务失败";
}

export function QuickPastePublishPanel({
  configs,
  devices,
  loading = false,
  onTaskCreated
}: Props) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [deviceId, setDeviceId] = useState<string>();
  const [platforms, setPlatforms] = useState<QuickPastePlatform[]>(["抖音"]);
  const [rawText, setRawText] = useState("");
  const [coverCheck, setCoverCheck] = useState<CoverCheck>({ status: "idle" });
  const [submissionResult, setSubmissionResult] = useState<SubmissionResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const defaultResolution = useMemo(
    () => resolveDefaultDirectMaterialConfig(configs),
    [configs]
  );
  const defaultExecutionConfig = defaultResolution.config;
  const expectedTopicCount = Math.max(1, Math.trunc(Number(defaultExecutionConfig?.configPayload.expectedTopicCount) || 5));
  const parsed = useMemo(
    () => rawText.trim() ? parseQuickPasteText(rawText, expectedTopicCount) : { value: null, errors: [] },
    [expectedTopicCount, rawText]
  );
  const orderedDevices = useMemo(
    () => [...devices].sort((left, right) => Number(isOnline(right)) - Number(isOnline(left))),
    [devices]
  );
  const selectedDevice = devices.find((device) => device.id === deviceId);

  useEffect(() => {
    setCoverCheck({ status: "idle" });
    setSubmissionResult(null);
  }, [parsed.value?.coverUrl]);

  async function submit() {
    if (!defaultExecutionConfig) {
      messageApi.error(defaultResolution.issue === "multiple"
        ? "检测到多个默认发布执行配置，请先到发布设置保留一个默认配置"
        : "请先到发布设置中创建默认发布执行配置");
      return;
    }
    if (!deviceId) {
      messageApi.error("请选择设备");
      return;
    }
    if (!platforms.length) {
      messageApi.error("请至少选择一个发布平台");
      return;
    }
    if (!parsed.value) {
      messageApi.error(parsed.errors[0] || "请按三行或四行格式粘贴内容");
      return;
    }

    setCoverCheck({ status: "checking", message: "正在校验封面地址" });
    const nextCoverCheck = await verifyCoverUrl(parsed.value.coverUrl);
    setCoverCheck(nextCoverCheck);
    if (nextCoverCheck.status === "missing") {
      messageApi.error(nextCoverCheck.message || "封面不存在");
      return;
    }
    if (nextCoverCheck.status === "warning" && nextCoverCheck.message) {
      messageApi.warning(nextCoverCheck.message);
    }

    setSubmitting(true);
    setSubmissionResult(null);
    try {
      const payloads = buildManualPublishPayloads({
        configId: defaultExecutionConfig.id,
        deviceId,
        platforms,
        parsed: parsed.value
      });
      const results = await Promise.allSettled(payloads.map((payload) => createManualPublishTest(payload)));
      const successfulPlatforms: QuickPastePlatform[] = [];
      const failedPlatforms: SubmissionResult["failedPlatforms"] = [];

      results.forEach((result, index) => {
        const platform = payloads[index]?.platform as QuickPastePlatform;
        if (result.status === "fulfilled") {
          successfulPlatforms.push(platform);
        } else {
          failedPlatforms.push({ platform, reason: errorMessage(result.reason) });
        }
      });

      const nextResult = { successfulPlatforms, failedPlatforms };
      setSubmissionResult(nextResult);
      if (successfulPlatforms.length) {
        await queryClient.invalidateQueries({ queryKey: ["publishTasks"] });
      }
      if (!failedPlatforms.length) {
        messageApi.success("已成功下发 " + successfulPlatforms.length + " 个发布任务");
        onTaskCreated();
      } else if (successfulPlatforms.length) {
        messageApi.warning("已下发 " + successfulPlatforms.length + " 个任务，" + failedPlatforms.length + " 个任务失败");
      } else {
        messageApi.error("发布任务创建失败：" + failedPlatforms.map((item) => item.reason).join("；"));
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="ops-panel quick-paste-publish-panel">
      {contextHolder}
      <div className="ops-panel-head">
        <span>快速粘贴发布</span>
        <span className="ops-small">使用默认发布执行配置创建独立发布任务</span>
      </div>
      <div className="ops-panel-body quick-paste-layout">
        <Form layout="vertical" requiredMark="optional" className="quick-paste-form">
          {!defaultExecutionConfig ? (
            <Alert
              className="quick-paste-config-alert"
              showIcon
              type="warning"
              message={defaultResolution.issue === "multiple"
                ? "检测到多个默认发布执行配置，请先到发布设置保留一个默认配置"
                : "请先到发布设置中创建默认发布执行配置"}
            />
          ) : (
            <Alert
              className="quick-paste-config-alert"
              showIcon
              type={defaultResolution.issue === "fallback" ? "warning" : "info"}
              message={defaultResolution.issue === "fallback"
                ? "未设置默认配置，暂使用第一个已启用直接素材配置：" + defaultExecutionConfig.configName
                : "当前使用默认发布执行配置：" + defaultExecutionConfig.configName}
            />
          )}
          <Form.Item label="设备" required>
            <Select
              showSearch
              value={deviceId}
              loading={loading}
              optionFilterProp="label"
              placeholder="选择设备"
              options={orderedDevices.map((device) => ({ value: device.id, label: deviceOptionLabel(device) }))}
              onChange={setDeviceId}
            />
          </Form.Item>
          <Form.Item label="发布平台" required>
            <Checkbox.Group
              value={platforms}
              options={[{ label: "抖音", value: "抖音" }, { label: "视频号", value: "视频号" }]}
              onChange={(values) => setPlatforms(values as QuickPastePlatform[])}
            />
          </Form.Item>
          <Form.Item
            label="粘贴内容"
            required
            extra={"支持三行“成片/封面、标题、描述”或四行“成片、封面、标题、描述”；描述必须恰好包含 " + expectedTopicCount + " 个 #话题。粘贴 /public/downloads/{草稿ID}.mp4 预览地址时会自动转换为真实 COS 视频地址并推导同一 COS 存储中的封面地址；未提供封面时会按普通 .mp4 推导 .jpg 并执行封面校验。"}
          >
            <Input.TextArea
              rows={8}
              value={rawText}
              placeholder={"成片/封面：https://example.com/video-id.mp4 https://example.com/video-id.jpg\n标题：发布标题\n描述：发布描述 #话题一 #话题二 #话题三 #话题四 #话题五\n\n或\n\n成片：https://example.com/video-id.mp4\n封面：https://example.com/video-id.jpg\n标题：发布标题\n描述：发布描述 #话题一 #话题二 #话题三 #话题四 #话题五"}
              onChange={(event) => setRawText(event.target.value)}
            />
          </Form.Item>
          <Space>
            <Button
              type="primary"
              loading={submitting || coverCheck.status === "checking"}
              disabled={loading || submitting || coverCheck.status === "checking" || !defaultExecutionConfig}
              onClick={() => void submit()}
            >
              校验封面并下发
            </Button>
            <span className="ops-small">两平台会并发创建两条独立任务</span>
          </Space>
          {submissionResult ? (
            <Alert
              className="quick-paste-submit-result"
              showIcon
              type={submissionResult.failedPlatforms.length ? "warning" : "success"}
              message={submissionResult.failedPlatforms.length ? "部分任务已下发，请处理失败项" : "发布任务已全部下发"}
              description={submissionResult.failedPlatforms.length
                ? submissionResult.failedPlatforms.map((item) => item.platform + "：" + item.reason).join("；")
                : undefined}
            />
          ) : null}
        </Form>
        <QuickPastePublishPreview
          parseResult={parsed}
          selectedDevice={selectedDevice}
          platforms={platforms}
          coverStatus={coverCheck.status}
          coverStatusMessage={coverCheck.message}
        />
      </div>
    </section>
  );
}
