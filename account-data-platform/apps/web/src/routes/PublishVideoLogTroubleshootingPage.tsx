import { ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Drawer, Empty, Input, Select, Skeleton, Space, Table, Tag, Typography, type TableColumnsType } from "antd";
import { useMemo, useState } from "react";
import { getLogDeviceSummary, getLogs } from "../lib/api-client";
import {
  buildRuntimeLogSearchText,
  classifyPublishLogMilestones,
  matchesPublishTaskId,
  matchesTroubleshootingKeywords,
  parseTroubleshootingKeywords,
  publishMilestoneDefinitions,
  publishTroubleshootingPresetKeywords,
  summarizePublishMilestones,
  type PublishTroubleshootingRuntimeLog
} from "../lib/publish-video-log-troubleshooting";

const maxTroubleshootingLogPages = 5;
const troubleshootingPageSize = 100;

type LogDeviceSummary = {
  deviceCode?: string;
  deviceName?: string;
  totalCount?: number;
  latestLogAt?: string | null;
};

type Pagination = {
  page?: number;
  pageSize?: number;
  totalItems?: number;
  totalPages?: number;
};

type RuntimeLogResponse = {
  data?: unknown[];
  pagination?: Pagination;
};

type TroubleshootingFilters = {
  deviceCode?: string;
  createdFrom: string;
  createdTo: string;
  level?: string;
  taskId: string;
  manualKeyword: string;
  presetKeywords: string[];
};

function dateInputValue(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function recentRange(minutes: number) {
  const end = new Date();
  const start = new Date(end.getTime() - minutes * 60_000);
  return { createdFrom: dateInputValue(start), createdTo: dateInputValue(end) };
}

function todayRange() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return { createdFrom: dateInputValue(start), createdTo: dateInputValue(new Date()) };
}

function toIso(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function logTimeValue(log: PublishTroubleshootingRuntimeLog) {
  const value = log.createdAt || log.reportedAt || "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function normalizeLogRow(value: unknown): PublishTroubleshootingRuntimeLog {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    id: String(row.id ?? `${row.createdAt ?? ""}-${row.message ?? ""}`),
    createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
    reportedAt: typeof row.reportedAt === "string" ? row.reportedAt : null,
    level: typeof row.level === "string" ? row.level : null,
    message: typeof row.message === "string" ? row.message : null,
    stopReason: typeof row.stopReason === "string" ? row.stopReason : null,
    contextJson: row.contextJson && typeof row.contextJson === "object" ? row.contextJson as Record<string, unknown> : null,
    deviceCode: typeof row.deviceCode === "string" ? row.deviceCode : null,
    deviceName: typeof row.deviceName === "string" ? row.deviceName : null
  };
}

function contextSummary(log: PublishTroubleshootingRuntimeLog) {
  const context = log.contextJson ?? {};
  const entries = [
    ["taskId", context.taskId],
    ["action", context.action ?? context.actionName],
    ["phase", context.phase ?? context.stage ?? context.currentTask],
    ["reason", context.reason ?? context.failureReason],
    ["bytes", context.videoBytes ?? context.coverBytes]
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) return "-";
  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" / ");
}

function milestoneLabel(log: PublishTroubleshootingRuntimeLog) {
  const keys = classifyPublishLogMilestones(log);
  if (keys.length === 0) return "未归类";
  return keys
    .map((key) => publishMilestoneDefinitions.find((definition) => definition.key === key)?.label ?? key)
    .join("、");
}

function levelColor(level?: string | null) {
  if (level === "ERROR") return "red";
  if (level === "WARN") return "orange";
  return "blue";
}

function deviceLabel(device: LogDeviceSummary) {
  const name = device.deviceName || "未命名设备";
  return device.deviceCode ? `${name} / ${device.deviceCode}` : name;
}

