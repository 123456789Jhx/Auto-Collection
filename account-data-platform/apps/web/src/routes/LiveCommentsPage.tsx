import { ArrowLeftOutlined, PauseOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Col, Empty, Form, Input, InputNumber, Modal, Row, Select, Skeleton, Space, Statistic, Switch, Table, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { createMobileCommand, getDeviceTaskConfig, getLiveCommentActions, getLiveCommentDeviceSummary, updateDevice, updateDeviceTaskConfig } from "../lib/api-client";
import { statusColor, statusText } from "../lib/display-maps";

type LiveCommentDeviceSummary = {
  deviceId?: string;
  deviceCode?: string;
  deviceName?: string;
  totalCount: number;
  plannedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  latestActionAt?: string | null;
  deviceStatus?: string;
  lastHeartbeatAt?: string | null;
};

type LiveCommentAction = {
  id: string;
  createdAt?: string;
  deviceCode?: string;
  deviceName?: string;
  roomName?: string | null;
  leaderAccountName?: string | null;
  triggerText?: string | null;
  replyText?: string;
  plannedDelayMs?: number | null;
  status?: string;
  skipReason?: string | null;
  failureReason?: string | null;
  sentAt?: string | null;
};

type DeviceTaskConfig = {
  source?: string;
  liveCommentMode?: "off" | "target_follow" | "agri_chatbot";
  liveCommentBotConfig?: Record<string, unknown> | null;
  accountProfile?: Record<string, unknown> | null;
};

type DeviceProfileFormValues = {
  profileName?: string;
  regionProvince?: string;
  regionCity?: string;
  regionCounty?: string;
  role?: string;
  years?: number;
  tone?: string;
  products?: string;
  interests?: string;
  forbiddenClaims?: string;
};

type TargetRoomFormValues = {
  enabled?: boolean;
  anchorName?: string;
  titleKeywords?: string;
  roomKeywords?: string;
  allowRealSend?: boolean;
  maxSendCount?: number;
  minSendIntervalSeconds?: number;
};

type CommandType = "START" | "PAUSE" | "RESUME" | "STOP" | "REFRESH_CONFIG";

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function shortText(value?: string | null, maxLength = 80) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function actionStatusColor(value?: string) {
  if (value === "sent") return "green";
  if (value === "failed") return "red";
  if (value === "skipped") return "orange";
  return "blue";
}

function actionStatusText(value?: string) {
  if (value === "planned") return "已计划";
  if (value === "sent") return "已发送";
  if (value === "failed") return "失败";
  if (value === "skipped") return "跳过";
  return value || "-";
}

function liveCommentModeText(value?: string) {
  if (value === "agri_chatbot") return "账号机器人";
  if (value === "target_follow") return "跟随评论";
  if (value === "off") return "关闭";
  return "账号机器人";
}

function configSourceText(value?: string) {
  if (value === "device") return "设备单独配置";
  if (value === "task") return "公共任务模板";
  return "公共任务模板";
}

function defaultAccountProfile() {
  return {
    profileName: "三农交流账号",
    region: { province: "", city: "", county: "" },
    identity: { role: "种植户", years: 5, tone: "朴实、自然、接地气" },
    products: [{ name: "水稻", scale: "几十亩", topics: ["病虫害", "水肥管理"] }],
    interests: ["三农", "种植", "农产品"],
    speakingStyle: { length: "short", emojiAllowed: false, questionRatio: 0.4 },
    forbiddenClaims: ["夸大收益", "保证效果", "诱导私信", "售卖农资"],
    status: "enabled"
  };
}

function emptyProfileFormValues(profile?: Record<string, unknown> | null): DeviceProfileFormValues {
  const value = profile || defaultAccountProfile();
  const region = (value.region as Record<string, unknown>) || {};
  const identity = (value.identity as Record<string, unknown>) || {};
  const products = Array.isArray(value.products) ? value.products : [];
  const firstProduct = products[0] && typeof products[0] === "object" ? (products[0] as Record<string, unknown>) : {};
  return {
    profileName: String(value.profileName || ""),
    regionProvince: String(region.province || ""),
    regionCity: String(region.city || ""),
    regionCounty: String(region.county || ""),
    role: String(identity.role || ""),
    years: Number(identity.years || 0),
    tone: String(identity.tone || ""),
    products: String(firstProduct.name || ""),
    interests: Array.isArray(value.interests) ? value.interests.join("\n") : "",
    forbiddenClaims: Array.isArray(value.forbiddenClaims) ? value.forbiddenClaims.join("\n") : ""
  };
}

function buildAccountProfile(values: DeviceProfileFormValues) {
  return {
    profileName: values.profileName?.trim() || "三农交流账号",
    region: {
      province: values.regionProvince?.trim() || "",
      city: values.regionCity?.trim() || "",
      county: values.regionCounty?.trim() || ""
    },
    identity: {
      role: values.role?.trim() || "种植户",
      years: Number(values.years || 0),
      tone: values.tone?.trim() || "朴实、自然、接地气"
    },
    products: values.products?.trim() ? [{ name: values.products.trim(), scale: "", topics: [] }] : [],
    interests: splitLines(values.interests),
    speakingStyle: { length: "short", emojiAllowed: false, questionRatio: 0.4 },
    forbiddenClaims: splitLines(values.forbiddenClaims),
    status: "enabled"
  };
}

function splitLines(value?: string) {
  return (value || "")
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberFromConfig(config: Record<string, unknown> | null | undefined, key: string, fallback: number) {
  const value = config?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getProfileField(profile: Record<string, unknown>, path: string[]) {
  let current: unknown = profile;
  for (const key of path) {
    if (!current || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" || typeof current === "number" ? String(current) : "";
}

function targetRoomFormValues(config?: Record<string, unknown> | null): TargetRoomFormValues {
  const targetRoom = (config?.targetRoom && typeof config.targetRoom === "object" ? config.targetRoom : {}) as Record<string, unknown>;
  return {
    enabled: targetRoom.enabled === true,
    anchorName: String(targetRoom.anchorName || ""),
    titleKeywords: Array.isArray(targetRoom.titleKeywords) ? targetRoom.titleKeywords.join("\n") : "",
    roomKeywords: Array.isArray(targetRoom.roomKeywords) ? targetRoom.roomKeywords.join("\n") : "",
    allowRealSend: targetRoom.allowRealSend === true,
    maxSendCount: Number(targetRoom.maxSendCount || 3),
    minSendIntervalSeconds: Number(targetRoom.minSendIntervalSeconds || 30)
  };
}

function buildTargetRoomConfig(values: TargetRoomFormValues) {
  return {
    enabled: values.enabled === true,
    anchorName: values.anchorName?.trim() || "",
    titleKeywords: splitLines(values.titleKeywords),
    roomKeywords: splitLines(values.roomKeywords),
    allowRealSend: values.allowRealSend === true,
    maxSendCount: Math.max(1, Number(values.maxSendCount || 3)),
    minSendIntervalSeconds: Math.max(10, Number(values.minSendIntervalSeconds || 30))
  };
}

export function LiveCommentsPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedDevice, setSelectedDevice] = useState<LiveCommentDeviceSummary | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [checkedDeviceCodes, setCheckedDeviceCodes] = useState<string[]>([]);
  const [deviceKeyword, setDeviceKeyword] = useState("");
  const [deviceStatus, setDeviceStatus] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [recordKeyword, setRecordKeyword] = useState("");
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(15);
  const [profileOpen, setProfileOpen] = useState(false);
  const [targetRoomOpen, setTargetRoomOpen] = useState(false);
  const [targetRoomDevice, setTargetRoomDevice] = useState<LiveCommentDeviceSummary | null>(null);
  const [targetRoomConfig, setTargetRoomConfig] = useState<DeviceTaskConfig | null>(null);
  const [profileForm] = Form.useForm<DeviceProfileFormValues>();
  const [targetRoomForm] = Form.useForm<TargetRoomFormValues>();

  const summaryQuery = useQuery({
    queryKey: ["live-comment-device-summary"],
    queryFn: () => getLiveCommentDeviceSummary(),
    refetchInterval: autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });

  const taskConfigQuery = useQuery({
    queryKey: ["live-comment-task-config", selectedDevice?.deviceCode],
    queryFn: async () => {
      if (!selectedDevice?.deviceCode) return null;
      return (await getDeviceTaskConfig(selectedDevice.deviceCode, "douyin")) as DeviceTaskConfig;
    },
    enabled: !!selectedDevice?.deviceCode
  });

  const actionsQuery = useQuery({
    queryKey: ["live-comment-actions", selectedDevice?.deviceCode, status, recordKeyword],
    queryFn: () =>
      getLiveCommentActions({
        deviceCode: selectedDevice?.deviceCode,
        status,
        keyword: recordKeyword,
        pageSize: 100
      }),
    enabled: !!selectedDevice?.deviceCode,
    refetchInterval: selectedDevice && autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });

  const commandMutation = useMutation({
    mutationFn: ({ deviceId, commandType }: { deviceId: string; commandType: CommandType }) =>
      createMobileCommand({
        deviceId,
        commandType,
        payload: { source: "live_comment_page", taskType: "live_comment_control" },
        expiresInSeconds: 3600
      }),
    onSuccess: () => {
      messageApi.success("远程指令已下发");
      void queryClient.invalidateQueries({ queryKey: ["live-comment-device-summary"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  const deviceMutation = useMutation({
    mutationFn: ({ deviceCode, accountProfile }: { deviceCode: string; accountProfile: Record<string, unknown> }) =>
      updateDevice(deviceCode, { accountProfile }),
    onSuccess: () => {
      messageApi.success("设备画像已保存");
      setProfileOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["live-comment-task-config", selectedDevice?.deviceCode] });
      void queryClient.invalidateQueries({ queryKey: ["live-comment-device-summary"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  const targetRoomMutation = useMutation({
    mutationFn: ({ deviceCode, liveCommentBotConfig }: { deviceCode: string; liveCommentBotConfig: Record<string, unknown> }) =>
      updateDeviceTaskConfig(deviceCode, {
        liveCommentMode: "agri_chatbot",
        liveCommentBotConfig
      }, "douyin"),
    onSuccess: (_data, variables) => {
      messageApi.success("指定直播间配置已保存");
      setTargetRoomOpen(false);
      setTargetRoomDevice(null);
      setTargetRoomConfig(null);
      commandMutation.mutate({ deviceId: variables.deviceCode, commandType: "REFRESH_CONFIG" });
      void queryClient.invalidateQueries({ queryKey: ["live-comment-task-config", selectedDevice?.deviceCode] });
      void queryClient.invalidateQueries({ queryKey: ["live-comment-device-summary"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  const summaries = useMemo(() => (summaryQuery.data ?? []) as LiveCommentDeviceSummary[], [summaryQuery.data]);
  const filteredSummaries = useMemo(() => {
    const keyword = deviceKeyword.trim().toLowerCase();
    return summaries.filter((item) => {
      const matchesKeyword = !keyword || `${item.deviceName || ""} ${item.deviceCode || ""}`.toLowerCase().includes(keyword);
      const matchesStatus = !deviceStatus || item.deviceStatus === deviceStatus;
      return matchesKeyword && matchesStatus;
    });
  }, [deviceKeyword, deviceStatus, summaries]);
  const actions = useMemo(() => (actionsQuery.data?.data ?? []) as LiveCommentAction[], [actionsQuery.data]);
  const selectedConfig = taskConfigQuery.data ?? null;
  const selectedProfile = (selectedConfig?.accountProfile ?? defaultAccountProfile()) as Record<string, unknown>;

  function enterBatchMode() {
    setBatchMode(true);
    setCheckedDeviceCodes([]);
  }

  function leaveBatchMode() {
    setBatchMode(false);
    setCheckedDeviceCodes([]);
  }

  function toggleDeviceChecked(deviceCode?: string) {
    if (!deviceCode) return;
    setCheckedDeviceCodes((current) => current.includes(deviceCode) ? current.filter((item) => item !== deviceCode) : [...current, deviceCode]);
  }

  function sendCommand(deviceCode: string | undefined, commandType: CommandType) {
    if (!deviceCode) return;
    commandMutation.mutate({ deviceId: deviceCode, commandType });
  }

  function sendBatchCommand(commandType: CommandType) {
    if (checkedDeviceCodes.length === 0) {
      messageApi.warning("请先勾选设备");
      return;
    }
    checkedDeviceCodes.forEach((deviceCode) => commandMutation.mutate({ deviceId: deviceCode, commandType }));
  }

  function openProfileEditor() {
    profileForm.setFieldsValue(emptyProfileFormValues(selectedProfile));
    setProfileOpen(true);
  }

  async function openTargetRoomEditor(device?: LiveCommentDeviceSummary | null) {
    const targetDevice = device || selectedDevice;
    const deviceCode = targetDevice?.deviceCode;
    if (!deviceCode) return;
    setTargetRoomDevice(targetDevice);
    try {
      const config = (await queryClient.fetchQuery({
        queryKey: ["live-comment-task-config", deviceCode],
        queryFn: async () => (await getDeviceTaskConfig(deviceCode, "douyin")) as DeviceTaskConfig
      })) as DeviceTaskConfig;
      setTargetRoomConfig(config);
      targetRoomForm.setFieldsValue(targetRoomFormValues(config?.liveCommentBotConfig));
    } catch {
      setTargetRoomConfig(null);
      targetRoomForm.setFieldsValue(targetRoomFormValues());
    }
    setTargetRoomOpen(true);
  }

  function closeTargetRoomEditor() {
    setTargetRoomOpen(false);
    setTargetRoomDevice(null);
    setTargetRoomConfig(null);
  }

  function saveProfile() {
    if (!selectedDevice?.deviceCode) return;
    deviceMutation.mutate({
      deviceCode: selectedDevice.deviceCode,
      accountProfile: buildAccountProfile(profileForm.getFieldsValue())
    });
  }

  function saveTargetRoom() {
    const deviceCode = targetRoomDevice?.deviceCode || selectedDevice?.deviceCode;
    if (!deviceCode) return;
    const current = ((targetRoomConfig || selectedConfig)?.liveCommentBotConfig || {}) as Record<string, unknown>;
    targetRoomMutation.mutate({
      deviceCode,
      liveCommentBotConfig: {
        ...current,
        targetRoom: buildTargetRoomConfig(targetRoomForm.getFieldsValue())
      }
    });
  }

  if (summaryQuery.isLoading) return <Skeleton active />;
  if (summaryQuery.isError) return <Alert type="error" message="直播评论汇总加载失败" description={summaryQuery.error.message} showIcon />;

  if (selectedDevice) {
    return (
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        {contextHolder}
        <Card
          title={
            <Space>
              <Button icon={<ArrowLeftOutlined />} onClick={() => setSelectedDevice(null)}>返回</Button>
              <span>{selectedDevice.deviceName || selectedDevice.deviceCode}</span>
            </Space>
          }
          extra={<RefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />}
        >
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Space wrap>
              <Tag color={statusColor(selectedDevice.deviceStatus)}>{statusText(selectedDevice.deviceStatus)}</Tag>
              <Tag>评论模式：{liveCommentModeText(selectedConfig?.liveCommentMode)}</Tag>
              <Tag>配置来源：{configSourceText(selectedConfig?.source)}</Tag>
              <Button icon={<ReloadOutlined />} onClick={() => sendCommand(selectedDevice.deviceCode, "REFRESH_CONFIG")}>刷新配置</Button>
              <Button icon={<PlayCircleOutlined />} onClick={() => sendCommand(selectedDevice.deviceCode, "START")}>启动</Button>
              <Button icon={<PauseOutlined />} onClick={() => sendCommand(selectedDevice.deviceCode, "PAUSE")}>暂停</Button>
              <Button icon={<PlayCircleOutlined />} onClick={() => sendCommand(selectedDevice.deviceCode, "RESUME")}>恢复</Button>
              <Button danger icon={<StopOutlined />} onClick={() => sendCommand(selectedDevice.deviceCode, "STOP")}>停止</Button>
                <Button onClick={() => void openTargetRoomEditor(selectedDevice)}>指定直播间</Button>
                <Button onClick={openProfileEditor}>编辑画像</Button>
              </Space>
            <Row gutter={12}>
              <Col span={6}><Statistic title="总数" value={selectedDevice.totalCount} /></Col>
              <Col span={6}><Statistic title="计划" value={selectedDevice.plannedCount} /></Col>
              <Col span={6}><Statistic title="发送" value={selectedDevice.sentCount} /></Col>
              <Col span={6}><Statistic title="跳过" value={selectedDevice.skippedCount} /></Col>
            </Row>
            <Row gutter={12}>
              <Col xs={24} lg={12}>
                <Card size="small" title="设备画像摘要">
                  <Space direction="vertical" size={4}>
                    <Typography.Text>画像名称：{String(selectedProfile.profileName || "-")}</Typography.Text>
                    <Typography.Text>地区：{[getProfileField(selectedProfile, ["region", "province"]), getProfileField(selectedProfile, ["region", "city"]), getProfileField(selectedProfile, ["region", "county"])].filter(Boolean).join(" / ") || "-"}</Typography.Text>
                    <Typography.Text>身份：{getProfileField(selectedProfile, ["identity", "role"]) || "-"}</Typography.Text>
                    <Typography.Text>农产品：{Array.isArray(selectedProfile.products) && selectedProfile.products.length > 0 ? String((selectedProfile.products[0] as Record<string, unknown>)?.name || "-") : "-"}</Typography.Text>
                  </Space>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card size="small" title="公共模板摘要">
                  <Row gutter={12}>
                    <Col span={6}><Statistic title="每直播间" value={numberFromConfig(selectedConfig?.liveCommentBotConfig, "maxCommentsPerRoom", 3)} suffix="条" /></Col>
                    <Col span={6}><Statistic title="每小时" value={numberFromConfig(selectedConfig?.liveCommentBotConfig, "maxCommentsPerHour", 10)} suffix="条" /></Col>
                    <Col span={6}><Statistic title="最小间隔" value={numberFromConfig(selectedConfig?.liveCommentBotConfig, "minIntervalSeconds", 120)} suffix="秒" /></Col>
                    <Col span={6}><Statistic title="相关阈值" value={numberFromConfig(selectedConfig?.liveCommentBotConfig, "roomRelevanceThreshold", 60)} /></Col>
                  </Row>
                </Card>
              </Col>
            </Row>
          </Space>
        </Card>

        <Card
          title={`${selectedDevice.deviceName || selectedDevice.deviceCode} 执行记录`}
          extra={
            <Space wrap>
              <Select
                allowClear
                placeholder="状态"
                value={status}
                onChange={setStatus}
                style={{ width: 130 }}
                options={[
                  { value: "planned", label: "已计划" },
                  { value: "sent", label: "已发送" },
                  { value: "failed", label: "失败" },
                  { value: "skipped", label: "跳过" }
                ]}
              />
              <Input.Search placeholder="直播间/账号/话术" allowClear onSearch={setRecordKeyword} style={{ width: 220 }} />
            </Space>
          }
        >
          {actionsQuery.isLoading ? <Skeleton active /> : null}
          {actionsQuery.isError ? <Alert type="error" message="执行记录加载失败" description={actionsQuery.error.message} showIcon /> : null}
          {!actionsQuery.isLoading && actions.length === 0 ? <Empty description="暂无直播评论执行记录" /> : null}
          {actions.length > 0 ? <LiveActionTable actions={actions} /> : null}
        </Card>

        <ProfileModal open={profileOpen} form={profileForm} loading={deviceMutation.isPending} onCancel={() => setProfileOpen(false)} onSave={saveProfile} />
        <TargetRoomModal
          open={targetRoomOpen}
          form={targetRoomForm}
          loading={targetRoomMutation.isPending}
          onCancel={closeTargetRoomEditor}
          onSave={saveTargetRoom}
        />
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {contextHolder}
      <Card
        title="直播评论运营"
        extra={<RefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />}
      >
        <Space style={{ width: "100%", justifyContent: "space-between", marginBottom: 16 }} wrap>
          <Space wrap>
            <Input.Search placeholder="搜索设备名称/设备码" allowClear value={deviceKeyword} onChange={(event) => setDeviceKeyword(event.target.value)} style={{ width: 280 }} />
            <Select
              allowClear
              placeholder="设备状态"
              value={deviceStatus}
              onChange={setDeviceStatus}
              style={{ width: 140 }}
              options={[
                { value: "running", label: "运行中" },
                { value: "paused", label: "已暂停" },
                { value: "offline", label: "离线" },
                { value: "error", label: "异常" },
                { value: "idle", label: "未运行" }
              ]}
            />
          </Space>
          <Space wrap>
            {batchMode ? (
              <>
                <Button icon={<ReloadOutlined />} onClick={() => sendBatchCommand("REFRESH_CONFIG")}>刷新配置</Button>
                <Button icon={<PlayCircleOutlined />} onClick={() => sendBatchCommand("START")}>启动</Button>
                <Button icon={<PauseOutlined />} onClick={() => sendBatchCommand("PAUSE")}>暂停</Button>
                <Button icon={<PlayCircleOutlined />} onClick={() => sendBatchCommand("RESUME")}>恢复</Button>
                <Button danger icon={<StopOutlined />} onClick={() => sendBatchCommand("STOP")}>停止</Button>
                <Button onClick={leaveBatchMode}>退出批量</Button>
              </>
            ) : (
              <Button onClick={enterBatchMode}>批量操作</Button>
            )}
          </Space>
        </Space>
        {filteredSummaries.length === 0 ? <Empty description="暂无设备" /> : null}
        <Row gutter={[12, 12]}>
          {filteredSummaries.map((item) => (
            <Col xs={24} md={12} xl={8} key={item.deviceCode || item.deviceName}>
              <DeviceCard
                device={item}
                batchMode={batchMode}
                checked={!!item.deviceCode && checkedDeviceCodes.includes(item.deviceCode)}
                onCheck={() => toggleDeviceChecked(item.deviceCode)}
                onTargetRoom={() => void openTargetRoomEditor(item)}
                onOpen={() => {
                  if (batchMode) {
                    toggleDeviceChecked(item.deviceCode);
                    return;
                  }
                  setSelectedDevice(item);
                }}
              />
            </Col>
          ))}
        </Row>
      </Card>
      <TargetRoomModal
        open={targetRoomOpen}
        form={targetRoomForm}
        loading={targetRoomMutation.isPending}
        onCancel={closeTargetRoomEditor}
        onSave={saveTargetRoom}
      />
    </Space>
  );
}

function DeviceCard(props: {
  device: LiveCommentDeviceSummary;
  batchMode: boolean;
  checked: boolean;
  onCheck: () => void;
  onTargetRoom: () => void;
  onOpen: () => void;
}) {
  const item = props.device;
  return (
    <Card className="device-card" hoverable onClick={props.onOpen} style={{ borderColor: props.checked ? "#1677ff" : undefined }}>
      <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
        <Space align="start">
          {props.batchMode ? <Checkbox checked={props.checked} onClick={(event) => event.stopPropagation()} onChange={props.onCheck} /> : null}
          <Space direction="vertical" size={2}>
            <Typography.Text strong>{item.deviceName || item.deviceCode || "未知设备"}</Typography.Text>
            <Typography.Text type="secondary">{item.deviceCode || "-"}</Typography.Text>
          </Space>
        </Space>
        <Tag color={statusColor(item.deviceStatus)}>{statusText(item.deviceStatus)}</Tag>
      </Space>
      <Space style={{ marginTop: 12 }} wrap>
        <Button size="small" onClick={(event) => { event.stopPropagation(); props.onTargetRoom(); }}>指定直播间</Button>
      </Space>
      <Row gutter={12} className="card-stats">
        <Col span={6}><Statistic title="总数" value={item.totalCount} /></Col>
        <Col span={6}><Statistic title="计划" value={item.plannedCount} valueStyle={{ color: "#722ed1" }} /></Col>
        <Col span={6}><Statistic title="发送" value={item.sentCount} valueStyle={{ color: "#1677ff" }} /></Col>
        <Col span={6}><Statistic title="失败" value={item.failedCount} valueStyle={{ color: item.failedCount > 0 ? "#cf1322" : undefined }} /></Col>
        <Col span={6}><Statistic title="跳过" value={item.skippedCount} /></Col>
      </Row>
      <Typography.Text type="secondary">最近执行：{formatDateTime(item.latestActionAt)}</Typography.Text>
    </Card>
  );
}

function LiveActionTable(props: { actions: LiveCommentAction[] }) {
  return (
    <Table rowKey={(row) => String(row.id)} dataSource={props.actions} scroll={{ x: 1280 }} pagination={{ pageSize: 20 }}>
      <Table.Column title="时间" dataIndex="createdAt" width={180} render={(value) => formatDateTime(value as string | undefined)} />
      <Table.Column title="设备" width={160} render={(_, row) => (row as LiveCommentAction).deviceName || (row as LiveCommentAction).deviceCode || "-"} />
      <Table.Column title="直播间" dataIndex="roomName" width={160} render={(value) => shortText(value as string, 30) || "-"} />
      <Table.Column title="带头账号" dataIndex="leaderAccountName" width={140} render={(value) => value || "-"} />
      <Table.Column title="触发文本" dataIndex="triggerText" width={220} render={(value) => shortText(value as string, 60) || "-"} />
      <Table.Column title="评论话术" dataIndex="replyText" width={220} render={(value) => shortText(value as string, 60)} />
      <Table.Column title="延迟" dataIndex="plannedDelayMs" width={90} render={(value) => value == null ? "-" : `${value}ms`} />
      <Table.Column title="状态" dataIndex="status" width={100} render={(value) => <Tag color={actionStatusColor(value as string)}>{actionStatusText(value as string)}</Tag>} />
      <Table.Column title="原因" width={220} render={(_, row) => shortText((row as LiveCommentAction).failureReason || (row as LiveCommentAction).skipReason, 80) || "-"} />
      <Table.Column title="发送时间" dataIndex="sentAt" width={180} render={(value) => formatDateTime(value as string | undefined)} />
    </Table>
  );
}

function ProfileModal(props: {
  open: boolean;
  form: ReturnType<typeof Form.useForm<DeviceProfileFormValues>>[0];
  loading: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal title="编辑设备画像" open={props.open} onCancel={props.onCancel} onOk={props.onSave} confirmLoading={props.loading} okText="保存" cancelText="取消" width={760}>
      <Form form={props.form} layout="vertical">
        <Form.Item label="画像名称" name="profileName"><Input /></Form.Item>
        <Space.Compact style={{ width: "100%" }}>
          <Form.Item label="地区-省" name="regionProvince" style={{ width: "33.33%" }}><Input /></Form.Item>
          <Form.Item label="地区-市" name="regionCity" style={{ width: "33.33%" }}><Input /></Form.Item>
          <Form.Item label="地区-县" name="regionCounty" style={{ width: "33.33%" }}><Input /></Form.Item>
        </Space.Compact>
        <Space.Compact style={{ width: "100%" }}>
          <Form.Item label="身份" name="role" style={{ width: "50%" }}><Input /></Form.Item>
          <Form.Item label="种植年限" name="years" style={{ width: "50%" }}><InputNumber min={0} style={{ width: "100%" }} /></Form.Item>
        </Space.Compact>
        <Form.Item label="说话风格" name="tone"><Input /></Form.Item>
        <Form.Item label="主要农产品" name="products"><Input /></Form.Item>
        <Form.Item label="兴趣话题" name="interests"><Input.TextArea rows={3} placeholder="一行一个，也可用逗号分隔" /></Form.Item>
        <Form.Item label="禁用表达" name="forbiddenClaims"><Input.TextArea rows={3} placeholder="一行一个，也可用逗号分隔" /></Form.Item>
      </Form>
    </Modal>
  );
}

function TargetRoomModal(props: {
  open: boolean;
  form: ReturnType<typeof Form.useForm<TargetRoomFormValues>>[0];
  loading: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <Modal title="指定直播间测试配置" open={props.open} onCancel={props.onCancel} onOk={props.onSave} confirmLoading={props.loading} okText="保存" cancelText="取消" width={760}>
      <Form form={props.form} layout="vertical">
        <Form.Item label="启用指定直播间模式" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="主播账号名" name="anchorName">
          <Input placeholder="填写目标直播间主播昵称或账号名" />
        </Form.Item>
        <Form.Item label="直播间标题关键词" name="titleKeywords">
          <Input.TextArea rows={3} placeholder="一行一个，也可用逗号分隔" />
        </Form.Item>
        <Form.Item label="直播间画面关键词" name="roomKeywords">
          <Input.TextArea rows={3} placeholder="一行一个，也可用逗号分隔" />
        </Form.Item>
        <Form.Item label="允许真实发送" name="allowRealSend" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Space.Compact style={{ width: "100%" }}>
          <Form.Item label="最多发送条数" name="maxSendCount" style={{ width: "50%" }}>
            <InputNumber min={1} max={20} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="最小发送间隔秒" name="minSendIntervalSeconds" style={{ width: "50%" }}>
            <InputNumber min={10} max={3600} style={{ width: "100%" }} />
          </Form.Item>
        </Space.Compact>
      </Form>
    </Modal>
  );
}

function RefreshSelect(props: { value: number; onChange: (value: number) => void }) {
  return (
    <Select
      style={{ width: 130 }}
      value={props.value}
      onChange={props.onChange}
      options={[
        { label: "5秒刷新", value: 5 },
        { label: "15秒刷新", value: 15 },
        { label: "30秒刷新", value: 30 },
        { label: "暂停刷新", value: 0 }
      ]}
    />
  );
}
