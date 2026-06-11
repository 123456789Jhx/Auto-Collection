import { BarChartOutlined, DatabaseOutlined, FileTextOutlined, MobileOutlined, SettingOutlined } from "@ant-design/icons";
import { Layout, Menu, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { DashboardPage } from "./DashboardPage";
import { DevicesPage } from "./DevicesPage";
import { LogsPage } from "./LogsPage";
import { RecordsPage } from "./RecordsPage";
import { TasksPage } from "./TasksPage";

const { Header, Sider, Content } = Layout;

const pages = {
  dashboard: { title: "监控看板", component: <DashboardPage /> },
  devices: { title: "设备", component: <DevicesPage /> },
  records: { title: "采集记录", component: <RecordsPage /> },
  logs: { title: "日志", component: <LogsPage /> },
  tasks: { title: "任务配置", component: <TasksPage /> }
};

type PageKey = keyof typeof pages;

export function App() {
  const [page, setPage] = useState<PageKey>("dashboard");
  const current = useMemo(() => pages[page], [page]);

  return (
    <Layout className="app-shell">
      <Sider width={220} className="sidebar">
        <div className="brand">农业采集监控</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          onClick={(item) => setPage(item.key as PageKey)}
          items={[
            { key: "dashboard", icon: <BarChartOutlined />, label: "监控看板" },
            { key: "devices", icon: <MobileOutlined />, label: "设备" },
            { key: "records", icon: <DatabaseOutlined />, label: "采集记录" },
            { key: "logs", icon: <FileTextOutlined />, label: "日志" },
            { key: "tasks", icon: <SettingOutlined />, label: "任务配置" }
          ]}
        />
      </Sider>
      <Layout>
        <Header className="topbar">
          <Typography.Title level={4} className="page-title">
            {current.title}
          </Typography.Title>
          <Tag color="green">轻量监控后台</Tag>
        </Header>
        <Content className="content">{current.component}</Content>
      </Layout>
    </Layout>
  );
}
