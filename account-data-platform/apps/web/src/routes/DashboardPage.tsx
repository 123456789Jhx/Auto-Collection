import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Skeleton, message } from "antd";
import { PauseOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined, SyncOutlined } from "@ant-design/icons";
import { useMemo, useState } from "react";
import { createMobileCommand, getDeviceDailyProgress, getDeviceProgressHistory, getOverview } from "../lib/api-client";
import { deviceDisplayName, deviceSubTitle, sceneText, statusText } from "../lib/display-maps";

type DeviceProgress = {
  id: string;
  deviceCode: string;
  deviceName?: string;
  douyinAccountName?: string | null;
  status?: string;
  currentTask?: string;
  videoElapsedMinutes?: number | null;
  videoRemainingMinutes?: number | null;
  plannedVideoMinutes?: number | null;
  liveElapsedMinutes?: number | null;
  liveRemainingMinutes?: number | null;
  plannedLiveMinutes?: number | null;
  viewedCount?: number;
  liveViewedCount?: number;
  capturedCount?: number;
  todayLogCount?: number;
  todayWarnCount?: number;
  todayErrorCount?: number;
  latestLogAt?: string | null;
  logFileCount?: number;
  logFileSizeBytes?: number;
  latestFileUploadedAt?: string | null;
  lastHeartbeatAt?: string | null;
  heartbeat?: {
    lastMessage?: string | null;
    rawPayload?: Record<string, unknown> | null;
  } | null;
};

type HeartbeatHistory = {
  id: string;
  status?: string;
  sceneType?: string | null;
  lastMessage?: string | null;
  reportedAt?: string | null;
  createdAt?: string | null;
};

type DailyProgress = {
  progressDate: string;
  latestHeartbeatAt?: string | null;
  maxVideoElapsedMinutes?: number;
  maxVideoPlannedMinutes?: number;
  maxLiveElapsedMinutes?: number;
  maxLivePlannedMinutes?: number;
  maxViewedCount?: number;
  maxLiveViewedCount?: number;
  maxCapturedCount?: number;
  errorCount?: number;
  lastMessage?: string | null;
};

type CommandType = "START" | "PAUSE" | "RESUME" | "STOP" | "REFRESH_CONFIG";
type FeatureTone = "ok" | "warn" | "danger" | "idle";

