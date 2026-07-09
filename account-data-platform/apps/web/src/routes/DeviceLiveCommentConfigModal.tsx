import { Form, Input, InputNumber, Modal } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { getDeviceTaskConfig, updateDeviceTaskConfig } from "../lib/api-client";
import { deviceDisplayName } from "../lib/display-maps";
import { defaultLiveCommentBotConfig, defaultP3ExtensionsConfig } from "../lib/live-comment-config";

export type ConfigurableDevice = {
  deviceCode: string;
  deviceName?: string | null;
  douyinAccountName?: string | null;
  platform?: string | null;
};

type TaskConfigRow = {
  liveCommentBotConfig?: Record<string, unknown> | null;
  p3ExtensionsConfig?: Record<string, unknown> | null;
};

type DeviceLiveCommentConfigFormValues = {
  searchKeywords?: string;
  targetRoomName?: string;
  maxCommentsPerRoom?: number;
  maxCommentsPerHour?: number;
  targetMaxSendCount?: number;
  targetMinSendIntervalSeconds?: number;
  commentPoolText?: string;
};

type DeviceLiveCommentConfigModalProps = {
  open: boolean;
  device: ConfigurableDevice | null;
  onClose: () => void;
  onSaved?: () => void;
};

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTextList(value?: string) {
  return (value || "")
    .split(/[\n,，、]/)
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 50);
}

function listValue(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value === "string") return parseTextList(value);
  return [];
}

function listText(value: unknown) {
  return listValue(value).join("\n");
}

