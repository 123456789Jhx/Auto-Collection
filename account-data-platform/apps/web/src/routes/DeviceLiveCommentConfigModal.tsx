import { Form, Input, InputNumber, Modal, Switch, Tabs } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import {
  getDeviceTaskConfig,
  getLiveTargets,
  saveDeviceLiveTargetBindings,
  saveLiveTarget,
  saveLiveTargetFeatureConfig,
  updateDeviceTaskConfig,
  type LiveTarget,
  type LiveTargetFeatureConfig
} from "../lib/api-client";
import { deviceDisplayName } from "../lib/display-maps";
import { defaultLiveCommentBotConfig, defaultP3ExtensionsConfig } from "../lib/live-comment-config";

const COMMERCE_FEATURE_TYPE = "commerce_card_live_comment";
const DEFAULT_COMMERCE_LIVE_SIGNALS = ["直播中", "讲解中", "主播讲解", "进入直播间", "正在直播"];

export type ConfigurableDevice = {
  deviceCode: string;
  deviceName?: string | null;
  douyinAccountName?: string | null;
  platform?: string | null;
};

type LiveCommentMode = "off" | "target_follow" | "agri_chatbot";

type TaskConfigRow = {
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  commentLimit?: number;
  heartbeatMinutes?: number;
  liveCommentMode?: LiveCommentMode;
  liveCommentBotConfig?: Record<string, unknown> | null;
  p3ExtensionsConfig?: Record<string, unknown> | null;
};

type DeviceLiveCommentConfigFormValues = {
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  commentLimit?: number;
  heartbeatMinutes?: number;
  liveCommentSearchKeywords?: string;
  liveCommentTargetRoomName?: string;
  liveCommentMaxCommentsPerRoom?: number;
  liveCommentMaxCommentsPerHour?: number;
  liveCommentTargetMaxSendCount?: number;
  liveCommentTargetMinSendIntervalSeconds?: number;
  commerceSearchKeywords?: string;
  commerceProductKeywords?: string;
  commerceProductCardDwellSeconds?: number;
  commerceRoundMinutes?: number;
  commerceMaxRounds?: number;
  targetCommentRoomName?: string;
  targetCommentAliases?: string;
  targetCommentExecuteEnabled?: boolean;
  targetCommentSearchMaxActiveMinutes?: number;
  targetCommentMaxCommentsPerRoom?: number;
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

function booleanValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
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
  const liveCommentMode = record.liveCommentMode === "off" || record.liveCommentMode === "target_follow" || record.liveCommentMode === "agri_chatbot"
    ? record.liveCommentMode
    : undefined;
  return {
    videoMinutesMin: numberValue(record.videoMinutesMin, 120),
    videoMinutesMax: numberValue(record.videoMinutesMax, 180),
    liveMinutesMin: numberValue(record.liveMinutesMin, 60),
    liveMinutesMax: numberValue(record.liveMinutesMax, 120),
    commentLimit: numberValue(record.commentLimit, 10),
    heartbeatMinutes: numberValue(record.heartbeatMinutes, 1),
    liveCommentMode,
    liveCommentBotConfig: nullableRecord(record.liveCommentBotConfig),
    p3ExtensionsConfig: nullableRecord(record.p3ExtensionsConfig)
  };
}

function commerceTargetCode(deviceCode?: string | null) {
  const normalized = String(deviceCode || "device").replace(/\s+/g, "_").slice(0, 45);
  return `${normalized}_cc_v2`;
}

function findWorkbenchCommerceTarget(targets: LiveTarget[] | undefined, deviceCode?: string | null) {
  const targetCode = commerceTargetCode(deviceCode);
  return (targets || []).find((target) => target.targetCode === targetCode) ?? null;
}

function findCommerceFeature(target?: LiveTarget | null): LiveTargetFeatureConfig | null {
  return target?.featureConfigs.find((feature) =>
    feature.featureType === COMMERCE_FEATURE_TYPE && feature.storedWorkflowVersion === 2
  ) ?? target?.featureConfigs.find((feature) => feature.featureType === COMMERCE_FEATURE_TYPE) ?? null;
}

