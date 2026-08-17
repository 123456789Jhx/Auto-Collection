import { PauseCircleOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, message, Space, Tag, Typography } from "antd";
import {
  getCurrentSingleInterfacePublish,
  startSingleInterfacePublish,
  stopSingleInterfacePublish,
  type SingleInterfacePublishStatus
} from "../lib/api-client-single-interface-publish";

const queryKey = ["single-interface-publish", "current"] as const;

const statusPresentation: Record<SingleInterfacePublishStatus, { label: string; color: string }> = {
  IDLE: { label: "未启动", color: "default" },
  STARTING: { label: "启动中", color: "processing" },
  RUNNING: { label: "执行中", color: "blue" },
  STOPPING: { label: "停止中", color: "warning" },
  STOPPED: { label: "已停止", color: "default" },
  SUCCEEDED: { label: "已完成", color: "success" },
  FAILED: { label: "失败", color: "error" }
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "操作失败，请稍后重试";
}

export function SingleInterfacePublishPage() {
  const [messageApi, contextHolder] = message.useMessage();
  const queryClient = useQueryClient();
  const currentQuery = useQuery({
    queryKey,
    queryFn: getCurrentSingleInterfacePublish,
    refetchInterval: 3_000
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey });
  const startMutation = useMutation({
    mutationFn: startSingleInterfacePublish,
    onSuccess: () => {
      messageApi.success("接口发布任务已启动");
      void refresh();
    },
    onError: (error) => messageApi.error(errorMessage(error))
  });
  const stopMutation = useMutation({
    mutationFn: stopSingleInterfacePublish,
    onSuccess: () => {
      messageApi.success("停止指令已提交");
      void refresh();
    },
    onError: (error) => messageApi.error(errorMessage(error))
  });

  const run = currentQuery.data;
  const status = run?.status ?? "IDLE";
  const presentation = statusPresentation[status] ?? statusPresentation.IDLE;
  const changing = startMutation.isPending || stopMutation.isPending;
  const canStart = ["IDLE", "STOPPED", "SUCCEEDED", "FAILED"].includes(status);
  const canStop = status === "STARTING" || status === "RUNNING";

  return (
    <div className="publish-schedules-page">
      {contextHolder}
      <div className="ops-page-header">
        <Typography.Title level={3}>接口发布</Typography.Title>
        <Typography.Text type="secondary">
          从测试接口获取一条账号素材，并交由现有手机发布流程执行。
        </Typography.Text>
      </div>

      {currentQuery.isError ? (
        <Alert
          showIcon
          type="error"
          message="当前状态加载失败"
          description={errorMessage(currentQuery.error)}
          action={<Button size="small" onClick={() => void currentQuery.refetch()}>重试</Button>}
        />
      ) : null}

      <div className="ops-panel">
        <div className="ops-panel-header">
          <Typography.Text strong>测试绑定</Typography.Text>
          <Tag color={run?.deviceStatus === "online" ? "success" : "default"}>
            {run?.deviceStatus === "online" ? "设备在线" : (run?.deviceStatus ?? "等待设备状态")}
          </Tag>
        </div>
        <div className="ops-panel-body">
          <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
            <Descriptions.Item label="设备">{run?.deviceName ?? run?.deviceCode ?? "唯一测试设备"}</Descriptions.Item>
            <Descriptions.Item label="账号">{run?.accountName ?? "勤能致富"}</Descriptions.Item>
            <Descriptions.Item label="抖音号">{run?.douyinId ?? "23362504586"}</Descriptions.Item>
            <Descriptions.Item label="当前状态"><Tag color={presentation.color}>{presentation.label}</Tag></Descriptions.Item>
          </Descriptions>
          <Space>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              loading={startMutation.isPending}
              disabled={changing || !canStart}
              onClick={() => startMutation.mutate()}
            >
              启动
            </Button>
            <Button
              danger
              icon={<PauseCircleOutlined />}
              loading={stopMutation.isPending}
              disabled={changing || !canStop}
              onClick={() => stopMutation.mutate()}
            >
              停止
            </Button>
          </Space>
        </div>
      </div>

      <div className="ops-panel">
        <div className="ops-panel-header"><Typography.Text strong>任务摘要</Typography.Text></div>
        <div className="ops-panel-body">
          <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label="任务标题">{run?.title ?? "暂无任务"}</Descriptions.Item>
            <Descriptions.Item label="本地任务 ID">{run?.taskId ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="外部任务 ID">{run?.externalTaskId ?? "-"}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{run?.updatedAt ?? "-"}</Descriptions.Item>
          </Descriptions>
          {run?.error ? <Alert showIcon type="error" message={run.error} /> : null}
        </div>
      </div>
    </div>
  );
}
