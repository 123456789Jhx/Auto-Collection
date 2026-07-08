import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Empty, Input, Select, Skeleton, message } from "antd";
import { useMemo, useState } from "react";
import { createMobileCommand, getLogDates, getLogDeviceSummary, getLogFileDetail, getLogFiles, getLogs } from "../lib/api-client";
import { deviceDisplayName, deviceSubTitle } from "../lib/display-maps";
import { levelText, statusText, stopReasonText } from "../lib/display-maps";

type LogDeviceSummary = {
  deviceCode?: string;
  deviceName?: string;
  douyinAccountName?: string | null;
  totalCount: number;
  infoCount: number;
  warnCount: number;
  errorCount: number;
  fileCount?: number;
  latestLogAt?: string | null;
  latestFileUploadedAt?: string | null;
  deviceStatus?: string;
  lastHeartbeatAt?: string | null;
};

type LogDateSummary = {
  logDate: string;
  totalCount: number;
  infoCount: number;
  warnCount: number;
  errorCount: number;
  fileCount?: number;
  fileSizeBytes?: number;
  latestLogAt?: string | null;
  latestUploadedAt?: string | null;
  lastErrorReason?: string | null;
};

type LogFile = {
  id: string;
  logDate?: string;
  fileName?: string;
  content?: string;
  fileSizeBytes?: number;
  infoCount?: number;
  warnCount?: number;
  errorCount?: number;
  lastErrorReason?: string | null;
  uploadedAt?: string | null;
};

type RuntimeLog = {
  id: string;
  createdAt?: string;
  level?: string;
  message?: string;
  stopReason?: string | null;
  contextJson?: Record<string, unknown>;
};

type Pagination = {
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
};

type DisplayLog = RuntimeLog & {
  duplicateCount: number;
  duplicateIds: string[];
  latestCreatedAt?: string;
};

