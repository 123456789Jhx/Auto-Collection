import { CheckCircleOutlined, CloudSyncOutlined, ExclamationCircleOutlined, MobileOutlined, PauseCircleOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Col, Collapse, Drawer, Empty, Progress, Row, Skeleton, Space, Statistic, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { getDeviceDailyProgress, getDeviceProgressHistory, getOverview } from "../lib/api-client";
import { sceneText, statusColor, statusText } from "../lib/display-maps";

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
  heartbeatCount?: number;
  latestHeartbeatAt?: string | null;
  firstHeartbeatAt?: string | null;
  maxVideoElapsedMinutes?: number;
  maxVideoPlannedMinutes?: number;
  videoCompletionPercent?: number;
  maxLiveElapsedMinutes?: number;
  maxLivePlannedMinutes?: number;
  liveCompletionPercent?: number;
  maxViewedCount?: number;
  maxLiveViewedCount?: number;
  maxCapturedCount?: number;
  runningCount?: number;
  pausedCount?: number;
  stoppedCount?: number;
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
  return value && value !== "none" ? sceneText(value) : "无任务";
}

function progressBlock(title: string, elapsed?: number | null, remaining?: number | null, planned?: number | null, color?: string) {
  return (
    <Space direction="vertical" size={4} style={{ width: "100%" }}>
      <Typography.Text type="secondary">{title}</Typography.Text>
      <Progress
        percent={progressPercent(elapsed, remaining, planned)}
        size="small"
        strokeColor={color}
        format={() => progressLabel(elapsed, remaining, planned)}
      />
    </Space>
  );
}