function configFormValues(taskConfig?: TaskConfigRow | null, commerceTarget?: LiveTarget | null): DeviceLiveCommentConfigFormValues {
  const botConfig = { ...(defaultLiveCommentBotConfig as Record<string, unknown>), ...recordValue(taskConfig?.liveCommentBotConfig) };
  const targetRoom = recordValue(botConfig.targetRoom);
  const p3Config = { ...(defaultP3ExtensionsConfig as Record<string, unknown>), ...recordValue(taskConfig?.p3ExtensionsConfig) };
  const defaultCommerce = recordValue((defaultP3ExtensionsConfig as Record<string, unknown>).commerceCardLiveComment);
  const commerceConfig = { ...defaultCommerce, ...recordValue(p3Config.commerceCardLiveComment) };
  const commerceTargetRoom = recordValue(commerceConfig.targetRoom);
  const featureConfig = findCommerceFeature(commerceTarget);
  const runtimeConfig = recordValue(featureConfig?.runtimeConfig);
  const featureSearchKeywords = listValue(featureConfig?.searchKeywords);
  const featureProductKeywords = listValue(featureConfig?.productKeywords);
  const targetAliases = commerceTarget?.aliases?.filter((item) => item.enabled).map((item) => item.aliasText) ?? [];
  const commerceSearchKeywords = featureSearchKeywords.length > 0 ? featureSearchKeywords : listValue(commerceConfig.searchKeywords);
  const commerceProductKeywords = featureProductKeywords.length > 0
    ? featureProductKeywords
    : uniqueTextList([...listValue(commerceConfig.productKeywords), ...listValue(commerceConfig.matchKeywords)]);

  return {
    videoMinutesMin: taskConfig?.videoMinutesMin ?? 120,
    videoMinutesMax: taskConfig?.videoMinutesMax ?? 180,
    liveMinutesMin: taskConfig?.liveMinutesMin ?? 60,
    liveMinutesMax: taskConfig?.liveMinutesMax ?? 120,
    commentLimit: taskConfig?.commentLimit ?? 10,
    heartbeatMinutes: taskConfig?.heartbeatMinutes ?? 1,
    liveCommentSearchKeywords: listText(targetRoom.searchKeywords),
    liveCommentTargetRoomName: textValue(targetRoom.targetName),
    liveCommentMaxCommentsPerRoom: numberValue(botConfig.maxCommentsPerRoom, 3),
    liveCommentMaxCommentsPerHour: numberValue(botConfig.maxCommentsPerHour, 10),
    liveCommentTargetMaxSendCount: numberValue(targetRoom.maxSendCount, 3),
    liveCommentTargetMinSendIntervalSeconds: numberValue(targetRoom.minSendIntervalSeconds, numberValue(botConfig.minIntervalSeconds, 120)),
    commerceSearchKeywords: commerceSearchKeywords.join("\n"),
    commerceProductKeywords: commerceProductKeywords.join("\n"),
    commerceProductCardDwellSeconds: numberValue(runtimeConfig.productCardDwellSeconds, numberValue(commerceConfig.productCardDwellSeconds, 120)),
    commerceRoundMinutes: numberValue(runtimeConfig.productNurtureRoundMinutes, numberValue(commerceConfig.scanMinutesPerRound, 15)),
    commerceMaxRounds: numberValue(runtimeConfig.productNurtureMaxRounds, numberValue(commerceConfig.maxRounds, 3)),
    targetCommentRoomName: commerceTarget?.targetName || textValue(commerceTargetRoom.targetName),
    targetCommentAliases: uniqueTextList(targetAliases).join("\n"),
    targetCommentExecuteEnabled: booleanValue(runtimeConfig.executeEnabled, booleanValue(commerceConfig.executeEnabled, false)),
    targetCommentSearchMaxActiveMinutes: numberValue(runtimeConfig.targetCommentSearchMaxActiveMinutes, 60),
    targetCommentMaxCommentsPerRoom: numberValue(runtimeConfig.maxCommentsPerRoom, numberValue(commerceConfig.maxCommentsPerRoom, 1)),
    commentPoolText: listText(runtimeConfig.commentPool ?? commerceConfig.commentPool)
  };
}