type LogTab = "status" | "issues" | "full";

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatClock(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function formatBytes(value?: number) {
  const size = Number(value ?? 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function relativeTime(value?: string | null) {
  if (!value) return "未同步";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "刚刚";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
}

function nextDate(value?: string) {
  if (!value) return undefined;
  const parts = value.split("-").map(Number);
  if (parts.length !== 3 || parts.some((part) => Number.isNaN(part))) return undefined;
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  if (Number.isNaN(date.getTime())) return undefined;
  date.setDate(date.getDate() + 1);
  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${date.getFullYear()}-${month < 10 ? `0${month}` : month}-${day < 10 ? `0${day}` : day}`;
}

function dayBoundary(value?: string) {
  return value ? `${value}T00:00:00+08:00` : undefined;
}

function reasonText(log: RuntimeLog) {
  const context = log.contextJson || {};
  const reason = log.stopReason || String(context.reason || context.message || context.error || "");
  return reason ? stopReasonText(reason) : "-";
}

function phaseText(log: RuntimeLog) {
  const context = log.contextJson || {};
  const phase = String(context.phase || context.sceneType || context.currentTask || "");
  const map: Record<string, string> = {
    douyin_state_detection: "页面识别",
    candidate_upload: "采集上传",
    live_room: "直播间停留",
    live_readonly: "直播采集",
    live_comment_task_start: "搜索直播间评论启动",
    live_comment_target_search: "搜索目标直播间",
    commerce_card_live_start: "商品卡直播评论启动",
    commerce_card_live_task_start: "商品卡直播评论启动",
    commerce_card_live_config: "商品卡直播评论配置",
    commerce_card_scan_start: "商品卡扫描",
    commerce_card_live_before_scan: "商品卡扫描",
    commerce_card_live_before_comment: "商品卡直播评论",
    commerce_card_live_comment: "商品卡直播评论",
    commerce_card_live_comment_send: "商品卡直播评论发送",
    commerce_card_live_comment_result: "商品卡直播评论结果",
    commerce_card_live_watch: "商品卡直播观看",
    commerce_card_live_finish: "商品卡直播评论完成",
    task_switch: "任务切换",
    search: "搜索入口",
    search_open: "搜索入口",
    heartbeat: "手机状态上报",
    permission: "手机权限检查",
    log_upload: "完整日志同步"
  };
  if (map[phase]) return map[phase];
  if (phase === "video") return "视频采集";
  if (phase === "live") return "直播采集";
  if (phase === "live_comment") return "搜索直播间评论";
  if (phase === "commerce_card_live_comment") return "商品卡直播评论";
  if (phase) return "运行事件";
  if (/直播评论/.test(log.message || "")) return "直播评论";
  if (/直播/.test(log.message || "")) return "直播采集";
  if (/视频/.test(log.message || "")) return "视频采集";
  if (/心跳/.test(log.message || "")) return "手机状态上报";
  if (/上传|同步/.test(log.message || "")) return "完整日志同步";
  if (/搜索/.test(log.message || "")) return "搜索入口";
  return "-";
}

function eventStatus(log: RuntimeLog) {
  if (log.level === "ERROR") return { text: "异常", kind: "error" };
  if (log.level === "WARN") return { text: "需要关注", kind: "warn" };
  if (/成功|完成|已执行|已应用|结束|上传完成|写入/.test(log.message || "")) return { text: "已完成", kind: "ok" };
  return { text: "正常", kind: "info" };
}

function eventTitle(log: RuntimeLog) {
  const message = log.message || "";
  const context = log.contextJson || {};
  const reason = String(context.reason || log.stopReason || "");
  if (/candidate_upload|候选/.test(message) || reason === "candidate_upload") return "候选采集结果已上传到后台";
  if (/douyin_state_detection|页面状态|状态识别/.test(message)) return "手机完成当前页面识别";
  if (/task_switched|任务切换/.test(reason) || /切换/.test(message)) return "后台要求手机切换任务";
  if (/target_live_card_not_found|target_live_room_search_failed/.test(reason)) return "目标直播间暂时没有找到";
  if (/权限|permission_failed/.test(reason) || /permission/.test(message)) return "手机权限检查没有通过";
  return message || "手机上报运行事件";
}

function eventSub(log: RuntimeLog) {
  const reason = reasonText(log);
  if (reason !== "-") return `原因：${reason}`;
  if (log.level === "WARN") return "系统已记录该事件，后续会按策略观察或重试。";
  if (log.level === "ERROR") return "该事件可能已经影响当前任务，需要人工排查。";
  return "手机运行状态已同步到后台。";
}

function involvedText(log: RuntimeLog) {
  const context = log.contextJson || {};
  const value = context.keyword || context.searchKeyword || context.targetRoom || context.roomName || context.anchorName || context.taskType;
  return value ? String(value) : "无";
}

function impactText(log: RuntimeLog) {
  if (log.level === "ERROR") return "已影响";
  if (log.level === "WARN") return "可能影响";
  return "不影响";
}

function suggestionText(log: RuntimeLog) {
  const reason = reasonText(log);
  const text = `${reason} ${log.message || ""}`.toLowerCase();
  if (log.level === "ERROR" && /权限|permission/.test(text)) return "检查手机权限";
  if (/直播间|target|room|search/.test(text)) return "确认直播间或关键词";
  if (/connect|timeout|网络|上传/.test(text)) return "检查网络和后台地址";
  if (log.level === "ERROR") return "人工查看手机";
  if (log.level === "WARN") return "观察是否恢复";
  return "无需处理";
}

function normalizeLogText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[，。,.！!？?；;：:、]/g, "")
    .trim()
    .slice(0, 120);
}

function logDedupKey(log: RuntimeLog) {
  const context = log.contextJson || {};
  return [
    log.level || "",
    normalizeLogText(log.message),
    normalizeLogText(log.stopReason),
    normalizeLogText(context.phase),
    normalizeLogText(context.taskType),
    normalizeLogText(context.failureReason || context.reason),
    normalizeLogText(context.actionName),
    normalizeLogText(context.state || context.stateBefore)
  ].join("|");
}

function compactDuplicateLogs(logs: RuntimeLog[]) {
  const byKey = new Map<string, DisplayLog>();
  logs.forEach((log) => {
    const key = logDedupKey(log);
    const existing = key ? byKey.get(key) : undefined;
    if (existing) {
      existing.duplicateCount += 1;
      existing.duplicateIds.push(log.id);
      if (!existing.latestCreatedAt || (log.createdAt && new Date(log.createdAt).getTime() > new Date(existing.latestCreatedAt).getTime())) {
        existing.latestCreatedAt = log.createdAt;
      }
      return;
    }
    byKey.set(key || log.id, {
      ...log,
      duplicateCount: 1,
      duplicateIds: [log.id],
      latestCreatedAt: log.createdAt
    });
  });
  return Array.from(byKey.values());
}

function latestLogContent(content?: string | null, lines = 80) {
  const text = String(content || "").trim();
  if (!text) return "";
  return text.split(/\r?\n/).filter((line) => line.trim()).slice(-lines).join("\n");
}

function fullLogContent(content?: string | null) {
  return String(content || "").trim();
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function statusBadge(log: RuntimeLog) {
  const status = eventStatus(log);
  return <span className={`log-center-badge ${status.kind}`}>{status.text}</span>;
}

function phaseBadge(log: RuntimeLog) {
  const phase = phaseText(log);
  const taskLike = /直播|视频|任务/.test(phase);
  return <span className={`log-center-badge ${taskLike ? "task" : "info"}`}>{phase}</span>;
}

function refreshLabel(seconds: number) {
  return seconds > 0 ? `${seconds}秒刷新` : "暂停刷新";
}

export function LogsPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedDeviceCode, setSelectedDeviceCode] = useState<string>();
  const [selectedDateValue, setSelectedDateValue] = useState<string>();
  const [previewLog, setPreviewLog] = useState<RuntimeLog | null>(null);
  const [level, setLevel] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(5);
  const [activeTab, setActiveTab] = useState<LogTab>("status");
  const [logsPage, setLogsPage] = useState(1);
  const [logsPageSize, setLogsPageSize] = useState(20);
  const refreshInterval = autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false;

  const summaryQuery = useQuery({
    queryKey: ["log-device-summary"],
    queryFn: () => getLogDeviceSummary(),
    refetchInterval: refreshInterval
  });
  const summaries = (summaryQuery.data ?? []) as LogDeviceSummary[];
  const selectedDevice = summaries.find((item) => item.deviceCode === selectedDeviceCode) ?? null;
  const effectiveDeviceCode = selectedDevice?.deviceCode;

  const dateQuery = useQuery({
    queryKey: ["log-dates", effectiveDeviceCode],
    queryFn: () => getLogDates(effectiveDeviceCode || ""),
    enabled: !!effectiveDeviceCode,
    refetchInterval: effectiveDeviceCode ? refreshInterval : false
  });
  const dates = (dateQuery.data ?? []) as LogDateSummary[];
  const selectedDate = dates.find((item) => item.logDate === selectedDateValue) ?? null;
  const effectiveDate = selectedDate?.logDate;

  const fileQuery = useQuery({
    queryKey: ["log-files", effectiveDeviceCode, effectiveDate],
    queryFn: () => getLogFiles({ deviceCode: effectiveDeviceCode, logDate: effectiveDate }),
    enabled: !!effectiveDeviceCode && !!effectiveDate,
    refetchInterval: effectiveDeviceCode && effectiveDate ? refreshInterval : false
  });
  const files = (fileQuery.data ?? []) as LogFile[];
  const latestFile = files[0] ?? null;
  const fileDetailQuery = useQuery({
    queryKey: ["log-file-detail", latestFile?.id],
    queryFn: () => getLogFileDetail(latestFile?.id || ""),
    enabled: !!latestFile?.id,
    refetchInterval: latestFile?.id ? refreshInterval : false
  });
  const logsQuery = useQuery({
    queryKey: ["logs", effectiveDeviceCode, effectiveDate, level, keyword, logsPage, logsPageSize],
    queryFn: () => getLogs({
      deviceCode: effectiveDeviceCode,
      level,
      keyword,
      createdFrom: dayBoundary(effectiveDate),
      createdTo: dayBoundary(nextDate(effectiveDate)),
      page: logsPage,
      pageSize: logsPageSize
    }),
    enabled: !!effectiveDeviceCode && !!effectiveDate,
    refetchInterval: effectiveDeviceCode && effectiveDate ? refreshInterval : false
  });
  const syncLogMutation = useMutation({
    mutationFn: () => {
      if (!effectiveDeviceCode) {
        throw new Error("请选择要同步日志的手机");
      }
      return createMobileCommand({
        deviceId: effectiveDeviceCode,
        commandType: "UPLOAD_LOG",
        payload: {
          reason: "log_center_manual_sync",
          logDate: effectiveDate
        },
        expiresInSeconds: 3600
      });
    },
    onSuccess: async () => {
      messageApi.success("已触发日志重新同步，手机会在领取指令后上报");
      await Promise.all([
        summaryQuery.refetch(),
        dateQuery.refetch(),
        fileQuery.refetch(),
        fileDetailQuery.refetch(),
        logsQuery.refetch()
      ]);
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  const logs = useMemo(() => (logsQuery.data?.data ?? []) as RuntimeLog[], [logsQuery.data]);
  const issueLogs = useMemo(() => logs.filter((log) => log.level === "WARN" || log.level === "ERROR"), [logs]);
  const displayLogs = useMemo(() => compactDuplicateLogs(logs), [logs]);
  const displayIssueLogs = useMemo(() => compactDuplicateLogs(issueLogs), [issueLogs]);
  const logsPagination = (logsQuery.data?.pagination ?? {}) as Pagination;
  const selectedFile = (fileDetailQuery.data ?? latestFile ?? null) as LogFile | null;
  const visibleLogs = activeTab === "issues" ? displayIssueLogs : displayLogs;
  const fullLogText = fileDetailQuery.isFetching && !selectedFile?.content
    ? "正在读取完整日志..."
    : fullLogContent(selectedFile?.content) || "完整日志内容为空";

  if (summaryQuery.isLoading) return <Skeleton active />;
  if (summaryQuery.isError) return <Alert type="error" message="日志加载失败" description={summaryQuery.error.message} showIcon />;

  const title = `${deviceDisplayName(selectedDevice)} / ${effectiveDate || "未选择日期"}`;
  const latestUploadedAt = selectedFile?.uploadedAt || selectedDate?.latestUploadedAt || selectedDevice?.latestFileUploadedAt;
  const syncState = latestUploadedAt ? relativeTime(latestUploadedAt) : "未同步";
  const deviceOptions = summaries
    .filter((item) => item.deviceCode)
    .map((item) => ({ value: item.deviceCode as string, label: `${deviceDisplayName(item)} / ${item.deviceCode}` }));

  const totalLogs = summaries.reduce((sum, item) => sum + Number(item.totalCount || 0), 0);
  const warnLogs = summaries.reduce((sum, item) => sum + Number(item.warnCount || 0), 0);
  const errorLogs = summaries.reduce((sum, item) => sum + Number(item.errorCount || 0), 0);
  const fileCount = summaries.reduce((sum, item) => sum + Number(item.fileCount || 0), 0);
  const refreshAll = () => {
    void summaryQuery.refetch();
    if (effectiveDeviceCode) void dateQuery.refetch();
    if (effectiveDeviceCode && effectiveDate) {
      void logsQuery.refetch();
      void fileQuery.refetch();
      void fileDetailQuery.refetch();
    }
  };
  const openDevice = (deviceCode?: string) => {
    if (!deviceCode) return;
    setSelectedDeviceCode(deviceCode);
    setSelectedDateValue(undefined);
    setPreviewLog(null);
    setLevel(undefined);
    setKeyword("");
    setActiveTab("status");
    setLogsPage(1);
  };
  const openDate = (date: string) => {
    setSelectedDateValue(date);
    setPreviewLog(null);
    setActiveTab("status");
    setLogsPage(1);
  };
  const backToDevices = () => {
    setSelectedDeviceCode(undefined);
    setSelectedDateValue(undefined);
    setPreviewLog(null);
    setLevel(undefined);
    setKeyword("");
    setActiveTab("status");
    setLogsPage(1);
  };
  const backToDates = () => {
    setSelectedDateValue(undefined);
    setPreviewLog(null);
    setActiveTab("status");
    setLogsPage(1);
  };
  const totalLogPages = Math.max(1, Number(logsPagination.totalPages || 1));
  const totalLogItems = Number(logsPagination.totalItems || 0);
  const renderLogPagination = () => (
    <div className="log-center-pagination">
      <div className="log-center-panel-note">
        原始 {totalLogItems} 条，本页 {logs.length} 条，{activeTab === "issues" ? `异常合并后 ${displayIssueLogs.length} 条` : `功能状态合并后 ${displayLogs.length} 条`}
      </div>
      <div className="log-center-pagination-controls">
        <Button disabled={logsPage <= 1} onClick={() => setLogsPage((page) => Math.max(1, page - 1))}>上一页</Button>
        <span className="log-center-page-indicator">{logsPage} / {totalLogPages}</span>
        <Button disabled={logsPage >= totalLogPages} onClick={() => setLogsPage((page) => Math.min(totalLogPages, page + 1))}>下一页</Button>
        <Select
          className="log-center-page-size"
          value={logsPageSize}
          onChange={(value) => { setLogsPageSize(value); setLogsPage(1); }}
          options={[
            { label: "10条/页", value: 10 },
            { label: "20条/页", value: 20 },
            { label: "50条/页", value: 50 }
          ]}
        />
      </div>
    </div>
  );

  if (!selectedDeviceCode) {
    return (
      <div className="log-center-page">
        {contextHolder}
        <header className="log-center-topbar">
          <div className="log-center-title-wrap">
            <div>
              <h1 className="log-center-title">日志中心</h1>
              <div className="log-center-subtitle">先选择手机，再选择日期，默认查看功能状态；完整日志在独立标签中展示。</div>
            </div>
          </div>
          <div className="log-center-actions">
            <Select
              className="log-center-refresh"
              value={autoRefreshSeconds}
              onChange={setAutoRefreshSeconds}
              options={[
                { label: "5秒刷新", value: 5 },
                { label: "15秒刷新", value: 15 },
                { label: "30秒刷新", value: 30 },
                { label: "暂停刷新", value: 0 }
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
          </div>
        </header>

        <section className="log-center-content">
          <div className="log-center-summary-grid">
            <div className="log-center-summary-card">
              <div className="log-center-label">结构化日志</div>
              <div className="log-center-metric">{totalLogs}</div>
              <div className="log-center-note">后台已接收的功能状态</div>
            </div>
            <div className="log-center-summary-card">
              <div className="log-center-label">需要关注</div>
              <div className="log-center-metric warn">{warnLogs}</div>
              <div className="log-center-note">WARN 事件汇总</div>
            </div>
            <div className="log-center-summary-card">
              <div className="log-center-label">异常</div>
              <div className="log-center-metric error">{errorLogs}</div>
              <div className="log-center-note">ERROR 事件汇总</div>
            </div>
            <div className="log-center-summary-card">
              <div className="log-center-label">完整日志文件</div>
              <div className="log-center-metric ok">{fileCount}</div>
              <div className="log-center-note">手机上传的原始日志</div>
            </div>
          </div>

          <section className="log-center-panel">
            <div className="log-center-panel-header">
              <div>
                <div className="log-center-panel-title">按手机查看日志</div>
                <div className="log-center-panel-note">点击手机卡片进入日期列表</div>
              </div>
            </div>
            <div className="log-center-card-grid">
              {summaries.length === 0 ? <div className="log-center-empty">暂无设备日志</div> : null}
              {summaries.map((item) => (
                <button
                  className="log-center-device-card"
                  disabled={!item.deviceCode}
                  key={item.deviceCode || item.deviceName}
                  type="button"
                  onClick={() => openDevice(item.deviceCode)}
                >
                  <div className="log-center-card-head">
                    <div>
                      <div className="log-center-card-title">{deviceDisplayName(item)}</div>
                      <div className="log-center-panel-note">{deviceSubTitle(item)}</div>
                    </div>
                    <span className="log-center-badge info">{statusText(item.deviceStatus)}</span>
                  </div>
                  <div className="log-center-mini-stats">
                    <div><span>动态</span><strong>{item.totalCount}</strong></div>
                    <div><span>警告</span><strong>{item.warnCount}</strong></div>
                    <div><span>异常</span><strong>{item.errorCount}</strong></div>
                  </div>
                  <div className="log-center-card-meta">
                    <span>最近日志</span>
                    <strong>{formatDateTime(item.latestLogAt || item.latestFileUploadedAt)}</strong>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </section>
      </div>
    );
  }

  if (!selectedDevice) {
    return (
      <div className="log-center-page">
        {contextHolder}
        <header className="log-center-topbar">
          <div className="log-center-title-wrap">
            <button className="log-center-back" type="button" aria-label="返回手机列表" onClick={backToDevices}>‹</button>
            <div>
              <h1 className="log-center-title">日志中心</h1>
              <div className="log-center-subtitle">所选设备不在当前汇总中，请返回手机列表重新选择。</div>
            </div>
          </div>
        </header>
      </div>
    );
  }

  if (!selectedDateValue) {
    return (
      <div className="log-center-page">
        {contextHolder}
        <header className="log-center-topbar">
          <div className="log-center-title-wrap">
            <button className="log-center-back" type="button" aria-label="返回手机列表" onClick={backToDevices}>‹</button>
            <div>
              <h1 className="log-center-title">{deviceDisplayName(selectedDevice)}</h1>
              <div className="log-center-subtitle">选择日期后查看功能状态、异常汇总和完整日志。</div>
            </div>
          </div>
          <div className="log-center-actions">
            <Select
              className="log-center-refresh"
              value={autoRefreshSeconds}
              onChange={setAutoRefreshSeconds}
              options={[
                { label: "5秒刷新", value: 5 },
                { label: "15秒刷新", value: 15 },
                { label: "30秒刷新", value: 30 },
                { label: "暂停刷新", value: 0 }
              ]}
            />
            <Button icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>
          </div>
        </header>

        <section className="log-center-content">
          <div className="log-center-summary-grid">
            <div className="log-center-summary-card">
              <div className="log-center-label">设备动态</div>
              <div className="log-center-metric">{selectedDevice.totalCount}</div>
              <div className="log-center-note">设备编号：{selectedDevice.deviceCode}</div>
            </div>
            <div className="log-center-summary-card">
              <div className="log-center-label">需要关注</div>
              <div className="log-center-metric warn">{selectedDevice.warnCount}</div>
              <div className="log-center-note">WARN 事件</div>
            </div>
            <div className="log-center-summary-card">
              <div className="log-center-label">异常</div>
              <div className="log-center-metric error">{selectedDevice.errorCount}</div>
              <div className="log-center-note">ERROR 事件</div>
            </div>
            <div className="log-center-summary-card">
              <div className="log-center-label">完整日志</div>
              <div className="log-center-metric ok">{selectedDevice.fileCount ?? 0}</div>
              <div className="log-center-note">最近同步：{formatDateTime(selectedDevice.latestFileUploadedAt)}</div>
            </div>
          </div>

          <section className="log-center-panel">
            <div className="log-center-panel-header">
              <div>
                <div className="log-center-panel-title">日志日期</div>
                <div className="log-center-panel-note">点击日期卡片进入当天日志详情</div>
              </div>
            </div>
            <div className="log-center-card-grid">
              {dateQuery.isLoading ? <div className="log-center-loading"><Skeleton active /></div> : null}
              {dateQuery.isError ? <Alert type="error" message="日志日期加载失败" description={dateQuery.error.message} showIcon /> : null}
              {!dateQuery.isLoading && !dateQuery.isError && dates.length === 0 ? <div className="log-center-empty">这台手机还没有日志日期</div> : null}
              {dates.map((item) => (
                <button className="log-center-device-card" key={item.logDate} type="button" onClick={() => openDate(item.logDate)}>
                  <div className="log-center-card-head">
                    <div>
                      <div className="log-center-card-title">{item.logDate}</div>
                      <div className="log-center-panel-note">最近一条：{formatDateTime(item.latestLogAt || item.latestUploadedAt)}</div>
                    </div>
                    <span className={`log-center-badge ${item.errorCount > 0 ? "error" : item.warnCount > 0 ? "warn" : "ok"}`}>
                      {item.errorCount > 0 ? `异常 ${item.errorCount}` : item.warnCount > 0 ? `关注 ${item.warnCount}` : "正常"}
                    </span>
                  </div>
                  <div className="log-center-mini-stats">
                    <div><span>动态</span><strong>{item.totalCount}</strong></div>
                    <div><span>警告</span><strong>{item.warnCount}</strong></div>
                    <div><span>完整日志</span><strong>{item.fileCount ?? 0}</strong></div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        </section>
      </div>
    );
  }

  return (
    <div className="log-center-page">
      {contextHolder}
      <header className="log-center-topbar">
        <div className="log-center-title-wrap">
          <button className="log-center-back" type="button" aria-label="返回日期列表" onClick={backToDates}>‹</button>
          <div>
            <h1 className="log-center-title">{title}</h1>
            <div className="log-center-subtitle">脚本自动同步日志，功能状态每 {refreshLabel(autoRefreshSeconds)}</div>
          </div>
        </div>
        <div className="log-center-actions">
          <Select
            className="log-center-select"
            value={effectiveDeviceCode}
            onChange={(value) => { setSelectedDeviceCode(value); setSelectedDateValue(undefined); }}
            options={deviceOptions}
          />
          <Select
            className="log-center-date"
            value={effectiveDate}
            loading={dateQuery.isLoading}
            onChange={(value) => { setSelectedDateValue(value); setLogsPage(1); }}
            options={dates.map((item) => ({ value: item.logDate, label: item.logDate }))}
          />
          <Select
            className="log-center-status"
            allowClear
            placeholder="全部状态"
            value={level}
            onChange={(value) => { setLevel(value); setLogsPage(1); }}
            options={[
              { value: "ERROR", label: "异常" },
              { value: "WARN", label: "需要关注" },
              { value: "INFO", label: "正常" }
            ]}
          />
          <Input.Search
            className="log-center-search"
            placeholder="搜索事件、关键词、直播间"
            allowClear
            onSearch={(value) => { setKeyword(value); setLogsPage(1); }}
            onChange={(event) => { if (!event.target.value) { setKeyword(""); setLogsPage(1); } }}
          />
          <Select
            className="log-center-refresh"
            value={autoRefreshSeconds}
            onChange={setAutoRefreshSeconds}
            options={[
              { label: "5秒刷新", value: 5 },
              { label: "15秒刷新", value: 15 },
              { label: "30秒刷新", value: 30 },
              { label: "暂停刷新", value: 0 }
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => { void logsQuery.refetch(); void fileQuery.refetch(); void fileDetailQuery.refetch(); }} />
        </div>
      </header>

      <section className="log-center-content">
        <nav className="log-center-tabs" aria-label="日志标签">
          <button className={activeTab === "status" ? "active" : ""} type="button" onClick={() => setActiveTab("status")}>功能状态</button>
          <button className={activeTab === "issues" ? "active" : ""} type="button" onClick={() => setActiveTab("issues")}>异常汇总</button>
          <button className={activeTab === "full" ? "active" : ""} type="button" onClick={() => setActiveTab("full")}>完整日志</button>
        </nav>

        <div className="log-center-summary-grid">
          <div className="log-center-summary-card">
            <div className="log-center-label">今日功能状态</div>
            <div className="log-center-metric">{selectedDate?.totalCount ?? logs.length}</div>
            <div className="log-center-note">最近一条：{formatClock(selectedDate?.latestLogAt || selectedDevice?.latestLogAt)}</div>
          </div>
          <div className="log-center-summary-card">
            <div className="log-center-label">需要关注</div>
            <div className="log-center-metric warn">{selectedDate?.warnCount ?? 0}</div>
            <div className="log-center-note">WARN 事件会进入异常汇总</div>
          </div>
          <div className="log-center-summary-card">
            <div className="log-center-label">异常</div>
            <div className="log-center-metric error">{selectedDate?.errorCount ?? 0}</div>
            <div className="log-center-note">{Number(selectedDate?.errorCount ?? 0) > 0 ? "存在影响任务的问题" : "当前没有中断任务的问题"}</div>
          </div>
          <div className="log-center-summary-card">
            <div className="log-center-label">完整日志同步</div>
            <div className="log-center-metric ok">{syncState}</div>
            <div className="log-center-note">{formatBytes(selectedDate?.fileSizeBytes)}，错误 {selectedFile?.errorCount ?? selectedDate?.errorCount ?? 0}，警告 {selectedFile?.warnCount ?? selectedDate?.warnCount ?? 0}</div>
          </div>
        </div>

        <div className="log-center-work-area">
          <section className="log-center-panel">
            <div className="log-center-panel-header">
              <div>
                <div className="log-center-panel-title">{activeTab === "full" ? "完整日志" : activeTab === "issues" ? "异常汇总" : "功能状态"}</div>
                <div className="log-center-panel-note">默认只看设备在线、配置同步、采集链路、日志同步等关键状态；完整日志进入独立标签</div>
              </div>
              <Button
                icon={<DownloadOutlined />}
                disabled={!selectedFile}
                onClick={() => selectedFile && downloadText(selectedFile.fileName || `${effectiveDate}.log`, selectedFile.content || "")}
              >
                导出当天记录
              </Button>
            </div>

            {activeTab === "full" ? (
              <div className="log-center-full-main">
                <div className="log-center-full-meta">
                  <span>{selectedFile?.fileName || `${effectiveDate || "today"}.log`}</span>
                  <span>最后同步：{formatDateTime(latestUploadedAt)}</span>
                  <span>大小：{formatBytes(selectedFile?.fileSizeBytes || selectedDate?.fileSizeBytes)}</span>
                </div>
                <pre className="log-center-log-box large">{fullLogText}</pre>
              </div>
            ) : (
              <>
                {(dateQuery.isLoading || logsQuery.isLoading) ? <div className="log-center-loading"><Skeleton active /></div> : null}
                {logsQuery.isError ? <Alert type="error" message="日志加载失败" description={logsQuery.error.message} showIcon /> : null}
                {!logsQuery.isLoading && visibleLogs.length === 0 ? <Empty className="log-center-empty" description={activeTab === "issues" ? "当前没有需要关注的日志" : "暂无功能状态"} /> : null}
                {visibleLogs.length > 0 ? (
                  <>
                    {renderLogPagination()}
                    <div className="log-center-table-wrap">
                      <table className="log-center-table">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>状态</th>
                            <th>发生了什么</th>
                            <th>所在环节</th>
                            <th>涉及内容</th>
                            <th>是否影响任务</th>
                            <th>建议处理</th>
                            <th>详情</th>
                          </tr>
                        </thead>
                        <tbody>
                          {visibleLogs.map((log) => (
                            <tr key={log.id}>
                              <td className="log-center-time">
                                <div>{formatClock(log.latestCreatedAt || log.createdAt)}</div>
                                {log.duplicateCount > 1 ? <span className="log-center-badge warn">重复 {log.duplicateCount} 次</span> : null}
                              </td>
                              <td>{statusBadge(log)}</td>
                              <td>
                                <div className="log-center-event-title">{eventTitle(log)}</div>
                                <div className="log-center-event-sub">{eventSub(log)}</div>
                              </td>
                              <td>{phaseBadge(log)}</td>
                              <td>{involvedText(log)}</td>
                              <td className="log-center-impact">{impactText(log)}</td>
                              <td>{suggestionText(log)}</td>
                              <td><button className="log-center-action-link" type="button" onClick={() => setPreviewLog(log)}>查看</button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {renderLogPagination()}
                  </>
                ) : null}
              </>
            )}
          </section>

          <aside className="log-center-side-panel">
            <div className="log-center-side-block">
              <div className="log-center-panel-title">完整日志</div>
              <div className="log-center-sync-state">
                <div>
                  <div className="log-center-sync-title">{selectedFile ? "自动同步中" : "等待手机同步"}</div>
                  <div className="log-center-panel-note">最后同步：{formatClock(latestUploadedAt)}</div>
                </div>
                <Button size="small" disabled={!effectiveDeviceCode} loading={syncLogMutation.isPending} onClick={() => syncLogMutation.mutate()}>重新同步</Button>
              </div>
              <div className="log-center-mini-list">
                <div className="log-center-mini-item"><div>文件</div><span>{selectedFile?.fileName || `${effectiveDate || "-"}.log`}</span></div>
                <div className="log-center-mini-item"><div>大小</div><span>{formatBytes(selectedFile?.fileSizeBytes || selectedDate?.fileSizeBytes)}</span></div>
                <div className="log-center-mini-item"><div>警告</div><span>{selectedFile?.warnCount ?? selectedDate?.warnCount ?? 0} 条</span></div>
                <div className="log-center-mini-item"><div>错误</div><span>{selectedFile?.errorCount ?? selectedDate?.errorCount ?? 0} 条</span></div>
              </div>
              <pre className="log-center-log-box">{latestLogContent(selectedFile?.content, 20) || fullLogText}</pre>
            </div>

            <div className="log-center-side-block">
              <div className="log-center-panel-title">最近需要关注</div>
              <div className="log-center-mini-list">
                {displayIssueLogs.slice(0, 3).map((log) => (
                  <div className="log-center-mini-item" key={log.id}>
                    <div>{formatClock(log.latestCreatedAt || log.createdAt)}</div>
                    <span>{eventTitle(log)}{log.duplicateCount > 1 ? `（重复 ${log.duplicateCount} 次）` : ""}</span>
                  </div>
                ))}
                {displayIssueLogs.length === 0 ? <div className="log-center-panel-note">当前没有需要关注的事件</div> : null}
              </div>
            </div>

            <div className="log-center-side-block">
              <div className="log-center-panel-title">当前设备</div>
              <div className="log-center-mini-list">
                <div className="log-center-mini-item"><div>状态</div><span>{statusText(selectedDevice?.deviceStatus)}</span></div>
                <div className="log-center-mini-item"><div>心跳</div><span>{formatDateTime(selectedDevice?.lastHeartbeatAt)}</span></div>
                <div className="log-center-mini-item"><div>结构化</div><span>{selectedDate?.totalCount ?? 0} 条</span></div>
                <div className="log-center-mini-item"><div>完整日志</div><span>{selectedDate?.fileCount ?? 0} 个文件</span></div>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {previewLog ? (
        <aside className="log-center-drawer" aria-label="日志详情">
          <div className="log-center-panel-header">
            <div>
              <div className="log-center-panel-title">日志详情</div>
              <div className="log-center-panel-note">{formatClock(previewLog.createdAt)} · {phaseText(previewLog)}</div>
            </div>
            <button className="log-center-close" type="button" onClick={() => setPreviewLog(null)}>关闭</button>
          </div>
          <div className="log-center-drawer-body">
            <section>
              <h3>发生了什么</h3>
              <p>{eventTitle(previewLog)}</p>
            </section>
            <section>
              <h3>对任务的影响</h3>
              <p>{impactText(previewLog)}。{eventSub(previewLog)}</p>
            </section>
            <section>
              <h3>建议处理</h3>
              <p>{suggestionText(previewLog)}</p>
            </section>
            <section>
              <h3>手机当时状态</h3>
              <p>所在环节：{phaseText(previewLog)}；涉及内容：{involvedText(previewLog)}。</p>
            </section>
            <section>
              <h3>技术详情</h3>
              <pre className="log-center-tech-box">{`level: ${levelText(previewLog.level)}
phase: ${phaseText(previewLog)}
reason: ${reasonText(previewLog)}
context:
${JSON.stringify(previewLog.contextJson ?? {}, null, 2)}`}</pre>
            </section>
          </div>
        </aside>
      ) : null}
    </div>
  );
}