async function fetchTroubleshootingLogs(filters: TroubleshootingFilters) {
  const createdFrom = toIso(filters.createdFrom);
  const createdTo = toIso(filters.createdTo);
  const pages: RuntimeLogResponse[] = [];
  for (let page = 1; page <= maxTroubleshootingLogPages; page += 1) {
    const result = await getLogs({
      deviceCode: filters.deviceCode,
      level: filters.level,
      createdFrom,
      createdTo,
      page,
      pageSize: troubleshootingPageSize
    }) as RuntimeLogResponse;
    pages.push(result);
    const totalPages = Number(result.pagination?.totalPages ?? 1);
    if (page >= totalPages) break;
  }

  const byId = new Map<string, PublishTroubleshootingRuntimeLog>();
  pages.flatMap((page) => page.data ?? []).map(normalizeLogRow).forEach((log) => {
    byId.set(log.id, log);
  });
  const rawLogs = Array.from(byId.values()).sort((left, right) => logTimeValue(left) - logTimeValue(right));
  const keywords = [
    ...filters.presetKeywords,
    ...parseTroubleshootingKeywords(filters.manualKeyword)
  ];
  const filteredLogs = rawLogs.filter((log) =>
    matchesPublishTaskId(log, filters.taskId) && matchesTroubleshootingKeywords(log, keywords)
  );
  return {
    rawLogs,
    logs: filteredLogs,
    totalItems: Number(pages[0]?.pagination?.totalItems ?? rawLogs.length),
    scannedItems: rawLogs.length,
    capped: Number(pages[0]?.pagination?.totalItems ?? 0) > maxTroubleshootingLogPages * troubleshootingPageSize
  };
}