export function DashboardPage() {
  const [selectedDevice, setSelectedDevice] = useState<DeviceProgress | null>(null);
  const query = useQuery({ queryKey: ["overview"], queryFn: getOverview, refetchInterval: 15000 });
  const historyQuery = useQuery({
    queryKey: ["device-progress-history", selectedDevice?.deviceCode],
    queryFn: () => getDeviceProgressHistory(selectedDevice?.deviceCode || "", { limit: 80 }),
    enabled: !!selectedDevice?.deviceCode,
    refetchInterval: selectedDevice ? 15000 : false
  });
  const dailyProgressQuery = useQuery({
    queryKey: ["device-daily-progress", selectedDevice?.deviceCode],
    queryFn: () => getDeviceDailyProgress(selectedDevice?.deviceCode || "", { limit: 30 }),
    enabled: !!selectedDevice?.deviceCode,
    refetchInterval: selectedDevice ? 15000 : false
  });

  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" message="看板加载失败" description={query.error.message} showIcon />;

  const data = query.data ?? {};
  const devices = (Array.isArray(data.deviceProgress) ? data.deviceProgress : []) as DeviceProgress[];
  const selected = selectedDevice ? devices.find((item) => item.deviceCode === selectedDevice.deviceCode) ?? selectedDevice : null;

  return (
    <div>
      <Row gutter={[12, 12]} className="metrics">
        <Col xs={24} md={8} xl={4}>
          <Card className="metric-card"><Statistic title="设备总数" value={Number(data.deviceCount ?? 0)} prefix={<MobileOutlined />} /></Card>
        </Col>
        <Col xs={24} md={8} xl={4}>
          <Card className="metric-card"><Statistic title="运行中" value={Number(data.runningCount ?? 0)} prefix={<PlayCircleOutlined />} valueStyle={{ color: "#1677ff" }} /></Card>
        </Col>
        <Col xs={24} md={8} xl={4}>
          <Card className="metric-card"><Statistic title="暂停" value={Number(data.pausedCount ?? 0)} prefix={<PauseCircleOutlined />} /></Card>
        </Col>
        <Col xs={24} md={8} xl={4}>
          <Card className="metric-card"><Statistic title="今日采集" value={Number(data.todayRecordCount ?? 0)} prefix={<CheckCircleOutlined />} /></Card>
        </Col>
        <Col xs={24} md={8} xl={4}>
          <Card className="metric-card"><Statistic title="今日直播" value={Number(data.todayLiveRecordCount ?? 0)} prefix={<CloudSyncOutlined />} /></Card>
        </Col>
        <Col xs={24} md={8} xl={4}>
          <Card className="metric-card"><Statistic title="今日异常" value={Number(data.todayErrorCount ?? 0)} prefix={<ExclamationCircleOutlined />} valueStyle={{ color: Number(data.todayErrorCount ?? 0) > 0 ? "#cf1322" : undefined }} /></Card>
        </Col>
      </Row>

      <Card title="手机任务进度">
        {devices.length === 0 ? <Empty description="暂无设备" /> : null}
        <Row gutter={[12, 12]}>
          {devices.map((item) => (
            <Col xs={24} md={12} xl={8} key={item.id || item.deviceCode}>
              <Card className="device-card progress-device-card" hoverable onClick={() => setSelectedDevice(item)}>
                <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
                  <Space direction="vertical" size={2}>
                    <Typography.Text strong>{item.deviceName || item.deviceCode}</Typography.Text>
                    <Typography.Text type="secondary">{item.deviceCode}</Typography.Text>
                  </Space>
                  <Tag color={statusColor(item.status)}>{statusText(item.status)}</Tag>
                </Space>
                <Space direction="vertical" size={10} style={{ width: "100%", marginTop: 14 }}>
                  <Space>
                    <Typography.Text type="secondary">当前任务</Typography.Text>
                    <Tag>{currentTaskText(item.currentTask)}</Tag>
                  </Space>
                  {progressBlock("视频进度", item.videoElapsedMinutes, item.videoRemainingMinutes, item.plannedVideoMinutes, "#1677ff")}
                  {progressBlock("直播进度", item.liveElapsedMinutes, item.liveRemainingMinutes, item.plannedLiveMinutes, "#722ed1")}
                  <Row gutter={12}>
                    <Col span={8}><Statistic title="视频浏览" value={item.viewedCount ?? 0} /></Col>
                    <Col span={8}><Statistic title="直播浏览" value={item.liveViewedCount ?? 0} /></Col>
                    <Col span={8}><Statistic title="采集数" value={item.capturedCount ?? 0} /></Col>
                  </Row>
                  <Typography.Text type="secondary">最后心跳：{formatDateTime(item.lastHeartbeatAt)}</Typography.Text>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>

      <Drawer
        title={selected ? `${selected.deviceName || selected.deviceCode} 任务进度` : "任务进度"}
        open={!!selected}
        onClose={() => setSelectedDevice(null)}
        width={860}
      >
        {selected ? (
          <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <Card size="small" title="当前状态">
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}><Statistic title="状态" value={statusText(selected.status)} /></Col>
                <Col xs={24} md={8}><Statistic title="当前任务" value={currentTaskText(selected.currentTask)} /></Col>
                <Col xs={24} md={8}><Statistic title="最后心跳" value={formatDateTime(selected.lastHeartbeatAt)} /></Col>
                <Col span={24}>{progressBlock("视频进度", selected.videoElapsedMinutes, selected.videoRemainingMinutes, selected.plannedVideoMinutes, "#1677ff")}</Col>
                <Col span={24}>{progressBlock("直播进度", selected.liveElapsedMinutes, selected.liveRemainingMinutes, selected.plannedLiveMinutes, "#722ed1")}</Col>
              </Row>
              {selected.heartbeat?.lastMessage ? <Alert style={{ marginTop: 12 }} type="info" message={selected.heartbeat.lastMessage} /> : null}
            </Card>
            <Card size="small" title="每日任务完成情况">
              {dailyProgressQuery.isLoading ? <Skeleton active /> : null}
              {dailyProgressQuery.isError ? <Alert type="error" message="每日进度加载失败" description={dailyProgressQuery.error.message} showIcon /> : null}
              {!dailyProgressQuery.isLoading && ((dailyProgressQuery.data ?? []) as DailyProgress[]).length === 0 ? <Empty description="暂无每日任务进度" /> : null}
              <Space direction="vertical" style={{ width: "100%" }} size={12}>
                {((dailyProgressQuery.data ?? []) as DailyProgress[]).map((item) => (
                  <Card size="small" key={item.progressDate} className="daily-progress-card">
                    <Row gutter={[12, 12]} align="middle">
                      <Col xs={24} md={4}>
                        <Typography.Text strong>{item.progressDate}</Typography.Text>
                        <br />
                        <Typography.Text type="secondary">{formatDateTime(item.latestHeartbeatAt)}</Typography.Text>
                      </Col>
                      <Col xs={24} md={8}>
                        <Typography.Text type="secondary">视频完成度</Typography.Text>
                        <Progress percent={item.videoCompletionPercent ?? 0} size="small" format={() => `${item.maxVideoElapsedMinutes ?? 0} / ${item.maxVideoPlannedMinutes ?? 0} 分钟`} />
                      </Col>
                      <Col xs={24} md={8}>
                        <Typography.Text type="secondary">直播完成度</Typography.Text>
                        <Progress percent={item.liveCompletionPercent ?? 0} size="small" strokeColor="#722ed1" format={() => `${item.maxLiveElapsedMinutes ?? 0} / ${item.maxLivePlannedMinutes ?? 0} 分钟`} />
                      </Col>
                      <Col xs={24} md={4}>
                        <Space size={6} wrap>
                          <Tag color="blue">视频 {item.maxViewedCount ?? 0}</Tag>
                          <Tag color="purple">直播 {item.maxLiveViewedCount ?? 0}</Tag>
                          <Tag color="green">采集 {item.maxCapturedCount ?? 0}</Tag>
                          {item.errorCount ? <Tag color="red">异常 {item.errorCount}</Tag> : null}
                        </Space>
                      </Col>
                      <Col span={24}>
                        <Typography.Text type="secondary">最后消息：{item.lastMessage || "-"}</Typography.Text>
                      </Col>
                    </Row>
                  </Card>
                ))}
              </Space>
            </Card>
            <Collapse
              items={[{
                key: "heartbeat",
                label: "最近心跳明细（排查用）",
                children: (
                  <>
                    {historyQuery.isLoading ? <Skeleton active /> : null}
                    {historyQuery.isError ? <Alert type="error" message="心跳历史加载失败" description={historyQuery.error.message} showIcon /> : null}
                    <Table rowKey={(row) => String((row as HeartbeatHistory).id)} dataSource={(historyQuery.data ?? []) as HeartbeatHistory[]} size="small" scroll={{ x: 900 }} pagination={{ pageSize: 10 }}>
                      <Table.Column title="上报时间" dataIndex="reportedAt" width={180} render={(value) => formatDateTime(value as string | undefined)} />
                      <Table.Column title="状态" dataIndex="status" width={100} render={(value) => <Tag color={statusColor(value as string)}>{statusText(value as string)}</Tag>} />
                      <Table.Column title="阶段" dataIndex="sceneType" width={90} render={(value) => sceneText(value as string)} />
                      <Table.Column title="已用/剩余" width={120} render={(_, row) => `${(row as HeartbeatHistory).elapsedMinutes ?? 0} / ${(row as HeartbeatHistory).remainingMinutes ?? "-"}`} />
                      <Table.Column title="浏览" width={120} render={(_, row) => `${(row as HeartbeatHistory).viewedCount ?? 0} / ${(row as HeartbeatHistory).liveViewedCount ?? 0}`} />
                      <Table.Column title="采集" dataIndex="capturedCount" width={80} />
                      <Table.Column title="消息" dataIndex="lastMessage" ellipsis />
                    </Table>
                  </>
                )
              }]}
            />
          </Space>
        ) : null}
      </Drawer>
    </div>
  );
}
