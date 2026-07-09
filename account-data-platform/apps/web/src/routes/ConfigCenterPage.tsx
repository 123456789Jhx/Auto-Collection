import { CheckSquareOutlined, CommentOutlined, CopyOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, ShoppingOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Empty, Form, Input, InputNumber, Select, Skeleton, Space, Switch, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { getDeviceTaskConfig, getDevices, getLiveTargets, updateDeviceTaskConfig, type LiveTarget, type LiveTargetFeatureConfig, type LiveTargetFeatureType } from "../lib/api-client";
import { deviceDisplayName, deviceSubTitle, statusText } from "../lib/display-maps";
import { defaultLiveCommentBotConfig, defaultP3ExtensionsConfig } from "../lib/live-comment-config";

type DeviceRow = {
  id?: string;
  deviceCode: string;
  deviceName?: string | null;
  douyinAccountName?: string | null;
  platform?: string | null;
  effectiveStatus?: string | null;
  status?: string | null;
  currentTask?: string | null;
  lastHeartbeatAt?: string | null;
  enabled?: boolean;
};

type TaskConfigRow = {
  liveCommentBotConfig?: Record<string, unknown> | null;
  p3ExtensionsConfig?: Record<string, unknown> | null;
};

type ConfigFormValues = {
  liveEnabled?: boolean;
  targetRoomName?: string;
  liveSearchKeywords?: string;
  liveMatchKeywords?: string;
  liveRequiredKeywords?: string;
  liveForbiddenKeywords?: string;
  liveMaxCommentsPerRoom?: number;
  liveMaxCommentsPerHour?: number;
  liveMinIntervalSeconds?: number;
  liveTargetMaxSendCount?: number;
  liveTargetMinSendIntervalSeconds?: number;
  commerceEnabled?: boolean;
  commerceSendApproved?: boolean;
  commerceTargetRoomName?: string;
  commerceSearchKeywords?: string;
  commerceMatchKeywords?: string;
  commerceRoomMatchKeywords?: string;
  commerceLiveSignals?: string;
  commerceScanMinutesPerRound?: number;
  commerceWatchMinutesPerLive?: number;
  commerceMaxRounds?: number;
  commerceMaxCommentsPerRoom?: number;
  commerceCommentPool?: string;
};

type DeviceConfigLoadResult = {
  deviceCode: string;
  taskConfig?: TaskConfigRow;
  values: ConfigFormValues;
  errorMessage?: string;
};

type SaveDevicesPayload = {
  targets: Array<{
    device: DeviceRow;
    values: ConfigFormValues;
    taskConfig?: TaskConfigRow;
  }>;
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

function boolValue(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
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
  if (typeof value === "string") {
    return parseTextList(value);
  }
  return [];
}

function listText(value: unknown) {
  return listValue(value).join("\n");
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function statusTone(value?: string | null) {
  if (value === "error" || value === "risk_control") return "red";
  if (value === "offline" || value === "stopped") return "default";
  if (value === "paused" || value === "idle" || value === "booting" || value === "updating") return "orange";
  return "green";
}

function taskConfigFromUnknown(value: unknown): TaskConfigRow {
  const record = recordValue(value);
  return {
    liveCommentBotConfig: nullableRecord(record.liveCommentBotConfig),
    p3ExtensionsConfig: nullableRecord(record.p3ExtensionsConfig)
  };
}

function configFormValues(taskConfig?: TaskConfigRow | null): ConfigFormValues {
  const botConfig = { ...(defaultLiveCommentBotConfig as Record<string, unknown>), ...recordValue(taskConfig?.liveCommentBotConfig) };
  const targetRoom = recordValue(botConfig.targetRoom);
  const p3Config = { ...(defaultP3ExtensionsConfig as Record<string, unknown>), ...recordValue(taskConfig?.p3ExtensionsConfig) };
  const defaultCommerce = recordValue((defaultP3ExtensionsConfig as Record<string, unknown>).commerceCardLiveComment);
  const commerceConfig = { ...defaultCommerce, ...recordValue(p3Config.commerceCardLiveComment) };
  const commerceTargetRoom = recordValue(commerceConfig.targetRoom);

  return {
    liveEnabled: boolValue(targetRoom.enabled, false),
    targetRoomName: textValue(targetRoom.targetName),
    liveSearchKeywords: listText(targetRoom.searchKeywords),
    liveMatchKeywords: listText(targetRoom.matchKeywords),
    liveRequiredKeywords: listText(targetRoom.requiredKeywords),
    liveForbiddenKeywords: listText(targetRoom.forbiddenKeywords),
    liveMaxCommentsPerRoom: numberValue(botConfig.maxCommentsPerRoom, 3),
    liveMaxCommentsPerHour: numberValue(botConfig.maxCommentsPerHour, 10),
    liveMinIntervalSeconds: numberValue(botConfig.minIntervalSeconds, 120),
    liveTargetMaxSendCount: numberValue(targetRoom.maxSendCount, 3),
    liveTargetMinSendIntervalSeconds: numberValue(targetRoom.minSendIntervalSeconds, 30),
    commerceEnabled: boolValue(commerceConfig.enabled, false),
    commerceSendApproved: boolValue(commerceConfig.executeEnabled, false) && boolValue(commerceConfig.manualExecutionApproved, false),
    commerceTargetRoomName: textValue(commerceTargetRoom.targetName),
    commerceSearchKeywords: listText(commerceConfig.searchKeywords),
    commerceMatchKeywords: listText(commerceConfig.matchKeywords),
    commerceRoomMatchKeywords: listText(commerceTargetRoom.matchKeywords),
    commerceLiveSignals: listText(commerceConfig.liveSignals),
    commerceScanMinutesPerRound: numberValue(commerceConfig.scanMinutesPerRound, 15),
    commerceWatchMinutesPerLive: numberValue(commerceConfig.watchMinutesPerLive, 15),
    commerceMaxRounds: numberValue(commerceConfig.maxRounds, 3),
    commerceMaxCommentsPerRoom: numberValue(commerceConfig.maxCommentsPerRoom, 1),
    commerceCommentPool: listText(commerceConfig.commentPool)
  };
}

function buildLiveCommentBotConfig(taskConfig: TaskConfigRow | undefined, values: ConfigFormValues) {
  const botConfig = { ...(defaultLiveCommentBotConfig as Record<string, unknown>), ...recordValue(taskConfig?.liveCommentBotConfig) };
  const targetRoom = recordValue(botConfig.targetRoom);

  return {
    ...botConfig,
    maxCommentsPerRoom: values.liveMaxCommentsPerRoom ?? 3,
    maxCommentsPerHour: values.liveMaxCommentsPerHour ?? 10,
    minIntervalSeconds: values.liveMinIntervalSeconds ?? 120,
    targetRoom: {
      ...targetRoom,
      enabled: values.liveEnabled === true,
      targetName: (values.targetRoomName || "").trim(),
      searchKeywords: parseTextList(values.liveSearchKeywords),
      matchKeywords: parseTextList(values.liveMatchKeywords),
      requiredKeywords: parseTextList(values.liveRequiredKeywords),
      forbiddenKeywords: parseTextList(values.liveForbiddenKeywords),
      maxSendCount: values.liveTargetMaxSendCount ?? 3,
      minSendIntervalSeconds: values.liveTargetMinSendIntervalSeconds ?? 30,
      similarityThreshold: numberValue(targetRoom.similarityThreshold, 0.9)
    }
  };
}

function buildP3ExtensionsConfig(taskConfig: TaskConfigRow | undefined, values: ConfigFormValues) {
  const p3Config = { ...(defaultP3ExtensionsConfig as Record<string, unknown>), ...recordValue(taskConfig?.p3ExtensionsConfig) };
  const defaultCommerce = recordValue((defaultP3ExtensionsConfig as Record<string, unknown>).commerceCardLiveComment);
  const commerceConfig = { ...defaultCommerce, ...recordValue(p3Config.commerceCardLiveComment) };
  const commerceTargetRoom = recordValue(commerceConfig.targetRoom);
  const sendApproved = values.commerceSendApproved === true;

  return {
    ...p3Config,
    commerceCardLiveComment: {
      ...commerceConfig,
      enabled: values.commerceEnabled === true,
      executeEnabled: sendApproved,
      manualExecutionApproved: sendApproved,
      searchKeywords: parseTextList(values.commerceSearchKeywords),
      matchKeywords: parseTextList(values.commerceMatchKeywords),
      liveSignals: parseTextList(values.commerceLiveSignals),
      scanMinutesPerRound: values.commerceScanMinutesPerRound ?? 15,
      watchMinutesPerLive: values.commerceWatchMinutesPerLive ?? 15,
      maxRounds: values.commerceMaxRounds ?? 3,
      maxCommentsPerRoom: values.commerceMaxCommentsPerRoom ?? 1,
      commentPool: parseTextList(values.commerceCommentPool),
      targetRoom: {
        ...commerceTargetRoom,
        enabled: values.commerceEnabled === true,
        targetName: (values.commerceTargetRoomName || "").trim(),
        matchKeywords: parseTextList(values.commerceRoomMatchKeywords),
        similarityThreshold: numberValue(commerceTargetRoom.similarityThreshold, 0.9)
      }
    }
  };
}

function featureConfig(target: LiveTarget, featureType: LiveTargetFeatureType): LiveTargetFeatureConfig | undefined {
  return (target.featureConfigs || []).find((item) => item.featureType === featureType);
}

function runtimeNumber(runtime: Record<string, unknown>, key: string, fallback: number) {
  return numberValue(runtime[key], fallback);
}

function aliasTextList(target: LiveTarget) {
  const aliases = (target.aliases || [])
    .filter((alias) => alias.enabled !== false)
    .map((alias) => alias.aliasText.trim())
    .filter(Boolean);
  return aliases.length > 0 ? aliases : [target.targetName].filter(Boolean);
}

function templateKey(target: LiveTarget) {
  return target.id || target.targetCode;
}

function templateLabel(target: LiveTarget) {
  const enabledFeatures = (target.featureConfigs || [])
    .filter((item) => item.enabled !== false)
    .map((item) => item.featureType === "commerce_card_live_comment" ? "商品卡" : "直播评论");
  return enabledFeatures.length > 0 ? `${target.targetName}（${enabledFeatures.join("、")}）` : target.targetName;
}

function applyTemplateValues(target: LiveTarget, current: ConfigFormValues): ConfigFormValues {
  const aliases = aliasTextList(target);
  const liveFeature = featureConfig(target, "live_comment");
  const commerceFeature = featureConfig(target, "commerce_card_live_comment");
  const commerceRuntime = recordValue(commerceFeature?.runtimeConfig);

  return {
    ...current,
    liveEnabled: liveFeature ? liveFeature.enabled !== false : current.liveEnabled,
    targetRoomName: target.targetName,
    liveSearchKeywords: liveFeature ? listText(liveFeature.searchKeywords) : current.liveSearchKeywords,
    liveMatchKeywords: listText(aliases),
    liveRequiredKeywords: liveFeature ? listText(liveFeature.requiredKeywords) : current.liveRequiredKeywords,
    liveForbiddenKeywords: liveFeature ? listText(liveFeature.forbiddenKeywords) : current.liveForbiddenKeywords,
    commerceEnabled: commerceFeature ? commerceFeature.enabled !== false : current.commerceEnabled,
    commerceSendApproved: commerceFeature ? commerceFeature.enabled !== false : current.commerceSendApproved,
    commerceTargetRoomName: target.targetName,
    commerceSearchKeywords: commerceFeature ? listText(commerceFeature.searchKeywords) : current.commerceSearchKeywords,
    commerceMatchKeywords: commerceFeature ? listText(commerceFeature.productKeywords) : current.commerceMatchKeywords,
    commerceRoomMatchKeywords: listText(aliases),
    commerceLiveSignals: commerceFeature ? listText(commerceFeature.liveSignals) : current.commerceLiveSignals,
    commerceScanMinutesPerRound: commerceFeature ? runtimeNumber(commerceRuntime, "scanMinutesPerRound", 15) : current.commerceScanMinutesPerRound,
    commerceWatchMinutesPerLive: commerceFeature ? runtimeNumber(commerceRuntime, "watchMinutesPerLive", 15) : current.commerceWatchMinutesPerLive,
    commerceMaxRounds: commerceFeature ? runtimeNumber(commerceRuntime, "maxRounds", 3) : current.commerceMaxRounds,
    commerceMaxCommentsPerRoom: commerceFeature ? runtimeNumber(commerceRuntime, "maxCommentsPerRoom", 1) : current.commerceMaxCommentsPerRoom,
    commerceCommentPool: commerceFeature ? listText(commerceRuntime.commentPool) : current.commerceCommentPool
  };
}

function uniqueCodes(codes: string[]) {
  return Array.from(new Set(codes.filter(Boolean)));
}

function hasFormConfig(values?: ConfigFormValues) {
  return Boolean(
    values?.targetRoomName ||
    values?.liveSearchKeywords ||
    values?.commerceTargetRoomName ||
    values?.commerceSearchKeywords ||
    values?.commerceMatchKeywords
  );
}

type DeviceConfigFormPanelProps = {
  device: DeviceRow;
  values?: ConfigFormValues;
  loading: boolean;
  errorMessage?: string;
  checked: boolean;
  dirty: boolean;
  saving: boolean;
  onCheck: (checked: boolean) => void;
  onChange: (values: ConfigFormValues) => void;
  onApplyTemplate: () => void;
  onSave: () => void;
  onReload: () => void;
};

function DeviceConfigFormPanel({
  device,
  values,
  loading,
  errorMessage,
  checked,
  dirty,
  saving,
  onCheck,
  onChange,
  onApplyTemplate,
  onSave,
  onReload
}: DeviceConfigFormPanelProps) {
  const [form] = Form.useForm<ConfigFormValues>();
  const status = device.effectiveStatus || device.status;

  useEffect(() => {
    form.setFieldsValue(values || configFormValues(null));
  }, [form, values]);

  return (
    <section className={`config-phone-config-row ${dirty ? "dirty" : ""}`}>
      <div className="config-phone-row-head">
        <div className="config-phone-row-main">
          <Checkbox checked={checked} onChange={(event) => onCheck(event.target.checked)} />
          <div className="config-phone-identity">
            <div className="config-phone-title-line">
              <h2>{deviceDisplayName(device)}</h2>
              <Tag color={statusTone(status)}>{statusText(status)}</Tag>
              {dirty ? <Tag color="gold">未保存</Tag> : <Tag>已同步</Tag>}
            </div>
            <p>{deviceSubTitle(device)}</p>
          </div>
        </div>
        <div className="config-phone-row-meta">
          <span>平台 <strong>{device.platform || "douyin"}</strong></span>
          <span>当前任务 <strong>{device.currentTask || "-"}</strong></span>
          <span>最近心跳 <strong>{formatTime(device.lastHeartbeatAt)}</strong></span>
        </div>
        <div className="config-phone-row-actions">
          <Button icon={<CopyOutlined />} onClick={onApplyTemplate}>
            应用模板到本机
          </Button>
          <Button icon={<ReloadOutlined />} onClick={onReload}>
            重新载入
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={onSave}>
            保存本机
          </Button>
        </div>
      </div>

      {loading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
      {errorMessage ? <Alert type="error" message="配置加载失败" description={errorMessage} showIcon /> : null}
      {!loading && !errorMessage ? (
        <Form
          form={form}
          layout="vertical"
          className="config-feature-form config-phone-inline-form"
          onValuesChange={() => onChange(form.getFieldsValue())}
        >
          <div className="config-feature-fields">
            <section className="config-feature-block">
              <div className="config-feature-heading">
                <div className="config-feature-name">
                  <h3><CommentOutlined /> 搜索直播评论</h3>
                </div>
                <Form.Item name="liveEnabled" valuePropName="checked" noStyle>
                  <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                </Form.Item>
              </div>
              <div className="config-feature-grid">
                <Form.Item label="目标直播间名称" name="targetRoomName">
                  <Input maxLength={200} placeholder="秭归夏橙直播间" />
                </Form.Item>
                <Form.Item label="每直播间评论上限" name="liveMaxCommentsPerRoom">
                  <InputNumber min={0} max={20} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="每小时评论上限" name="liveMaxCommentsPerHour">
                  <InputNumber min={0} max={100} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="评论间隔秒数" name="liveMinIntervalSeconds">
                  <InputNumber min={10} max={3600} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="目标房间发送上限" name="liveTargetMaxSendCount">
                  <InputNumber min={1} max={20} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="目标房间发送间隔" name="liveTargetMinSendIntervalSeconds">
                  <InputNumber min={10} max={3600} style={{ width: "100%" }} />
                </Form.Item>
              </div>
              <div className="config-feature-grid textareas">
                <Form.Item label="搜索关键词" name="liveSearchKeywords">
                  <Input.TextArea rows={4} placeholder={"夏橙\n秭归夏橙"} />
                </Form.Item>
                <Form.Item label="直播间匹配词" name="liveMatchKeywords">
                  <Input.TextArea rows={4} placeholder={"秭归夏橙\n夏橙助农"} />
                </Form.Item>
                <Form.Item label="必须包含词" name="liveRequiredKeywords">
                  <Input.TextArea rows={3} placeholder="可留空" />
                </Form.Item>
                <Form.Item label="排除词" name="liveForbiddenKeywords">
                  <Input.TextArea rows={3} placeholder={"回放\n录播"} />
                </Form.Item>
              </div>
            </section>

            <section className="config-feature-block">
              <div className="config-feature-heading">
                <div className="config-feature-name">
                  <h3><ShoppingOutlined /> 商品卡直播评论</h3>
                </div>
                <Space>
                  <Form.Item name="commerceEnabled" valuePropName="checked" noStyle>
                    <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                  </Form.Item>
                  <Form.Item name="commerceSendApproved" valuePropName="checked" noStyle>
                    <Switch checkedChildren="允许发送" unCheckedChildren="只跑链路" />
                  </Form.Item>
                </Space>
              </div>
              <div className="config-feature-grid">
                <Form.Item label="目标直播间名称" name="commerceTargetRoomName">
                  <Input maxLength={200} placeholder="秭归夏橙直播间" />
                </Form.Item>
                <Form.Item label="每轮扫描分钟" name="commerceScanMinutesPerRound">
                  <InputNumber min={1} max={60} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="进房观看分钟" name="commerceWatchMinutesPerLive">
                  <InputNumber min={0} max={120} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="循环轮次" name="commerceMaxRounds">
                  <InputNumber min={1} max={20} style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="每直播间评论数" name="commerceMaxCommentsPerRoom">
                  <InputNumber min={0} max={5} style={{ width: "100%" }} />
                </Form.Item>
              </div>
              <div className="config-feature-grid textareas">
                <Form.Item label="商品卡搜索关键词" name="commerceSearchKeywords">
                  <Input.TextArea rows={4} placeholder={"夏橙\n秭归夏橙"} />
                </Form.Item>
                <Form.Item label="商品卡匹配词" name="commerceMatchKeywords">
                  <Input.TextArea rows={4} placeholder={"秭归\n夏橙"} />
                </Form.Item>
                <Form.Item label="直播间匹配词" name="commerceRoomMatchKeywords">
                  <Input.TextArea rows={4} placeholder={"秭归夏橙\n夏橙直播间"} />
                </Form.Item>
                <Form.Item label="直播状态识别词" name="commerceLiveSignals">
                  <Input.TextArea rows={4} placeholder={"直播中\n正在直播\n讲解中"} />
                </Form.Item>
                <Form.Item label="评论内容" name="commerceCommentPool" className="config-form-wide">
                  <Input.TextArea rows={4} maxLength={2000} placeholder={"111\n666"} />
                </Form.Item>
              </div>
            </section>
          </div>
        </Form>
      ) : null}
    </section>
  );
}

export function ConfigCenterPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [keyword, setKeyword] = useState("");
  const [templateId, setTemplateId] = useState<string>();
  const [checkedDeviceCodes, setCheckedDeviceCodes] = useState<string[]>([]);
  const [dirtyDeviceCodes, setDirtyDeviceCodes] = useState<string[]>([]);
  const [formValuesByDevice, setFormValuesByDevice] = useState<Record<string, ConfigFormValues>>({});
  const [taskConfigByDevice, setTaskConfigByDevice] = useState<Record<string, TaskConfigRow | undefined>>({});
  const [errorByDevice, setErrorByDevice] = useState<Record<string, string | undefined>>({});

  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    refetchInterval: 15000
  });

  const devices = useMemo(() => (devicesQuery.data ?? []) as DeviceRow[], [devicesQuery.data]);
  const deviceQueryKey = useMemo(() => devices.map((device) => `${device.deviceCode}:${device.platform || "douyin"}`).join("|"), [devices]);

  const liveTargetsQuery = useQuery({
    queryKey: ["liveTargets", "douyin"],
    queryFn: () => getLiveTargets("douyin")
  });

  const publicTemplates = useMemo(() => (liveTargetsQuery.data ?? []).filter((target) => target.enabled !== false), [liveTargetsQuery.data]);
  const activeTemplate = useMemo(() => publicTemplates.find((target) => templateKey(target) === templateId) || publicTemplates[0], [publicTemplates, templateId]);

  useEffect(() => {
    if (!templateId && publicTemplates[0]) {
      setTemplateId(templateKey(publicTemplates[0]));
    }
  }, [publicTemplates, templateId]);

  const taskConfigsQuery = useQuery({
    queryKey: ["deviceTaskConfigs", deviceQueryKey],
    enabled: devices.length > 0,
    queryFn: async () => Promise.all(devices.map(async (device): Promise<DeviceConfigLoadResult> => {
      try {
        const taskConfig = taskConfigFromUnknown(await getDeviceTaskConfig(device.deviceCode, device.platform || "douyin"));
        return {
          deviceCode: device.deviceCode,
          taskConfig,
          values: configFormValues(taskConfig)
        };
      } catch (error) {
        return {
          deviceCode: device.deviceCode,
          values: configFormValues(null),
          errorMessage: error instanceof Error ? error.message : "配置加载失败"
        };
      }
    }))
  });

  useEffect(() => {
    if (!taskConfigsQuery.data) return;
    setTaskConfigByDevice((current) => {
      const next = { ...current };
      taskConfigsQuery.data.forEach((result) => {
        next[result.deviceCode] = result.taskConfig;
      });
      return next;
    });
    setErrorByDevice((current) => {
      const next = { ...current };
      taskConfigsQuery.data.forEach((result) => {
        next[result.deviceCode] = result.errorMessage;
      });
      return next;
    });
    setFormValuesByDevice((current) => {
      const dirtySet = new Set(dirtyDeviceCodes);
      const next = { ...current };
      taskConfigsQuery.data.forEach((result) => {
        if (!dirtySet.has(result.deviceCode)) {
          next[result.deviceCode] = result.values;
        }
      });
      return next;
    });
  }, [taskConfigsQuery.data]);

  const filteredDevices = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    if (!search) return devices;
    return devices.filter((device) =>
      `${deviceDisplayName(device)} ${deviceSubTitle(device)} ${device.platform ?? ""}`.toLowerCase().includes(search)
    );
  }, [devices, keyword]);

  const visibleCodes = useMemo(() => filteredDevices.map((device) => device.deviceCode), [filteredDevices]);
  const checkedCodeSet = useMemo(() => new Set(checkedDeviceCodes), [checkedDeviceCodes]);
  const dirtyCodeSet = useMemo(() => new Set(dirtyDeviceCodes), [dirtyDeviceCodes]);
  const allVisibleChecked = visibleCodes.length > 0 && visibleCodes.every((code) => checkedCodeSet.has(code));
  const someVisibleChecked = visibleCodes.some((code) => checkedCodeSet.has(code));

  const saveMutation = useMutation({
    mutationFn: async (payload: SaveDevicesPayload) => {
      await Promise.all(payload.targets.map((target) => updateDeviceTaskConfig(target.device.deviceCode, {
        liveCommentBotConfig: buildLiveCommentBotConfig(target.taskConfig, target.values),
        p3ExtensionsConfig: buildP3ExtensionsConfig(target.taskConfig, target.values)
      }, target.device.platform || "douyin")));
      return payload.targets.map((target) => target.device.deviceCode);
    },
    onSuccess: (savedCodes) => {
      const savedSet = new Set(savedCodes);
      setDirtyDeviceCodes((current) => current.filter((code) => !savedSet.has(code)));
      messageApi.success(`已保存 ${savedCodes.length} 台手机配置，并已下发刷新配置命令`);
      void queryClient.invalidateQueries({ queryKey: ["deviceTaskConfigs"] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  function updateDeviceForm(deviceCode: string, values: ConfigFormValues) {
    setFormValuesByDevice((current) => ({ ...current, [deviceCode]: values }));
    setDirtyDeviceCodes((current) => uniqueCodes([...current, deviceCode]));
  }

  function toggleDeviceChecked(deviceCode: string, checked: boolean) {
    setCheckedDeviceCodes((current) => checked ? uniqueCodes([...current, deviceCode]) : current.filter((code) => code !== deviceCode));
  }

  function toggleVisibleChecked(checked: boolean) {
    setCheckedDeviceCodes((current) => checked ? uniqueCodes([...current, ...visibleCodes]) : current.filter((code) => !visibleCodes.includes(code)));
  }

  function reloadDeviceConfig(deviceCode: string) {
    setFormValuesByDevice((current) => ({ ...current, [deviceCode]: configFormValues(taskConfigByDevice[deviceCode]) }));
    setDirtyDeviceCodes((current) => current.filter((code) => code !== deviceCode));
    messageApi.success("已恢复为后台已保存配置");
  }

  function buildSaveTargets(codes: string[]) {
    const codeSet = new Set(codes);
    return devices
      .filter((device) => codeSet.has(device.deviceCode))
      .map((device) => ({
        device,
        values: formValuesByDevice[device.deviceCode] || configFormValues(taskConfigByDevice[device.deviceCode]),
        taskConfig: taskConfigByDevice[device.deviceCode]
      }));
  }

  function saveDevices(codes: string[]) {
    const targets = buildSaveTargets(uniqueCodes(codes));
    if (targets.length === 0) {
      messageApi.warning("没有可保存的手机");
      return;
    }
    saveMutation.mutate({ targets });
  }

  function saveChangedDevices() {
    saveDevices(dirtyDeviceCodes);
  }

  function applyTemplateToDeviceCodes(codes: string[], scopeLabel: string) {
    if (!activeTemplate) {
      messageApi.warning("请先选择公共模板");
      return;
    }
    const targetCodes = uniqueCodes(codes).filter((code) => devices.some((device) => device.deviceCode === code));
    if (targetCodes.length === 0) {
      messageApi.warning("没有可应用模板的手机");
      return;
    }
    setFormValuesByDevice((current) => {
      const next = { ...current };
      targetCodes.forEach((code) => {
        const base = current[code] || configFormValues(taskConfigByDevice[code]);
        next[code] = applyTemplateValues(activeTemplate, base);
      });
      return next;
    });
    setDirtyDeviceCodes((current) => uniqueCodes([...current, ...targetCodes]));
    messageApi.success(`已将公共模板应用到${scopeLabel}，请确认后保存`);
  }

  async function refreshConfig() {
    await Promise.all([
      devicesQuery.refetch(),
      taskConfigsQuery.refetch(),
      liveTargetsQuery.refetch()
    ]);
    messageApi.success("配置数据已刷新");
  }

  const onlineCount = devices.filter((device) => !["offline", "stopped", "error"].includes(device.effectiveStatus || device.status || "")).length;
  const configuredCount = devices.filter((device) => hasFormConfig(formValuesByDevice[device.deviceCode])).length;

  return (
    <div className="ops-page config-center-page">
      {contextHolder}
      <header className="ops-topbar">
        <div>
          <h1>配置中心</h1>
          <p>展示所有手机，按手机填写目标直播间、关键词和商品卡直播评论参数。</p>
        </div>
        <div className="ops-toolbar">
          <Tag color="blue">按手机配置</Tag>
          <Button icon={<ReloadOutlined />} loading={devicesQuery.isFetching || taskConfigsQuery.isFetching || liveTargetsQuery.isFetching} onClick={() => void refreshConfig()}>
            刷新
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saveMutation.isPending} disabled={dirtyDeviceCodes.length === 0} onClick={saveChangedDevices}>
            保存全部已修改
          </Button>
        </div>
      </header>

      <section className="config-device-summary">
        <div>
          <span>手机总数</span>
          <strong>{devices.length}</strong>
        </div>
        <div>
          <span>在线手机</span>
          <strong>{onlineCount}</strong>
        </div>
        <div>
          <span>已填写配置</span>
          <strong>{configuredCount}</strong>
        </div>
        <div>
          <span>待保存手机</span>
          <strong>{dirtyDeviceCodes.length}</strong>
        </div>
      </section>

      <section className="config-template-bar">
        <div className="config-template-main">
          <div className="config-template-title">
            <CopyOutlined />
            <div>
              <strong>公共模板</strong>
              <span>用于把相同目标直播间、关键词和商品卡参数快速填入多台手机表单。</span>
            </div>
          </div>
          <Select
            className="config-template-select"
            placeholder="选择公共模板"
            loading={liveTargetsQuery.isFetching}
            value={activeTemplate ? templateKey(activeTemplate) : undefined}
            onChange={setTemplateId}
            options={publicTemplates.map((target) => ({ value: templateKey(target), label: templateLabel(target) }))}
          />
        </div>
        <div className="config-template-actions">
          <Checkbox
            checked={allVisibleChecked}
            indeterminate={!allVisibleChecked && someVisibleChecked}
            onChange={(event) => toggleVisibleChecked(event.target.checked)}
          >
            选择全部可见
          </Checkbox>
          <Button icon={<CheckSquareOutlined />} disabled={!activeTemplate || checkedDeviceCodes.length === 0} onClick={() => applyTemplateToDeviceCodes(checkedDeviceCodes, "选中手机")}>
            应用到选中手机
          </Button>
          <Button icon={<CheckSquareOutlined />} disabled={!activeTemplate || devices.length === 0} onClick={() => applyTemplateToDeviceCodes(devices.map((device) => device.deviceCode), "全部手机")}>
            应用到全部手机
          </Button>
        </div>
      </section>

      <section className="config-device-toolbar">
        <div>
          <strong>手机配置清单</strong>
          <span>{filteredDevices.length} 台可见，{checkedDeviceCodes.length} 台已选</span>
        </div>
        <Input
          prefix={<SearchOutlined />}
          allowClear
          placeholder="搜索抖音账号 / 设备编号"
          value={keyword}
          onChange={(event) => setKeyword(event.currentTarget.value)}
        />
      </section>

      {devicesQuery.isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
      {devicesQuery.isError ? <Alert type="error" message="手机列表加载失败" description={devicesQuery.error.message} showIcon /> : null}
      {!devicesQuery.isLoading && filteredDevices.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无手机" /> : null}

      <main className="config-phone-config-list" aria-label="手机配置表单列表">
        {filteredDevices.map((device) => (
          <DeviceConfigFormPanel
            key={device.id || device.deviceCode}
            device={device}
            values={formValuesByDevice[device.deviceCode]}
            loading={taskConfigsQuery.isLoading && !formValuesByDevice[device.deviceCode]}
            errorMessage={errorByDevice[device.deviceCode]}
            checked={checkedCodeSet.has(device.deviceCode)}
            dirty={dirtyCodeSet.has(device.deviceCode)}
            saving={saveMutation.isPending}
            onCheck={(checked) => toggleDeviceChecked(device.deviceCode, checked)}
            onChange={(values) => updateDeviceForm(device.deviceCode, values)}
            onApplyTemplate={() => applyTemplateToDeviceCodes([device.deviceCode], "本机")}
            onSave={() => saveDevices([device.deviceCode])}
            onReload={() => reloadDeviceConfig(device.deviceCode)}
          />
        ))}
      </main>
    </div>
  );
}
