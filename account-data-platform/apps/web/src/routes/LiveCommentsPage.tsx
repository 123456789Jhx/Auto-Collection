import { PauseOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Checkbox, Form, Input, InputNumber, Modal, Select, Skeleton, Space, Switch, message } from "antd";
import { useMemo, useState } from "react";
import { createMobileCommand, getDeviceTaskConfig, getLiveCommentActions, getLiveCommentDeviceSummary, updateDevice, updateDeviceTaskConfig } from "../lib/api-client";
import { statusText } from "../lib/display-maps";

type LiveCommentMode = "off" | "target_follow" | "agri_chatbot";

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
  reportedStatus?: string;
  currentTask?: "video" | "live" | "none";
  lastHeartbeatAt?: string | null;
  heartbeatAgeMinutes?: number | null;
  lastMessage?: string | null;
  liveCommentMode?: LiveCommentMode;
  configSource?: string;
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
  liveCommentMode?: LiveCommentMode;
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

function actionStatusTone(value?: string) {
  if (value === "sent") return "green";
  if (value === "failed") return "red";
  if (value === "skipped") return "amber";
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

function statusTone(value?: string | null) {
  if (value === "error" || value === "risk_control") return "red";
  if (value === "offline" || value === "stopped") return "gray";
  if (value === "paused" || value === "idle" || value === "booting" || value === "updating") return "amber";
  return "green";
}

const liveCommentModeOptions: Array<{ value: LiveCommentMode; label: string }> = [
  { value: "agri_chatbot", label: "账号机器人" },
  { value: "target_follow", label: "跟随评论" },
  { value: "off", label: "关闭" }
];

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
    mutationFn: ({ deviceId, commandType, payload }: { deviceId: string; commandType: CommandType; payload?: Record<string, unknown> }) =>
      createMobileCommand({
        deviceId,
        commandType,
        payload: {
          source: "live_comment_page",
          taskType: "live_comment_control",
          ...(payload || {})
        },
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
      sendCommand(variables.deviceCode, "REFRESH_CONFIG", { reenterTargetRoom: true });
      void queryClient.invalidateQueries({ queryKey: ["live-comment-task-config", selectedDevice?.deviceCode] });
      void queryClient.invalidateQueries({ queryKey: ["live-comment-device-summary"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  const modeMutation = useMutation({
    mutationFn: ({ deviceCode, liveCommentMode }: { deviceCode: string; liveCommentMode: LiveCommentMode }) =>
      updateDeviceTaskConfig(deviceCode, { liveCommentMode }, "douyin"),
    onSuccess: (_data, variables) => {
      messageApi.success(`评论模式已切换为：${liveCommentModeText(variables.liveCommentMode)}`);
      void queryClient.invalidateQueries({ queryKey: ["live-comment-task-config", variables.deviceCode] });
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

  function sendCommand(deviceCode: string | undefined, commandType: CommandType, payload?: Record<string, unknown>) {
    if (!deviceCode) return;
    commandMutation.mutate({ deviceId: deviceCode, commandType, payload });
  }

  function sendBatchCommand(commandType: CommandType) {
    if (checkedDeviceCodes.length === 0) {
      messageApi.warning("请先勾选设备");
      return;
    }
    checkedDeviceCodes.forEach((deviceCode) => commandMutation.mutate({ deviceId: deviceCode, commandType }));
  }

  function changeLiveCommentMode(deviceCode: string | undefined, liveCommentMode: LiveCommentMode) {
    if (!deviceCode) return;
    modeMutation.mutate({ deviceCode, liveCommentMode });
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

  const activeDevice = selectedDevice ?? filteredSummaries[0] ?? summaries[0] ?? null;
  const totalCount = summaries.reduce((sum, item) => sum + Number(item.totalCount || 0), 0);
  const plannedCount = summaries.reduce((sum, item) => sum + Number(item.plannedCount || 0), 0);
  const sentCount = summaries.reduce((sum, item) => sum + Number(item.sentCount || 0), 0);
  const failedCount = summaries.reduce((sum, item) => sum + Number(item.failedCount || 0), 0);
  const skippedCount = summaries.reduce((sum, item) => sum + Number(item.skippedCount || 0), 0);

  return (
    <div className="ops-page">
      {contextHolder}
      <header className="ops-topbar">
        <div>
          <h1>直播评论</h1>
          <p>按设备查看评论计划、发送、跳过和失败情况，目标直播间与账号画像放在右侧处理。</p>
        </div>
        <div className="ops-toolbar">
          {batchMode ? (
            <>
              <button className="ops-btn" type="button" onClick={() => sendBatchCommand("REFRESH_CONFIG")}><ReloadOutlined /> 刷新配置</button>
              <button className="ops-btn primary" type="button" onClick={() => sendBatchCommand("START")}><PlayCircleOutlined /> 启动</button>
              <button className="ops-btn" type="button" onClick={() => sendBatchCommand("PAUSE")}><PauseOutlined /> 暂停</button>
              <button className="ops-btn" type="button" onClick={() => sendBatchCommand("RESUME")}><PlayCircleOutlined /> 恢复</button>
              <button className="ops-btn danger" type="button" onClick={() => sendBatchCommand("STOP")}><StopOutlined /> 停止</button>
              <button className="ops-btn" type="button" onClick={leaveBatchMode}>退出批量</button>
            </>
          ) : (
            <button className="ops-btn" type="button" onClick={enterBatchMode}>批量操作</button>
          )}
          <select className="ops-input" value={autoRefreshSeconds} onChange={(event) => setAutoRefreshSeconds(Number(event.currentTarget.value))}>
            <option value={5}>5秒刷新</option>
            <option value={15}>15秒刷新</option>
            <option value={30}>30秒刷新</option>
            <option value={0}>暂停刷新</option>
          </select>
        </div>
      </header>

      <section className="ops-stats">
        <div className="ops-stat"><div className="ops-stat-label">总记录</div><div className="ops-stat-value">{totalCount}</div><div className="ops-stat-note">计划、发送、跳过、失败总量</div></div>
        <div className="ops-stat"><div className="ops-stat-label">已计划</div><div className="ops-stat-value">{plannedCount}</div><div className="ops-stat-note">等待执行或真实发送</div></div>
        <div className="ops-stat"><div className="ops-stat-label">已发送</div><div className="ops-stat-value ok">{sentCount}</div><div className="ops-stat-note">手机已执行发送</div></div>
        <div className="ops-stat"><div className="ops-stat-label">跳过</div><div className="ops-stat-value warn">{skippedCount}</div><div className="ops-stat-note">规则判断不适合发送</div></div>
        <div className="ops-stat"><div className="ops-stat-label">失败</div><div className="ops-stat-value danger">{failedCount}</div><div className="ops-stat-note">需要排查账号或直播间</div></div>
      </section>

      <section className="ops-filter-panel three">
        <div className="ops-field">
          <label htmlFor="live-device-keyword">设备搜索</label>
          <input id="live-device-keyword" className="ops-input" placeholder="设备名称 / 设备码" value={deviceKeyword} onChange={(event) => setDeviceKeyword(event.currentTarget.value)} />
        </div>
        <div className="ops-field">
          <label htmlFor="live-device-status">设备状态</label>
          <select id="live-device-status" className="ops-input" value={deviceStatus ?? ""} onChange={(event) => setDeviceStatus(event.currentTarget.value || undefined)}>
            <option value="">全部状态</option>
            <option value="running">运行中</option>
            <option value="paused">已暂停</option>
            <option value="offline">离线</option>
            <option value="error">异常</option>
            <option value="idle">未运行</option>
          </select>
        </div>
        <div className="ops-field">
          <label htmlFor="live-action-status">执行状态</label>
          <select id="live-action-status" className="ops-input" value={status ?? ""} onChange={(event) => setStatus(event.currentTarget.value || undefined)}>
            <option value="">全部状态</option>
            <option value="planned">已计划</option>
            <option value="sent">已发送</option>
            <option value="failed">失败</option>
            <option value="skipped">跳过</option>
          </select>
        </div>
        <button className="ops-btn" type="button" onClick={() => { void summaryQuery.refetch(); void actionsQuery.refetch(); }}>应用筛选</button>
      </section>

      <section className="ops-workbench wide-side">
        <div className="ops-main">
          <div className="ops-panel">
            <div className="ops-panel-head">
              <span>设备评论状态</span>
              <span className="ops-small">{filteredSummaries.length} 台</span>
            </div>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>设备</th>
                    <th>模式 / 来源</th>
                    <th>设备状态</th>
                    <th>计划 / 发送 / 失败</th>
                    <th>最近执行</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSummaries.length === 0 ? <tr><td className="ops-empty" colSpan={6}>暂无设备</td></tr> : null}
                  {filteredSummaries.map((item) => (
                    <tr key={item.deviceCode || item.deviceName} className={item.deviceCode === activeDevice?.deviceCode ? "selected" : ""} onClick={() => {
                      if (batchMode) {
                        toggleDeviceChecked(item.deviceCode);
                        return;
                      }
                      setSelectedDevice(item);
                    }}>
                      <td>
                        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                          {batchMode ? <Checkbox checked={!!item.deviceCode && checkedDeviceCodes.includes(item.deviceCode)} onClick={(event) => event.stopPropagation()} onChange={() => toggleDeviceChecked(item.deviceCode)} /> : null}
                          <div><div className="ops-title">{item.deviceName || item.deviceCode || "未知设备"}</div><div className="ops-small">{item.deviceCode || "-"}</div></div>
                        </div>
                      </td>
                      <td>
                        <div onClick={(event) => event.stopPropagation()}>
                          <Select size="small" value={item.liveCommentMode || "agri_chatbot"} options={liveCommentModeOptions} style={{ width: 120 }} onChange={(mode) => changeLiveCommentMode(item.deviceCode, mode)} />
                        </div>
                        <div className="ops-small">{configSourceText(item.configSource)}</div>
                      </td>
                      <td><span className={`ops-tag ${statusTone(item.deviceStatus)}`}>{statusText(item.deviceStatus)}</span></td>
                      <td>{item.plannedCount} / {item.sentCount} / <span style={{ color: item.failedCount > 0 ? "#b91c1c" : undefined }}>{item.failedCount}</span></td>
                      <td>
                        <div>{formatDateTime(item.latestActionAt)}</div>
                        <div className="ops-small">{item.lastMessage || "暂无心跳消息"}</div>
                      </td>
                      <td>
                        <div className="ops-actions-cell" onClick={(event) => event.stopPropagation()}>
                          <button className="ops-mini-btn" type="button" onClick={() => void openTargetRoomEditor(item)}>指定直播间</button>
                          <button className="ops-mini-btn primary" type="button" onClick={() => { setSelectedDevice(item); sendCommand(item.deviceCode, "START"); }}>启动</button>
                          <button className="ops-mini-btn" type="button" onClick={() => sendCommand(item.deviceCode, "REFRESH_CONFIG")}>刷新配置</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="ops-panel">
            <div className="ops-panel-head">
              <span>{activeDevice ? `${activeDevice.deviceName || activeDevice.deviceCode} 执行记录` : "执行记录"}</span>
              <input className="ops-input" style={{ maxWidth: 260 }} placeholder="直播间 / 账号 / 话术" value={recordKeyword} onChange={(event) => setRecordKeyword(event.currentTarget.value)} />
            </div>
            {actionsQuery.isLoading ? <div className="ops-panel-body"><Skeleton active /></div> : null}
            {actionsQuery.isError ? <div className="ops-panel-body"><Alert type="error" message="执行记录加载失败" description={actionsQuery.error.message} showIcon /></div> : null}
            {!actionsQuery.isLoading && !actionsQuery.isError ? <LiveActionTable actions={actions} /> : null}
          </div>
        </div>

        <aside className="ops-panel">
          <div className="ops-panel-head">
            <span>评论详情</span>
            <span className={`ops-tag ${statusTone(activeDevice?.deviceStatus)}`}>{statusText(activeDevice?.deviceStatus)}</span>
          </div>
          <div className="ops-panel-body">
            {activeDevice ? (
              <>
                <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{activeDevice.deviceName || activeDevice.deviceCode}</h2>
                <div className="ops-kv">
                  <div className="ops-k">设备编号</div><div>{activeDevice.deviceCode || "-"}</div>
                  <div className="ops-k">评论模式</div><div>{liveCommentModeText(selectedConfig?.liveCommentMode || activeDevice.liveCommentMode)}</div>
                  <div className="ops-k">配置来源</div><div>{configSourceText(selectedConfig?.source || activeDevice.configSource)}</div>
                  <div className="ops-k">最近心跳</div><div>{formatDateTime(activeDevice.lastHeartbeatAt)}</div>
                  <div className="ops-k">最近消息</div><div>{activeDevice.lastMessage || "-"}</div>
                </div>
                <div className="ops-mini-stats">
                  <div className="ops-mini-stat"><span>计划</span><strong>{activeDevice.plannedCount}</strong></div>
                  <div className="ops-mini-stat"><span>发送</span><strong>{activeDevice.sentCount}</strong></div>
                  <div className="ops-mini-stat"><span>失败</span><strong>{activeDevice.failedCount}</strong></div>
                </div>
                <div className="ops-toolbar detail-toolbar">
                  <button className="ops-btn primary" type="button" onClick={() => sendCommand(activeDevice.deviceCode, "START")}>启动</button>
                  <button className="ops-btn" type="button" onClick={() => sendCommand(activeDevice.deviceCode, "PAUSE")}>暂停</button>
                  <button className="ops-btn" type="button" onClick={() => sendCommand(activeDevice.deviceCode, "RESUME")}>恢复</button>
                  <button className="ops-btn danger" type="button" onClick={() => sendCommand(activeDevice.deviceCode, "STOP")}>停止</button>
                  <button className="ops-btn" type="button" onClick={() => void openTargetRoomEditor(activeDevice)}>指定直播间</button>
                  <button className="ops-btn" type="button" onClick={() => { setSelectedDevice(activeDevice); openProfileEditor(); }}>编辑画像</button>
                </div>
                <div className="ops-panel-note" style={{ marginTop: 14 }}>设备画像摘要</div>
                <div className="ops-kv" style={{ marginTop: 8 }}>
                  <div className="ops-k">画像名称</div><div>{String(selectedProfile.profileName || "-")}</div>
                  <div className="ops-k">地区</div><div>{[getProfileField(selectedProfile, ["region", "province"]), getProfileField(selectedProfile, ["region", "city"]), getProfileField(selectedProfile, ["region", "county"])].filter(Boolean).join(" / ") || "-"}</div>
                  <div className="ops-k">身份</div><div>{getProfileField(selectedProfile, ["identity", "role"]) || "-"}</div>
                  <div className="ops-k">农产品</div><div>{Array.isArray(selectedProfile.products) && selectedProfile.products.length > 0 ? String((selectedProfile.products[0] as Record<string, unknown>)?.name || "-") : "-"}</div>
                </div>
                <div className="ops-panel-note" style={{ marginTop: 14 }}>公共模板</div>
                <div className="ops-kv" style={{ marginTop: 8 }}>
                  <div className="ops-k">每直播间</div><div>{numberFromConfig(selectedConfig?.liveCommentBotConfig, "maxCommentsPerRoom", 3)} 条</div>
                  <div className="ops-k">每小时</div><div>{numberFromConfig(selectedConfig?.liveCommentBotConfig, "maxCommentsPerHour", 10)} 条</div>
                  <div className="ops-k">最小间隔</div><div>{numberFromConfig(selectedConfig?.liveCommentBotConfig, "minIntervalSeconds", 120)} 秒</div>
                  <div className="ops-k">相关阈值</div><div>{numberFromConfig(selectedConfig?.liveCommentBotConfig, "roomRelevanceThreshold", 60)}</div>
                </div>
              </>
            ) : <div className="ops-empty">暂无设备</div>}
          </div>
        </aside>
      </section>

      <TargetRoomModal
        open={targetRoomOpen}
        form={targetRoomForm}
        loading={targetRoomMutation.isPending}
        onCancel={closeTargetRoomEditor}
        onSave={saveTargetRoom}
      />
      <ProfileModal open={profileOpen} form={profileForm} loading={deviceMutation.isPending} onCancel={() => setProfileOpen(false)} onSave={saveProfile} />
    </div>
  );
}

function LiveActionTable(props: { actions: LiveCommentAction[] }) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>直播间</th>
            <th>触发内容</th>
            <th>评论话术</th>
            <th>状态</th>
            <th>原因 / 发送时间</th>
          </tr>
        </thead>
        <tbody>
          {props.actions.length === 0 ? <tr><td className="ops-empty" colSpan={6}>暂无直播评论执行记录</td></tr> : null}
          {props.actions.map((item) => (
            <tr key={item.id}>
              <td>{formatDateTime(item.createdAt)}</td>
              <td>
                <div className="ops-title">{shortText(item.roomName, 30) || "-"}</div>
                <div className="ops-small">{item.leaderAccountName || "-"}</div>
              </td>
              <td>{shortText(item.triggerText, 60) || "-"}</td>
              <td>{shortText(item.replyText, 60)}</td>
              <td><span className={`ops-tag ${actionStatusTone(item.status)}`}>{actionStatusText(item.status)}</span></td>
              <td>
                <div>{shortText(item.failureReason || item.skipReason, 80) || "-"}</div>
                <div className="ops-small">{formatDateTime(item.sentAt)}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