export function PublishVideoLogTroubleshootingContent() {
  const defaultRange = useMemo(() => recentRange(120), []);
  const [filters, setFilters] = useState<TroubleshootingFilters>({
    ...defaultRange,
    taskId: "",
    manualKeyword: "",
    presetKeywords: [...publishTroubleshootingPresetKeywords]
  });
  const [appliedFilters, setAppliedFilters] = useState<TroubleshootingFilters | null>(null);
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(0);
  const [previewLog, setPreviewLog] = useState<PublishTroubleshootingRuntimeLog | null>(null);
  const refreshInterval = autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false;

  const devicesQuery = useQuery({
    queryKey: ["publishVideoLogTroubleshootingDevices"],
    queryFn: () => getLogDeviceSummary()
  });
  const logsQuery = useQuery({
    queryKey: ["publishVideoLogTroubleshooting", appliedFilters],
    queryFn: () => fetchTroubleshootingLogs(appliedFilters as TroubleshootingFilters),
    enabled: !!appliedFilters,
    refetchInterval: appliedFilters ? refreshInterval : false
  });

  const deviceOptions = ((devicesQuery.data ?? []) as LogDeviceSummary[])
    .filter((device) => device.deviceCode)
    .map((device) => ({ value: device.deviceCode as string, label: deviceLabel(device) }));
  const logs = logsQuery.data?.logs ?? [];
  const milestoneSummary = summarizePublishMilestones(logs);
  const gateStart = milestoneSummary.find((item) => item.key === "gateStart")?.matched;
  const gateDone = milestoneSummary.find((item) => item.key === "gateDone")?.matched;
  const gateTimeout = milestoneSummary.find((item) => item.key === "gateTimeout")?.matched;
  const gateHint = gateStart && !gateDone && gateTimeout;

  const columns: TableColumnsType<PublishTroubleshootingRuntimeLog> = [
    {
      title: "时间",
      dataIndex: "createdAt",
      width: 180,
      render: (_, record) => formatDateTime(record.createdAt || record.reportedAt)
    },
    {
      title: "级别",
      dataIndex: "level",
      width: 90,
      render: (value) => <Tag color={levelColor(value)}>{value || "INFO"}</Tag>
    },
    {
      title: "命中步骤",
      key: "milestone",
      width: 180,
      render: (_, record) => <Tag>{milestoneLabel(record)}</Tag>
    },
    {
      title: "设备",
      key: "device",
      width: 150,
      render: (_, record) => record.deviceCode || record.deviceName || "-"
    },
    {
      title: "消息",
      dataIndex: "message",
      ellipsis: true,
      render: (value) => value || "-"
    },
    {
      title: "关键上下文",
      key: "context",
      ellipsis: true,
      render: (_, record) => <span className="publish-log-context-preview">{contextSummary(record)}</span>
    },
    {
      title: "详情",
      key: "actions",
      width: 90,
      render: (_, record) => <Button type="link" onClick={() => setPreviewLog(record)}>查看</Button>
    }
  ];

  const applyRange = (range: { createdFrom: string; createdTo: string }) => {
    setFilters((current) => ({ ...current, ...range }));
  };

  const submit = () => setAppliedFilters({ ...filters });
  const reset = () => {
    const range = recentRange(120);
    setFilters({
      ...range,
      taskId: "",
      manualKeyword: "",
      presetKeywords: [...publishTroubleshootingPresetKeywords]
    });
    setAppliedFilters(null);
  };

  return (
    <div className="publish-log-troubleshooting">
      <Alert
        type="info"
        showIcon
        message="视频发布日志排障"
        description="按设备和时间窗口查询运行日志，快速核对预加载、素材下载、选择素材闸口和超时链路；完整日志仍请到日志中心查看。"
      />

      <section className="ops-panel publish-log-panel">
        <div className="ops-panel-head"><span>查询条件</span></div>
        <div className="ops-panel-body">
          <div className="publish-log-filter-grid">
            <label>
              <span>设备</span>
              <Select
                allowClear
                showSearch
                placeholder="选择设备"
                loading={devicesQuery.isLoading}
                value={filters.deviceCode}
                options={deviceOptions}
                onChange={(value) => setFilters((current) => ({ ...current, deviceCode: value }))}
              />
            </label>
            <label>
              <span>开始时间</span>
              <Input
                type="datetime-local"
                value={filters.createdFrom}
                onChange={(event) => setFilters((current) => ({ ...current, createdFrom: event.target.value }))}
              />
            </label>
            <label>
              <span>结束时间</span>
              <Input
                type="datetime-local"
                value={filters.createdTo}
                onChange={(event) => setFilters((current) => ({ ...current, createdTo: event.target.value }))}
              />
            </label>
            <label>
              <span>任务 ID</span>
              <Input
                allowClear
                placeholder="可粘贴 ce47..."
                value={filters.taskId}
                onChange={(event) => setFilters((current) => ({ ...current, taskId: event.target.value }))}
              />
            </label>
            <label>
              <span>日志级别</span>
              <Select
                allowClear
                placeholder="全部级别"
                value={filters.level}
                onChange={(value) => setFilters((current) => ({ ...current, level: value }))}
                options={[
                  { label: "INFO", value: "INFO" },
                  { label: "WARN", value: "WARN" },
                  { label: "ERROR", value: "ERROR" }
                ]}
              />
            </label>
            <label>
              <span>手动关键词</span>
              <Input
                allowClear
                placeholder="多个关键词用逗号或换行分隔"
                value={filters.manualKeyword}
                onChange={(event) => setFilters((current) => ({ ...current, manualKeyword: event.target.value }))}
              />
            </label>
          </div>

          <div className="publish-log-quick-actions">
            <Space wrap>
              <Button size="small" onClick={() => applyRange(recentRange(15))}>最近15分钟</Button>
              <Button size="small" onClick={() => applyRange(recentRange(30))}>最近30分钟</Button>
              <Button size="small" onClick={() => applyRange(recentRange(60))}>最近1小时</Button>
              <Button size="small" onClick={() => applyRange(todayRange())}>今天</Button>
            </Space>
            <Select
              mode="multiple"
              className="publish-log-preset-select"
              placeholder="预设关键词"
              value={filters.presetKeywords}
              options={publishTroubleshootingPresetKeywords.map((keyword) => ({ label: keyword, value: keyword }))}
              onChange={(value) => setFilters((current) => ({ ...current, presetKeywords: value }))}
            />
            <Select
              className="publish-log-refresh-select"
              value={autoRefreshSeconds}
              onChange={setAutoRefreshSeconds}
              options={[
                { label: "暂停刷新", value: 0 },
                { label: "5秒刷新", value: 5 },
                { label: "15秒刷新", value: 15 },
                { label: "30秒刷新", value: 30 }
              ]}
            />
            <Space>
              <Button type="primary" icon={<SearchOutlined />} onClick={submit}>查询</Button>
              <Button icon={<ReloadOutlined />} disabled={!appliedFilters} loading={logsQuery.isFetching} onClick={() => void logsQuery.refetch()}>刷新</Button>
              <Button onClick={reset}>重置</Button>
            </Space>
          </div>
        </div>
      </section>

      {logsQuery.data?.capped ? (
        <Alert type="warning" showIcon message="当前仅扫描最新 500 条，请缩小时间窗口或指定设备" />
      ) : null}
      {gateHint ? (
        <Alert type="warning" showIcon message="选择素材闸口开始后未完成，疑似 openAlbum 前 gate 超时" />
      ) : null}

      <div className="publish-log-milestone-grid">
        {milestoneSummary.map((item) => (
          <div className={`publish-log-milestone-card ${item.matched ? "matched" : "missing"}`} key={item.key}>
            <div className="publish-log-milestone-label">{item.label}</div>
            <div className="publish-log-milestone-state">{item.matched ? "已发现" : "未发现"}</div>
            <div className="publish-log-milestone-meta">
              <span>{item.count} 条</span>
              <span>首次：{formatDateTime(item.firstAt)}</span>
              <span>最近：{formatDateTime(item.lastAt)}</span>
            </div>
          </div>
        ))}
      </div>

      <section className="ops-panel publish-log-panel">
        <div className="ops-panel-head">
          <span>查询结果</span>
          <Typography.Text type="secondary">
            {appliedFilters ? `已扫描 ${logsQuery.data?.scannedItems ?? 0} 条，命中 ${logs.length} 条` : "设置条件后点击查询"}
          </Typography.Text>
        </div>
        <div className="ops-panel-body">
          {logsQuery.isLoading ? <Skeleton active /> : null}
          {logsQuery.isError ? <Alert type="error" showIcon message="日志查询失败" description={logsQuery.error.message} /> : null}
          {!logsQuery.isLoading && appliedFilters && logs.length === 0 ? <Empty description="当前条件下未发现匹配的发布日志" /> : null}
          {logs.length > 0 ? (
            <Table<PublishTroubleshootingRuntimeLog>
              rowKey="id"
              columns={columns}
              dataSource={logs}
              pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
              scroll={{ x: 1200 }}
            />
          ) : null}
        </div>
      </section>

      <Drawer title="日志详情" width={560} open={!!previewLog} onClose={() => setPreviewLog(null)}>
        {previewLog ? (
          <div className="publish-log-detail">
            <Typography.Title level={5}>{previewLog.message || "手机上报运行事件"}</Typography.Title>
            <p>创建时间：{formatDateTime(previewLog.createdAt)}</p>
            <p>上报时间：{formatDateTime(previewLog.reportedAt)}</p>
            <p>级别：{previewLog.level || "INFO"}</p>
            <p>停止原因：{previewLog.stopReason || "-"}</p>
            <Typography.Text type="secondary">搜索文本</Typography.Text>
            <pre className="publish-log-tech-box">{buildRuntimeLogSearchText(previewLog)}</pre>
            <Typography.Text type="secondary">contextJson</Typography.Text>
            <pre className="publish-log-tech-box">{JSON.stringify(previewLog.contextJson ?? {}, null, 2)}</pre>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
