import { MoreOutlined, PauseOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined, SyncOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Dropdown, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Space, Switch, Table, Tag, Tooltip, message } from "antd";
import { useState } from "react";
import { createMobileCommand, getDeviceTaskConfig, getDevices, updateDevice, updateDeviceTaskConfig } from "../lib/api-client";
import { statusColor, statusText } from "../lib/display-maps";
import { defaultLiveCommentBotConfig, parseLiveCommentConfig, parseP3ExtensionsConfig, stringifyLiveCommentConfig, stringifyP3ExtensionsConfig } from "../lib/live-comment-config";

type DeviceRow = {
  id: string;
  deviceCode: string;
  deviceName?: string;
  platform?: string;
  status: string;
  reportedStatus?: string;
  currentTask?: "video" | "live" | "none";
  effectiveStatus: string;
  lastHeartbeatAt?: string;
  heartbeatAgeMinutes?: number | null;
  appVersion?: string | null;
  targetVersion?: string | null;
  enabled?: boolean;
  lastIp?: string | null;
  lastRegion?: string | null;
  remark?: string | null;
  accountProfile?: Record<string, unknown> | null;
};

type TaskRow = {
  taskId?: string;
  taskCode?: string;
  source?: string;
  platform?: string;
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  autoStart?: boolean;
  commentLimit?: number;
  heartbeatMinutes?: number;
  liveCommentRole?: "none" | "followed" | "follower";
  liveCommentGroup?: "A" | "B" | "C" | null;
  liveCommentMode?: "off" | "target_follow" | "agri_chatbot";
  liveCommentBotConfig?: Record<string, unknown> | null;
  followedAccountName?: string | null;
  followedAccountId?: string | null;
  followedAliases?: string[] | null;
  liveCommentConfig?: Record<string, unknown> | null;
  p3ExtensionsConfig?: Record<string, unknown> | null;
};

type DeviceConfigFormValues = Partial<TaskRow> & {
  followedAliasesText?: string;
  liveCommentBotConfigText?: string;
  liveCommentConfigText?: string;
  p3ExtensionsConfigText?: string;
};

type DeviceTaskConfigPayload = {
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  autoStart?: boolean;
  commentLimit?: number;
  heartbeatMinutes?: number;
  liveCommentRole?: "none" | "followed" | "follower";
  liveCommentGroup?: "A" | "B" | "C" | null;
  liveCommentMode?: "off" | "target_follow" | "agri_chatbot";
  liveCommentBotConfig?: Record<string, unknown> | null;
  followedAccountName?: string | null;
  followedAccountId?: string | null;
  followedAliases?: string[] | null;
  liveCommentConfig?: Record<string, unknown>;
  p3ExtensionsConfig?: Record<string, unknown>;
};

type DeviceFormValues = {
  deviceName?: string;
  enabled?: boolean;
  lastRegion?: string;
  remark?: string;
  accountProfileText?: string;
};

type DevicePayload = {
  deviceName?: string;
  enabled?: boolean;
  lastRegion?: string;
  remark?: string;
  accountProfile?: Record<string, unknown> | null;
};

type CommandType =
  | "START"
  | "PAUSE"
  | "RESUME"
  | "STOP"
  | "REFRESH_CONFIG"
  | "STATUS"
  | "RESTART_APP"
  | "RESTART_AGENT"
  | "CHECK_UPDATE"
  | "UPDATE_AGENT";

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function parseAliasText(value?: string) {
  return (value || "")
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function parseJsonObject(raw: string, label: string) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "{}");
  } catch {
    return { ok: false as const, error: `${label} JSON 格式不正确` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false as const, error: `${label} 必须是 JSON 对象` };
  }
  return { ok: true as const, value: parsed as Record<string, unknown> };
}

const defaultAccountProfile = {
  profileName: "三农交流账号",
  region: { province: "", city: "", county: "" },
  identity: { role: "种植户", years: 5, tone: "朴实、自然、接地气" },
  products: [{ name: "水稻", scale: "几十亩", topics: ["病虫害", "水肥管理"] }],
  interests: ["三农", "种植", "农产品"],
  speakingStyle: { length: "short", emojiAllowed: false, questionRatio: 0.4 },
  forbiddenClaims: ["夸大收益", "保证效果", "诱导私信", "售卖农资"],
  status: "enabled"
};