function buildLiveCommentBotConfig(taskConfig: TaskConfigRow | undefined, values: DeviceLiveCommentConfigFormValues) {
  const botConfig = { ...(defaultLiveCommentBotConfig as Record<string, unknown>), ...recordValue(taskConfig?.liveCommentBotConfig) };
  const targetRoom = recordValue(botConfig.targetRoom);
  const targetName = (values.liveCommentTargetRoomName || "").trim();
  const searchKeywords = parseTextList(values.liveCommentSearchKeywords);

  return {
    ...botConfig,
    maxCommentsPerRoom: values.liveCommentMaxCommentsPerRoom ?? 3,
    maxCommentsPerHour: values.liveCommentMaxCommentsPerHour ?? 10,
    targetRoom: {
      ...targetRoom,
      enabled: true,
      targetName,
      searchKeywords,
      matchKeywords: uniqueTextList([targetName, ...listValue(targetRoom.matchKeywords)]),
      maxSendCount: values.liveCommentTargetMaxSendCount ?? 3,
      minSendIntervalSeconds: values.liveCommentTargetMinSendIntervalSeconds ?? 120,
      similarityThreshold: numberValue(targetRoom.similarityThreshold, 0.9)
    }
  };
}

function buildP3ExtensionsConfig(taskConfig: TaskConfigRow | undefined, values: DeviceLiveCommentConfigFormValues) {
  const p3Config = { ...(defaultP3ExtensionsConfig as Record<string, unknown>), ...recordValue(taskConfig?.p3ExtensionsConfig) };
  const defaultCommerce = recordValue((defaultP3ExtensionsConfig as Record<string, unknown>).commerceCardLiveComment);
  const commerceConfig = { ...defaultCommerce, ...recordValue(p3Config.commerceCardLiveComment) };
  const commerceTargetRoom = recordValue(commerceConfig.targetRoom);
  const targetName = (values.targetCommentRoomName || "").trim();
  const aliases = parseTextList(values.targetCommentAliases);
  const searchKeywords = parseTextList(values.commerceSearchKeywords);
  const productKeywords = parseTextList(values.commerceProductKeywords);
  const commentPool = parseTextList(values.commentPoolText);

  return {
    ...p3Config,
    commerceCardLiveComment: {
      ...commerceConfig,
      enabled: true,
      executeEnabled: values.targetCommentExecuteEnabled === true,
      manualExecutionApproved: values.targetCommentExecuteEnabled === true,
      searchKeywords,
      matchKeywords: uniqueTextList([...productKeywords, ...searchKeywords]),
      productKeywords,
      liveSignals: listValue(commerceConfig.liveSignals).length > 0 ? listValue(commerceConfig.liveSignals) : DEFAULT_COMMERCE_LIVE_SIGNALS,
      scanMinutesPerRound: values.commerceRoundMinutes ?? 15,
      productCardDwellSeconds: values.commerceProductCardDwellSeconds ?? 120,
      watchMinutesPerLive: numberValue(commerceConfig.watchMinutesPerLive, 15),
      maxRounds: values.commerceMaxRounds ?? 3,
      maxCommentsPerRoom: values.targetCommentMaxCommentsPerRoom ?? 1,
      commentPool,
      targetRoom: {
        ...commerceTargetRoom,
        enabled: true,
        targetName,
        matchKeywords: uniqueTextList([targetName, ...aliases]),
        similarityThreshold: numberValue(commerceTargetRoom.similarityThreshold, 0.9)
      }
    }
  };
}

