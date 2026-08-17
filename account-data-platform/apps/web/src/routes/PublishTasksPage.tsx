import { ReloadOutlined, TagsOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntdApp, Button, Space, Statistic, Table, Tag, Tooltip, Typography, type TableColumnsType } from "antd";
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
  CHANNELS_VERIFY_PENDING: "需人工处理视频号验证",
  PUBLISH_BUSY: "设备忙，等待重试"
};

const failureCodeLabels: Record<string, string> = {
  COVER_REQUIRED: "缺少封面",
  VIDEO_REQUIRED: "缺少视频",
  VIDEO_URL_INVALID: "视频链接无效",
  COVER_URL_INVALID: "封面链接无效",
  MATERIAL_INVALID: "素材异常",
  PUBLISH_BUSY: "设备忙"
};

const sourceLabels: Record<string, string> = {
  EXTERNAL_PULL: "接口定时",
  QUICK_PASTE: "粘贴发布",
  MANUAL_TEST: "手动测试",
  EXTERNAL_PUSH: "接口推送",
  ADMIN_IMPORT: "管理导入"
};

const modeLabels: Record<string, string> = {
  SCHEDULED: "定时执行",
  IMMEDIATE: "立即执行"
};

const reportStatusLabels: Record<string, string> = {
  NOT_REQUIRED: "无需回写",
  REPORT_PENDING: "待回写",
  REPORTING: "回写中",
  REPORTED: "已回写",
  REPORT_FAILED: "回写失败"
};

function statusColor(status: string, resultError: string | null) {
  if (status === "REPORTED") return resultError ? "red" : "green";
  if (status === "PUBLISH_BUSY" || status === "TOPIC_PENDING") return "orange";
  if (status === "CHANNELS_VERIFY_PENDING") return "purple";
  if (["FAILED", "MATERIAL_INVALID", "UNMATCHED"].includes(status)) return "red";
  if (status === "SUCCEEDED") return "green";
  return "blue";
}

function reportStatusColor(status: string) {
  if (status === "REPORTED" || status === "NOT_REQUIRED") return "green";
  if (status === "REPORT_FAILED") return "red";
  if (status === "REPORT_PENDING") return "orange";
  return "blue";
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}


export function PublishTasksContent() {
  const queryClient = useQueryClient();
  const { message } = AntdApp.useApp();
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
    {
      title: "来源/方式",
      dataIndex: "source",
      width: 130,
      render: (value: string, record) => (
        <Space direction="vertical" size={0}>
          <Tag>{sourceLabels[value] ?? value}</Tag>
          <Typography.Text type="secondary">{modeLabels[record.mode] ?? record.mode}</Typography.Text>
        </Space>
      )
    },
    { title: "账号", dataIndex: "accountName", width: 140 },
    { title: "设备", dataIndex: "deviceCode", width: 150, render: (value) => value || "未匹配" },
    { title: "平台", dataIndex: "platform", width: 90, render: (value) => value === "DOUYIN" ? "抖音" : "视频号" },
    {
      title: "状态",
      dataIndex: "status",
      width: 125,
      render: (value: string, record) => <Tag color={statusColor(value, record.resultError)}>{statusLabels[value] ?? value}</Tag>
    },
    {
      title: "回写状态",
      dataIndex: "reportStatus",
      width: 130,
      render: (value: string, record) => {
        const detail = record.reportLastError || (record.reportMode === "EXTERNAL"
          ? `已尝试 ${record.reportAttempts} 次`
          : "仅更新本地看板");
        return (
          <Tooltip title={detail}>
            <Tag color={reportStatusColor(value)}>{reportStatusLabels[value] ?? value}</Tag>
          </Tooltip>
        );
      }
    },
    {
      title: "错误",
      key: "error",
      width: 220,
      ellipsis: true,
      render: (_, record) => {
        const failureLabel = record.failureCode ? (failureCodeLabels[record.failureCode] ?? record.failureCode) : "";
        const detail = record.resultError || record.reportLastError || record.matchNote || "";
        const error = failureLabel || detail || "-";
        return <Tooltip title={detail && detail !== error ? detail : undefined}>{error}</Tooltip>;
      }
    },
    {
      title: "重试",
      key: "retry",
      width: 170,
      render: (_, record) => record.status === "PUBLISH_BUSY" ? (
        <Space direction="vertical" size={0}>
          <Typography.Text>第 {record.dispatchRetryCount}/3 次重试</Typography.Text>
          <Typography.Text type="secondary">预计：{formatDate(record.nextDispatchAt)}</Typography.Text>
        </Space>
      ) : "-"
    },
    {
      title: "时间",
      key: "time",
      width: 200,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Typography.Text>计划：{formatDate(record.scheduledAt || record.scheduledSlot)}</Typography.Text>
          <Typography.Text type="secondary">
            更新：{formatDate(record.reportedAt || record.finishedAt || record.dispatchedAt || record.claimedAt)}
          </Typography.Text>
        </Space>
      )
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
    <>
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
        <div><Statistic title="设备忙（待重试）" value={dashboard.data?.stats.busy ?? 0} valueStyle={{ color: "#c56a09" }} /></div>
        <div><Statistic title="话题待补" value={dashboard.data?.stats.topicPending ?? 0} valueStyle={{ color: "#c56a09" }} /></div>
        <div><Statistic title="素材异常" value={dashboard.data?.stats.materialInvalid ?? 0} valueStyle={{ color: "#c53030" }} /></div>
        <div><Statistic title="视频号待验证" value={dashboard.data?.stats.channelsVerifyPending ?? 0} valueStyle={{ color: "#722ed1" }} /></div>
        <div><Statistic title="外部回写失败" value={dashboard.data?.stats.reportFailed ?? 0} valueStyle={{ color: "#c53030" }} /></div>
      </div>

      <section className="ops-panel">
        <div className="ops-panel-body">
          <Table<PublishTaskRow>
            rowKey="id"
            columns={columns}
            dataSource={dashboard.data?.data ?? []}
            loading={dashboard.isLoading}
            scroll={{ x: 1600 }}
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
    </>
  );
}

export function PublishTasksPage() {
  return (
    <div className="ops-page publish-tasks-page">
      <PublishTasksContent />
    </div>
  );
}
