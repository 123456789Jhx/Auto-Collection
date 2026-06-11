import { ArrowLeftOutlined, CalendarOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Empty, Input, Modal, Row, Select, Skeleton, Space, Statistic, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { getRecordDates, getRecordDeviceSummary, getRecords } from "../lib/api-client";
import { sceneText, statusColor, statusText } from "../lib/display-maps";

type RecordDeviceSummary = {
  deviceCode?: string;
  deviceName?: string;
  totalCount: number;
  videoCount: number;
  liveCount: number;
  latestRecordAt?: string | null;
  deviceStatus?: string;
  lastHeartbeatAt?: string | null;
};

type RecordDateSummary = {
  recordDate: string;
  totalCount: number;
  videoCount: number;
  liveCount: number;
  latestRecordAt?: string | null;
};

type CollectionRecord = {
  id: string;
  createdAt?: string;
  sceneType?: string;
  authorName?: string | null;
  keyword?: string | null;
  matchedKeywords?: string[] | null;
  titleText?: string | null;
  subtitleText?: string | null;
  metricsText?: string | null;
  hotCommentsJson?: string[] | null;
  screenText?: string | null;
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
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

function matchedKeywordText(value?: string[] | null) {
  return Array.isArray(value) && value.length ? value.join("、") : "-";
}

export function RecordsPage() {
  const [selectedDevice, setSelectedDevice] = useState<RecordDeviceSummary | null>(null);
  const [selectedDate, setSelectedDate] = useState<RecordDateSummary | null>(null);
  const [previewRecord, setPreviewRecord] = useState<CollectionRecord | null>(null);
  const [sceneType, setSceneType] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(15);

  const summaryQuery = useQuery({
    queryKey: ["record-device-summary"],
    queryFn: () => getRecordDeviceSummary(),
    refetchInterval: autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });
  const dateQuery = useQuery({
    queryKey: ["record-dates", selectedDevice?.deviceCode],
    queryFn: () => getRecordDates(selectedDevice?.deviceCode || ""),
    enabled: !!selectedDevice?.deviceCode
  });
  const recordsQuery = useQuery({
    queryKey: ["records", selectedDevice?.deviceCode, selectedDate?.recordDate, sceneType, keyword],
    queryFn: () => getRecords({
      deviceCode: selectedDevice?.deviceCode,
      sceneType,
      keyword,
      createdFrom: selectedDate?.recordDate,
      createdTo: nextDate(selectedDate?.recordDate),
      pageSize: 100
    }),
    enabled: !!selectedDevice?.deviceCode && !!selectedDate?.recordDate,
    refetchInterval: autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });

  if (summaryQuery.isLoading) return <Skeleton active />;
  if (summaryQuery.isError) return <Alert type="error" message="采集记录加载失败" description={summaryQuery.error.message} showIcon />;

  if (!selectedDevice) {
    const summaries = (summaryQuery.data ?? []) as RecordDeviceSummary[];
    return (
      <Card
        title="按手机查看采集记录"
        extra={<RefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />}
      >
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
                  <Col span={8}><Statistic title="总记录" value={item.totalCount} /></Col>
                  <Col span={8}><Statistic title="视频" value={item.videoCount} /></Col>
                  <Col span={8}><Statistic title="直播" value={item.liveCount} /></Col>
                </Row>
                <Space direction="vertical" size={0}>
                  <Typography.Text type="secondary">最近采集：{formatDateTime(item.latestRecordAt)}</Typography.Text>
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
    const dates = (dateQuery.data ?? []) as RecordDateSummary[];
    return (
      <Card
        title={
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => setSelectedDevice(null)} />
            <span>{selectedDevice.deviceName || selectedDevice.deviceCode} 的采集日期</span>
          </Space>
        }
        extra={<RefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />}
      >
        {dateQuery.isLoading ? <Skeleton active /> : null}
        {!dateQuery.isLoading && dates.length === 0 ? <Empty description="暂无采集日期" /> : null}
        <Row gutter={[12, 12]}>
          {dates.map((item) => (
            <Col xs={24} md={12} xl={8} key={item.recordDate}>
              <Card className="device-card" hoverable onClick={() => setSelectedDate(item)}>
                <Space align="start" style={{ width: "100%", justifyContent: "space-between" }}>
                  <Space direction="vertical" size={2}>
                    <Typography.Text strong>{item.recordDate}</Typography.Text>
                    <Typography.Text type="secondary">最近：{formatDateTime(item.latestRecordAt)}</Typography.Text>
                  </Space>
                  <CalendarOutlined className="card-icon" />
                </Space>
                <Row gutter={12} className="card-stats">
                  <Col span={8}><Statistic title="总记录" value={item.totalCount} /></Col>
                  <Col span={8}><Statistic title="视频" value={item.videoCount} /></Col>
                  <Col span={8}><Statistic title="直播" value={item.liveCount} /></Col>
                </Row>
              </Card>
            </Col>
          ))}
        </Row>
      </Card>
    );
  }

  const records = (recordsQuery.data?.data ?? []) as CollectionRecord[];

  return (
    <Card
      title={
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => setSelectedDate(null)} />
          <span>{selectedDevice.deviceName || selectedDevice.deviceCode} / {selectedDate.recordDate}</span>
        </Space>
      }
      extra={
        <Space>
          <Select
            allowClear
            placeholder="阶段"
            value={sceneType}
            onChange={setSceneType}
            style={{ width: 120 }}
            options={[
              { value: "video", label: "视频" },
              { value: "live", label: "直播" }
            ]}
          />
          <Input.Search placeholder="标题关键词" allowClear onSearch={setKeyword} style={{ width: 220 }} />
          <RefreshSelect value={autoRefreshSeconds} onChange={setAutoRefreshSeconds} />
        </Space>
      }
    >
      {recordsQuery.isLoading ? <Skeleton active /> : null}
      {recordsQuery.isError ? <Alert type="error" message="采集记录加载失败" description={recordsQuery.error.message} showIcon /> : null}
      {!recordsQuery.isLoading && records.length === 0 ? <Empty description="当天暂无采集记录" /> : null}
      <Table rowKey={(row) => String((row as CollectionRecord).id)} dataSource={records} scroll={{ x: 1200 }} pagination={{ pageSize: 20 }}>
        <Table.Column title="采集时间" dataIndex="createdAt" width={180} render={(value) => formatDateTime(value as string | undefined)} />
        <Table.Column title="阶段" dataIndex="sceneType" width={90} render={(value) => <Tag>{sceneText(value as string)}</Tag>} />
        <Table.Column title="搜索词" dataIndex="keyword" width={140} />
        <Table.Column title="命中词" width={160} render={(_, row) => matchedKeywordText((row as CollectionRecord).matchedKeywords)} />
        <Table.Column title="作者" dataIndex="authorName" width={160} ellipsis />
        <Table.Column title="标题/文案" dataIndex="titleText" ellipsis />
        <Table.Column title="指标" dataIndex="metricsText" width={180} ellipsis />
        <Table.Column title="操作" width={90} render={(_, row) => <Button size="small" onClick={() => setPreviewRecord(row as CollectionRecord)}>详情</Button>} />
      </Table>
      <Modal title="采集记录详情" open={!!previewRecord} onCancel={() => setPreviewRecord(null)} footer={null} width={820}>
        {previewRecord ? (
          <Space direction="vertical" style={{ width: "100%" }} size={12}>
            <Row gutter={12}>
              <Col span={8}><Statistic title="阶段" value={sceneText(previewRecord.sceneType)} /></Col>
              <Col span={8}><Statistic title="搜索词" value={previewRecord.keyword || "-"} /></Col>
              <Col span={8}><Statistic title="作者" value={previewRecord.authorName || "-"} /></Col>
            </Row>
            <Card size="small" title="内容">
              <Typography.Paragraph>{previewRecord.titleText || "-"}</Typography.Paragraph>
              {previewRecord.subtitleText ? <Typography.Paragraph type="secondary">{previewRecord.subtitleText}</Typography.Paragraph> : null}
            </Card>
            <Card size="small" title="指标与命中">
              <Space direction="vertical">
                <Typography.Text>指标：{previewRecord.metricsText || "-"}</Typography.Text>
                <Typography.Text>命中词：{matchedKeywordText(previewRecord.matchedKeywords)}</Typography.Text>
              </Space>
            </Card>
            {previewRecord.hotCommentsJson?.length ? (
              <Card size="small" title="热门评论">
                <Space direction="vertical">
                  {previewRecord.hotCommentsJson.map((comment, index) => <Typography.Text key={`${index}-${comment}`}>{comment}</Typography.Text>)}
                </Space>
              </Card>
            ) : null}
          </Space>
        ) : null}
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