async function saveWorkbenchCommerceTarget(device: ConfigurableDevice, targets: LiveTarget[] | undefined, values: DeviceLiveCommentConfigFormValues) {
  const existingTarget = findWorkbenchCommerceTarget(targets, device.deviceCode);
  const existingFeature = findCommerceFeature(existingTarget);
  const searchKeywords = parseTextList(values.commerceSearchKeywords);
  const productKeywords = parseTextList(values.commerceProductKeywords);
  const targetName = (values.targetCommentRoomName || "").trim();
  const aliases = parseTextList(values.targetCommentAliases);
  const commentPool = parseTextList(values.commentPoolText);
  const maxCommentsPerRoom = values.targetCommentMaxCommentsPerRoom ?? 1;

  if (!targetName && !existingTarget) return;
  if (!targetName) throw new Error("请填写目标直播间名称");
  if (searchKeywords.length === 0) throw new Error("请填写商品卡商城搜索词");
  if (productKeywords.length === 0) throw new Error("请填写商品卡匹配词");
  if (maxCommentsPerRoom > 0 && commentPool.length < maxCommentsPerRoom) {
    throw new Error("评论内容数量不能少于目标直播间单房发送上限");
  }

  const savedTarget = await saveLiveTarget({
    id: existingTarget?.id,
    targetCode: commerceTargetCode(device.deviceCode),
    targetName,
    platform: device.platform || "douyin",
    similarityThreshold: 0.9,
    enabled: true,
    remark: "工作台商品卡组合任务配置",
    aliases: uniqueTextList([targetName, ...aliases]).map((aliasText, index) => ({
      aliasText,
      aliasType: "room_name",
      weight: 100 + index,
      enabled: true
    }))
  });
  if (!savedTarget.id) {
    throw new Error("商品卡目标保存失败");
  }

  const currentFeature = findCommerceFeature(savedTarget) ?? existingFeature;
  const targetAfterFeature = await saveLiveTargetFeatureConfig(savedTarget.id, {
    featureType: COMMERCE_FEATURE_TYPE,
    searchKeywords,
    requiredKeywords: [],
    forbiddenKeywords: [],
    productKeywords,
    liveSignals: DEFAULT_COMMERCE_LIVE_SIGNALS,
    runtimeConfig: {
      configVersion: 2,
      enabledStages: ["product_nurture", "target_comment"],
      executeEnabled: values.targetCommentExecuteEnabled === true,
      recommendationSignals: ["你可能还会喜欢"],
      productCardDwellSeconds: values.commerceProductCardDwellSeconds ?? 120,
      productNurtureRoundMinutes: values.commerceRoundMinutes ?? 15,
      productNurtureMaxRounds: values.commerceMaxRounds ?? 3,
      targetLiveMaxRoomsPerRefresh: 25,
      targetCommentSearchMaxActiveMinutes: values.targetCommentSearchMaxActiveMinutes ?? 60,
      maxCommentsPerRoom,
      commentPool,
      liveNurtureKeywords: [],
      liveNurtureRefreshAfterRooms: 10,
      liveNurtureWatchMinMinutes: 10,
      liveNurtureWatchMaxMinutes: 20,
      liveNurtureTotalMinMinutes: 70,
      liveNurtureTotalMaxMinutes: 100,
      taskMaxActiveMinutes: 240
    },
    enabled: true,
    expectedRevision: currentFeature?.revision ?? 0
  });
  const savedFeature = findCommerceFeature(targetAfterFeature);
  if (!savedFeature?.revision) {
    throw new Error("商品卡功能配置保存失败");
  }
  await saveDeviceLiveTargetBindings({
    targetId: savedTarget.id,
    featureType: COMMERCE_FEATURE_TYPE,
    deviceCodes: [device.deviceCode],
    defaultEnabled: false,
    expectedRevision: savedFeature.revision
  });
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
  const liveTargetsQuery = useQuery({
    queryKey: ["liveTargets", "workbench-config", platform],
    enabled: open && !!device?.deviceCode,
    queryFn: () => getLiveTargets(platform)
  });
  const mutation = useMutation({
    mutationFn: async (values: DeviceLiveCommentConfigFormValues) => {
      if (!device?.deviceCode) throw new Error("请先选择要配置的手机");
      const taskConfig = taskConfigFromUnknown(configQuery.data);
      const payload = {
        videoMinutesMin: values.videoMinutesMin ?? 120,
        videoMinutesMax: values.videoMinutesMax ?? 180,
        liveMinutesMin: values.liveMinutesMin ?? 60,
        liveMinutesMax: values.liveMinutesMax ?? 120,
        commentLimit: values.commentLimit ?? 10,
        heartbeatMinutes: values.heartbeatMinutes ?? 1,
        liveCommentMode: "agri_chatbot" as const,
        liveCommentBotConfig: buildLiveCommentBotConfig(taskConfig, values),
        p3ExtensionsConfig: buildP3ExtensionsConfig(taskConfig, values)
      };
      await saveWorkbenchCommerceTarget(device, liveTargetsQuery.data, values);
      return updateDeviceTaskConfig(device.deviceCode, payload, platform);
    },
    onSuccess: async () => {
      onClose();
      onSaved?.();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["device-live-comment-config"] }),
        queryClient.invalidateQueries({ queryKey: ["liveTargets"] }),
        queryClient.invalidateQueries({ queryKey: ["devices"] }),
        queryClient.invalidateQueries({ queryKey: ["overview"] }),
        queryClient.invalidateQueries({ queryKey: ["task-assignments"] })
      ]);
    }
  });

  useEffect(() => {
    if (!open) return;
    form.setFieldsValue(configFormValues(
      taskConfigFromUnknown(configQuery.data),
      findWorkbenchCommerceTarget(liveTargetsQuery.data, device?.deviceCode)
    ));
  }, [configQuery.data, device?.deviceCode, form, liveTargetsQuery.data, open]);

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
      width={820}
    >
      {configQuery.isFetching || liveTargetsQuery.isFetching ? <div className="scheduler-config-hint">正在读取手机当前配置...</div> : null}
      {configQuery.isError ? <div className="scheduler-error">配置加载失败：{configQuery.error.message}</div> : null}
      {liveTargetsQuery.isError ? <div className="scheduler-error">目标配置加载失败：{liveTargetsQuery.error.message}</div> : null}
      {mutation.isError ? <div className="scheduler-error">配置保存失败：{mutation.error.message}</div> : null}
      <Form
        form={form}
        layout="vertical"
        className="scheduler-config-form"
        onFinish={(values) => mutation.mutate(values)}
      >
        <Tabs
          items={[
            {
              key: "video",
              label: "刷视频配置",
              children: (
                <div className="scheduler-config-grid">
                  <Form.Item label="视频随机下限" name="videoMinutesMin" rules={[{ required: true, message: "请输入视频时长下限" }]}>
                    <InputNumber min={1} max={1440} addonAfter="分钟" style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="视频随机上限" name="videoMinutesMax" rules={[{ required: true, message: "请输入视频时长上限" }]}>
                    <InputNumber min={1} max={1440} addonAfter="分钟" style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="评论采集数量" name="commentLimit">
                    <InputNumber min={0} max={200} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="心跳间隔" name="heartbeatMinutes">
                    <InputNumber min={1} max={60} addonAfter="分钟" style={{ width: "100%" }} />
                  </Form.Item>
                </div>
              )
            },
            {
              key: "live",
              label: "刷直播配置",
              children: (
                <div className="scheduler-config-grid">
                  <Form.Item label="直播随机下限" name="liveMinutesMin" rules={[{ required: true, message: "请输入直播时长下限" }]}>
                    <InputNumber min={1} max={1440} addonAfter="分钟" style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="直播随机上限" name="liveMinutesMax" rules={[{ required: true, message: "请输入直播时长上限" }]}>
                    <InputNumber min={1} max={1440} addonAfter="分钟" style={{ width: "100%" }} />
                  </Form.Item>
                </div>
              )
            },
            {
              key: "search-live-comment",
              label: "搜直播评论配置",
              children: (
                <div className="scheduler-config-grid">
                  <Form.Item className="scheduler-config-wide" label="搜索关键词" name="liveCommentSearchKeywords">
                    <Input.TextArea rows={3} placeholder={"夏橙\n秭归夏橙"} />
                  </Form.Item>
                  <Form.Item label="目标直播间名称" name="liveCommentTargetRoomName">
                    <Input maxLength={200} placeholder="秭归夏橙直播间" />
                  </Form.Item>
                  <Form.Item label="直播间评论上限" name="liveCommentMaxCommentsPerRoom">
                    <InputNumber min={0} max={20} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="每小时直播评论上限" name="liveCommentMaxCommentsPerHour">
                    <InputNumber min={0} max={100} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="目标直播间发送上限" name="liveCommentTargetMaxSendCount">
                    <InputNumber min={0} max={20} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="目标房间发送间隔" name="liveCommentTargetMinSendIntervalSeconds">
                    <InputNumber min={10} max={3600} addonAfter="秒" style={{ width: "100%" }} />
                  </Form.Item>
                </div>
              )
            },
            {
              key: "commerce-nurture",
              label: "商品卡养号配置",
              children: (
                <div className="scheduler-config-grid">
                  <Form.Item className="scheduler-config-wide" label="商城搜索关键词" name="commerceSearchKeywords" rules={[{ required: true, message: "请输入商城搜索关键词" }]}>
                    <Input.TextArea rows={3} placeholder={"夏橙\n秭归夏橙"} />
                  </Form.Item>
                  <Form.Item className="scheduler-config-wide" label="商品卡匹配词" name="commerceProductKeywords" rules={[{ required: true, message: "请输入商品卡匹配词" }]}>
                    <Input.TextArea rows={3} placeholder={"夏橙\n秭归"} />
                  </Form.Item>
                  <Form.Item label="每轮浏览时长" name="commerceRoundMinutes">
                    <InputNumber min={5} max={30} addonAfter="分钟" style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="最多循环轮次" name="commerceMaxRounds">
                    <InputNumber min={1} max={6} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="单卡停留时长" name="commerceProductCardDwellSeconds">
                    <InputNumber min={60} max={180} addonAfter="秒" style={{ width: "100%" }} />
                  </Form.Item>
                </div>
              )
            },
            {
              key: "target-comment",
              label: "目标直播间评论配置",
              children: (
                <div className="scheduler-config-grid">
                  <Form.Item label="目标直播间名称" name="targetCommentRoomName" rules={[{ required: true, message: "请输入目标直播间名称" }]}>
                    <Input maxLength={200} placeholder="后台配置的目标直播间账号名字" />
                  </Form.Item>
                  <Form.Item label="允许发送评论" name="targetCommentExecuteEnabled" valuePropName="checked">
                    <Switch checkedChildren="允许" unCheckedChildren="禁止" />
                  </Form.Item>
                  <Form.Item className="scheduler-config-wide" label="目标直播间别名" name="targetCommentAliases">
                    <Input.TextArea rows={3} placeholder={"账号别名\n直播间标题关键词"} />
                  </Form.Item>
                  <Form.Item label="目标搜索最长时间" name="targetCommentSearchMaxActiveMinutes">
                    <InputNumber min={5} max={120} addonAfter="分钟" style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item label="单房发送上限" name="targetCommentMaxCommentsPerRoom">
                    <InputNumber min={0} max={5} style={{ width: "100%" }} />
                  </Form.Item>
                  <Form.Item
                    className="scheduler-config-wide"
                    label="评论内容"
                    name="commentPoolText"
                    dependencies={["targetCommentMaxCommentsPerRoom"]}
                    rules={[({ getFieldValue }) => ({
                      validator: async (_, value: string | undefined) => {
                        const maxComments = numberValue(getFieldValue("targetCommentMaxCommentsPerRoom"), 1);
                        if (maxComments <= 0 || parseTextList(value).length >= maxComments) return;
                        throw new Error("评论内容数量不能少于单房发送上限");
                      }
                    })]}
                  >
                    <Input.TextArea rows={4} maxLength={2000} placeholder={"111\n666"} />
                  </Form.Item>
                </div>
              )
            }
          ]}
        />
        <div className="scheduler-config-hint">保存后后台会下发 REFRESH_CONFIG，手机领取后刷新本机配置。</div>
      </Form>
    </Modal>
  );
}