function uniqueTextList(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function taskConfigFromUnknown(value: unknown): TaskConfigRow {
  const record = recordValue(value);
  return {
    liveCommentBotConfig: nullableRecord(record.liveCommentBotConfig),
    p3ExtensionsConfig: nullableRecord(record.p3ExtensionsConfig)
  };
}

function configFormValues(taskConfig?: TaskConfigRow | null): DeviceLiveCommentConfigFormValues {
  const botConfig = { ...(defaultLiveCommentBotConfig as Record<string, unknown>), ...recordValue(taskConfig?.liveCommentBotConfig) };
  const targetRoom = recordValue(botConfig.targetRoom);
  const p3Config = { ...(defaultP3ExtensionsConfig as Record<string, unknown>), ...recordValue(taskConfig?.p3ExtensionsConfig) };
  const defaultCommerce = recordValue((defaultP3ExtensionsConfig as Record<string, unknown>).commerceCardLiveComment);
  const commerceConfig = { ...defaultCommerce, ...recordValue(p3Config.commerceCardLiveComment) };
  const commerceTargetRoom = recordValue(commerceConfig.targetRoom);
  const liveSearchKeywords = listValue(targetRoom.searchKeywords);
  const commerceSearchKeywords = listValue(commerceConfig.searchKeywords);

  return {
    searchKeywords: (liveSearchKeywords.length > 0 ? liveSearchKeywords : commerceSearchKeywords).join("\n"),
    targetRoomName: textValue(targetRoom.targetName) || textValue(commerceTargetRoom.targetName),
    maxCommentsPerRoom: numberValue(botConfig.maxCommentsPerRoom, 3),
    maxCommentsPerHour: numberValue(botConfig.maxCommentsPerHour, 10),
    targetMaxSendCount: numberValue(targetRoom.maxSendCount, numberValue(commerceConfig.maxCommentsPerRoom, 1)),
    targetMinSendIntervalSeconds: numberValue(targetRoom.minSendIntervalSeconds, numberValue(botConfig.minIntervalSeconds, 120)),
    commentPoolText: listText(commerceConfig.commentPool)
  };
}

function buildLiveCommentBotConfig(taskConfig: TaskConfigRow | undefined, values: DeviceLiveCommentConfigFormValues) {
  const botConfig = { ...(defaultLiveCommentBotConfig as Record<string, unknown>), ...recordValue(taskConfig?.liveCommentBotConfig) };
  const targetRoom = recordValue(botConfig.targetRoom);
  const targetName = (values.targetRoomName || "").trim();
  const searchKeywords = parseTextList(values.searchKeywords);

  return {
    ...botConfig,
    maxCommentsPerRoom: values.maxCommentsPerRoom ?? 3,
    maxCommentsPerHour: values.maxCommentsPerHour ?? 10,
    targetRoom: {
      ...targetRoom,
      enabled: true,
      targetName,
      searchKeywords,
      matchKeywords: uniqueTextList([targetName, ...listValue(targetRoom.matchKeywords)]),
      maxSendCount: values.targetMaxSendCount ?? 3,
      minSendIntervalSeconds: values.targetMinSendIntervalSeconds ?? 120,
      similarityThreshold: numberValue(targetRoom.similarityThreshold, 0.9)
    }
  };
}

function buildP3ExtensionsConfig(taskConfig: TaskConfigRow | undefined, values: DeviceLiveCommentConfigFormValues) {
  const p3Config = { ...(defaultP3ExtensionsConfig as Record<string, unknown>), ...recordValue(taskConfig?.p3ExtensionsConfig) };
  const defaultCommerce = recordValue((defaultP3ExtensionsConfig as Record<string, unknown>).commerceCardLiveComment);
  const commerceConfig = { ...defaultCommerce, ...recordValue(p3Config.commerceCardLiveComment) };
  const commerceTargetRoom = recordValue(commerceConfig.targetRoom);
  const targetName = (values.targetRoomName || "").trim();
  const searchKeywords = parseTextList(values.searchKeywords);

  return {
    ...p3Config,
    commerceCardLiveComment: {
      ...commerceConfig,
      enabled: true,
      searchKeywords,
      matchKeywords: uniqueTextList([...listValue(commerceConfig.matchKeywords), ...searchKeywords]),
      maxCommentsPerRoom: values.targetMaxSendCount ?? 1,
      commentPool: parseTextList(values.commentPoolText),
      targetRoom: {
        ...commerceTargetRoom,
        enabled: true,
        targetName,
        matchKeywords: uniqueTextList([targetName, ...listValue(commerceTargetRoom.matchKeywords)]),
        similarityThreshold: numberValue(commerceTargetRoom.similarityThreshold, 0.9)
      }
    }
  };
}

export function DeviceLiveCommentConfigModal({ open, device, onClose, onSaved }: DeviceLiveCommentConfigModalProps) {
  const [form] = Form.useForm<DeviceLiveCommentConfigFormValues>();
  const queryClient = useQueryClient();
  const platform = device?.platform || "douyin";
  const configQuery = useQuery({
    queryKey: ["device-live-comment-config", device?.deviceCode, platform],
    enabled: open && !!device?.deviceCode,
    queryFn: () => getDeviceTaskConfig(device?.deviceCode || "", platform)
  });
  const mutation = useMutation({
    mutationFn: async (values: DeviceLiveCommentConfigFormValues) => {
      if (!device?.deviceCode) throw new Error("请先选择要配置的手机");
      const taskConfig = taskConfigFromUnknown(configQuery.data);
      return updateDeviceTaskConfig(device.deviceCode, {
        liveCommentBotConfig: buildLiveCommentBotConfig(taskConfig, values),
        p3ExtensionsConfig: buildP3ExtensionsConfig(taskConfig, values)
      }, platform);
    },
    onSuccess: async () => {
      onClose();
      onSaved?.();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["device-live-comment-config"] }),
        queryClient.invalidateQueries({ queryKey: ["devices"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["task-assignments"] })
      ]);
    }
  });

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(configFormValues(taskConfigFromUnknown(configQuery.data)));
  }, [configQuery.data, form, open]);

  return (
    <Modal
      className="scheduler-config-modal"
      title={`配置${device ? ` - ${deviceDisplayName(device)}` : ""}`}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={mutation.isPending}
      okText="保存"
      cancelText="取消"
      width={780}
    >
      {configQuery.isFetching ? <div className="scheduler-config-hint">正在读取手机当前配置...</div> : null}
      {configQuery.isError ? <div className="scheduler-error">配置加载失败：{configQuery.error.message}</div> : null}
      {mutation.isError ? <div className="scheduler-error">配置保存失败：{mutation.error.message}</div> : null}
      <Form
        form={form}
        layout="vertical"
        className="scheduler-config-form"
        onFinish={(values) => mutation.mutate(values)}
      >
        <div className="scheduler-config-grid">
          <Form.Item
            className="scheduler-config-wide"
            label="搜索关键词"
            name="searchKeywords"
            rules={[{ required: true, message: "请输入搜索关键词" }]}
          >
            <Input.TextArea rows={3} placeholder={"夏橙\n秭归夏橙"} />
          </Form.Item>
          <Form.Item
            label="目标直播间名称"
            name="targetRoomName"
            rules={[{ required: true, message: "请输入目标直播间名称" }]}
          >
            <Input maxLength={200} placeholder="秭归夏橙直播间" />
          </Form.Item>
          <Form.Item label="直播间评论上限" name="maxCommentsPerRoom">
            <InputNumber min={0} max={20} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="每小时直播评论上限" name="maxCommentsPerHour">
            <InputNumber min={0} max={100} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="目标直播间发送上限" name="targetMaxSendCount">
            <InputNumber min={0} max={20} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="目标房间发送间隔" name="targetMinSendIntervalSeconds">
            <InputNumber min={10} max={3600} addonAfter="秒" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item
            className="scheduler-config-wide"
            label="评论内容"
            name="commentPoolText"
            rules={[{ required: true, message: "请输入评论内容" }]}
          >
            <Input.TextArea rows={4} maxLength={2000} placeholder={"111\n666\n👍"} />
          </Form.Item>
        </div>
        <div className="scheduler-config-hint">保存后后台会下发 REFRESH_CONFIG，手机领取后刷新本机配置。</div>
      </Form>
    </Modal>
  );
}
