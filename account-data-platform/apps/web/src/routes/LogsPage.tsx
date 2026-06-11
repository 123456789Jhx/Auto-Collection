import { ArrowLeftOutlined, CalendarOutlined, DownloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Collapse, Empty, Input, Modal, Row, Select, Skeleton, Space, Statistic, Table, Tag, Typography, message } from "antd";
import { useMemo, useState } from "react";
import { createMobileCommand, getLogDates, getLogDeviceSummary, getLogFileDetail, getLogFiles, getLogs } from "../lib/api-client";
import { levelColor, levelText, statusColor, statusText, stopReasonText } from "../lib/display-maps";

type LogDeviceSummary = {
  deviceCode?: string;
  deviceName?: string;
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

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function formatBytes(value?: number) {
  const size = Number(value ?? 0);
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
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

function resultText(log: RuntimeLog) {
  if (log.level === "ERROR") return "失败";
  if (log.level === "WARN") return "警告";
  if (/成功|完成|已执行|已应用|结束|上传完成|写入/.test(log.message || "")) return "成功";
  return "信息";
}

function resultColor(log: RuntimeLog) {
  if (log.level === "ERROR") return "red";
  if (log.level === "WARN") return "orange";
  if (resultText(log) === "成功") return "green";
  return "blue";
}

function reasonText(log: RuntimeLog) {
  const context = log.contextJson || {};
  const reason = log.stopReason || String(context.reason || context.message || context.error || "");
  return reason ? stopReasonText(reason) : "-";
}

function shortText(value?: string | null, maxLength = 80) {
  const text = String(value || "");
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function phaseText(log: RuntimeLog) {
  const context = log.contextJson || {};
  const phase = String(context.phase || context.sceneType || context.currentTask || "");
  if (phase === "video") return "视频";
  if (phase === "live") return "直播";
  if (phase) return phase;
  if (/搜索/.test(log.message || "")) return "搜索";
  if (/直播/.test(log.message || "")) return "直播";
  if (/视频/.test(log.message || "")) return "视频";
  if (/心跳/.test(log.message || "")) return "心跳";
  if (/上传/.test(log.message || "")) return "上传";
  return "-";
}

function keywordText(log: RuntimeLog) {
  const context = log.contextJson || {};
  return String(context.keyword || context.searchKeyword || "");
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

export function LogsPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedDevice, setSelectedDevice] = useState<LogDeviceSummary | null>(null);
  const [selectedDate, setSelectedDate] = useState<LogDateSummary | null>(null);
  const [previewLog, setPreviewLog] = useState<RuntimeLog | null>(null);
  const [level, setLevel] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(15);

  const summaryQuery = useQuery({
    queryKey: ["log-device-summary"],
    queryFn: () => getLogDeviceSummary(),
    refetchInterval: autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });
  const dateQuery = useQuery({
    queryKey: ["log-dates", selectedDevice?.deviceCode],
    queryFn: () => getLogDates(selectedDevice?.deviceCode || ""),
    enabled: !!selectedDevice?.deviceCode
  });
  const fileQuery = useQuery({
    queryKey: ["log-files", selectedDevice?.deviceCode, selectedDate?.logDate],
    queryFn: () => getLogFiles({ deviceCode: selectedDevice?.deviceCode, logDate: selectedDate?.logDate }),
    enabled: !!selectedDevice?.deviceCode && !!selectedDate?.logDate
  });
  const files = (fileQuery.data ?? []) as LogFile[];
  const latestFile = files[0] ?? null;
  const fileDetailQuery = useQuery({
    queryKey: ["log-file-detail", latestFile?.id],
    queryFn: () => getLogFileDetail(latestFile?.id || ""),
    enabled: !!latestFile?.id
  });
  const logsQuery = useQuery({
    queryKey: ["logs", selectedDevice?.deviceCode, selectedDate?.logDate, level, keyword],
    queryFn: () => getLogs({
      deviceCode: selectedDevice?.deviceCode,
      level,
      keyword,
      createdFrom: dayBoundary(selectedDate?.logDate),
      createdTo: dayBoundary(nextDate(selectedDate?.logDate)),
      pageSize: 100
    }),
    enabled: !!selectedDevice?.deviceCode && !!selectedDate?.logDate,
    refetchInterval: autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });
  const uploadLogMutation = useMutation({
    mutationFn: (deviceCode: string) => createMobileCommand({ deviceId: deviceCode, commandType: "UPLOAD_LOG", expiresInSeconds: 3600 }),
    onSuccess: () => {
      messageApi.success("上传日志指令已下发");
      void queryClient.invalidateQueries({ queryKey: ["log-files"] });
      void queryClient.invalidateQueries({ queryKey: ["log-dates"] });
      void queryClient.invalidateQueries({ queryKey: ["log-device-summary"] });
    },
    onError: (error) => messageApi.error(error.message)
  });

  const logs = useMemo(() => (logsQuery.data?.data ?? []) as RuntimeLog[], [logsQuery.data]);
  const selectedFile = (fileDetailQuery.data ?? latestFile ?? null) as LogFile | null;

  if (summaryQuery.isLoading) return <Skeleton active />;
  if (summaryQuery.isError) return <Alert type="error" message="日志加载失败" description={summaryQuery.error.message} showIcon />;

  if (!selectedDevice) {
    const summaries = (summaryQuery.data ?? []) as LogDeviceSummary[];
    return (
      <Card title="按手机查看日志" extra={<RefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />}>
        {contextHolder}
        {summaries.length === 0 ? <Empty description="暂无设备" /> : null}
        <Row gutter={[12, 12]}>
          {summaries.map((item) => (
            <Col xs={24} md={12} xl={8} key={item.deviceCode || item.deviceName}>
              <Card className="device-card" hoverable onClick={() => { setSelectedDevice(item); setSelectedDate(null); }}>
                <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
                  <Space direction="vertical" size={2}>
                    <Typography.Text strong>{item.deviceName || item.deviceCode || "未知设备"}</Typography.Text>
                    <Typography.Text type="secondary">{item.deviceCode || "-"}</Typography.Text>
                  </Space>
                  <Tag color={statusColor(item.deviceStatus)}>{statusText(item.deviceStatus)}</Tag>
                </Space>
                <Row gutter={12} className="card-stats">
                  <Col span={6}><Statistic title="结构化" value={item.totalCount} /></Col>
                  <Col span={6}><Statistic title="完整文件" value={item.fileCount ?? 0} /></Col>
                  <Col span={6}><Statistic title="警告" value={item.warnCount} /></Col>
                  <Col span={6}><Statistic title="失败" value={item.errorCount} valueStyle={{ color: item.errorCount > 0 ? "#cf1322" : undefined }} /></Col>
                </Row>
                <Space direction="vertical" size={0}>
                  <Typography.Text type="secondary">最近日志：{formatDateTime(item.latestLogAt)}</Typography.Text>
                  <Typography.Text type="secondary">最近心跳：{formatDateTime(item.lastHeartbeatAt)}</Typography.Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
    );
  }

  if (!selectedDate) {
    const dates = (dateQuery.data ?? []) as LogDateSummary[];
    return (
      <Card
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => setSelectedDevice(null)} />
            <span>{selectedDevice.deviceName || selectedDevice.deviceCode} 的日志日期</span>
          </Space>
        }
        extra={<Button icon={<DownloadOutlined />} loading={uploadLogMutation.isPending} onClick={() => selectedDevice.deviceCode && uploadLogMutation.mutate(selectedDevice.deviceCode)}>拉取手机日志</Button>}
      >
        {contextHolder}
        {dateQuery.isLoading ? <Skeleton active /> : null}
        {!dateQuery.isLoading && dates.length === 0 ? <Empty description="暂无日志日期" /> : null}
        <Row gutter={[12, 12]}>
          {dates.map((item) => (
            <Col xs={24} md={12} xl={8} key={item.logDate}>
              <Card className="device-card" hoverable onClick={() => setSelectedDate(item)}>
                <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
                  <Space direction="vertical" size={2}>
                    <Typography.Text strong>{item.logDate}</Typography.Text>
                    <Typography.Text type="secondary">最近：{formatDateTime(item.latestLogAt || item.latestUploadedAt)}</Typography.Text>
                  </Space>
                  <CalendarOutlined className="card-icon" />
                </Space>
                <Row gutter={12} className="card-stats">
                  <Col span={6}><Statistic title="结构化" value={item.totalCount} /></Col>
                  <Col span={6}><Statistic title="完整文件" value={item.fileCount ?? 0} /></Col>
                  <Col span={6}><Statistic title="警告" value={item.warnCount} /></Col>
                  <Col span={6}><Statistic title="失败" value={item.errorCount} valueStyle={{ color: item.errorCount > 0 ? "#cf1322" : undefined }} /></Col>
                </Row>
                <Typography.Text type="secondary">文件大小：{formatBytes(item.fileSizeBytes)}</Typography.Text>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
    );
  }

  return (
    <Card
      title={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => setSelectedDate(null)} />
          <span>{selectedDevice.deviceName || selectedDevice.deviceCode} / {selectedDate.logDate}</span>
        </Space>
      }
      extra={
        <Space>
          <Select
            allowClear
            placeholder="级别"
            value={level}
            onChange={setLevel}
            style={{ width: 120 }}
            options={[
              { value: "INFO", label: "信息" },
              { value: "WARN", label: "警告" },
              { value: "ERROR", label: "失败" }
            ]}
          />
          <Input.Search placeholder="日志关键词" allowClear onSearch={setKeyword} style={{ width: 220 }} />
          <RefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />
        </Space>
      }
    >
      <Space direction="vertical" style={{ width: "100%" }} size={16}>
        <Card size="small" title="结构化日志明细">
          {logsQuery.isLoading ? <Skeleton active /> : null}
          {logsQuery.isError ? <Alert type="error" message="日志加载失败" description={logsQuery.error.message} showIcon /> : null}
          {!logsQuery.isLoading && logs.length === 0 ? <Empty description="暂无结构化日志" /> : null}
          <Table rowKey={(row) => String((row as RuntimeLog).id)} dataSource={logs} scroll={{ x: 1100 }} pagination={{ pageSize: 20 }}>
            <Table.Column title="时间" dataIndex="createdAt" width={180} render={(value) => formatDateTime(value as string | undefined)} />
            <Table.Column title="阶段" width={90} render={(_, row) => phaseText(row as RuntimeLog)} />
            <Table.Column title="级别" dataIndex="level" width={90} render={(value) => <Tag color={levelColor(value as string)}>{levelText(value as string)}</Tag>} />
            <Table.Column title="结果" width={90} render={(_, row) => <Tag color={resultColor(row as RuntimeLog)}>{resultText(row as RuntimeLog)}</Tag>} />
            <Table.Column title="关键词" width={140} render={(_, row) => keywordText(row as RuntimeLog) || "-"} />
            <Table.Column title="消息" dataIndex="message" ellipsis render={(value) => shortText(value as string, 120)} />
            <Table.Column title="原因" width={220} render={(_, row) => shortText(reasonText(row as RuntimeLog), 80)} />
            <Table.Column title="操作" width={90} render={(_, row) => <Button size="small" onClick={() => setPreviewLog(row as RuntimeLog)}>预览</Button>} />
          </Table>
        </Card>

        <Collapse
          items={[{
            key: "raw-log",
            label: "当天完整日志源文件",
            children: (
              <Card
                size="small"
                extra={
                  <Button
                    icon={<DownloadOutlined />}
                    disabled={!selectedFile}
                    onClick={() => selectedFile && downloadText(selectedFile.fileName || `${selectedDate.logDate}.log`, selectedFile.content || "")}
                  >
                    下载完整日志
                  </Button>
                }
              >
                {fileQuery.isLoading || fileDetailQuery.isLoading ? <Skeleton active /> : null}
                {!fileQuery.isLoading && !selectedFile ? (
                  <Alert type="info" message="当天还没有完整日志文件" description="可以返回日期页点击“拉取手机日志”，等待手机上传。" showIcon />
                ) : null}
                {selectedFile ? (
                  <Space direction="vertical" style={{ width: "100%" }} size={12}>
                    <Row gutter={12}>
                      <Col xs={24} md={6}><Statistic title="文件名" value={selectedFile.fileName || `${selectedDate.logDate}.log`} /></Col>
                      <Col xs={24} md={6}><Statistic title="大小" value={formatBytes(selectedFile.fileSizeBytes)} /></Col>
                      <Col xs={24} md={6}><Statistic title="上传时间" value={formatDateTime(selectedFile.uploadedAt)} /></Col>
                      <Col xs={24} md={6}><Statistic title="错误数" value={selectedFile.errorCount ?? 0} valueStyle={{ color: Number(selectedFile.errorCount ?? 0) > 0 ? "#cf1322" : undefined }} /></Col>
                    </Row>
                    {selectedFile.lastErrorReason ? <Alert type="warning" message="最近异常" description={selectedFile.lastErrorReason} showIcon /> : null}
                    <pre className="log-preview compact-log-preview">{selectedFile.content || ""}</pre>
                  </Space>
                ) : null}
              </Card>
            )
          }]}
        />
      </Space>
      <Modal title="日志预览" open={!!previewLog} onCancel={() => setPreviewLog(null)} footer={null} width={760}>
        <pre className="log-preview">
{previewLog ? `[${formatDateTime(previewLog.createdAt)}] [${previewLog.level}] ${previewLog.message}
阶段：${phaseText(previewLog)}
结果：${resultText(previewLog)}
关键词：${keywordText(previewLog) || "-"}
原因：${reasonText(previewLog)}

${JSON.stringify(previewLog.contextJson ?? {}, null, 2)}` : ""}
        </pre>
      </Modal>
    </Card>
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
