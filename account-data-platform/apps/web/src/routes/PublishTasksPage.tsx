import { ReloadOutlined, TagsOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Space, Statistic, Table, Tag, Tooltip, Typography, message, type TableColumnsType } from "antd";
import { useState } from "react";
import {
  completePublishTaskTopics,
  getPublishTaskDashboard,
  type PublishTaskRow
} from "../lib/api-client-publish-tasks";
import { PublishTopicsModal } from "./PublishTopicsModal";

const statusLabels: Record<string, string> = {
  CLAIMED: "已领取",
  MATCHED: "已匹配",
  UNMATCHED: "未命中",
  DISPATCHED: "已下发",
  RUNNING: "执行中",
  SUCCEEDED: "已成功",
  FAILED: "失败",
  REPORTED: "已回传",
  TOPIC_PENDING: "待补话题",
  MATERIAL_INVALID: "素材异常",
  CHANNELS_VERIFY_PENDING: "视频号待确认"
};

function statusColor(status: string) {
  if (["SUCCEEDED", "REPORTED"].includes(status)) return "green";
  if (["FAILED", "MATERIAL_INVALID", "UNMATCHED"].includes(status)) return "red";
  if (["TOPIC_PENDING", "CHANNELS_VERIFY_PENDING"].includes(status)) return "orange";
  return "blue";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatSlot(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function PublishTasksPage() {
  const queryClient = useQueryClient();
  const [topicTask, setTopicTask] = useState<PublishTaskRow | null>(null);
  const dashboard = useQuery({
    queryKey: ["publishTasks"],
    queryFn: getPublishTaskDashboard,
    refetchInterval: 30_000
  });
  const topicMutation = useMutation({
    mutationFn: ({ id, description }: { id: string; description: string }) =>
      completePublishTaskTopics(id, description),
    onSuccess: async () => {
      setTopicTask(null);
      message.success("话题已补全并重新下发");
      await queryClient.invalidateQueries({ queryKey: ["publishTasks"] });
    },
    onError: (error: Error) => message.error(error.message || "重新下发失败")
  });

  const columns: TableColumnsType<PublishTaskRow> = [
    {
      title: "任务",
      dataIndex: "title",
      width: 230,
      render: (value: string, record) => (
        <div className="publish-task-title">
          <Typography.Text strong>{value}</Typography.Text>
          <Typography.Text type="secondary">{record.taskId}</Typography.Text>
        </div>
      )
    },
    { title: "账号", dataIndex: "accountName", width: 140 },
    { title: "设备", dataIndex: "deviceCode", width: 150, render: (value) => value || "未匹配" },
    { title: "平台", dataIndex: "platform", width: 90, render: (value) => value === "DOUYIN" ? "抖音" : "视频号" },
    {
      title: "状态",
      dataIndex: "status",
      width: 125,
      render: (value: string) => <Tag color={statusColor(value)}>{statusLabels[value] ?? value}</Tag>
    },
    { title: "时段", dataIndex: "scheduledSlot", width: 80, render: formatSlot },
    {
      title: "错误",
      key: "error",
      width: 220,
      ellipsis: true,
      render: (_, record) => {
        const error = record.resultError || record.matchNote || "-";
        return <Tooltip title={error === "-" ? undefined : error}>{error}</Tooltip>;
      }
    },
    {
      title: "时间",
      key: "time",
      width: 180,
      render: (_, record) => formatDate(record.reportedAt || record.finishedAt || record.dispatchedAt || record.claimedAt)
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_, record) => record.status === "TOPIC_PENDING" ? (
        <Button type="link" icon={<TagsOutlined />} onClick={() => setTopicTask(record)}>补全话题</Button>
      ) : null
    }
  ];

  return (
    <div className="ops-page publish-tasks-page">
      <div className="ops-page-header">
        <div>
          <Typography.Title level={3}>发布任务</Typography.Title>
          <Typography.Text type="secondary">共 {dashboard.data?.data.length ?? 0} 条任务</Typography.Text>
        </div>
        <Space>
          <Button
            icon={<ReloadOutlined />}
            loading={dashboard.isFetching}
            onClick={() => void dashboard.refetch()}
            aria-label="刷新发布任务"
          />
        </Space>
      </div>

      <div className="publish-task-stats">
        <div><Statistic title="今日成功" value={dashboard.data?.stats.success ?? 0} valueStyle={{ color: "#16803c" }} /></div>
        <div><Statistic title="今日未发" value={dashboard.data?.stats.unpublished ?? 0} valueStyle={{ color: "#c53030" }} /></div>
        <div><Statistic title="今日未命中" value={dashboard.data?.stats.unmatched ?? 0} valueStyle={{ color: "#c56a09" }} /></div>
      </div>

      <section className="ops-panel">
        <div className="ops-panel-body">
          <Table<PublishTaskRow>
            rowKey="id"
            columns={columns}
            dataSource={dashboard.data?.data ?? []}
            loading={dashboard.isLoading}
            scroll={{ x: 1320 }}
            pagination={{ pageSize: 20, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
          />
        </div>
      </section>

      <PublishTopicsModal
        task={topicTask}
        loading={topicMutation.isPending}
        onCancel={() => setTopicTask(null)}
        onSubmit={(description) => topicTask && topicMutation.mutate({ id: topicTask.id, description })}
      />
    </div>
  );
}
