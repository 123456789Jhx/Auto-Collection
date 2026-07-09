import { BarChartOutlined, ControlOutlined, DatabaseOutlined, FileTextOutlined, LockOutlined, LoginOutlined, LogoutOutlined, SettingOutlined, UserOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Layout, Menu, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { clearAdminToken, getAdminToken, getCurrentAdmin, loginAdmin, setAdminToken, type AdminUser } from "../lib/api-client";
import { DashboardPage } from "./DashboardPage";
import { LogsPage } from "./LogsPage";
import { RecordsPage } from "./RecordsPage";
import { TaskSchedulerPage } from "./TaskSchedulerPage";
import { TasksPage } from "./TasksPage";

const { Header, Sider, Content } = Layout;

const pages = {
  dashboard: { title: "工作台", component: <DashboardPage /> },
  scheduler: { title: "任务调度", component: <TaskSchedulerPage /> },
  tasks: { title: "配置", component: <TasksPage /> },
  records: { title: "采集记录", component: <RecordsPage /> },
  logs: { title: "日志中心", component: <LogsPage /> }
};

type PageKey = keyof typeof pages;
type AuthStatus = "checking" | "authenticated" | "unauthenticated";

type LoginFormValues = {
  username: string;
  password: string;
};

function LoginPage({ onLogin }: { onLogin: (user: AdminUser) => void }) {
  const loginMutation = useMutation({
    mutationFn: loginAdmin,
    onSuccess: (result) => {
      setAdminToken(result.token);
      onLogin(result.user);
    }
  });

  return (
    <div className="login-page">
      <div className="login-panel">
        <div className="login-brand">
          <Typography.Title level={3}>后台管理员登录</Typography.Title>
          <Typography.Text type="secondary">请输入管理员账号和密码</Typography.Text>
        </div>
        {loginMutation.isError ? <Alert type="error" showIcon message={loginMutation.error.message || "登录失败"} className="login-alert" /> : null}
        <Form<LoginFormValues> layout="vertical" initialValues={{ username: "root", password: "root" }} onFinish={(values) => loginMutation.mutate(values)}>
          <Form.Item label="账号" name="username" rules={[{ required: true, message: "请输入账号" }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" />
          </Form.Item>
          <Form.Item label="密码" name="password" rules={[{ required: true, message: "请输入密码" }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<LoginOutlined />} block loading={loginMutation.isPending}>
            登录
          </Button>
        </Form>
      </div>
    </div>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState<PageKey>("dashboard");
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() => (getAdminToken() ? "checking" : "unauthenticated"));
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const current = useMemo(() => pages[page], [page]);

  function logout() {
    clearAdminToken();
    queryClient.clear();
    setAdminUser(null);
    setAuthStatus("unauthenticated");
  }

  useEffect(() => {
    if (!getAdminToken()) {
      setAuthStatus("unauthenticated");
      return;
    }

    let active = true;
    getCurrentAdmin()
      .then((result) => {
        if (!active) return;
        setAdminUser(result.user);
        setAuthStatus("authenticated");
      })
      .catch(() => {
        if (!active) return;
        logout();
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    window.addEventListener("admin-auth-expired", logout);
    return () => window.removeEventListener("admin-auth-expired", logout);
  }, []);

  if (authStatus === "checking") {
    return (
      <div className="login-page">
        <Spin tip="正在验证登录状态" />
      </div>
    );
  }

  if (authStatus !== "authenticated") {
    return (
      <LoginPage
        onLogin={(user) => {
          setAdminUser(user);
          setAuthStatus("authenticated");
        }}
      />
    );
  }

  return (
    <Layout className="app-shell">
      <Sider width={220} className="sidebar">
        <div className="brand">燎原星火后台</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[page]}
          onClick={(item) => setPage(item.key as PageKey)}
          items={[
            { key: "dashboard", icon: <BarChartOutlined />, label: "工作台" },
            { key: "scheduler", icon: <ControlOutlined />, label: "任务调度" },
            { key: "tasks", icon: <SettingOutlined />, label: "配置" },
            { key: "records", icon: <DatabaseOutlined />, label: "采集记录" },
            { key: "logs", icon: <FileTextOutlined />, label: "日志中心" }
          ]}
        />
      </Sider>
      <Layout>
        <Header className="topbar">
          <Typography.Title level={4} className="page-title">
            {current.title}
          </Typography.Title>
          <Space>
            <Tag color="green">运营后台</Tag>
            <Tag icon={<UserOutlined />}>{adminUser?.username ?? "admin"}</Tag>
            <Button icon={<LogoutOutlined />} onClick={logout}>
              退出
            </Button>
          </Space>
        </Header>
        <Content className="content">{current.component}</Content>
      </Layout>
    </Layout>
  );
}
