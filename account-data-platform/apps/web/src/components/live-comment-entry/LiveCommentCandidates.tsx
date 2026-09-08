import { CheckSquareOutlined, DatabaseOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Space, Statistic, Table, Tag, Typography, type TableColumnsType } from "antd";
import { useEffect, useMemo, useState } from "react";
import {
  confirmLiveCommentCandidates,
  getLiveCommentCandidates,
  type PendingLiveCommentCandidate
} from "../../lib/api-client-live-comment-entry";

function sourceLabel(source: PendingLiveCommentCandidate["sourcesJson"][number]) {
  const page = source.pageIndex == null ? "轮次未知" : `第 ${source.pageIndex + 1} 轮`;
  return `${source.userName || "未知用户"} · ${source.deviceId || "未知设备"} · ${source.roomKey || "未知房间"} · ${page}`;
}

export function LiveCommentCandidates(props: { batchId: string; batchFinished: boolean }) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const candidatesQuery = useQuery({
    queryKey: ["liveCommentCandidates", props.batchId],
    queryFn: () => getLiveCommentCandidates(props.batchId),
    enabled: Boolean(props.batchId),
    refetchInterval: props.batchFinished ? false : 2_000
  });
  const candidates = candidatesQuery.data ?? [];
  const selectableIds = useMemo(() => candidates.filter((item) => item.status === "PENDING").map((item) => item.id), [candidates]);
  useEffect(() => setSelectedIds((current) => current.filter((id) => candidates.some((item) => item.id === id))), [candidates]);
  const confirmMutation = useMutation({
    mutationFn: (clean: boolean) => confirmLiveCommentCandidates(props.batchId, selectedIds, clean),
    onSuccess: async () => {
      setConfirmOpen(false);
      setSelectedIds([]);
      await queryClient.invalidateQueries({ queryKey: ["liveCommentCandidates", props.batchId] });
    }
  });
  const columns: TableColumnsType<PendingLiveCommentCandidate> = [
    { title: "评论文本", dataIndex: "commentText", width: 320 },
    {
      title: "来源（设备 / 房间 / 轮次）",
      key: "source",
      width: 420,
      render: (_, row) => <Space direction="vertical" size={0}>{row.sourcesJson.map((source, index) => <Typography.Text type="secondary" key={`${row.id}-${index}`}>{sourceLabel(source)}</Typography.Text>)}</Space>
    },
    { title: "入库状态", dataIndex: "status", width: 120, render: (status: string) => <Tag color={status === "IMPORTED" ? "success" : "processing"}>{status === "IMPORTED" ? "已入库" : "待入库"}</Tag> }
  ];
  return <section className="ops-panel">
    <div className="ops-panel-head"><span>本批候选评论</span><span className="ops-small">设备回传后进入待入库，确认只写入勾选项</span></div>
    <div className="ops-panel-body">
      <Alert showIcon type={props.batchFinished ? "success" : "info"} message={props.batchFinished ? "批次抓取完成" : "等待设备回传候选词"} />
      <Space size="large" style={{ marginTop: 16 }}><Statistic title="候选词" value={candidates.length} /><Statistic title="待入库" value={selectableIds.length} /><Statistic title="已入库" value={candidates.filter((item) => item.status === "IMPORTED").length} /></Space>
      <Space style={{ marginTop: 16, marginBottom: 12 }}>
        <Button icon={<CheckSquareOutlined />} disabled={!props.batchFinished || !selectableIds.length} onClick={() => setSelectedIds(selectableIds)}>全选待入库</Button>
        <Button type="primary" icon={<DatabaseOutlined />} loading={confirmMutation.isPending} disabled={!props.batchFinished || !selectedIds.length} onClick={() => setConfirmOpen(true)}>确认入库</Button>
      </Space>
      <Modal open={confirmOpen} title="确认评论入库" onCancel={() => setConfirmOpen(false)} footer={[
        <Button key="cancel" onClick={() => setConfirmOpen(false)}>取消</Button>,
        <Button key="defer" disabled={confirmMutation.isPending} onClick={() => confirmMutation.mutate(false)}>暂不清洗（保留缓存）</Button>,
        <Button key="clean" type="primary" loading={confirmMutation.isPending} onClick={() => confirmMutation.mutate(true)}>清洗后入库</Button>
      ]}>
        <Typography.Paragraph>是否先进行评论清洗？含特殊字符的整条评论和重复评论会被筛选，原始评论仍保留在候选缓存中。</Typography.Paragraph>
      </Modal>
    </div>
    <Table<PendingLiveCommentCandidate> rowKey="id" size="small" columns={columns} dataSource={candidates} loading={candidatesQuery.isLoading} rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)), getCheckboxProps: (row) => ({ disabled: row.status === "IMPORTED" || !props.batchFinished }) }} pagination={{ defaultPageSize: 20 }} scroll={{ x: 900 }} />
  </section>;
}
