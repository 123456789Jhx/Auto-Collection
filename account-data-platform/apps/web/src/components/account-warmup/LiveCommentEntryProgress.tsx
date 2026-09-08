import { CheckCircleFilled, ClockCircleOutlined, DownOutlined, ExclamationCircleFilled, EyeOutlined, MobileOutlined, ReloadOutlined, StopOutlined } from "@ant-design/icons";
import { Alert, Button, Col, Empty, Modal, Row, Skeleton, Space, Statistic, Tooltip, Typography } from "antd";
import { useState } from "react";
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
  agentReachable?: boolean;
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

const displayStageLabels: Record<string, string> = {
  SCREENING_VIEWER_COUNT: "筛选直播间人数",
  OPENING_ANCHOR_SUMMARY: "打开主播资料",
  OPENING_ANCHOR_PROFILE: "查看主播主页",
  READING_ROOM_IDENTITY: "识别主播账号",
  CLAIMING_LIVE_ROOM: "绑定当前直播间",
  CLOSING_ANCHOR_PROFILE: "返回直播间",
  ROOM_FILTER_PASSED: "直播间筛选通过",
  SWITCHING_LIVE_ROOM: "切换直播间"
};

function displayStage(stage: string) {
  return displayStageLabels[stage] || stage;
}

function DeviceStatusCard(props: {
  row: LiveCommentEntryRow;
  stopping: boolean;
  onStop: (row: LiveCommentEntryRow) => void;
  onViewDetails: (row: LiveCommentEntryRow) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { row } = props;
  const tone = row.viewState.color === "error" ? "error" : row.viewState.color === "success" ? "success"
    : row.viewState.key === "stopping" ? "warning" : row.viewState.active ? "running" : "neutral";
  const moving = tone === "running" && row.viewState.key !== "pending";
  const stages = row.viewState.stageHistory;
  const resultText = liveCommentEntryResultText(row);
  const deviceLabel = row.deviceName || row.deviceCode || row.deviceId;
  const updatedAt = row.updatedAt || row.acknowledgedAt || row.fetchedAt || row.issuedAt;
  const detailId = `live-device-history-${row.id}`;

  return (
    <article className="live-device-card" data-tone={tone} data-moving={moving} aria-label={`${deviceLabel} 状态`}>
      <header className="live-device-card-head">
        <div className="live-device-identity">
          <span className="live-device-icon"><MobileOutlined /></span>
          <div className="live-device-name">
            <Tooltip title={deviceLabel}><h3>{deviceLabel}</h3></Tooltip>
            <Tooltip title={row.deviceCode || row.deviceId}><span className="live-device-code">{row.deviceCode || row.deviceId}</span></Tooltip>
          </div>
        </div>
        <span className="live-device-status" role="status">
          {tone === "error" ? <ExclamationCircleFilled /> : tone === "success" ? <CheckCircleFilled /> : <span className="live-device-status-dot" />}
          {row.viewState.label}
        </span>
      </header>
      <div className="live-device-phase">
        <span className="live-device-label">当前阶段</span>
        <strong key={row.viewState.stage} className="live-device-stage">{displayStage(row.viewState.stageLabel)}</strong>
        <div className="live-device-activity" aria-hidden="true"><span /></div>
      </div>
      <div className="live-device-history-preview">
        <span className="live-device-label">阶段记录 <span className="live-device-history-count">{stages.length}</span></span>
        <ol>{stages.slice(-3).map((stage, index) => <li key={`${stage}-${index}`}>{displayStage(stage)}</li>)}</ol>
        {!stages.length ? <span className="live-device-muted">等待阶段回执</span> : null}
      </div>
      {resultText !== "-" ? (
        <div className="live-device-result" aria-label="结果 / 错误">
          {tone === "error" ? <ExclamationCircleFilled /> : <CheckCircleFilled />}
          <p>{resultText}</p>
        </div>
      ) : null}
      <div className="live-device-expanded" data-expanded={expanded} aria-hidden={!expanded} id={detailId}>
        <div className="live-device-expanded-inner">
          <div className="live-device-expanded-content">
            <span className="live-device-label">完整阶段记录</span>
            <ol>{stages.map((stage, index) => <li key={`${stage}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{displayStage(stage)}</li>)}</ol>
            {!stages.length ? <p className="live-device-muted">等待阶段回执</p> : null}
            {resultText !== "-" ? <><span className="live-device-label">完整结果 / 错误</span><p className="live-device-full-result">{resultText}</p></> : null}
          </div>
        </div>
      </div>
      <footer className="live-device-footer">
        <span className="live-device-updated"><ClockCircleOutlined /><span>最后更新 <time dateTime={updatedAt || undefined}>{formatDateTime(updatedAt)}</time></span></span>
        <Space size={4} className="live-device-actions">
          <Tooltip title={expanded ? "收起记录" : "展开完整记录"}>
            <Button type="text" icon={<DownOutlined className="live-device-disclosure" data-expanded={expanded} />} aria-label={`${expanded ? "收起" : "展开"} ${deviceLabel} 记录`} aria-expanded={expanded} aria-controls={detailId} onClick={() => setExpanded(!expanded)} />
          </Tooltip>
          <Tooltip title="查看详情"><Button icon={<EyeOutlined />} aria-label={`查看 ${deviceLabel} 详情`} onClick={() => props.onViewDetails(row)} /></Tooltip>
          {row.viewState.active ? (
            <Tooltip title="停止该设备任务"><Button danger icon={<StopOutlined />} aria-label={`停止 ${deviceLabel}`} disabled={row.viewState.key === "stopping" || !row.deviceCode} loading={props.stopping} onClick={() => props.onStop(row)} /></Tooltip>
          ) : null}
        </Space>
      </footer>
    </article>
  );
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
  onViewDetails: (row: LiveCommentEntryRow) => void;
  onCloseWarning: () => void;
}) {
  const summary = summarizeLiveCommentEntryStates(props.rows.map((row) => row.viewState));
  const capturedCount = props.rows.filter(isLiveCommentEntryCaptureCompleted).length;

  return (
    <section className="ops-panel live-device-progress">
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
      <div className="live-device-grid" aria-busy={props.loading}>
        {props.rows.map((row) => <DeviceStatusCard key={row.id} row={row} stopping={props.stoppingCommandIds.has(row.id)} onStop={props.onStop} onViewDetails={props.onViewDetails} />)}
        {props.loading && !props.rows.length ? <div className="live-device-skeleton"><Skeleton active paragraph={{ rows: 3 }} /></div> : null}
      </div>
      {!props.loading && !props.rows.length ? <Empty className="live-device-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description={props.activeBatchId ? "等待设备领取任务" : "尚未下发任务"} /> : null}
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