export function DevicesPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [configOpen, setConfigOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<DeviceRow | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(15);
  const [form] = Form.useForm<DeviceConfigFormValues>();
  const [deviceForm] = Form.useForm<DeviceFormValues>();
  const query = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    refetchInterval: autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });
  const commandMutation = useMutation({
    mutationFn: ({ deviceId, commandType }: { deviceId: string; commandType: CommandType }) =>
      createMobileCommand({ deviceId, commandType, expiresInSeconds: 3600 }),
    onSuccess: () => {
      messageApi.success("控制指令已下发，等待手机脚本拉取");
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });
  const configMutation = useMutation({
    mutationFn: ({ deviceCode, platform, values }: { deviceCode: string; platform?: string; values: DeviceTaskConfigPayload }) =>
      updateDeviceTaskConfig(deviceCode, values, platform),
    onSuccess: () => {
      messageApi.success("设备脚本参数已保存，并已自动下发刷新配置指令");
      setConfigOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });
  const deviceMutation = useMutation({
    mutationFn: ({ deviceCode, values }: { deviceCode: string; values: DevicePayload }) => updateDevice(deviceCode, values),
    onSuccess: () => {
      messageApi.success("设备信息已保存");
      setDeviceOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  function sendCommand(deviceCode: string, commandType: CommandType) {
    commandMutation.mutate({ deviceId: deviceCode, commandType });
  }

  async function manualRefresh() {
    try {
      const result = await query.refetch();
      if (result.error) {
        messageApi.error(result.error.message);
        return;
      }
      messageApi.success("设备列表已刷新");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "设备列表刷新失败");
    }
  }

  async function openConfig(device: DeviceRow) {
    setCurrentDevice(device);
    const task = (await getDeviceTaskConfig(device.deviceCode, device.platform ?? "douyin")) as TaskRow;
    form.setFieldsValue({
      heartbeatMinutes: task?.heartbeatMinutes ?? 1,
      videoMinutesMin: task?.videoMinutesMin ?? 120,
      videoMinutesMax: task?.videoMinutesMax ?? 180,
      liveMinutesMin: task?.liveMinutesMin ?? 60,
      liveMinutesMax: task?.liveMinutesMax ?? 120,
      autoStart: task?.autoStart ?? false,
      commentLimit: task?.commentLimit ?? 10,
      liveCommentRole: task?.liveCommentRole ?? "none",
      liveCommentGroup: task?.liveCommentGroup ?? "A",
      liveCommentMode: task?.liveCommentMode ?? "agri_chatbot",
      liveCommentBotConfigText: JSON.stringify(task?.liveCommentBotConfig || defaultLiveCommentBotConfig, null, 2),
      followedAccountName: task?.followedAccountName ?? "",
      followedAccountId: task?.followedAccountId ?? "",
      followedAliasesText: (task?.followedAliases ?? []).join("\n"),
      liveCommentConfigText: stringifyLiveCommentConfig(task?.liveCommentConfig),
      p3ExtensionsConfigText: stringifyP3ExtensionsConfig(task?.p3ExtensionsConfig)
    });
    setConfigOpen(true);
  }

  function openDeviceEditor(device: DeviceRow) {
    setCurrentDevice(device);
    deviceForm.setFieldsValue({
      deviceName: device.deviceName || device.deviceCode,
      enabled: device.enabled !== false,
      lastRegion: device.lastRegion || "",
      remark: device.remark || "",
      accountProfileText: JSON.stringify(device.accountProfile || defaultAccountProfile, null, 2)
    });
    setDeviceOpen(true);
  }

  function saveDevice() {
    if (!currentDevice?.deviceCode) {
      messageApi.error("未找到当前设备");
      return;
    }
    const values = deviceForm.getFieldsValue();
    const profile = parseJsonObject(values.accountProfileText || "{}", "账号画像");
    if (!profile.ok) {
      messageApi.error(profile.error);
      return;
    }
    deviceMutation.mutate({
      deviceCode: currentDevice.deviceCode,
      values: {
        deviceName: values.deviceName,
        enabled: values.enabled,
        lastRegion: values.lastRegion,
        remark: values.remark,
        accountProfile: profile.value
      }
    });
  }

  function saveConfig() {
    if (!currentDevice?.deviceCode) {
      messageApi.error("未找到当前设备");
      return;
    }
    const values = form.getFieldsValue();
    const parsed = parseLiveCommentConfig(values.liveCommentConfigText || "{}");
    if (!parsed.ok) {
      messageApi.error(parsed.error);
      return;
    }
    const parsedP3 = parseP3ExtensionsConfig(values.p3ExtensionsConfigText || "{}");
    if (!parsedP3.ok) {
      messageApi.error(parsedP3.error);
      return;
    }
    const parsedBot = parseJsonObject(values.liveCommentBotConfigText || "{}", "直播聊天机器人配置");
    if (!parsedBot.ok) {
      messageApi.error(parsedBot.error);
      return;
    }

    const payload: DeviceTaskConfigPayload = {
      heartbeatMinutes: values.heartbeatMinutes,
      videoMinutesMin: values.videoMinutesMin,
      videoMinutesMax: values.videoMinutesMax,
      liveMinutesMin: values.liveMinutesMin,
      liveMinutesMax: values.liveMinutesMax,
      autoStart: values.autoStart,
      commentLimit: values.commentLimit,
      liveCommentRole: values.liveCommentRole ?? "none",
      liveCommentGroup: values.liveCommentGroup ?? "A",
      liveCommentMode: values.liveCommentMode ?? "agri_chatbot",
      liveCommentBotConfig: parsedBot.value,
      followedAccountName: values.followedAccountName?.trim() || null,
      followedAccountId: values.followedAccountId?.trim() || null,
      followedAliases: parseAliasText(values.followedAliasesText),
      liveCommentConfig: parsed.value,
      p3ExtensionsConfig: parsedP3.value
    };
    configMutation.mutate({ deviceCode: currentDevice.deviceCode, platform: currentDevice.platform ?? "douyin", values: payload });
  }

  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" message="设备列表加载失败" description={query.error.message} showIcon />;

  const devices = ((query.data ?? []) as DeviceRow[]).filter((item) => {
    const text = `${item.deviceCode} ${item.deviceName ?? ""} ${item.platform ?? ""}`.toLowerCase();
    const matchedKeyword = !keyword || text.includes(keyword.toLowerCase());
    const matchedStatus = !statusFilter || item.effectiveStatus === statusFilter || item.reportedStatus === statusFilter;
    return matchedKeyword && matchedStatus;
  });

  return (
    <Card title="设备状态">
      {contextHolder}
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Space wrap>
          <Input.Search placeholder="搜索设备编号/名称" allowClear style={{ width: 260 }} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 150 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: "运行中", value: "running" },
              { label: "待命", value: "idle" },
              { label: "暂停", value: "paused" },
              { label: "离线", value: "offline" },
              { label: "异常", value: "error" }
            ]}
          />
          <Select
            style={{ width: 150 }}
            value={autoRefreshSeconds}
            onChange={setAutoRefreshSeconds}
            options={[
              { label: "5秒刷新", value: 5 },
              { label: "15秒刷新", value: 15 },
              { label: "30秒刷新", value: 30 },
              { label: "暂停刷新", value: 0 }
            ]}
          />
        </Space>
        <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void manualRefresh()}>
          手动刷新
        </Button>
      </Space>
      <Table<DeviceRow> rowKey={(row) => String(row.id)} dataSource={devices} scroll={{ x: 1180 }} pagination={{ pageSize: 10 }}>
        <Table.Column<DeviceRow>
          title="设备"
          fixed="left"
          width={220}
          render={(_, device) => (
            <Space direction="vertical" size={0}>
              <strong>{device.deviceName || device.deviceCode}</strong>
              <span style={{ color: "#6b7280", fontSize: 12 }}>{device.deviceCode}</span>
            </Space>
          )}
        />
        <Table.Column<DeviceRow>
          title="当前状态"
          dataIndex="effectiveStatus"
          width={110}
          render={(value) => <Tag color={statusColor(value)}>{statusText(value)}</Tag>}
        />
        <Table.Column<DeviceRow>
          title="当前任务"
          dataIndex="currentTask"
          width={120}
          render={(value) => {
            if (value === "video") return <Tag color="blue">视频</Tag>;
            if (value === "live") return <Tag color="purple">直播</Tag>;
            return <Tag>未执行任务</Tag>;
          }}
        />
        <Table.Column<DeviceRow> title="平台" dataIndex="platform" width={90} render={(value) => value || "-"} />
        <Table.Column<DeviceRow> title="启用" dataIndex="enabled" width={80} render={(value) => <Tag color={value === false ? "red" : "green"}>{value === false ? "禁用" : "启用"}</Tag>} />
        <Table.Column<DeviceRow> title="最近 IP" dataIndex="lastIp" width={140} render={(value) => value || "-"} />
        <Table.Column<DeviceRow> title="最后心跳" width={190} render={(_, device) => <span>{formatDateTime(device.lastHeartbeatAt)}</span>} />
        <Table.Column<DeviceRow> title="版本" width={150} render={(_, device) => `${device.appVersion || "-"} / ${device.targetVersion || "-"}`} />
        <Table.Column<DeviceRow>
          title="控制"
          fixed="right"
          width={360}
          render={(_, device) => (
            <Space size={6} wrap>
              <Tooltip title="启动或继续今天的采集任务，Agent 脚本保持常驻">
                <Button size="small" icon={<PlayCircleOutlined />} onClick={() => sendCommand(device.deviceCode, "START")}>
                  启动/继续任务
                </Button>
              </Tooltip>
              <Tooltip title="暂停当前采集任务，Agent 脚本继续常驻">
                <Button size="small" icon={<PauseOutlined />} onClick={() => sendCommand(device.deviceCode, "PAUSE")}>
                  暂停任务
                </Button>
              </Tooltip>
              <Tooltip title="查看并修改当前平台脚本参数">
                <Button size="small" onClick={() => void openConfig(device)}>
                  脚本参数
                </Button>
              </Tooltip>
              <Tooltip title="编辑设备名称、部署区域和备注">
                <Button size="small" onClick={() => openDeviceEditor(device)}>
                  设备信息
                </Button>
              </Tooltip>
              <Popconfirm
                title="确认关闭手机 Agent 脚本？"
                description="关闭后后台将无法继续下发任务，除非本地或守护脚本重新拉起。"
                okText="确认关闭"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => sendCommand(device.deviceCode, "STOP")}
              >
                <Button size="small" danger icon={<StopOutlined />}>
                  关闭脚本
                </Button>
              </Popconfirm>
              <Dropdown
                menu={{
                  items: [
                    { key: "REFRESH_CONFIG", icon: <SyncOutlined />, label: "刷新配置" },
                    { key: "CHECK_UPDATE", icon: <SyncOutlined />, label: "检查版本" },
                    { key: "UPDATE_AGENT", icon: <SyncOutlined />, label: "更新脚本" },
                    { key: "RESTART_APP", icon: <ReloadOutlined />, label: "故障重启抖音" }
                  ],
                  onClick: ({ key }) => {
                    sendCommand(device.deviceCode, key as "REFRESH_CONFIG" | "CHECK_UPDATE" | "UPDATE_AGENT" | "RESTART_APP");
                  }
                }}
              >
                <Button size="small" icon={<MoreOutlined />} />
              </Dropdown>
            </Space>
          )}
        />
      </Table>
      <Modal
        title={currentDevice ? `${currentDevice.deviceName || currentDevice.deviceCode} 脚本参数` : "脚本参数"}
        open={configOpen}
        onOk={saveConfig}
        confirmLoading={configMutation.isPending}
        onCancel={() => setConfigOpen(false)}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="心跳发送间隔（分钟）" name="heartbeatMinutes" rules={[{ required: true, message: "请输入心跳发送间隔" }]}>
            <InputNumber min={1} max={60} style={{ width: "100%" }} />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item label="视频随机下限（分钟）" name="videoMinutesMin" rules={[{ required: true, message: "请输入视频时长下限" }]} style={{ width: "50%" }}>
              <InputNumber min={120} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="视频随机上限（分钟）" name="videoMinutesMax" rules={[{ required: true, message: "请输入视频时长上限" }]} style={{ width: "50%" }}>
              <InputNumber min={120} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item label="直播随机下限（分钟）" name="liveMinutesMin" rules={[{ required: true, message: "请输入直播时长下限" }]} style={{ width: "50%" }}>
              <InputNumber min={60} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="直播随机上限（分钟）" name="liveMinutesMax" rules={[{ required: true, message: "请输入直播时长上限" }]} style={{ width: "50%" }}>
              <InputNumber min={60} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item label="Agent 启动后自动执行任务" name="autoStart" valuePropName="checked">
            <Switch checkedChildren="自动执行" unCheckedChildren="只常驻" />
          </Form.Item>
          <Form.Item label="评论采集数量" name="commentLimit" rules={[{ required: true, message: "请输入评论采集数量" }]}>
            <InputNumber min={0} max={50} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="直播身份" name="liveCommentRole" rules={[{ required: true, message: "请选择直播身份" }]}>
            <Select
              options={[
                { label: "普通机器人账号", value: "none" },
                { label: "目标跟随实验：被跟随", value: "followed" },
                { label: "目标跟随实验：跟随者", value: "follower" }
              ]}
            />
          </Form.Item>
          <Form.Item label="直播评论模式" name="liveCommentMode" rules={[{ required: true, message: "请选择直播评论模式" }]}>
            <Select
              options={[
                { label: "账号机器人", value: "agri_chatbot" },
                { label: "关闭", value: "off" },
                { label: "目标跟随", value: "target_follow" }
              ]}
            />
          </Form.Item>
          <Form.Item label="话术组" name="liveCommentGroup" rules={[{ required: true, message: "请选择话术组" }]}>
            <Select
              options={[
                { label: "A 组", value: "A" },
                { label: "B 组", value: "B" },
                { label: "C 组", value: "C" }
              ]}
            />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item label="目标跟随实验：目标号昵称" name="followedAccountName" style={{ width: "50%" }}>
              <Input maxLength={100} placeholder="仅 target_follow 模式使用" />
            </Form.Item>
            <Form.Item label="目标跟随实验：目标号 ID/抖音号" name="followedAccountId" style={{ width: "50%" }}>
              <Input maxLength={100} placeholder="仅 target_follow 模式使用" />
            </Form.Item>
          </Space.Compact>
          <Form.Item label="目标跟随实验：目标号别名" name="followedAliasesText">
            <Input.TextArea rows={3} maxLength={1000} placeholder="仅 target_follow 模式使用，一行一个，也可用逗号分隔" />
          </Form.Item>
          <Form.Item label="设备级直播聊天机器人配置 JSON" name="liveCommentBotConfigText">
            <Input.TextArea rows={10} spellCheck={false} />
          </Form.Item>
          <Form.Item label="设备级直播评论配置 JSON" name="liveCommentConfigText">
            <Input.TextArea rows={14} spellCheck={false} />
          </Form.Item>
          <Form.Item label="设备级 P3 扩展配置 JSON" name="p3ExtensionsConfigText">
            <Input.TextArea rows={12} spellCheck={false} />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            message="设备级配置会覆盖任务默认配置"
            description="当前主线是 agri_chatbot：每台设备使用自己的账号画像在三农相关直播间生成 planned/skipped 记录。真实评论默认关闭，测试真实发送时需要显式开启 executeEnabled 和 manualExecutionApproved，并从手机端或后台启动直播评论控制。"
          />
        </Form>
      </Modal>
      <Modal
        title={currentDevice ? `${currentDevice.deviceName || currentDevice.deviceCode} 设备信息` : "设备信息"}
        open={deviceOpen}
        onOk={saveDevice}
        confirmLoading={deviceMutation.isPending}
        onCancel={() => setDeviceOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={deviceForm} layout="vertical">
          <Form.Item label="设备名称" name="deviceName" rules={[{ required: true, message: "请输入设备名称" }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="设备状态" name="enabled">
            <Select
              options={[
                { label: "启用", value: true },
                { label: "禁用", value: false }
              ]}
            />
          </Form.Item>
          <Form.Item label="部署区域" name="lastRegion">
            <Input maxLength={100} placeholder="例如 广东广州、山东寿光" />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea maxLength={500} rows={4} />
          </Form.Item>
          <Form.Item label="账号画像 JSON" name="accountProfileText">
            <Input.TextArea rows={14} spellCheck={false} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
