import { PlusOutlined, ReloadOutlined, SaveOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, InputNumber, Select, Space, Switch, Tabs, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { getDevices, getLiveTargets, saveDeviceLiveTargetBindings, saveLiveTarget, saveLiveTargetFeatureConfig, type LiveTarget, type LiveTargetAlias, type LiveTargetFeatureConfig, type LiveTargetFeatureType } from "../lib/api-client";
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
  scanMinutesPerRound?: number;
  watchMinutesPerLive?: number;
  maxRounds?: number;
  maxCommentsPerRoom?: number;
  commentPoolText?: string;
};

type BindingFormValues = {
  featureType: LiveTargetFeatureType;
  defaultEnabled: boolean;
  deviceCodes: string[];
};

function toLines(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).join("\n") : "";
}

function parseLines(value?: string) {
  return (value || "")
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
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
  return featureType === "commerce_card_live_comment" ? "商品卡直播评论" : "搜索直播评论";
}

function featureConfig(target: LiveTarget | null, featureType: LiveTargetFeatureType): LiveTargetFeatureConfig {
  return (
    target?.featureConfigs?.find((item) => item.featureType === featureType) || {
      featureType,
      enabled: true,
      searchKeywords: [],
      requiredKeywords: [],
      forbiddenKeywords: [],
      productKeywords: [],
      liveSignals: featureType === "commerce_card_live_comment" ? ["直播中", "讲解中", "正在直播"] : [],
      runtimeConfig: featureType === "commerce_card_live_comment" ? { scanMinutesPerRound: 15, watchMinutesPerLive: 15, maxRounds: 3, maxCommentsPerRoom: 1, commentPool: ["111", "666"] } : {}
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
    scanMinutesPerRound: Number(runtime.scanMinutesPerRound || 15),
    watchMinutesPerLive: Number(runtime.watchMinutesPerLive || 15),
    maxRounds: Number(runtime.maxRounds || 3),
    maxCommentsPerRoom: Number(runtime.maxCommentsPerRoom || 1),
    commentPoolText: toLines(runtime.commentPool)
  };
}

function buildFeaturePayload(featureType: LiveTargetFeatureType, values: FeatureFormValues): LiveTargetFeatureConfig {
  const runtimeConfig =
    featureType === "commerce_card_live_comment"
      ? {
          scanMinutesPerRound: Number(values.scanMinutesPerRound || 15),
          watchMinutesPerLive: Number(values.watchMinutesPerLive || 15),
          maxRounds: Number(values.maxRounds || 3),
          maxCommentsPerRoom: Number(values.maxCommentsPerRoom || 1),
          commentPool: parseLines(values.commentPoolText)
        }
      : {};

  return {
    featureType,
    enabled: values.enabled !== false,
    searchKeywords: parseLines(values.searchKeywordsText),
    requiredKeywords: parseLines(values.requiredKeywordsText),
    forbiddenKeywords: parseLines(values.forbiddenKeywordsText),
    productKeywords: parseLines(values.productKeywordsText),
    liveSignals: parseLines(values.liveSignalsText),
    runtimeConfig
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

export function LiveTargetsPage() {
  const [targetForm] = Form.useForm<TargetFormValues>();
  const [liveForm] = Form.useForm<FeatureFormValues>();
  const [commerceForm] = Form.useForm<FeatureFormValues>();
  const [bindingForm] = Form.useForm<BindingFormValues>();
  const [selectedId, setSelectedId] = useState<string>("");
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();
  const targetQuery = useQuery({ queryKey: ["liveTargets"], queryFn: () => getLiveTargets("douyin") });
  const deviceQuery = useQuery({ queryKey: ["devices"], queryFn: getDevices });
  const targets = targetQuery.data || [];
  const devices = (deviceQuery.data || []) as DeviceRow[];
  const selectedTarget = useMemo(() => (creating ? null : targets.find((item) => item.id === selectedId) || null), [targets, selectedId, creating]);
  const deviceCodeById = useMemo(() => new Map(devices.map((device) => [device.id, device.deviceCode])), [devices]);

  useEffect(() => {
    if (!creating && !selectedId && targets[0]?.id) {
      setSelectedId(targets[0].id);
    }
  }, [creating, selectedId, targets]);

  useEffect(() => {
    if (!selectedTarget?.id) return;
    setSelectedId(selectedTarget.id);
    targetForm.setFieldsValue(targetInitialValues(selectedTarget));
    liveForm.setFieldsValue(featureValues(featureConfig(selectedTarget, "live_comment")));
    commerceForm.setFieldsValue(featureValues(featureConfig(selectedTarget, "commerce_card_live_comment")));
    const bindings = selectedTarget.bindings || [];
    bindingForm.setFieldsValue({
      featureType: "commerce_card_live_comment",
      defaultEnabled: bindings.some((item) => !item.deviceId && item.enabled !== false),
      deviceCodes: bindings.map((item) => (item.deviceId ? deviceCodeById.get(item.deviceId) : "")).filter(Boolean) as string[]
    });
  }, [selectedTarget?.id, targets.length, devices.length]);

  const targetMutation = useMutation({
    mutationFn: (values: TargetFormValues) =>
      saveLiveTarget({
        id: selectedTarget?.id,
        targetCode: values.targetCode,
        targetName: values.targetName,
        platform: "douyin",
        similarityThreshold: Number(values.similarityThreshold || 90) / 100,
        enabled: values.enabled !== false,
        remark: values.remark || null,
        aliases: parseAliases(values.aliasesText)
      }),
    onSuccess: async (result) => {
      message.success("目标直播间已保存");
      setCreating(false);
      setSelectedId(result.id || "");
      await queryClient.invalidateQueries({ queryKey: ["liveTargets"] });
    },
    onError: (error: Error) => message.error(error.message || "目标直播间保存失败")
  });

  const featureMutation = useMutation({
    mutationFn: (payload: { targetId: string; featureType: LiveTargetFeatureType; values: FeatureFormValues }) =>
      saveLiveTargetFeatureConfig(payload.targetId, buildFeaturePayload(payload.featureType, payload.values)),
    onSuccess: async () => {
      message.success("功能配置已保存");
      await queryClient.invalidateQueries({ queryKey: ["liveTargets"] });
    },
    onError: (error: Error) => message.error(error.message || "功能配置保存失败")
  });

  const bindingMutation = useMutation({
    mutationFn: (values: BindingFormValues) =>
      saveDeviceLiveTargetBindings({
        targetId: selectedTarget?.id || "",
        featureType: values.featureType,
        deviceCodes: values.deviceCodes || [],
        defaultEnabled: values.defaultEnabled
      }),
    onSuccess: async () => {
      message.success("设备绑定已保存");
      await queryClient.invalidateQueries({ queryKey: ["liveTargets"] });
    },
    onError: (error: Error) => message.error(error.message || "设备绑定保存失败")
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

  return (
    <div className="ops-page">
      <div className="ops-topbar">
        <div>
          <h1>直播目标配置</h1>
          <p>配置关键词搜索、目标直播间名称匹配、直播间别名和商品卡直播评论参数。</p>
        </div>
        <div className="ops-toolbar">
          <Button icon={<ReloadOutlined />} onClick={() => targetQuery.refetch()}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={createTarget}>
            新增目标
          </Button>
        </div>
      </div>

      <div className="ops-workbench wide-side">
        <section className="ops-panel">
          <div className="ops-panel-head">
            <span>目标直播间</span>
            <span className="ops-panel-note">{targets.length} 个目标</span>
          </div>
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>直播间名称</th>
                  <th>相似度阈值</th>
                  <th>功能</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {targets.map((target) => (
                  <tr
                    key={target.id || target.targetCode}
                    className={target.id === selectedTarget?.id ? "selected" : ""}
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(target.id || "");
                    }}
                  >
                    <td>
                      <div className="ops-title">{target.targetName}</div>
                      <div className="ops-small">{target.targetCode}</div>
                    </td>
                    <td>{Math.round(Number(target.similarityThreshold || 0.9) * 100)}%</td>
                    <td>
                      <Space wrap>
                        {target.featureConfigs?.map((item) => (
                          <Tag key={item.featureType} color={item.enabled ? "blue" : "default"}>
                            {featureTitle(item.featureType)}
                          </Tag>
                        ))}
                      </Space>
                    </td>
                    <td>
                      <Tag color={target.enabled ? "green" : "default"}>{target.enabled ? "启用" : "停用"}</Tag>
                    </td>
                  </tr>
                ))}
                {targets.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="ops-empty">
                      暂无目标直播间
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="ops-panel">
          <div className="ops-panel-head">
            <span>{selectedTarget?.targetName || "新增目标直播间"}</span>
            <span className="ops-panel-note">搜索词和目标名分离配置</span>
          </div>
          <div className="ops-panel-body">
            <Form<TargetFormValues> form={targetForm} layout="vertical" initialValues={targetInitialValues(selectedTarget)} onFinish={(values) => targetMutation.mutate(values)}>
              <Form.Item label="目标直播间编码" name="targetCode" rules={[{ required: true, message: "请输入目标编码" }]}>
                <Input placeholder="zigui_xiacheng" />
              </Form.Item>
              <Form.Item label="目标直播间名称" name="targetName" rules={[{ required: true, message: "请输入目标直播间名称" }]}>
                <Input placeholder="秭归夏橙直播间" />
              </Form.Item>
              <Form.Item label="直播间别名" name="aliasesText">
                <Input.TextArea rows={3} placeholder="一行一个别名，例如：秭归夏橙" />
              </Form.Item>
              <Space align="start" size={16}>
                <Form.Item label="相似度阈值" name="similarityThreshold" rules={[{ required: true, message: "请输入阈值" }]}>
                  <InputNumber min={50} max={100} addonAfter="%" />
                </Form.Item>
                <Form.Item label="启用目标" name="enabled" valuePropName="checked">
                  <Switch />
                </Form.Item>
              </Space>
              <Form.Item label="备注" name="remark">
                <Input.TextArea rows={2} />
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={targetMutation.isPending}>
                保存目标直播间
              </Button>
            </Form>

            <Tabs
              className="live-target-tabs"
              items={[
                {
                  key: "live_comment",
                  label: "搜索直播评论",
                  children: (
                    <FeatureForm form={liveForm} featureType="live_comment" loading={featureMutation.isPending} onSave={(values) => saveFeature("live_comment", values)} />
                  )
                },
                {
                  key: "commerce_card_live_comment",
                  label: "商品卡直播评论",
                  children: (
                    <FeatureForm form={commerceForm} featureType="commerce_card_live_comment" loading={featureMutation.isPending} onSave={(values) => saveFeature("commerce_card_live_comment", values)} />
                  )
                },
                {
                  key: "bindings",
                  label: "设备绑定",
                  children: (
                    <Form<BindingFormValues> form={bindingForm} layout="vertical" initialValues={{ featureType: "commerce_card_live_comment", defaultEnabled: false, deviceCodes: [] }} onFinish={(values) => bindingMutation.mutate(values)}>
                      <Alert type="info" showIcon message="未绑定任何设备时，目标默认对全部设备可用；绑定后仅下发到选中的设备。" style={{ marginBottom: 12 }} />
                      <Form.Item label="绑定功能" name="featureType">
                        <Select
                          options={[
                            { value: "live_comment", label: "搜索直播评论" },
                            { value: "commerce_card_live_comment", label: "商品卡直播评论" }
                          ]}
                        />
                      </Form.Item>
                      <Form.Item label="默认下发给全部设备" name="defaultEnabled" valuePropName="checked">
                        <Switch />
                      </Form.Item>
                      <Form.Item label="指定设备" name="deviceCodes">
                        <Select
                          mode="multiple"
                          allowClear
                          placeholder="选择设备"
                          options={devices
                            .filter((device) => device.deviceCode)
                            .map((device) => ({
                              value: device.deviceCode!,
                              label: `${deviceDisplayName(device)} / ${deviceSubTitle(device)}`
                            }))}
                        />
                      </Form.Item>
                      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} disabled={!selectedTarget?.id} loading={bindingMutation.isPending}>
                        保存设备绑定
                      </Button>
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
  return (
    <Form<FeatureFormValues> form={form} layout="vertical" onFinish={onSave}>
      <Form.Item label="启用功能" name="enabled" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="搜索关键词" name="searchKeywordsText" rules={[{ required: true, message: "请输入搜索关键词" }]}>
        <Input.TextArea rows={3} placeholder="一行一个搜索关键词，例如：夏橙" />
      </Form.Item>
      <Form.Item label="目标必须包含关键词" name="requiredKeywordsText">
        <Input.TextArea rows={2} placeholder="可选，一行一个关键词" />
      </Form.Item>
      <Form.Item label="排除关键词" name="forbiddenKeywordsText">
        <Input.TextArea rows={2} placeholder="例如：回放、录播" />
      </Form.Item>
      {featureType === "commerce_card_live_comment" ? (
        <>
          <Form.Item label="商品卡匹配关键词" name="productKeywordsText" rules={[{ required: true, message: "请输入商品卡匹配关键词" }]}>
            <Input.TextArea rows={2} placeholder="例如：秭归、夏橙" />
          </Form.Item>
          <Form.Item label="直播信号关键词" name="liveSignalsText">
            <Input.TextArea rows={2} placeholder="例如：直播中、讲解中、正在直播" />
          </Form.Item>
          <Space align="start" wrap>
            <Form.Item label="单轮扫描分钟" name="scanMinutesPerRound">
              <InputNumber min={1} max={60} />
            </Form.Item>
            <Form.Item label="进房观看分钟" name="watchMinutesPerLive">
              <InputNumber min={0} max={120} />
            </Form.Item>
            <Form.Item label="循环轮次" name="maxRounds">
              <InputNumber min={1} max={20} />
            </Form.Item>
            <Form.Item label="单房评论数" name="maxCommentsPerRoom">
              <InputNumber min={0} max={5} />
            </Form.Item>
          </Space>
          <Form.Item label="评论内容池" name="commentPoolText">
            <Input.TextArea rows={3} placeholder="一行一个评论内容" />
          </Form.Item>
        </>
      ) : null}
      <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={loading}>
        保存{featureTitle(featureType)}
      </Button>
    </Form>
  );
}
