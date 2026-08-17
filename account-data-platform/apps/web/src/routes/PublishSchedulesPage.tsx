import { ApiOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  App as AntdApp,
  Button,
  Table,
  Tag,
  Typography,
  type TableColumnsType
} from "antd";
import { useMemo } from "react";
import { testPublishScheduleConnection } from "../lib/api-client-publish-schedules";
import { getRemoteScriptConfigs, type RemoteScriptConfig } from "../lib/api-client-remote-scripts";
import { InterfacePublishBindingsPanel } from "./InterfacePublishBindingsPanel";
import { InterfacePublishRunControl } from "./InterfacePublishRunControl";
import { InterfacePublishRunMonitor } from "./InterfacePublishRunMonitor";
import { getPublishSourceMode } from "./RemoteScriptsPage";

type ScheduleRow = RemoteScriptConfig & {
  externalBaseUrl: string;
};

function toScheduleRow(config: RemoteScriptConfig): ScheduleRow | null {
  const externalBaseUrl = config.configPayload.externalBaseUrl;
  if (typeof externalBaseUrl !== "string") return null;
  return { ...config, externalBaseUrl };
}

export function PublishSchedulesPage() {
  const { message } = AntdApp.useApp();
  const configsQuery = useQuery({
    queryKey: ["remoteScriptConfigs", "publish_video", "schedules"],
    queryFn: () => getRemoteScriptConfigs({
      scriptKey: "publish_video",
      sourceMode: "external_pull",
      page: 1,
      pageSize: 100
    })
  });
  const schedules = useMemo(() => (configsQuery.data?.data ?? [])
    .filter((config) => getPublishSourceMode(config) === "external_pull")
    .map(toScheduleRow)
    .filter((config): config is ScheduleRow => config !== null), [configsQuery.data?.data]);
  const testMutation = useMutation({
    mutationFn: testPublishScheduleConnection,
    onSuccess: (result) => message.success(`${result.message}（HTTP ${result.httpStatus}）`),
    onError: (error: Error) => message.error(error.message || "测试连接失败")
  });
  const columns: TableColumnsType<ScheduleRow> = [
    {
      title: "接口定时配置",
      dataIndex: "configName",
      render: (value: string, record) => (
        <div>
          <Typography.Text strong>{value}</Typography.Text>
          <div><Typography.Text type="secondary">{record.externalBaseUrl}</Typography.Text></div>
        </div>
      )
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => (
        <Tag color={value === "ENABLED" ? "green" : "default"}>
          {value === "ENABLED" ? "已启用" : "已停用"}
        </Tag>
      )
    },
    {
      title: "操作",
      key: "actions",
      width: 140,
      render: (_, record) => (
        <Button
          icon={<ApiOutlined />}
          loading={testMutation.isPending && testMutation.variables === record.id}
          onClick={() => testMutation.mutate(record.id)}
        >测试连接</Button>
      )
    }
  ];

  return (
    <div className="ops-page publish-schedules-page">
      <div className="ops-page-header">
        <div>
          <Typography.Title level={3}>接口定时</Typography.Title>
          <Typography.Text type="secondary">配置总任务发布时间，查看设备匹配、运行进度和告警。</Typography.Text>
        </div>
        <InterfacePublishBindingsPanel />
      </div>

      <InterfacePublishRunControl
        configs={schedules
          .filter((config) => config.status === "ENABLED")
          .map((config) => ({ id: config.id, name: config.configName }))}
      />
      <InterfacePublishRunMonitor />

      <section className="ops-panel">
        <div className="ops-panel-head"><span>固定接口连接</span></div>
        <div className="ops-panel-body">
          <Table<ScheduleRow>
            rowKey="id"
            loading={configsQuery.isLoading}
            columns={columns}
            dataSource={schedules}
            pagination={false}
            locale={{ emptyText: "固定接口配置尚未初始化" }}
            scroll={{ x: 760 }}
          />
        </div>
      </section>

    </div>
  );
}
