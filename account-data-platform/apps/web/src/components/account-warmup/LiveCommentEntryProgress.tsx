import { ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Col, Modal, Row, Space, Statistic, Table, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
import type { LiveCommentEntryMobileCommand } from "../../lib/api-client-live-comment-entry";
import type { LiveCommentEntryDispatchFailure } from "../../lib/live-comment-entry-batch";
import {
  isLiveCommentEntryCaptureCompleted,
  summarizeLiveCommentEntryStates,
  type LiveCommentEntryState
} from "../../lib/live-comment-entry-form";
import { formatDateTime } from "../../routes/DeviceList";

export type LiveCommentEntryRow = LiveCommentEntryMobileCommand & {
  deviceCode: string;
  deviceName: string;
  viewState: LiveCommentEntryState;
};

export type LiveCommentEntryWarning = {
  id: string;
  deviceName: string;
  message: string;
};

export function liveCommentEntryResultText(row: LiveCommentEntryRow) {
  if (row.viewState.key === "platform_verification") return "出现平台验证";
  if (row.viewState.key === "cleanup_failed") {
    return row.viewState.message || "评论已抓取，但退出抖音或返回燎原星火失败";
  }
  if (["viewer_count_failed", "viewer_threshold_exhausted", "live_ended_exhausted", "live_ended_skip_failed"]
    .includes(row.viewState.key)) return row.viewState.message || "人数检测异常";
  if (row.viewState.message) return row.viewState.message;
  if (row.viewState.key === "captured") {
    const count = Number(row.resultJson?.commentCount);
    return Number.isFinite(count) ? `抓取到 ${count} 条候选评论` : "评论抓取完成";
  }
  if (row.viewState.key === "entered") return "已进入第一个直播结果";
  if (row.viewState.key === "stopped") return "任务已停止";
  return "-";
}

export function LiveCommentEntryProgress(props: {
  activeBatchId: string;
  rows: LiveCommentEntryRow[];
  deviceTotal: number;
  dispatchFailures: LiveCommentEntryDispatchFailure[];
  warningRows: LiveCommentEntryRow[];
  warningAlert: LiveCommentEntryWarning | null;
  loading: boolean;
  loadError: boolean;
  stoppingCommandIds: Set<string>;
  retryingDispatch: boolean;
  onRetryDispatch: () => void;
  onStop: (row: LiveCommentEntryRow) => void;
  onCloseWarning: () => void;
}) {
  const summary = summarizeLiveCommentEntryStates(props.rows.map((row) => row.viewState));
  const capturedCount = props.rows.filter(isLiveCommentEntryCaptureCompleted).length;
  const columns: TableColumnsType<LiveCommentEntryRow> = [
    {
      title: "设备",
      key: "device",
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.deviceName}</Typography.Text>
          <Typography.Text type="secondary">{row.deviceCode || row.deviceId}</Typography.Text>
        </Space>
      )
    },
    { title: "状态", key: "status", width: 110, render: (_, row) => <Tag color={row.viewState.color}>{row.viewState.label}</Tag> },
    { title: "当前阶段", key: "stage", width: 170, render: (_, row) => row.viewState.stageLabel },
    {
      title: "最后更新",
      key: "updatedAt",
      width: 180,
      render: (_, row) => formatDateTime(row.updatedAt || row.acknowledgedAt || row.fetchedAt || row.issuedAt)
    },
    {
      title: "阶段记录",
      key: "stageHistory",
      render: (_, row) => row.viewState.stageHistory.length ? (
        <Space size={[4, 4]} wrap>
          {row.viewState.stageHistory.map((stage, index) => <Tag key={`${row.id}-${index}`}>{stage}</Tag>)}
        </Space>
      ) : <Typography.Text type="secondary">等待阶段回执</Typography.Text>
    },
    { title: "结果 / 错误", key: "result", render: (_, row) => liveCommentEntryResultText(row) },
    {
      title: "操作",
      key: "action",
      width: 72,
      render: (_, row) => row.viewState.active ? (
        <Tooltip title="停止该设备任务">
          <Button
            danger
            size="small"
            icon={<StopOutlined />}
            aria-label={`停止 ${row.deviceName}`}
            disabled={row.viewState.key === "stopping" || !row.deviceCode}
            loading={props.stoppingCommandIds.has(row.id)}
            onClick={() => props.onStop(row)}
          />
        </Tooltip>
      ) : null
    }
  ];

  return (
    <section className="ops-panel">
      <div className="ops-panel-head">
        <span>执行进度</span>
        <span className="ops-small">{props.activeBatchId ? `批次 ${props.activeBatchId.slice(0, 8)}` : "尚未开始"}</span>
      </div>
      <div className="ops-panel-body">
        <Row gutter={[24, 16]}>
          <Col xs={12} sm={6}><Statistic title="设备总数" value={props.deviceTotal} /></Col>
          <Col xs={12} sm={6}><Statistic title="执行中" value={summary.running} /></Col>
          <Col xs={12} sm={6}><Statistic title="抓取完成" value={capturedCount} /></Col>
          <Col xs={12} sm={6}><Statistic title="失败" value={summary.failed + props.dispatchFailures.length} /></Col>
        </Row>
        {props.dispatchFailures.length ? (
          <Alert
            type="error"
            showIcon
            message={`${props.dispatchFailures.length} 台设备任务下发失败`}
            description={(
              <Space direction="vertical" size={2}>
                {props.dispatchFailures.map((failure) => (
                  <Typography.Text key={failure.deviceCode}>
                    {failure.deviceName}（{failure.deviceCode}）：{failure.message}
                  </Typography.Text>
                ))}
              </Space>
            )}
            action={(
              <Button
                danger
                icon={<ReloadOutlined />}
                loading={props.retryingDispatch}
                onClick={props.onRetryDispatch}
              >使用原批次重试</Button>
            )}
            style={{ marginTop: 16 }}
          />
        ) : null}
        {props.warningRows.length ? (
          <Alert
            type="error"
            showIcon
            message="异常设备"
            description={props.warningRows.map((row) => `${row.deviceName || row.deviceCode}：${liveCommentEntryResultText(row)}`).join("；")}
            style={{ marginTop: 16 }}
          />
        ) : null}
      </div>
      {props.loadError ? <Alert type="error" showIcon message="执行进度加载失败" /> : null}
      <Table<LiveCommentEntryRow>
        size="small"
        rowKey="id"
        loading={props.loading}
        columns={columns}
        dataSource={props.rows}
        pagination={false}
        scroll={{ x: 1080 }}
        locale={{ emptyText: props.activeBatchId ? "等待设备领取任务" : "尚未下发任务" }}
      />
      <Modal
        open={Boolean(props.warningAlert)}
        title="任务异常警告"
        okText="我知道了"
        cancelButtonProps={{ style: { display: "none" } }}
        onOk={props.onCloseWarning}
        onCancel={props.onCloseWarning}
      >
        <Typography.Paragraph>
          设备 {props.warningAlert?.deviceName || "-"}：{props.warningAlert?.message || "任务已停止"}。
        </Typography.Paragraph>
        <Typography.Text type="secondary">请处理异常后，再创建新的任务。</Typography.Text>
      </Modal>
    </section>
  );
}
