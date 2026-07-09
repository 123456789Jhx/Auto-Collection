import { CommentOutlined, ReloadOutlined, SaveOutlined, SearchOutlined, ShoppingOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Form, Input, InputNumber, Skeleton, Space, Switch, Tabs, Tag, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { getDeviceTaskConfig, getDevices, updateDeviceTaskConfig } from "../lib/api-client";
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

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

export function ConfigCenterPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [keyword, setKeyword] = useState("");
  const [selectedDeviceCode, setSelectedDeviceCode] = useState("");
  const [form] = Form.useForm<ConfigFormValues>();

  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    refetchInterval: 15000
  });

  const devices = useMemo(() => (devicesQuery.data ?? []) as DeviceRow[], [devicesQuery.data]);
  const filteredDevices = useMemo(() => {
    const search = keyword.trim().toLowerCase();
    if (!search) return devices;
    return devices.filter((device) =>
      `${deviceDisplayName(device)} ${deviceSubTitle(device)} ${device.platform ?? ""}`.toLowerCase().includes(search)
    );
  }, [devices, keyword]);

  const selectedDevice = useMemo(() => {
    return devices.find((device) => device.deviceCode === selectedDeviceCode)
      ?? filteredDevices[0]
      ?? devices[0]
      ?? null;
  }, [devices, filteredDevices, selectedDeviceCode]);

  useEffect(() => {
    if (!selectedDeviceCode && selectedDevice?.deviceCode) {
      setSelectedDeviceCode(selectedDevice.deviceCode);
    }
  }, [selectedDevice, selectedDeviceCode]);

  const taskConfigQuery = useQuery({
    queryKey: ["deviceTaskConfig", selectedDevice?.deviceCode, selectedDevice?.platform ?? "douyin"],
    queryFn: () => getDeviceTaskConfig(selectedDevice?.deviceCode ?? "", selectedDevice?.platform ?? "douyin") as Promise<TaskConfigRow>,
    enabled: Boolean(selectedDevice?.deviceCode)
  });

  useEffect(() => {
    if (taskConfigQuery.data) {
      form.setFieldsValue(configFormValues(taskConfigQuery.data));
    } else if (selectedDevice?.deviceCode) {
      form.setFieldsValue(configFormValues(null));
    }
  }, [form, selectedDevice?.deviceCode, taskConfigQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (values: ConfigFormValues) => {
      if (!selectedDevice) {
        throw new Error("未选择手机");
      }
      const taskConfig = taskConfigQuery.data;
      return updateDeviceTaskConfig(selectedDevice.deviceCode, {
        liveCommentBotConfig: buildLiveCommentBotConfig(taskConfig, values),
        p3ExtensionsConfig: buildP3ExtensionsConfig(taskConfig, values)
      }, selectedDevice.platform ?? "douyin");
    },
    onSuccess: () => {
      messageApi.success("手机配置已保存，并已下发刷新配置命令");
      void queryClient.invalidateQueries({ queryKey: ["deviceTaskConfig", selectedDevice?.deviceCode, selectedDevice?.platform ?? "douyin"] });
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  async function saveConfig() {
    const values = await form.validateFields();
    saveMutation.mutate(values);
  }

  async function refreshConfig() {
    await Promise.all([
      devicesQuery.refetch(),
      selectedDevice ? taskConfigQuery.refetch() : Promise.resolve()
    ]);
    messageApi.success("配置数据已刷新");
  }

  const onlineCount = devices.filter((device) => !["offline", "stopped", "error"].includes(device.effectiveStatus || device.status || "")).length;
  const configuredCount = devices.length;

  return (
    <div className="ops-page config-center-page">
      {contextHolder}
      <header className="ops-topbar">
        <div>
          <h1>配置中心</h1>
          <p>按手机配置目标直播间、关键词和商品卡直播评论参数。</p>
        </div>
        <div className="ops-toolbar">
          <Tag color="blue">按手机配置</Tag>
          <Button icon={<ReloadOutlined />} loading={devicesQuery.isFetching || taskConfigQuery.isFetching} onClick={() => void refreshConfig()}>
            刷新
          </Button>
          <Button type="primary" icon={<SaveOutlined />} loading={saveMutation.isPending} disabled={!selectedDevice} onClick={() => void saveConfig()}>
            保存并下发
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
          <span>设备级配置</span>
          <strong>{configuredCount}</strong>
        </div>
      </section>

      <div className="config-device-layout">
        <aside className="config-device-list" aria-label="手机列表">
          <div className="config-device-list-head">
            <strong>选择手机</strong>
            <span>{filteredDevices.length} 台</span>
          </div>
          <Input
            prefix={<SearchOutlined />}
            allowClear
            placeholder="搜索抖音账号 / 设备编号"
            value={keyword}
            onChange={(event) => setKeyword(event.currentTarget.value)}
          />
          {devicesQuery.isLoading ? <Skeleton active paragraph={{ rows: 6 }} /> : null}
          {devicesQuery.isError ? <Alert type="error" message="手机列表加载失败" description={devicesQuery.error.message} showIcon /> : null}
          {!devicesQuery.isLoading && filteredDevices.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无手机" /> : null}
          <div className="config-device-scroll">
            {filteredDevices.map((device) => {
              const active = selectedDevice?.deviceCode === device.deviceCode;
              const status = device.effectiveStatus || device.status;
              return (
                <button
                  className={`config-device-item ${active ? "active" : ""}`}
                  type="button"
                  key={device.id || device.deviceCode}
                  onClick={() => setSelectedDeviceCode(device.deviceCode)}
                >
                  <span>
                    <strong>{deviceDisplayName(device)}</strong>
                    <small>{deviceSubTitle(device)}</small>
                  </span>
                  <Tag color={statusTone(status)}>{statusText(status)}</Tag>
                </button>
              );
            })}
          </div>
        </aside>

        <main className="ops-panel config-device-editor" aria-label="手机功能配置">
          <div className="ops-panel-head">
            <span>{selectedDevice ? deviceDisplayName(selectedDevice) : "未选择手机"}</span>
            {selectedDevice ? <span className="ops-panel-note">{deviceSubTitle(selectedDevice)}</span> : null}
          </div>
          <div className="ops-panel-body">
            {!selectedDevice ? <Empty description="请选择一台手机" /> : null}
            {selectedDevice && taskConfigQuery.isLoading ? <Skeleton active paragraph={{ rows: 8 }} /> : null}
            {selectedDevice && taskConfigQuery.isError ? <Alert type="error" message="配置加载失败" description={taskConfigQuery.error.message} showIcon /> : null}
            {selectedDevice && !taskConfigQuery.isLoading && !taskConfigQuery.isError ? (
              <>
                <div className="config-device-meta">
                  <div><span>平台</span><strong>{selectedDevice.platform || "douyin"}</strong></div>
                  <div><span>状态</span><strong>{statusText(selectedDevice.effectiveStatus || selectedDevice.status)}</strong></div>
                  <div><span>最近心跳</span><strong>{formatTime(selectedDevice.lastHeartbeatAt)}</strong></div>
                </div>
                <Form form={form} layout="vertical" className="config-feature-form">
                  <Tabs
                    items={[
                      {
                        key: "live-comment",
                        label: <span><CommentOutlined />搜索直播评论</span>,
                        children: (
                          <div className="config-form-section">
                            <div className="config-form-header">
                              <div>
                                <h2>搜索直播评论</h2>
                                <p>通过关键词搜索直播间，匹配目标直播间名称后执行评论。</p>
                              </div>
                              <Form.Item name="liveEnabled" valuePropName="checked" noStyle>
                                <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                              </Form.Item>
                            </div>
                            <div className="config-form-grid">
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
                            <div className="config-form-grid textareas">
                              <Form.Item label="搜索关键词" name="liveSearchKeywords">
                                <Input.TextArea rows={5} placeholder={"夏橙\n秭归夏橙"} />
                              </Form.Item>
                              <Form.Item label="直播间匹配词" name="liveMatchKeywords">
                                <Input.TextArea rows={5} placeholder={"秭归夏橙\n夏橙助农"} />
                              </Form.Item>
                              <Form.Item label="必须包含词" name="liveRequiredKeywords">
                                <Input.TextArea rows={4} placeholder="可留空" />
                              </Form.Item>
                              <Form.Item label="排除词" name="liveForbiddenKeywords">
                                <Input.TextArea rows={4} placeholder={"回放\n录播"} />
                              </Form.Item>
                            </div>
                          </div>
                        )
                      },
                      {
                        key: "commerce-card-live-comment",
                        label: <span><ShoppingOutlined />商品卡直播评论</span>,
                        children: (
                          <div className="config-form-section">
                            <div className="config-form-header">
                              <div>
                                <h2>商品卡直播评论</h2>
                                <p>搜索商品卡关键词，识别直播卡片，进入匹配的目标直播间。</p>
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
                            <div className="config-form-grid">
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
                            <div className="config-form-grid textareas">
                              <Form.Item label="商品卡搜索关键词" name="commerceSearchKeywords">
                                <Input.TextArea rows={5} placeholder={"夏橙\n秭归夏橙"} />
                              </Form.Item>
                              <Form.Item label="商品卡匹配词" name="commerceMatchKeywords">
                                <Input.TextArea rows={5} placeholder={"秭归\n夏橙"} />
                              </Form.Item>
                              <Form.Item label="直播间匹配词" name="commerceRoomMatchKeywords">
                                <Input.TextArea rows={5} placeholder={"秭归夏橙\n夏橙直播间"} />
                              </Form.Item>
                              <Form.Item label="直播状态识别词" name="commerceLiveSignals">
                                <Input.TextArea rows={5} placeholder={"直播中\n正在直播\n讲解中"} />
                              </Form.Item>
                              <Form.Item label="评论内容" name="commerceCommentPool" className="config-form-wide">
                                <Input.TextArea rows={5} maxLength={2000} placeholder={"111\n666"} />
                              </Form.Item>
                            </div>
                          </div>
                        )
                      }
                    ]}
                  />
                </Form>
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
