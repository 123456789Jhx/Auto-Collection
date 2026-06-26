import { useQuery } from "@tanstack/react-query";
import { Alert, Skeleton } from "antd";
import { useMemo, useState } from "react";
import { getDeviceDailyProgress, getDeviceProgressHistory, getOverview } from "../lib/api-client";
import { sceneText, statusText } from "../lib/display-maps";

type DeviceProgress = {
  id: string;
  deviceCode: string;
  deviceName?: string;
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
  elapsedMinutes?: number | null;
  remainingMinutes?: number | null;
  viewedCount?: number | null;
  liveViewedCount?: number | null;
  capturedCount?: number | null;
  lastMessage?: string | null;
  reportedAt?: string | null;
  createdAt?: string | null;
};

type DailyProgress = {
  progressDate: string;
  latestHeartbeatAt?: string | null;
  maxVideoElapsedMinutes?: number;
  maxVideoPlannedMinutes?: number;
  videoCompletionPercent?: number;
  maxLiveElapsedMinutes?: number;
  maxLivePlannedMinutes?: number;
  liveCompletionPercent?: number;
  maxViewedCount?: number;
  maxLiveViewedCount?: number;
  maxCapturedCount?: number;
  errorCount?: number;
  lastMessage?: string | null;
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
  return "gray";
}

function needsAttention(device: DeviceProgress) {
  return ["offline", "error", "risk_control", "stopped"].includes(device.status || "") || !device.lastHeartbeatAt;
}

