import { useQuery } from "@tanstack/react-query";
import { Alert, Card, Skeleton, Table, Tag } from "antd";
import { getTasks } from "../lib/api-client";

type TaskRow = {
  id?: string;
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  heartbeatMinutes?: number;
};

export function TasksPage() {
  const query = useQuery({ queryKey: ["tasks"], queryFn: getTasks });
  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" message="任务配置加载失败" description={query.error.message} showIcon />;

  return (
    <Card title="任务配置">
      <Table<TaskRow> rowKey={(row) => String(row.id)} dataSource={(query.data ?? []) as TaskRow[]}>
        <Table.Column title="任务编号" dataIndex="taskCode" />
        <Table.Column title="名称" dataIndex="name" />
        <Table.Column title="平台" dataIndex="platform" />
        <Table.Column title="模式" dataIndex="mode" />
        <Table.Column<TaskRow> title="视频时长" render={(_, row) => `${row.videoMinutesMin}-${row.videoMinutesMax} 分钟`} />
        <Table.Column<TaskRow> title="直播时长" render={(_, row) => `${row.liveMinutesMin}-${row.liveMinutesMax} 分钟`} />
        <Table.Column<TaskRow> title="心跳间隔" render={(_, row) => `${row.heartbeatMinutes ?? 1} 分钟`} />
        <Table.Column title="状态" dataIndex="status" render={(value) => <Tag color={value === "ENABLED" ? "green" : "default"}>{value}</Tag>} />
      </Table>
    </Card>
  );
}
