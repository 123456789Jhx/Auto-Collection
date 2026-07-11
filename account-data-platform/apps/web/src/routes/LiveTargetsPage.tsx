import {
  CheckCircleOutlined,
  LockOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  StopOutlined
} from "@ant-design/icons";
import {
  defaultCommerceCardWorkflowRuntimeConfig,
  type CommerceCardFeaturePreview,
  type CommerceCardWorkflowRuntimeConfig,
  type CommerceCardWorkflowStage,
  type FeatureRolloutControl,
  type FeatureRolloutControlUpdate,
  type FeatureRolloutKey
} from "@pkg/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Checkbox,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Space,
  Switch,
  Tabs,
  Tag,
  message
} from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  getCommerceCardFeaturePreview,
  getDevices,
  getFeatureRolloutControls,
  getLiveTargets,
  saveDeviceLiveTargetBindings,
  saveLiveTarget,
  saveLiveTargetFeatureConfig,
  updateFeatureRolloutControl,
  type LiveTarget,
  type LiveTargetAlias,
  type LiveTargetFeatureConfig,
  type LiveTargetFeatureType
} from "../lib/api-client";
import { deviceDisplayName, deviceSubTitle } from "../lib/display-maps";

type DeviceRow = {
  id?: string;
  deviceCode?: string;
  deviceName?: string;
  douyinAccountName?: string | null;
};

type TargetFormValues = {
  targetCode: string;
  targetName: string;
  similarityThreshold: number;
  enabled: boolean;
  remark?: string;
  aliasesText?: string;
};

type FeatureFormValues = {
  enabled: boolean;
  searchKeywordsText?: string;
  requiredKeywordsText?: string;
  forbiddenKeywordsText?: string;
  productKeywordsText?: string;
  liveSignalsText?: string;
  enabledStages?: CommerceCardWorkflowStage[];
  executeEnabled?: boolean;
  recommendationSignalsText?: string;
  productCardDwellSeconds?: number;
  productNurtureRoundMinutes?: number;
  productNurtureMaxRounds?: number;
  targetLiveMaxRoomsPerRefresh?: number;
  targetCommentSearchMaxActiveMinutes?: number;
  maxCommentsPerRoom?: number;
  commentPoolText?: string;
  liveNurtureKeywordsText?: string;
  liveNurtureRefreshAfterRooms?: number;
  liveNurtureWatchMinMinutes?: number;
  liveNurtureWatchMaxMinutes?: number;
  liveNurtureTotalMinMinutes?: number;
  liveNurtureTotalMaxMinutes?: number;
  taskMaxActiveMinutes?: number;
};

type BindingFormValues = {
  featureType: LiveTargetFeatureType;
  defaultEnabled: boolean;
  deviceCodes: string[];
};

type RolloutFormValues = {
  enabled: boolean;
  minAppVersion: string | null;
  requiredCapabilities: FeatureRolloutControlUpdate["requiredCapabilities"];
  capabilityTtlSeconds: number;
  deviceCodes: string[];
  reason: string;
};

type LiveTargetTabKey = "live_comment" | "commerce_card_live_comment" | "bindings";

const stageOptions: Array<{ value: CommerceCardWorkflowStage; label: string }> = [
  { value: "product_nurture", label: "商品卡养号" },
  { value: "target_comment", label: "目标直播评论" },
  { value: "live_nurture", label: "直播养号2" }
];

const capabilityOptions = [
  { value: "workflow_v2", label: "组合流程 V2" },
  { value: "checkpoint_v2", label: "检查点 V2" },
  { value: "pause_resume", label: "原任务暂停恢复" },
  { value: "stable_room_key", label: "稳定直播间标识" },
  { value: "idempotent_comment", label: "评论幂等" },
  { value: "short_lived_comment_permit", label: "短时发送许可" }
];

function toLines(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).join("\n") : "";
}

function parseLines(value?: string) {
  return Array.from(new Set(
    (value || "")
      .split(/[\n,，]/)
      .map((item) => item.trim())
      .filter(Boolean)
  ));
}

function parseAliases(value?: string): LiveTargetAlias[] {
  return parseLines(value).map((aliasText, index) => ({
    aliasText,
    aliasType: "room_name",
    weight: 100 + index,
    enabled: true
  }));
}

function aliasesToText(aliases?: LiveTargetAlias[]) {
  return (aliases || []).map((item) => item.aliasText).filter(Boolean).join("\n");
}