function ProgressLine(props: { label: string; percent: number; note: string; tone?: "blue" | "purple" }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
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
  const [selectedDeviceCode, setSelectedDeviceCode] = useState("");
  const query = useQuery({ queryKey: ["overview"], queryFn: getOverview, refetchInterval: 15000 });
  const data = query.data ?? {};
  const devices = useMemo(() => (Array.isArray(data.deviceProgress) ? data.deviceProgress : []) as DeviceProgress[], [data.deviceProgress]);
  const selected = useMemo(
    () => devices.find((item) => item.deviceCode === selectedDeviceCode) ?? devices[0] ?? null,
    [devices, selectedDeviceCode]
  );
  const historyQuery = useQuery({
    queryKey: ["device-progress-history", selected?.deviceCode],
    queryFn: () => getDeviceProgressHistory(selected?.deviceCode || "", { limit: 8 }),
    enabled: !!selected?.deviceCode,
    refetchInterval: selected ? 15000 : false
  });
  const dailyProgressQuery = useQuery({
    queryKey: ["device-daily-progress", selected?.deviceCode],
    queryFn: () => getDeviceDailyProgress(selected?.deviceCode || "", { limit: 7 }),
    enabled: !!selected?.deviceCode,
    refetchInterval: selected ? 15000 : false
  });

  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" message="工作台加载失败" description={query.error.message} showIcon />;

  const attentionDevices = devices.filter(needsAttention);
  const dailyRows = (dailyProgressQuery.data ?? []) as DailyProgress[];
  const heartbeatRows = (historyQuery.data ?? []) as HeartbeatHistory[];

  return (
    <div className="ops-page">
      <header className="ops-topbar">
        <div>
          <h1>工作台</h1>
          <p>查看今日设备运行、采集进度和需要人工处理的问题。</p>
        </div>
        <div className="ops-toolbar">
          <button className="ops-btn" type="button" onClick={() => void query.refetch()}>刷新</button>
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
          <div className="ops-stat-label">运行中</div>
          <div className="ops-stat-value ok">{Number(data.runningCount ?? 0)}</div>
          <div className="ops-stat-note">正在执行采集任务</div>
        </div>
        <div className="ops-stat">
          <div className="ops-stat-label">暂停</div>
          <div className="ops-stat-value warn">{Number(data.pausedCount ?? 0)}</div>
          <div className="ops-stat-note">等待恢复或继续</div>
        </div>
        <div className="ops-stat">
          <div className="ops-stat-label">今日采集</div>
          <div className="ops-stat-value">{Number(data.todayRecordCount ?? 0)}</div>
          <div className="ops-stat-note">视频和直播内容</div>
        </div>
        <div className="ops-stat">
          <div className="ops-stat-label">今日异常</div>
          <div className="ops-stat-value danger">{Number(data.todayErrorCount ?? 0)}</div>
          <div className="ops-stat-note">需要排查的事件</div>
        </div>
      </section>

      <section className="ops-workbench wide-side">
        <div className="ops-main">
          <div className="ops-panel">
            <div className="ops-panel-head">
              <span>需要处理</span>
              <span className="ops-small">离线、异常、风控或没有心跳的设备</span>
            </div>
            {attentionDevices.length === 0 ? (
              <div className="ops-empty">当前没有需要处理的问题</div>
            ) : (
              <div className="ops-table-wrap">
                <table className="ops-table">
                  <thead>
                    <tr>
                      <th>设备</th>
                      <th>状态</th>
                      <th>当前任务</th>
                      <th>最后心跳</th>
                      <th>建议处理</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attentionDevices.map((item) => (
                      <tr key={item.deviceCode} onClick={() => setSelectedDeviceCode(item.deviceCode)}>
                        <td>
                          <div className="ops-title">{item.deviceName || item.deviceCode}</div>
                          <div className="ops-small">{item.deviceCode}</div>
                        </td>
                        <td><span className={`ops-tag ${statusTone(item.status)}`}>{statusText(item.status)}</span></td>
                        <td><span className={`ops-tag ${taskTone(item.currentTask)}`}>{currentTaskText(item.currentTask)}</span></td>
                        <td>{formatDateTime(item.lastHeartbeatAt)}</td>
                        <td>{item.status === "offline" ? "检查手机网络或脚本是否常驻" : "打开日志中心查看最近异常"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="ops-panel">
            <div className="ops-panel-head">
              <span>设备任务进度</span>
              <span className="ops-small">{devices.length} 台设备</span>
            </div>
            <div className="ops-panel-body">
              {devices.length === 0 ? <div className="ops-empty">暂无设备</div> : null}
              <div className="ops-card-grid">
                {devices.map((item) => {
                  const videoPercent = progressPercent(item.videoElapsedMinutes, item.videoRemainingMinutes, item.plannedVideoMinutes);
                  const livePercent = progressPercent(item.liveElapsedMinutes, item.liveRemainingMinutes, item.plannedLiveMinutes);
                  return (
                    <div
                      className={`ops-device-card ${item.deviceCode === selected?.deviceCode ? "selected" : ""}`}
                      key={item.id || item.deviceCode}
                      onClick={() => setSelectedDeviceCode(item.deviceCode)}
                    >
                      <div className="ops-card-head">
                        <div>
                          <div className="ops-title">{item.deviceName || item.deviceCode}</div>
                          <div className="ops-small">{item.deviceCode}</div>
                        </div>
                        <span className={`ops-tag ${statusTone(item.status)}`}>{statusText(item.status)}</span>
                      </div>
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        <div><span className={`ops-tag ${taskTone(item.currentTask)}`}>{currentTaskText(item.currentTask)}</span></div>
                        <ProgressLine label="视频进度" percent={videoPercent} note={progressLabel(item.videoElapsedMinutes, item.videoRemainingMinutes, item.plannedVideoMinutes)} />
                        <ProgressLine label="直播进度" percent={livePercent} note={progressLabel(item.liveElapsedMinutes, item.liveRemainingMinutes, item.plannedLiveMinutes)} tone="purple" />
                      </div>
                      <div className="ops-mini-stats">
                        <div className="ops-mini-stat"><span>视频浏览</span><strong>{item.viewedCount ?? 0}</strong></div>
                        <div className="ops-mini-stat"><span>直播浏览</span><strong>{item.liveViewedCount ?? 0}</strong></div>
                        <div className="ops-mini-stat"><span>采集数</span><strong>{item.capturedCount ?? 0}</strong></div>
                      </div>
                      <div className="ops-small" style={{ marginTop: 10 }}>最后心跳：{formatDateTime(item.lastHeartbeatAt)}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <aside className="ops-panel">
          <div className="ops-panel-head">
            <span>设备详情</span>
            <span className={`ops-tag ${statusTone(selected?.status)}`}>{statusText(selected?.status)}</span>
          </div>
          <div className="ops-panel-body">
            {selected ? (
              <>
                <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{selected.deviceName || selected.deviceCode}</h2>
                <div className="ops-kv">
                  <div className="ops-k">设备编号</div><div>{selected.deviceCode}</div>
                  <div className="ops-k">当前任务</div><div><span className={`ops-tag ${taskTone(selected.currentTask)}`}>{currentTaskText(selected.currentTask)}</span></div>
                  <div className="ops-k">最后心跳</div><div>{formatDateTime(selected.lastHeartbeatAt)}</div>
                  <div className="ops-k">最近消息</div><div>{selected.heartbeat?.lastMessage || "-"}</div>
                </div>
                <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
                  <ProgressLine label="视频进度" percent={progressPercent(selected.videoElapsedMinutes, selected.videoRemainingMinutes, selected.plannedVideoMinutes)} note={progressLabel(selected.videoElapsedMinutes, selected.videoRemainingMinutes, selected.plannedVideoMinutes)} />
                  <ProgressLine label="直播进度" percent={progressPercent(selected.liveElapsedMinutes, selected.liveRemainingMinutes, selected.plannedLiveMinutes)} note={progressLabel(selected.liveElapsedMinutes, selected.liveRemainingMinutes, selected.plannedLiveMinutes)} tone="purple" />
                </div>

                <div className="ops-panel-note" style={{ marginTop: 16 }}>最近 7 天完成情况</div>
                {dailyProgressQuery.isLoading ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
                {!dailyProgressQuery.isLoading && dailyRows.length === 0 ? <div className="ops-empty">暂无每日进度</div> : null}
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {dailyRows.map((item) => (
                    <div className="ops-device-card" key={item.progressDate}>
                      <div className="ops-card-head">
                        <strong>{item.progressDate}</strong>
                        {item.errorCount ? <span className="ops-tag red">异常 {item.errorCount}</span> : <span className="ops-tag green">正常</span>}
                      </div>
                      <div className="ops-small" style={{ marginTop: 6 }}>
                        视频 {item.maxVideoElapsedMinutes ?? 0}/{item.maxVideoPlannedMinutes ?? 0} 分钟 · 直播 {item.maxLiveElapsedMinutes ?? 0}/{item.maxLivePlannedMinutes ?? 0} 分钟
                      </div>
                      <div className="ops-small">采集 {item.maxCapturedCount ?? 0} · 最近 {formatDateTime(item.latestHeartbeatAt)}</div>
                    </div>
                  ))}
                </div>

                <div className="ops-panel-note" style={{ marginTop: 16 }}>最近心跳</div>
                {historyQuery.isLoading ? <Skeleton active paragraph={{ rows: 2 }} /> : null}
                <div className="ops-log-box">
                  {heartbeatRows.length === 0 ? "暂无心跳明细" : heartbeatRows.map((item) => `${formatDateTime(item.reportedAt || item.createdAt)}  ${statusText(item.status)}  ${sceneText(item.sceneType)}  ${item.lastMessage || ""}`).join("\n")}
                </div>
              </>
            ) : (
              <div className="ops-empty">暂无设备</div>
            )}
          </div>
        </aside>
      </section>
    </div>
  );
}
