import { CheckSquareOutlined, DatabaseOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Space, Table, Tag, Typography, type TableColumnsType } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  confirmLiveCommentCandidates,
  getLiveCommentCandidates,
  type LiveRoomCapture,
  type PendingLiveCommentCandidate
} from "../../lib/api-client-live-comment-entry";
import { scopeLiveCommentCandidates } from "../../lib/live-comment-candidate-scope";

export function LiveCommentCandidates(props: { capture: LiveRoomCapture; captureCompleted: boolean }) {
  const { batchId, deviceId, roomKey } = props.capture;
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const candidatesQuery = useQuery({
    queryKey: ["liveCommentCandidates", batchId, props.captureCompleted],
    queryFn: () => getLiveCommentCandidates(batchId),
    enabled: Boolean(batchId && deviceId && roomKey),
    refetchInterval: props.captureCompleted ? false : 2_000
  });
  const candidates = useMemo(() => scopeLiveCommentCandidates(
    candidatesQuery.data ?? [], { batchId, deviceId, roomKey }
  ), [candidatesQuery.data, batchId, deviceId, roomKey]);
  const selectableIds = useMemo(() => candidates.filter((item) => item.status === "PENDING").map((item) => item.id), [candidates]);
  const selectedPendingIds = selectedIds.filter((id) => selectableIds.includes(id));
  useEffect(() => setSelectedIds((current) => current.filter((id) => selectableIds.includes(id))), [selectableIds]);
  const confirmMutation = useMutation({
    mutationFn: (input: { batchId: string; candidateIds: string[] }) =>
      confirmLiveCommentCandidates(input.batchId, input.candidateIds, true),
    onSuccess: async (_, input) => {
      setConfirmOpen(false);
      setSelectedIds([]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["liveCommentCandidates", input.batchId] }),
        queryClient.invalidateQueries({ queryKey: ["accountWarmupVocabulary", "COMMENT"] })
      ]);
    }
  });
  const locked = !props.captureCompleted || candidatesQuery.isLoading || candidatesQuery.isError || confirmMutation.isPending;
  const result = confirmMutation.data;
  const columns: TableColumnsType<PendingLiveCommentCandidate> = [
    { title: "评论文本", dataIndex: "commentText", render: (text: string) => <Typography.Text className="lc-comment-text">{text}</Typography.Text> },
    {
      title: "轮次",
      key: "source",
      width: 72,
      render: (_, row) => {
        const pages = [...new Set(row.sourcesJson.flatMap((source) => source.pageIndex == null ? [] : [source.pageIndex + 1]))];
        return <Typography.Text type="secondary">{pages.join("、") || "-"}</Typography.Text>;
      }
    },
    { title: "入库状态", dataIndex: "status", width: 88, render: (status: string) => <Tag color={status === "IMPORTED" ? "success" : "processing"}>{status === "IMPORTED" ? "已入库" : "待入库"}</Tag> }
  ];
  return <section className="lc-candidates" aria-label="评论入库">
    <div className="lc-candidates-heading"><div><h4>当前直播间候选评论</h4><p className="lc-section-description">仅显示当前设备在本直播间抓取的候选评论。</p></div></div>
    <dl className="lc-candidate-stats" aria-label="当前直播间评论统计">
      <div><dt>待入库</dt><dd>{selectableIds.length}</dd></div>
      <div><dt>已入库</dt><dd>{candidates.length - selectableIds.length}</dd></div>
      <div className="lc-selected-stat"><dt>已选择</dt><dd aria-live="polite">{selectedPendingIds.length}</dd></div>
    </dl>
    <div className="lc-candidates-content">
      {!props.captureCompleted ? <Alert showIcon type="info" message="抓取中，完成后可入库" /> : null}
      {candidatesQuery.isError ? <Alert showIcon type="error" message="候选评论加载失败" description={candidatesQuery.error.message} action={<Button icon={<ReloadOutlined />} onClick={() => void candidatesQuery.refetch()}>重试</Button>} /> : null}
      {result ? <Alert
        showIcon
        type={result.importedCount ? "success" : "info"}
        message={result.importedCount ? "评论入库完成" : "本次没有新增入库评论"}
        description={`已选择 ${result.selectedCount} 条，成功入库 ${result.importedCount} 条，规则过滤 ${result.filteredCount} 条，重复 ${result.duplicateCount} 条。`}
      /> : null}
      <div className="lc-candidate-actions">
        <Space wrap size={8}>
          <Button icon={<CheckSquareOutlined />} disabled={locked || !selectableIds.length} onClick={() => setSelectedIds(selectableIds)}>全选待入库</Button>
          <Button type="text" disabled={locked || !selectedPendingIds.length} onClick={() => setSelectedIds([])}>取消全选</Button>
        </Space>
        <Button
          type="primary"
          icon={<DatabaseOutlined />}
          loading={confirmMutation.isPending}
          disabled={locked || !selectedPendingIds.length}
          onClick={() => { confirmMutation.reset(); setConfirmOpen(true); }}
        >确认入库{selectedPendingIds.length ? `（${selectedPendingIds.length}）` : ""}</Button>
      </div>
      <Table<PendingLiveCommentCandidate>
        rowKey="id"
        size="small"
        className="lc-candidate-table"
        columns={columns}
        dataSource={candidates}
        loading={candidatesQuery.isLoading}
        rowSelection={{
          columnWidth: 40,
          selectedRowKeys: selectedPendingIds,
          onChange: (keys) => setSelectedIds(keys.map(String)),
          getCheckboxProps: (row) => ({ disabled: row.status === "IMPORTED" || locked })
        }}
        pagination={{ defaultPageSize: 10, showSizeChanger: false, hideOnSinglePage: true, size: "small", showTotal: (total) => `共 ${total} 条` }}
        scroll={{ x: 400 }}
        locale={{ emptyText: props.captureCompleted ? "当前直播间暂无候选评论" : "等待当前直播间评论" }}
      />
      <p className="lc-selection-note">“全选待入库”会选择本直播间所有分页的待入库评论。</p>
    </div>
    <Modal
      rootClassName="lc-results-modal"
      open={confirmOpen}
      title="确认评论入库"
      closable={!confirmMutation.isPending}
      keyboard={!confirmMutation.isPending}
      maskClosable={!confirmMutation.isPending}
      onCancel={() => { if (!confirmMutation.isPending) setConfirmOpen(false); }}
      footer={[
        <Button key="defer" disabled={confirmMutation.isPending} onClick={() => setConfirmOpen(false)}>暂不入库</Button>,
        <Button
          key="clean"
          type="primary"
          icon={<DatabaseOutlined />}
          loading={confirmMutation.isPending}
          disabled={locked || !selectedPendingIds.length}
          onClick={() => confirmMutation.mutate({ batchId, candidateIds: selectedPendingIds })}
        >清洗后入库</Button>
      ]}
    >
      <div className="lc-import-summary"><span>当前直播间 · 所选评论</span><strong>{selectedPendingIds.length}<small>条</small></strong></div>
      <Typography.Paragraph>已选择当前直播间的 {selectedPendingIds.length} 条候选评论。</Typography.Paragraph>
      <Typography.Paragraph type="secondary">入库前将按现有规则过滤不合格评论并去重，原始评论保留。</Typography.Paragraph>
      {confirmMutation.isError ? <Alert showIcon type="error" message="评论入库失败" description={confirmMutation.error.message} /> : null}
    </Modal>
  </section>;
}