function featureTitle(featureType: LiveTargetFeatureType) {
  return featureType === "commerce_card_live_comment" ? "商品卡组合任务" : "搜索直播评论";
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function commerceRuntimeValues(runtime: Record<string, unknown>) {
  const defaults = defaultCommerceCardWorkflowRuntimeConfig;
  const isV2 = runtime.configVersion === 2;
  return {
    enabledStages: isV2 && Array.isArray(runtime.enabledStages)
      ? runtime.enabledStages.filter((stage): stage is CommerceCardWorkflowStage => stage === "product_nurture" || stage === "target_comment" || stage === "live_nurture")
      : defaults.enabledStages,
    executeEnabled: booleanValue(runtime.executeEnabled, false),
    recommendationSignalsText: toLines(isV2 ? runtime.recommendationSignals : defaults.recommendationSignals),
    productCardDwellSeconds: numberValue(runtime.productCardDwellSeconds, defaults.productCardDwellSeconds),
    productNurtureRoundMinutes: numberValue(runtime.productNurtureRoundMinutes ?? runtime.scanMinutesPerRound, defaults.productNurtureRoundMinutes),
    productNurtureMaxRounds: numberValue(runtime.productNurtureMaxRounds ?? runtime.maxRounds, defaults.productNurtureMaxRounds),
    targetLiveMaxRoomsPerRefresh: numberValue(runtime.targetLiveMaxRoomsPerRefresh, defaults.targetLiveMaxRoomsPerRefresh),
    targetCommentSearchMaxActiveMinutes: numberValue(runtime.targetCommentSearchMaxActiveMinutes, defaults.targetCommentSearchMaxActiveMinutes),
    maxCommentsPerRoom: numberValue(runtime.maxCommentsPerRoom, defaults.maxCommentsPerRoom),
    commentPoolText: toLines(runtime.commentPool),
    liveNurtureKeywordsText: toLines(runtime.liveNurtureKeywords),
    liveNurtureRefreshAfterRooms: numberValue(runtime.liveNurtureRefreshAfterRooms, defaults.liveNurtureRefreshAfterRooms),
    liveNurtureWatchMinMinutes: numberValue(runtime.liveNurtureWatchMinMinutes, defaults.liveNurtureWatchMinMinutes),
    liveNurtureWatchMaxMinutes: numberValue(runtime.liveNurtureWatchMaxMinutes, defaults.liveNurtureWatchMaxMinutes),
    liveNurtureTotalMinMinutes: numberValue(runtime.liveNurtureTotalMinMinutes, defaults.liveNurtureTotalMinMinutes),
    liveNurtureTotalMaxMinutes: numberValue(runtime.liveNurtureTotalMaxMinutes, defaults.liveNurtureTotalMaxMinutes),
    taskMaxActiveMinutes: numberValue(runtime.taskMaxActiveMinutes, defaults.taskMaxActiveMinutes)
  };
}

function featureConfig(target: LiveTarget | null, featureType: LiveTargetFeatureType): LiveTargetFeatureConfig {
  return (
    target?.featureConfigs?.find((item) => item.featureType === featureType) || {
      featureType,
      enabled: true,
      searchKeywords: featureType === "commerce_card_live_comment" ? ["夏橙"] : [],
      requiredKeywords: [],
      forbiddenKeywords: [],
      productKeywords: featureType === "commerce_card_live_comment" ? ["夏橙"] : [],
      liveSignals: featureType === "commerce_card_live_comment" ? ["直播中", "讲解中", "正在直播"] : [],
      runtimeConfig: featureType === "commerce_card_live_comment" ? defaultCommerceCardWorkflowRuntimeConfig : {}
    }
  );
}

function featureValues(config: LiveTargetFeatureConfig): FeatureFormValues {
  const runtime = config.runtimeConfig || {};
  return {
    enabled: config.enabled !== false,
    searchKeywordsText: toLines(config.searchKeywords),
    requiredKeywordsText: toLines(config.requiredKeywords),
    forbiddenKeywordsText: toLines(config.forbiddenKeywords),
    productKeywordsText: toLines(config.productKeywords),
    liveSignalsText: toLines(config.liveSignals),
    ...commerceRuntimeValues(runtime)
  };
}

function buildCommerceRuntime(values: FeatureFormValues): CommerceCardWorkflowRuntimeConfig {
  return {
    configVersion: 2,
    enabledStages: values.enabledStages?.length ? values.enabledStages : ["product_nurture"],
    executeEnabled: values.executeEnabled === true,
    recommendationSignals: parseLines(values.recommendationSignalsText),
    productCardDwellSeconds: Number(values.productCardDwellSeconds),
    productNurtureRoundMinutes: Number(values.productNurtureRoundMinutes),
    productNurtureMaxRounds: Number(values.productNurtureMaxRounds),
    targetLiveMaxRoomsPerRefresh: Number(values.targetLiveMaxRoomsPerRefresh),
    targetCommentSearchMaxActiveMinutes: Number(values.targetCommentSearchMaxActiveMinutes),
    maxCommentsPerRoom: Number(values.maxCommentsPerRoom),
    commentPool: parseLines(values.commentPoolText),
    liveNurtureKeywords: parseLines(values.liveNurtureKeywordsText),
    liveNurtureRefreshAfterRooms: Number(values.liveNurtureRefreshAfterRooms),
    liveNurtureWatchMinMinutes: Number(values.liveNurtureWatchMinMinutes),
    liveNurtureWatchMaxMinutes: Number(values.liveNurtureWatchMaxMinutes),
    liveNurtureTotalMinMinutes: Number(values.liveNurtureTotalMinMinutes),
    liveNurtureTotalMaxMinutes: Number(values.liveNurtureTotalMaxMinutes),
    taskMaxActiveMinutes: Number(values.taskMaxActiveMinutes)
  };
}

function buildFeaturePayload(
  featureType: LiveTargetFeatureType,
  values: FeatureFormValues,
  currentConfig: LiveTargetFeatureConfig
): LiveTargetFeatureConfig {
  return {
    featureType,
    enabled: values.enabled !== false,
    searchKeywords: parseLines(values.searchKeywordsText),
    requiredKeywords: parseLines(values.requiredKeywordsText),
    forbiddenKeywords: parseLines(values.forbiddenKeywordsText),
    productKeywords: parseLines(values.productKeywordsText),
    liveSignals: parseLines(values.liveSignalsText),
    runtimeConfig: featureType === "commerce_card_live_comment" ? buildCommerceRuntime(values) : {},
    expectedRevision: currentConfig.revision ?? 0
  };
}

function targetInitialValues(target: LiveTarget | null): TargetFormValues {
  return {
    targetCode: target?.targetCode || "",
    targetName: target?.targetName || "",
    similarityThreshold: Math.round(Number(target?.similarityThreshold || 0.9) * 100),
    enabled: target?.enabled !== false,
    remark: target?.remark || "",
    aliasesText: aliasesToText(target?.aliases)
  };
}

function expectedRevisions(target: LiveTarget | null) {
  const result: Partial<Record<LiveTargetFeatureType, number>> = {};
  for (const item of target?.featureConfigs ?? []) {
    if (item.revision) result[item.featureType] = item.revision;
  }
  return result;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function firstApiDetail(error: ApiError) {
  const details = recordValue(error.details);
  const fieldErrors = recordValue(details?.fieldErrors);
  if (!fieldErrors) return error.message;
  for (const value of Object.values(fieldErrors)) {
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return error.message;
}

function handleFeatureError(
  error: Error,
  form: ReturnType<typeof Form.useForm<FeatureFormValues>>[0],
  reload: () => void
) {
  if (!(error instanceof ApiError)) {
    message.error(error.message || "功能配置保存失败");
    return;
  }
  if (error.code === "CONFIG_REVISION_CONFLICT" || error.code === "CONFIG_REVISION_REQUIRED") {
    message.warning(error.message);
    reload();
    return;
  }
  const details = recordValue(error.details);
  const fieldErrors = recordValue(details?.fieldErrors);
  const fieldMap: Record<string, keyof FeatureFormValues> = {
    searchKeywords: "searchKeywordsText",
    productKeywords: "productKeywordsText",
    runtimeConfig: "enabledStages"
  };
  if (fieldErrors) {
    const fields = Object.entries(fieldErrors)
      .filter(([key, value]) => fieldMap[key] && Array.isArray(value))
      .map(([key, value]) => ({ name: fieldMap[key], errors: (value as unknown[]).map(String) }));
    if (fields.length > 0) form.setFields(fields);
  }
  message.error(firstApiDetail(error));
}

export function LiveTargetsPage({ embedded = false, activeTab }: { embedded?: boolean; activeTab?: LiveTargetTabKey } = {}) {
  const [targetForm] = Form.useForm<TargetFormValues>();
  const [liveForm] = Form.useForm<FeatureFormValues>();
  const [commerceForm] = Form.useForm<FeatureFormValues>();
  const [bindingForm] = Form.useForm<BindingFormValues>();
  const [selectedId, setSelectedId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const [tabKey, setTabKey] = useState<LiveTargetTabKey>(activeTab || "commerce_card_live_comment");
  const queryClient = useQueryClient();
  const targetQuery = useQuery({ queryKey: ["liveTargets"], queryFn: () => getLiveTargets("douyin") });
  const deviceQuery = useQuery({ queryKey: ["devices"], queryFn: getDevices });
  const rolloutQuery = useQuery({ queryKey: ["featureRolloutControls"], queryFn: getFeatureRolloutControls });
  const targets = targetQuery.data || [];
  const devices = (deviceQuery.data || []) as DeviceRow[];
  const selectedTarget = useMemo(() => (creating ? null : targets.find((item) => item.id === selectedId) || null), [targets, selectedId, creating]);
  const deviceCodeById = useMemo(() => new Map(devices.map((device) => [device.id, device.deviceCode])), [devices]);
  const revisionKey = selectedTarget?.featureConfigs.map((item) => `${item.featureType}:${item.revision ?? 0}:${item.updatedAt ?? ""}`).join("|") ?? "";
  const commerceConfig = featureConfig(selectedTarget, "commerce_card_live_comment");
  const previewQuery = useQuery({
    queryKey: ["commerceCardFeaturePreview", selectedTarget?.id, commerceConfig.revision],
    queryFn: () => getCommerceCardFeaturePreview(selectedTarget?.id || ""),
    enabled: Boolean(selectedTarget?.id && selectedTarget.featureConfigs.some((item) => item.featureType === "commerce_card_live_comment")),
    retry: false
  });

  useEffect(() => {
    if (activeTab) setTabKey(activeTab);
  }, [activeTab]);

  useEffect(() => {
    if (!creating && !selectedId && targets[0]?.id) setSelectedId(targets[0].id);
  }, [creating, selectedId, targets]);

  useEffect(() => {
    if (!selectedTarget?.id) return;
    targetForm.setFieldsValue(targetInitialValues(selectedTarget));
    liveForm.setFieldsValue(featureValues(featureConfig(selectedTarget, "live_comment")));
    commerceForm.setFieldsValue(featureValues(featureConfig(selectedTarget, "commerce_card_live_comment")));
    const bindings = selectedTarget.bindings || [];
    bindingForm.setFieldsValue({
      featureType: "commerce_card_live_comment",
      defaultEnabled: bindings.some((item) => item.featureType === "commerce_card_live_comment" && !item.deviceId && item.enabled !== false),
      deviceCodes: bindings
        .filter((item) => item.featureType === "commerce_card_live_comment")
        .map((item) => (item.deviceId ? deviceCodeById.get(item.deviceId) : ""))
        .filter(Boolean) as string[]
    });
  }, [selectedTarget?.id, selectedTarget?.updatedAt, revisionKey, devices.length]);

  const targetMutation = useMutation({
    mutationFn: (values: TargetFormValues) => saveLiveTarget({
      id: selectedTarget?.id,
      targetCode: values.targetCode,
      targetName: values.targetName,
      platform: "douyin",
      similarityThreshold: Number(values.similarityThreshold || 90) / 100,
      enabled: values.enabled !== false,
      remark: values.remark || null,
      aliases: parseAliases(values.aliasesText),
      expectedRevisions: expectedRevisions(selectedTarget)
    }),
    onSuccess: async (result) => {
      message.success("目标直播间已保存");
      setCreating(false);
      setSelectedId(result.id || "");
      await queryClient.invalidateQueries({ queryKey: ["liveTargets"] });
      await queryClient.invalidateQueries({ queryKey: ["commerceCardFeaturePreview"] });
    },
    onError: (error: Error) => {
      message.error(error.message || "目标直播间保存失败");
      if (error instanceof ApiError && error.code.startsWith("CONFIG_REVISION")) void targetQuery.refetch();
    }
  });

  const featureMutation = useMutation({
    mutationFn: (payload: { targetId: string; featureType: LiveTargetFeatureType; values: FeatureFormValues }) => {
      const current = featureConfig(selectedTarget, payload.featureType);
      return saveLiveTargetFeatureConfig(payload.targetId, buildFeaturePayload(payload.featureType, payload.values, current));
    },
    onSuccess: async () => {
      message.success("功能配置已保存");
      await queryClient.invalidateQueries({ queryKey: ["liveTargets"] });
      await queryClient.invalidateQueries({ queryKey: ["commerceCardFeaturePreview"] });
    },
    onError: (error: Error, variables) => handleFeatureError(
      error,
      variables.featureType === "commerce_card_live_comment" ? commerceForm : liveForm,
      () => void targetQuery.refetch()
    )
  });

  const bindingMutation = useMutation({
    mutationFn: (values: BindingFormValues) => saveDeviceLiveTargetBindings({
      targetId: selectedTarget?.id || "",
      featureType: values.featureType,
      deviceCodes: values.deviceCodes || [],
      defaultEnabled: values.defaultEnabled,
      expectedRevision: featureConfig(selectedTarget, values.featureType).revision
    }),
    onSuccess: async () => {
      message.success("设备绑定已保存");
      await queryClient.invalidateQueries({ queryKey: ["liveTargets"] });
      await queryClient.invalidateQueries({ queryKey: ["commerceCardFeaturePreview"] });
    },
    onError: (error: Error) => {
      message.error(error.message || "设备绑定保存失败");
      if (error instanceof ApiError && error.code.startsWith("CONFIG_REVISION")) void targetQuery.refetch();
    }
  });

  const rolloutMutation = useMutation({
    mutationFn: (input: { featureKey: FeatureRolloutKey; payload: FeatureRolloutControlUpdate }) => updateFeatureRolloutControl(input.featureKey, input.payload),
    onSuccess: async () => {
      message.success("运行门禁配置已保存");
      await queryClient.invalidateQueries({ queryKey: ["featureRolloutControls"] });
      await queryClient.invalidateQueries({ queryKey: ["commerceCardFeaturePreview"] });
    },
    onError: (error: Error) => {
      message.error(error.message || "运行门禁保存失败");
      if (error instanceof ApiError && error.code === "FEATURE_CONTROL_REVISION_CONFLICT") void rolloutQuery.refetch();
    }
  });

  function createTarget() {
    setSelectedId("");
    setCreating(true);
    targetForm.setFieldsValue(targetInitialValues(null));
    liveForm.setFieldsValue(featureValues(featureConfig(null, "live_comment")));
    commerceForm.setFieldsValue(featureValues(featureConfig(null, "commerce_card_live_comment")));
    bindingForm.setFieldsValue({ featureType: "commerce_card_live_comment", defaultEnabled: false, deviceCodes: [] });
  }

  function saveFeature(featureType: LiveTargetFeatureType, values: FeatureFormValues) {
    if (!selectedTarget?.id) {
      message.warning("请先保存目标直播间");
      return;
    }
    featureMutation.mutate({ targetId: selectedTarget.id, featureType, values });
  }

  if (targetQuery.isLoading) return <Skeleton active />;

  return (
    <div className={`ops-page live-targets-page ${embedded ? "embedded-ops-page" : ""}`}>
      <div className="ops-topbar">
        <div>
          <h1>直播目标配置</h1>
          <p>维护目标身份、组合任务阶段、设备范围和运行门禁。</p>
        </div>
        <div className="ops-toolbar">
          <Button icon={<ReloadOutlined />} onClick={() => void Promise.all([targetQuery.refetch(), rolloutQuery.refetch()])}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={createTarget}>新增目标</Button>
        </div>
      </div>

      {targetQuery.isError ? <Alert type="error" showIcon message="直播目标加载失败" description={targetQuery.error.message} /> : null}

      <RolloutControlsPanel
        controls={rolloutQuery.data || []}
        devices={devices}
        loading={rolloutMutation.isPending}
        error={rolloutQuery.isError ? rolloutQuery.error.message : null}
        onSave={(featureKey, payload) => rolloutMutation.mutate({ featureKey, payload })}
      />

      <div className="ops-workbench wide-side live-target-workbench">
        <section className="ops-panel">
          <div className="ops-panel-head">
            <span>目标直播间</span>
            <span className="ops-panel-note">{targets.length} 个目标</span>
          </div>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead><tr><th>直播间</th><th>匹配阈值</th><th>功能</th><th>状态</th></tr></thead>
              <tbody>
                {targets.map((target) => (
                  <tr
                    key={target.id || target.targetCode}
                    className={target.id === selectedTarget?.id ? "selected" : ""}
                    onClick={() => { setCreating(false); setSelectedId(target.id || ""); }}
                  >
                    <td><div className="ops-title">{target.targetName}</div><div className="ops-small">{target.targetCode}</div></td>
                    <td>{Math.round(Number(target.similarityThreshold || 0.9) * 100)}%</td>
                    <td>
                      <Space wrap>
                        {target.featureConfigs?.map((item) => (
                          <Tag key={item.featureType} color={item.configValidationError ? "red" : item.enabled ? "blue" : "default"}>
                            {featureTitle(item.featureType)}{item.storedWorkflowVersion === 2 ? " V2" : ""}
                          </Tag>
                        ))}
                      </Space>
                    </td>
                    <td><Tag color={target.enabled ? "green" : "default"}>{target.enabled ? "启用" : "停用"}</Tag></td>
                  </tr>
                ))}
                {targets.length === 0 ? <tr><td colSpan={4} className="ops-empty">暂无目标直播间</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ops-panel">
          <div className="ops-panel-head">
            <span>{selectedTarget?.targetName || "新增目标直播间"}</span>
            <span className="ops-panel-note">目标身份与执行参数分离保存</span>
          </div>
          <div className="ops-panel-body">
            <Form<TargetFormValues> form={targetForm} layout="vertical" initialValues={targetInitialValues(selectedTarget)} onFinish={(values) => targetMutation.mutate(values)}>
              <div className="workflow-field-grid two-columns">
                <Form.Item label="目标直播间编码" name="targetCode" rules={[{ required: true, message: "请输入目标编码" }]}>
                  <Input placeholder="业务编码" />
                </Form.Item>
                <Form.Item label="目标直播间名称" name="targetName" rules={[{ required: true, message: "请输入目标直播间名称" }]}>
                  <Input placeholder="直播间标准名称" />
                </Form.Item>
              </div>
              <Form.Item label="直播间别名" name="aliasesText"><Input.TextArea rows={3} placeholder="一行一个直播间名或主播名" /></Form.Item>
              <div className="workflow-field-grid compact-columns">
                <Form.Item label="相似度阈值" name="similarityThreshold" rules={[{ required: true, message: "请输入阈值" }]}>
                  <InputNumber min={50} max={100} addonAfter="%" style={{ width: "100%" }} />
                </Form.Item>
                <Form.Item label="启用目标" name="enabled" valuePropName="checked"><Switch /></Form.Item>
              </div>
              <Form.Item label="备注" name="remark"><Input.TextArea rows={2} /></Form.Item>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={targetMutation.isPending}>保存目标直播间</Button>
            </Form>

            <Divider />
            <Tabs
              className="live-target-tabs"
              activeKey={tabKey}
              onChange={(key) => setTabKey(key as LiveTargetTabKey)}
              items={[
                {
                  key: "live_comment",
                  label: "搜索直播评论",
                  children: <FeatureForm form={liveForm} featureType="live_comment" loading={featureMutation.isPending} onSave={(values) => saveFeature("live_comment", values)} />
                },
                {
                  key: "commerce_card_live_comment",
                  label: "商品卡组合任务",
                  children: (
                    <>
                      <FeatureForm form={commerceForm} featureType="commerce_card_live_comment" loading={featureMutation.isPending} onSave={(values) => saveFeature("commerce_card_live_comment", values)} />
                      <CommercePreview preview={previewQuery.data} loading={previewQuery.isLoading} error={previewQuery.isError ? previewQuery.error.message : null} />
                    </>
                  )
                },
                {
                  key: "bindings",
                  label: "设备绑定",
                  children: (
                    <Form<BindingFormValues> form={bindingForm} layout="vertical" initialValues={{ featureType: "commerce_card_live_comment", defaultEnabled: false, deviceCodes: [] }} onFinish={(values) => bindingMutation.mutate(values)}>
                      <Alert type="info" showIcon message="未指定设备时仅作为公共候选；指定后只对所选设备可用。" style={{ marginBottom: 12 }} />
                      <div className="workflow-field-grid two-columns">
                        <Form.Item label="绑定功能" name="featureType">
                          <Select options={[{ value: "live_comment", label: "搜索直播评论" }, { value: "commerce_card_live_comment", label: "商品卡组合任务" }]} />
                        </Form.Item>
                        <Form.Item label="公共候选" name="defaultEnabled" valuePropName="checked"><Switch /></Form.Item>
                      </div>
                      <Form.Item label="指定设备" name="deviceCodes">
                        <Select mode="multiple" allowClear placeholder="选择设备" options={devices.filter((device) => device.deviceCode).map((device) => ({ value: device.deviceCode!, label: `${deviceDisplayName(device)} / ${deviceSubTitle(device)}` }))} />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} disabled={!selectedTarget?.id} loading={bindingMutation.isPending}>保存设备绑定</Button>
                    </Form>
                  )
                }
              ]}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function FeatureForm({
  form,
  featureType,
  loading,
  onSave
}: {
  form: ReturnType<typeof Form.useForm<FeatureFormValues>>[0];
  featureType: LiveTargetFeatureType;
  loading: boolean;
  onSave: (values: FeatureFormValues) => void;
}) {
  const enabledStages = Form.useWatch("enabledStages", form) || [];
  const commerce = featureType === "commerce_card_live_comment";
  const productEnabled = enabledStages.includes("product_nurture");
  const commentEnabled = enabledStages.includes("target_comment");
  const liveNurtureEnabled = enabledStages.includes("live_nurture");

  return (
    <Form<FeatureFormValues> form={form} layout="vertical" onFinish={onSave}>
      <Form.Item label="启用功能" name="enabled" valuePropName="checked"><Switch /></Form.Item>
      <div className="workflow-field-grid two-columns">
        <Form.Item label={commerce ? "商城搜索关键词" : "直播搜索关键词"} name="searchKeywordsText" rules={commerce && productEnabled ? [{ required: true, message: "请输入商城搜索关键词" }] : []}>
          <Input.TextArea rows={3} placeholder="一行一个关键词" />
        </Form.Item>
        <Form.Item label="目标必须包含关键词" name="requiredKeywordsText"><Input.TextArea rows={3} placeholder="可选" /></Form.Item>
        <Form.Item label="排除关键词" name="forbiddenKeywordsText"><Input.TextArea rows={3} placeholder="例如：回放、录播" /></Form.Item>
        {commerce ? <Form.Item label="商品卡匹配关键词" name="productKeywordsText" rules={productEnabled ? [{ required: true, message: "请输入商品卡匹配关键词" }] : []}><Input.TextArea rows={3} placeholder="一行一个商品词" /></Form.Item> : null}
      </div>

      {commerce ? (
        <>
          <Divider orientation="left">阶段组合</Divider>
          <Form.Item label="执行阶段" name="enabledStages" rules={[{ required: true, message: "至少选择一个阶段" }]}>
            <Checkbox.Group options={stageOptions} className="workflow-stage-options" />
          </Form.Item>

          {productEnabled ? (
            <section className="workflow-stage-section">
              <h3>商品卡养号</h3>
              <Form.Item label="推荐区识别词" name="recommendationSignalsText" rules={[{ required: true, message: "请输入推荐区识别词" }]}><Input.TextArea rows={2} /></Form.Item>
              <div className="workflow-field-grid four-columns">
                <Form.Item label="商品详情秒数" name="productCardDwellSeconds"><InputNumber min={60} max={180} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="单轮分钟" name="productNurtureRoundMinutes"><InputNumber min={5} max={30} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="最大轮次" name="productNurtureMaxRounds"><InputNumber min={1} max={6} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="每次候选上限" name="targetLiveMaxRoomsPerRefresh"><InputNumber min={20} max={30} style={{ width: "100%" }} /></Form.Item>
              </div>
            </section>
          ) : null}

          {commentEnabled ? (
            <section className="workflow-stage-section">
              <h3>目标直播评论</h3>
              <div className="workflow-field-grid three-columns">
                <Form.Item label="主动查找上限分钟" name="targetCommentSearchMaxActiveMinutes"><InputNumber min={5} max={120} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="单房评论上限" name="maxCommentsPerRoom"><InputNumber min={0} max={5} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="实时发送开关" name="executeEnabled" valuePropName="checked"><Switch checkedChildren="允许" unCheckedChildren="禁止" /></Form.Item>
              </div>
              <Form.Item label="评论内容" name="commentPoolText" dependencies={["maxCommentsPerRoom"]} rules={[({ getFieldValue }) => ({
                validator: async (_, value: string | undefined) => {
                  const limit = Number(getFieldValue("maxCommentsPerRoom") || 0);
                  if (limit > 0 && parseLines(value).length < limit) throw new Error("评论内容数量不能少于单房评论上限");
                }
              })]}><Input.TextArea rows={4} placeholder="一行一条，无默认发送话术" /></Form.Item>
              <Alert type="warning" showIcon message="阶段 A 安全基线会强制阻断真实评论，当前配置不会触发发送。" />
            </section>
          ) : null}

          {liveNurtureEnabled ? (
            <section className="workflow-stage-section">
              <h3>直播养号2</h3>
              <Form.Item label="直播标题关键词" name="liveNurtureKeywordsText" rules={[{ required: true, message: "请输入直播标题关键词" }]}><Input.TextArea rows={2} /></Form.Item>
              <div className="workflow-field-grid five-columns">
                <Form.Item label="刷新候选数" name="liveNurtureRefreshAfterRooms"><InputNumber min={5} max={20} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="单房最短分钟" name="liveNurtureWatchMinMinutes"><InputNumber min={1} max={30} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="单房最长分钟" name="liveNurtureWatchMaxMinutes"><InputNumber min={1} max={60} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="累计最短分钟" name="liveNurtureTotalMinMinutes"><InputNumber min={10} max={180} style={{ width: "100%" }} /></Form.Item>
                <Form.Item label="累计最长分钟" name="liveNurtureTotalMaxMinutes"><InputNumber min={10} max={240} style={{ width: "100%" }} /></Form.Item>
              </div>
            </section>
          ) : null}

          <div className="workflow-field-grid two-columns workflow-final-fields">
            <Form.Item label="任务主动执行上限分钟" name="taskMaxActiveMinutes"><InputNumber min={30} max={360} style={{ width: "100%" }} /></Form.Item>
            <Form.Item label="第一版直播信号（只读诊断）" name="liveSignalsText"><Input disabled /></Form.Item>
          </div>
        </>
      ) : null}

      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading}>保存{featureTitle(featureType)}</Button>
    </Form>
  );
}

function RolloutControlsPanel({
  controls,
  devices,
  loading,
  error,
  onSave
}: {
  controls: FeatureRolloutControl[];
  devices: DeviceRow[];
  loading: boolean;
  error: string | null;
  onSave: (featureKey: FeatureRolloutKey, payload: FeatureRolloutControlUpdate) => void;
}) {
  return (
    <section className="ops-panel rollout-controls-panel">
      <div className="ops-panel-head"><span>运行门禁</span><span className="ops-panel-note">阶段 A 配置准备</span></div>
      <div className="ops-panel-body">
        {error ? <Alert type="error" showIcon message="运行门禁加载失败" description={error} /> : null}
        {controls.length === 0 && !error ? <div className="ops-empty">运行门禁尚未初始化</div> : null}
        {controls.map((control, index) => (
          <div key={`${control.featureKey}:${control.revision}`}>
            {index > 0 ? <Divider /> : null}
            <RolloutControlForm control={control} devices={devices} loading={loading} onSave={onSave} />
          </div>
        ))}
      </div>
    </section>
  );
}

function RolloutControlForm({
  control,
  devices,
  loading,
  onSave
}: {
  control: FeatureRolloutControl;
  devices: DeviceRow[];
  loading: boolean;
  onSave: (featureKey: FeatureRolloutKey, payload: FeatureRolloutControlUpdate) => void;
}) {
  const [form] = Form.useForm<RolloutFormValues>();
  const title = control.featureKey === "commerce_card_workflow_v2" ? "组合流程 V2" : "真实评论";
  return (
    <Form<RolloutFormValues>
      form={form}
      layout="vertical"
      initialValues={{
        enabled: control.enabled,
        minAppVersion: control.minAppVersion,
        requiredCapabilities: control.requiredCapabilities,
        capabilityTtlSeconds: control.capabilityTtlSeconds,
        deviceCodes: control.deviceCodes,
        reason: ""
      }}
      onFinish={(values) => onSave(control.featureKey, {
        enabled: values.enabled,
        expectedRevision: control.revision,
        minAppVersion: values.minAppVersion?.trim() || null,
        requiredCapabilities: values.requiredCapabilities || [],
        capabilityTtlSeconds: values.capabilityTtlSeconds,
        deviceCodes: values.deviceCodes || [],
        reason: values.reason
      })}
      className="rollout-control-form"
    >
      <div className="rollout-control-heading">
        <div>
          <strong>{title}</strong>
          <span>{control.updatedBy} · {new Date(control.updatedAt).toLocaleString()}</span>
        </div>
        <Tag icon={control.enabled ? <CheckCircleOutlined /> : <StopOutlined />} color={control.enabled ? "green" : "default"}>{control.enabled ? "已开启" : "已关闭"}</Tag>
      </div>
      <div className="workflow-field-grid rollout-columns">
        <Form.Item label="启用" name="enabled" valuePropName="checked"><Switch disabled={!control.activationReady && !control.enabled} /></Form.Item>
        <Form.Item label="最低 App 版本" name="minAppVersion"><Input placeholder="未设置" /></Form.Item>
        <Form.Item label="能力有效秒数" name="capabilityTtlSeconds"><InputNumber min={60} max={86400} style={{ width: "100%" }} /></Form.Item>
        <Form.Item label="灰度设备" name="deviceCodes"><Select mode="multiple" allowClear options={devices.filter((device) => device.deviceCode).map((device) => ({ value: device.deviceCode!, label: deviceDisplayName(device) }))} /></Form.Item>
      </div>
      <Form.Item label="必需能力" name="requiredCapabilities"><Select mode="multiple" options={capabilityOptions} /></Form.Item>
      <div className="rollout-save-row">
        <Form.Item label="变更原因" name="reason" rules={[{ required: true, min: 3, message: "请填写变更原因" }]}><Input maxLength={500} /></Form.Item>
        <Button htmlType="submit" icon={<LockOutlined />} loading={loading}>保存门禁配置</Button>
      </div>
      {!control.activationReady ? <Alert type="info" showIcon message="安全基线尚未完成，当前只能维护门禁参数，不能开启。" description={control.reason || undefined} /> : null}
    </Form>
  );
}

function CommercePreview({ preview, loading, error }: { preview?: CommerceCardFeaturePreview; loading: boolean; error: string | null }) {
  if (loading) return <Skeleton active paragraph={{ rows: 3 }} />;
  if (!preview) return <Alert type={error ? "warning" : "info"} showIcon message={error || "保存商品卡组合任务后生成 V2 预览"} />;
  return (
    <div className="commerce-preview-band">
      <div className="commerce-preview-heading"><strong>配置预览</strong><Tag color="blue">V2</Tag><Tag>{preview.rollout.enabled ? "门禁开启" : "门禁关闭"}</Tag></div>
      <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 3 }}>
        <Descriptions.Item label="配置来源">直播目标中心</Descriptions.Item>
        <Descriptions.Item label="配置版本">第 {preview.revision} 版</Descriptions.Item>
        <Descriptions.Item label="执行审批">未开放</Descriptions.Item>
        <Descriptions.Item label="预计主动时长">{preview.duration.minimumMinutes}-{preview.duration.maximumMinutes} 分钟</Descriptions.Item>
        <Descriptions.Item label="任务上限">{preview.duration.taskLimitMinutes} 分钟</Descriptions.Item>
        <Descriptions.Item label="当前可执行">否</Descriptions.Item>
      </Descriptions>
      <details className="commerce-preview-details">
        <summary>配置快照与校验哈希</summary>
        <div className="ops-small">SHA-256: {preview.configHash}</div>
        <pre className="ops-json-box">{JSON.stringify(preview.payload, null, 2)}</pre>
      </details>
    </div>
  );
}