type FeatureStatus = {
  label: string;
  text: string;
  note: string;
  tone: FeatureTone;
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function progressPercent(elapsed?: number | null, remaining?: number | null, planned?: number | null) {
  const used = Number(elapsed ?? 0);
  const total = planned && planned > 0 ? planned : used + Math.max(0, Number(remaining ?? 0));
  if (used <= 0 && total <= 0) return 0;
  if (total <= 0) return 100;
  return Math.min(100, Math.round((used / total) * 100));
}

function progressLabel(elapsed?: number | null, remaining?: number | null, planned?: number | null) {
  const used = Number(elapsed ?? 0);
  const total = planned && planned > 0 ? planned : used + Math.max(0, Number(remaining ?? 0));
  if (used <= 0 && total <= 0) return "未开始";
  if (total > 0) return `${used} / ${total} 分钟`;
  return `${used} 分钟`;
}

function currentTaskText(value?: string) {
  return value && value !== "none" ? sceneText(value) : "待命";
}

function statusTone(value?: string | null) {
  if (value === "error" || value === "risk_control") return "red";
  if (value === "offline" || value === "stopped") return "gray";
  if (value === "paused" || value === "idle" || value === "booting" || value === "updating") return "amber";
  return "green";
}

function taskTone(value?: string | null) {
  if (value === "live") return "green";
  if (value === "video") return "blue";
  if (value === "live_comment") return "purple";
  if (value === "commerce_card_live_comment") return "amber";
  return "gray";
}

function minutesSinceTime(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
}

function recentText(value?: string | null) {
  const minutes = minutesSinceTime(value);
  if (minutes === null) return "未上报";
  if (minutes <= 0) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

function heartbeatInfo(device: DeviceProgress) {
  if (!device.lastHeartbeatAt) {
    return { text: "从未上报", tone: "danger" as const, note: "检查手机网络、脚本常驻和后台地址" };
  }
  const last = new Date(device.lastHeartbeatAt);
  if (Number.isNaN(last.getTime())) {
    return { text: device.lastHeartbeatAt, tone: "warn" as const, note: "心跳时间格式异常" };
  }
  const minutes = Math.max(0, Math.round((Date.now() - last.getTime()) / 60000));
  if (["offline", "stopped", "error"].includes(device.status || "")) {
    return { text: minutes < 60 ? `离线 ${minutes} 分钟` : `离线 ${Math.floor(minutes / 60)} 小时`, tone: "danger" as const, note: "检查手机网络或脚本是否常驻" };
  }
  if (minutes <= 1) return { text: "刚刚心跳", tone: "ok" as const, note: "设备在线" };
  if (minutes <= 3) return { text: `${minutes} 分钟前`, tone: "ok" as const, note: "设备在线" };
  if (minutes <= 10) return { text: `心跳超时 ${minutes} 分钟`, tone: "warn" as const, note: "观察是否恢复，必要时刷新配置" };
  return { text: minutes < 60 ? `离线 ${minutes} 分钟` : `离线 ${Math.floor(minutes / 60)} 小时`, tone: "danger" as const, note: "检查手机网络或脚本是否常驻" };
}

function needsAttention(device: DeviceProgress) {
  const heartbeat = heartbeatInfo(device);
  return heartbeat.tone !== "ok" || ["offline", "error", "risk_control", "stopped"].includes(device.status || "");
}

function configFeatureStatus(device: DeviceProgress): FeatureStatus {
  const heartbeat = heartbeatInfo(device);
  const message = device.heartbeat?.lastMessage || "";
  if (heartbeat.tone === "danger") {
    return { label: "配置同步", text: "待确认", note: "手机未稳定在线", tone: "danger" };
  }
  if (/后台未就绪|配置拉取失败|注册失败/.test(message)) {
    return { label: "配置同步", text: "未完成", note: "等待注册或重新拉取配置", tone: "warn" };
  }
  return { label: "配置同步", text: "已同步", note: "最近心跳正常", tone: "ok" };
}

function collectionFeatureStatus(device: DeviceProgress): FeatureStatus {
  if (device.status === "error" || device.status === "risk_control") {
    return { label: "采集链路", text: "异常", note: device.heartbeat?.lastMessage || "检查手机状态", tone: "danger" };
  }
  if (device.currentTask && device.currentTask !== "none") {
    return { label: "采集链路", text: "运行中", note: currentTaskText(device.currentTask), tone: "ok" };
  }
  if (Number(device.capturedCount || 0) > 0 || Number(device.viewedCount || 0) > 0 || Number(device.liveViewedCount || 0) > 0) {
    return { label: "采集链路", text: "有结果", note: `今日采集 ${device.capturedCount ?? 0} 条`, tone: "ok" };
  }
  return { label: "采集链路", text: "待执行", note: "等待任务调度", tone: "idle" };
}

function logFeatureStatus(device: DeviceProgress): FeatureStatus {
  const latestLogMinutes = minutesSinceTime(device.latestLogAt);
  const latestFileMinutes = minutesSinceTime(device.latestFileUploadedAt);
  if (Number(device.todayErrorCount || 0) > 0) {
    return { label: "日志同步", text: "有异常", note: `今日错误 ${device.todayErrorCount} 条`, tone: "danger" };
  }
  if (latestLogMinutes !== null && latestLogMinutes <= 5) {
    return { label: "日志同步", text: "实时更新", note: `结构化 ${recentText(device.latestLogAt)}`, tone: "ok" };
  }
  if (latestFileMinutes !== null && latestFileMinutes <= 30) {
    return { label: "日志同步", text: "完整日志已同步", note: `完整日志 ${recentText(device.latestFileUploadedAt)}`, tone: "ok" };
  }
  if (Number(device.todayLogCount || 0) > 0 || Number(device.logFileCount || 0) > 0) {
    return { label: "日志同步", text: "有上报", note: `结构化 ${recentText(device.latestLogAt)}`, tone: "warn" };
  }
  return { label: "日志同步", text: "未上报", note: "等待脚本心跳自动同步", tone: "warn" };
}

function deviceFeatureStatuses(device: DeviceProgress): FeatureStatus[] {
  const heartbeat = heartbeatInfo(device);
  return [
    {
      label: "设备在线",
      text: heartbeat.tone === "ok" ? "在线" : heartbeat.tone === "warn" ? "延迟" : "离线",
      note: heartbeat.text,
      tone: heartbeat.tone === "ok" ? "ok" : heartbeat.tone === "warn" ? "warn" : "danger"
    },
    configFeatureStatus(device),
    collectionFeatureStatus(device),
    logFeatureStatus(device)
  ];
}

function FeatureStatusBoard(props: { devices: DeviceProgress[] }) {
  const total = props.devices.length || 0;
  const statuses = props.devices.map(deviceFeatureStatuses);
  const boardItems = ["设备在线", "配置同步", "采集链路", "日志同步"].map((label) => {
    const flat = statuses.map((items) => items.find((item) => item.label === label)).filter((item): item is FeatureStatus => !!item);
    const okCount = flat.filter((item) => item.tone === "ok").length;
    const dangerCount = flat.filter((item) => item.tone === "danger").length;
    const warnCount = flat.filter((item) => item.tone === "warn").length;
    return {
      label,
      okCount,
      dangerCount,
      warnCount,
      tone: dangerCount > 0 ? "danger" : warnCount > 0 ? "warn" : okCount > 0 ? "ok" : "idle"
    };
  });
  return (
    <section className="ops-panel feature-status-panel">
      <div className="ops-panel-head">
        <span>功能状态看板</span>
        <span className="ops-small">只看核心功能是否跑通，完整日志进入日志中心查看</span>
      </div>
      <div className="feature-status-grid">
        {boardItems.map((item) => (
          <div className={`feature-status-card ${item.tone}`} key={item.label}>
            <div className="feature-status-label">{item.label}</div>
            <div className="feature-status-value">{item.okCount} / {total}</div>
            <div className="feature-status-note">
              {item.dangerCount > 0 ? `异常 ${item.dangerCount} 台` : item.warnCount > 0 ? `待确认 ${item.warnCount} 台` : "当前正常"}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ProgressLine(props: { label: string; percent: number; note: string; tone?: "blue" | "purple" }) {
  return (
    <div className="device-progress-line">
      <div className="ops-card-head">
        <span className="ops-small">{props.label}</span>
        <span className="ops-small">{props.note}</span>
      </div>
      <div className={`ops-progress ${props.tone === "purple" ? "purple" : ""}`}>
        <span style={{ width: `${props.percent}%` }} />
      </div>
    </div>
  );
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedDeviceCode, setSelectedDeviceCode] = useState("");
  const [detailOpen, setDetailOpen] = useState(false);
  const query = useQuery({ queryKey: ["overview"], queryFn: getOverview, refetchInterval: 15000 });
  const data = query.data ?? {};
  const devices = useMemo(() => (Array.isArray(data.deviceProgress) ? data.deviceProgress : []) as DeviceProgress[], [data.deviceProgress]);
  const selected = useMemo(
    () => devices.find((item) => item.deviceCode === selectedDeviceCode) ?? null,
    [devices, selectedDeviceCode]
  );
  const historyQuery = useQuery({
    queryKey: ["device-progress-history", selected?.deviceCode],
    queryFn: () => getDeviceProgressHistory(selected?.deviceCode || "", { limit: 8 }),
    enabled: detailOpen && !!selected?.deviceCode,
    refetchInterval: detailOpen && selected ? 15000 : false
  });
  const dailyProgressQuery = useQuery({
    queryKey: ["device-daily-progress", selected?.deviceCode],
    queryFn: () => getDeviceDailyProgress(selected?.deviceCode || "", { limit: 7 }),
    enabled: detailOpen && !!selected?.deviceCode,
    refetchInterval: detailOpen && selected ? 15000 : false
  });
  const commandMutation = useMutation({
    mutationFn: ({ deviceId, commandType }: { deviceId: string; commandType: CommandType }) =>
      createMobileCommand({ deviceId, commandType, expiresInSeconds: 3600 }),
    onSuccess: async () => {
      messageApi.success("控制指令已下发，等待手机领取");
      await queryClient.invalidateQueries({ queryKey: ["overview"] });
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" message="工作台加载失败" description={query.error.message} showIcon />;

  const dailyRows = (dailyProgressQuery.data ?? []) as DailyProgress[];
  const heartbeatRows = (historyQuery.data ?? []) as HeartbeatHistory[];
  const onlineCount = devices.filter((item) => heartbeatInfo(item).tone === "ok").length;
  const offlineCount = devices.filter((item) => heartbeatInfo(item).tone === "danger").length;
  const attentionCount = devices.filter(needsAttention).length;

  function openDetail(deviceCode: string) {
    setSelectedDeviceCode(deviceCode);
    setDetailOpen(true);
  }

  function sendCommand(deviceCode: string | undefined, commandType: CommandType) {
    if (!deviceCode) return;
    commandMutation.mutate({ deviceId: deviceCode, commandType });
  }

  return (
    <div className="ops-page">
      {contextHolder}
      <header className="ops-topbar">
        <div>
          <h1>工作台</h1>
          <p>设备运行总览，集中查看心跳、任务、采集进度和常用操作。</p>
        </div>
        <div className="ops-toolbar">
          <button className="ops-btn" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}>刷新</button>
          <span className="ops-tag green">自动刷新 15 秒</span>
        </div>
      </header>

      <section className="ops-stats">
        <div className="ops-stat">
          <div className="ops-stat-label">设备总数</div>
          <div className="ops-stat-value">{Number(data.deviceCount ?? devices.length)}</div>
          <div className="ops-stat-note">已接入后台的手机</div>
        </div>
        <div className="ops-stat">
          <div className="ops-stat-label">在线设备</div>
          <div className="ops-stat-value ok">{onlineCount}</div>
          <div className="ops-stat-note">3 分钟内有心跳</div>
        </div>
        <div className="ops-stat">
          <div className="ops-stat-label">离线设备</div>
          <div className="ops-stat-value danger">{offlineCount}</div>
          <div className="ops-stat-note">需要确认手机和脚本</div>
        </div>
        <div className="ops-stat">
          <div className="ops-stat-label">今日采集</div>
          <div className="ops-stat-value">{Number(data.todayRecordCount ?? 0)}</div>
          <div className="ops-stat-note">视频和直播内容</div>
        </div>
        <div className="ops-stat">
          <div className="ops-stat-label">需要处理</div>
          <div className="ops-stat-value warn">{attentionCount}</div>
          <div className="ops-stat-note">点击设备查看处理建议</div>
        </div>
      </section>

      <FeatureStatusBoard devices={devices} />

      <section className="ops-panel">
        <div className="ops-panel-head">
          <span>设备监控看板</span>
          <span className="ops-small">卡片内可直接操作，点击卡片打开详情</span>
        </div>
        <div className="ops-panel-body">
          {devices.length === 0 ? <div className="ops-empty">暂无设备</div> : null}
          <div className="device-overview-list">
            {devices.map((item) => {
              const videoPercent = progressPercent(item.videoElapsedMinutes, item.videoRemainingMinutes, item.plannedVideoMinutes);
              const livePercent = progressPercent(item.liveElapsedMinutes, item.liveRemainingMinutes, item.plannedLiveMinutes);
              const heartbeat = heartbeatInfo(item);
              return (
                <article
                  className={`device-run-card heartbeat-${heartbeat.tone} ${item.deviceCode === selected?.deviceCode && detailOpen ? "selected" : ""}`}
                  key={item.id || item.deviceCode}
                  onClick={() => openDetail(item.deviceCode)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") openDetail(item.deviceCode);
                  }}
                >
                  <div className="device-run-main">
                    <div className="device-run-identity">
                      <div className="ops-title">{deviceDisplayName(item)}</div>
                      <div className="ops-small">{deviceSubTitle(item)}</div>
                    </div>
                    <div className="device-run-tags">
                      <span className={`ops-tag ${statusTone(item.status)}`}>{statusText(item.status)}</span>
                      <span className={`ops-tag ${taskTone(item.currentTask)}`}>{currentTaskText(item.currentTask)}</span>
                    </div>
                  </div>
                  <div className={`heartbeat-status ${heartbeat.tone}`}>
                    <strong>{heartbeat.text}</strong>
                    <span>{item.heartbeat?.lastMessage || heartbeat.note}</span>
                  </div>
                  <div className="device-function-strip">
                    {deviceFeatureStatuses(item).map((status) => (
                      <div className={`device-function-pill ${status.tone}`} key={status.label}>
                        <span>{status.label}</span>
                        <strong>{status.text}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="device-run-progress">
                    <ProgressLine label="视频进度" percent={videoPercent} note={progressLabel(item.videoElapsedMinutes, item.videoRemainingMinutes, item.plannedVideoMinutes)} />
                    <ProgressLine label="直播进度" percent={livePercent} note={progressLabel(item.liveElapsedMinutes, item.liveRemainingMinutes, item.plannedLiveMinutes)} tone="purple" />
                  </div>
                  <div className="device-run-stats">
                    <div><span>视频浏览</span><strong>{item.viewedCount ?? 0}</strong></div>
                    <div><span>直播浏览</span><strong>{item.liveViewedCount ?? 0}</strong></div>
                    <div><span>采集数</span><strong>{item.capturedCount ?? 0}</strong></div>
                  </div>
                  <div className="device-run-actions" onClick={(event) => event.stopPropagation()}>
                    <button className="ops-mini-btn primary" type="button" disabled={commandMutation.isPending} onClick={() => sendCommand(item.deviceCode, "START")}><PlayCircleOutlined />启动</button>
                    <button className="ops-mini-btn" type="button" disabled={commandMutation.isPending} onClick={() => sendCommand(item.deviceCode, "PAUSE")}><PauseOutlined />暂停</button>
                    <button className="ops-mini-btn" type="button" disabled={commandMutation.isPending} onClick={() => sendCommand(item.deviceCode, "RESUME")}><SyncOutlined />恢复</button>
                    <button className="ops-mini-btn" type="button" disabled={commandMutation.isPending} onClick={() => sendCommand(item.deviceCode, "REFRESH_CONFIG")}><ReloadOutlined />配置</button>
                    <button className="ops-mini-btn danger" type="button" disabled={commandMutation.isPending} onClick={() => sendCommand(item.deviceCode, "STOP")}><StopOutlined />停止</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {detailOpen && selected ? (
        <aside className="ops-detail-drawer" aria-label="设备详情">
          <div className="ops-detail-drawer-head">
            <div>
              <h2>{deviceDisplayName(selected)}</h2>
              <p>{deviceSubTitle(selected)}</p>
            </div>
            <button className="ops-drawer-close" type="button" onClick={() => setDetailOpen(false)}>关闭</button>
          </div>
          <div className="ops-detail-drawer-body">
            <div className="ops-kv">
              <div className="ops-k">设备状态</div><div><span className={`ops-tag ${statusTone(selected.status)}`}>{statusText(selected.status)}</span></div>
              <div className="ops-k">抖音账号</div><div>{selected.douyinAccountName || "-"}</div>
              <div className="ops-k">设备名称</div><div>{selected.deviceName || "-"}</div>
              <div className="ops-k">当前任务</div><div><span className={`ops-tag ${taskTone(selected.currentTask)}`}>{currentTaskText(selected.currentTask)}</span></div>
              <div className="ops-k">最后心跳</div><div>{formatDateTime(selected.lastHeartbeatAt)}</div>
              <div className="ops-k">最近消息</div><div>{selected.heartbeat?.lastMessage || "-"}</div>
            </div>

            <div className={`heartbeat-detail ${heartbeatInfo(selected).tone}`}>
              <strong>{heartbeatInfo(selected).text}</strong>
              <span>{heartbeatInfo(selected).note}</span>
            </div>

            <div className="drawer-section-title">今日进度</div>
            <div className="drawer-progress-block">
              <ProgressLine label="视频进度" percent={progressPercent(selected.videoElapsedMinutes, selected.videoRemainingMinutes, selected.plannedVideoMinutes)} note={progressLabel(selected.videoElapsedMinutes, selected.videoRemainingMinutes, selected.plannedVideoMinutes)} />
              <ProgressLine label="直播进度" percent={progressPercent(selected.liveElapsedMinutes, selected.liveRemainingMinutes, selected.plannedLiveMinutes)} note={progressLabel(selected.liveElapsedMinutes, selected.liveRemainingMinutes, selected.plannedLiveMinutes)} tone="purple" />
            </div>

            <div className="drawer-section-title">处理建议</div>
            <div className="ops-advice-box">
              {needsAttention(selected) ? heartbeatInfo(selected).note : "当前设备心跳正常，暂无需要人工处理的问题。"}
            </div>

            <div className="drawer-section-title">常用操作</div>
            <div className="drawer-action-grid">
              <button className="ops-btn primary" type="button" onClick={() => sendCommand(selected.deviceCode, "START")}>启动/继续</button>
              <button className="ops-btn" type="button" onClick={() => sendCommand(selected.deviceCode, "PAUSE")}>暂停</button>
              <button className="ops-btn" type="button" onClick={() => sendCommand(selected.deviceCode, "RESUME")}>恢复</button>
              <button className="ops-btn" type="button" onClick={() => sendCommand(selected.deviceCode, "REFRESH_CONFIG")}>刷新配置</button>
              <button className="ops-btn danger" type="button" onClick={() => sendCommand(selected.deviceCode, "STOP")}>停止</button>
            </div>

            <div className="drawer-section-title">最近 7 天</div>
            {dailyProgressQuery.isLoading ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
            {!dailyProgressQuery.isLoading && dailyRows.length === 0 ? <div className="ops-empty">暂无每日进度</div> : null}
            <div className="drawer-day-list">
              {dailyRows.map((item) => (
                <div className="drawer-day-card" key={item.progressDate}>
                  <div className="ops-card-head">
                    <strong>{item.progressDate}</strong>
                    {item.errorCount ? <span className="ops-tag red">异常 {item.errorCount}</span> : <span className="ops-tag green">正常</span>}
                  </div>
                  <div className="ops-small">视频 {item.maxVideoElapsedMinutes ?? 0}/{item.maxVideoPlannedMinutes ?? 0} 分钟 · 直播 {item.maxLiveElapsedMinutes ?? 0}/{item.maxLivePlannedMinutes ?? 0} 分钟</div>
                  <div className="ops-small">采集 {item.maxCapturedCount ?? 0} · 最近 {formatDateTime(item.latestHeartbeatAt)}</div>
                </div>
              ))}
            </div>

            <div className="drawer-section-title">最近心跳</div>
            {historyQuery.isLoading ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
            <div className="ops-log-box">
              {heartbeatRows.length === 0 ? "暂无心跳明细" : heartbeatRows.map((item) => `${formatDateTime(item.reportedAt || item.createdAt)}  ${statusText(item.status)}  ${sceneText(item.sceneType)}  ${item.lastMessage || ""}`).join("\n")}
            </div>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
