import { CheckSquareOutlined, DatabaseOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Popconfirm, Space, Statistic, Table, Tag, Typography, type TableColumnsType } from "antd";
import { useEffect, useMemo, useState } from "react";
import { saveLiveCommentEntryComments } from "../../lib/api-client-live-comment-entry";
import {
  buildLiveCommentVocabularyBatches,
  saveLiveCommentVocabularyBatches,
  type LiveCommentCandidate
} from "../../lib/live-comment-entry-candidates";

type FailedVocabularyBatch = { comments: string[]; message: string };
type UploadState = {
  key: "idle" | "partial" | "failed" | "success";
  savedCount: number;
  failures: FailedVocabularyBatch[];
};

const initialUploadState: UploadState = { key: "idle", savedCount: 0, failures: [] };

function sourceLabel(source: LiveCommentCandidate["sources"][number]) {
  const page = source.pageIndex === null ? "页码未知" : `第 ${source.pageIndex + 1} 页`;
  return `${source.userName || "未知用户"} · ${source.deviceName || source.deviceCode || source.deviceId || "未知设备"} · ${page}`;
}

export function LiveCommentCandidates(props: {
  batchId: string;
  candidates: LiveCommentCandidate[];
  batchFinished: boolean;
  deviceTotal: number;
  capturedCount: number;
  failedCount: number;
}) {
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>(initialUploadState);
  const candidateById = useMemo(() => new Map(props.candidates.map((item) => [item.id, item])), [props.candidates]);
  const uploadLocked = uploadState.key !== "idle";
  const selectableIds = useMemo(() => props.candidates.filter((item) => item.uploadable).map((item) => item.id), [props.candidates]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => candidateById.has(id)));
  }, [candidateById]);

  const uploadMutation = useMutation({
    mutationFn: async (input: { batches: string[][]; retry: boolean }) => {
      const result = await saveLiveCommentVocabularyBatches(input.batches, saveLiveCommentEntryComments);
      return { retry: input.retry, ...result };
    },
    onSuccess: async (result) => {
      setUploadState((current) => {
        const savedCount = (result.retry ? current.savedCount : 0) + result.savedCount;
        if (!result.failures.length) return { key: "success", savedCount, failures: [] };
        return { key: savedCount ? "partial" : "failed", savedCount, failures: result.failures };
      });
      if (result.savedCount) {
        await queryClient.invalidateQueries({ queryKey: ["accountWarmupVocabulary", "COMMENT"] });
      }
    }
  });
  const interactionLocked = uploadLocked || uploadMutation.isPending;

  function uploadSelected() {
    const comments = selectedIds.map((id) => candidateById.get(id)?.commentText || "");
    const batches = buildLiveCommentVocabularyBatches(comments);
    if (batches.length) uploadMutation.mutate({ batches, retry: false });
  }

  const columns: TableColumnsType<LiveCommentCandidate> = [
    {
      title: "评论正文",
      dataIndex: "commentText",
      width: 320,
      render: (text: string, row) => (
        <Space direction="vertical" size={2}>
          <Typography.Text>{text}</Typography.Text>
          {!row.uploadable ? <Tag color="warning">超过 100 字，不能入库</Tag> : null}
        </Space>
      )
    },
    {
      title: "用户名 / 来源设备 / 页",
      key: "sources",
      width: 340,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          {row.sources.map((source, index) => (
            <Typography.Text type="secondary" key={`${source.sourceId}-${index}`}>{sourceLabel(source)}</Typography.Text>
          ))}
        </Space>
      )
    }
  ];

  const failedCommentCount = uploadState.failures.reduce((total, batch) => total + batch.comments.length, 0);
  return (
    <section className="ops-panel">
      <div className="ops-panel-head">
        <span>本批候选评论</span>
        <span className="ops-small">默认不选择，确认后才会写入评论词库</span>
      </div>
      <div className="ops-panel-body">
        {props.batchId ? (
          <Alert
            showIcon
            type={props.batchFinished ? (props.failedCount ? "warning" : "success") : "info"}
            message={props.batchFinished ? "批次抓取完成" : "设备仍在抓取评论"}
            description={props.batchFinished
              ? `${props.deviceTotal} 台设备均已结束；抓取完成 ${props.capturedCount} 台，失败 ${props.failedCount} 台。`
              : "候选列表会随设备回执更新，全部设备结束后才可确认入库。"}
          />
        ) : null}
        <Space size="large" style={{ marginTop: props.batchId ? 16 : 0 }} wrap>
          <Statistic title="候选正文" value={props.candidates.length} />
          <Statistic title="已选择" value={selectedIds.length} />
          <Statistic title="已入库" value={uploadState.savedCount} />
        </Space>
        <Space style={{ marginTop: 16, marginBottom: 12 }} wrap>
          <Button
            icon={<CheckSquareOutlined />}
            disabled={!props.batchFinished || interactionLocked || !selectableIds.length}
            onClick={() => setSelectedIds(selectableIds)}
          >全选可入库评论</Button>
          <Button disabled={!selectedIds.length || interactionLocked} onClick={() => setSelectedIds([])}>取消全选</Button>
          <Popconfirm
            title="确认加入评论词库？"
            description={`将所选 ${selectedIds.length} 条正文写入共享评论词库。`}
            okText="确认入库"
            cancelText="取消"
            disabled={!props.batchFinished || !selectedIds.length || interactionLocked}
            onConfirm={uploadSelected}
          >
            <Button
              type="primary"
              icon={<DatabaseOutlined />}
              loading={uploadMutation.isPending}
              disabled={!props.batchFinished || !selectedIds.length || interactionLocked}
            >将所选评论加入评论词库</Button>
          </Popconfirm>
          {uploadState.failures.length ? (
            <Button
              danger
              icon={<ReloadOutlined />}
              loading={uploadMutation.isPending}
              onClick={() => uploadMutation.mutate({
                batches: uploadState.failures.map((item) => item.comments),
                retry: true
              })}
            >重试失败的 {failedCommentCount} 条</Button>
          ) : null}
        </Space>
        {uploadState.key === "success" ? (
          <Alert type="success" showIcon message="所选评论入库完成" description={`共 ${uploadState.savedCount} 条正文已写入评论词库。`} />
        ) : null}
        {props.batchFinished && uploadState.key === "idle" ? (
          <Alert type="info" showIcon message="所选评论尚未入库" description="请选择需要保留的评论，再点击确认入库。" />
        ) : null}
        {uploadState.key === "partial" || uploadState.key === "failed" ? (
          <Alert
            type="error"
            showIcon
            message={uploadState.key === "partial" ? "部分评论入库失败" : "评论入库失败"}
            description={`已成功 ${uploadState.savedCount} 条，失败 ${failedCommentCount} 条。可重试失败批次。${uploadState.failures[0]?.message ? ` ${uploadState.failures[0].message}` : ""}`}
          />
        ) : null}
      </div>
      <Table<LiveCommentCandidate>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={props.candidates}
        scroll={{ x: 700 }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => setSelectedIds(keys.map(String)),
          getCheckboxProps: (row) => ({ disabled: !props.batchFinished || interactionLocked || !row.uploadable })
        }}
        pagination={{ defaultPageSize: 20, showSizeChanger: true }}
        locale={{ emptyText: props.batchFinished ? "本批没有识别到可展示的评论" : "等待设备返回评论" }}
      />
    </section>
  );
}
