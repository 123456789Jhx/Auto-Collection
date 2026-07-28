import { BarChartOutlined, CloudUploadOutlined, CodeOutlined, ControlOutlined, DatabaseOutlined, FileTextOutlined, LockOutlined, LoginOutlined, LogoutOutlined, MobileOutlined, SettingOutlined, UserOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Layout, Menu, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { clearAdminToken, getAdminToken, getCurrentAdmin, loginAdmin, setAdminToken, type AdminUser } from "../lib/api-client";
import { DashboardPage } from "./DashboardPage";
import { DevicesPage } from "./DevicesPage";
import { LogsPage } from "./LogsPage";
import { RecordsPage } from "./RecordsPage";
import { RemoteScriptsPage } from "./RemoteScriptsPage";
import { PublishTasksPage } from "./PublishTasksPage";
import { TaskSchedulerPage } from "./TaskSchedulerPage";
import { TasksPage } from "./TasksPage";

const { Header, Sider, Content } = Layout;

const pages = {
  dashboard: { title: "工作台" },
  scheduler: { title: "任务调度" },
  tasks: { title: "配置" },
  devices: { title: "设备" },
  remoteScripts: { title: "远程脚本" },
  publishTasks: { title: "发布任务" },
  records: { title: "采集记录" },
  logs: { title: "日志中心" }
};

type PageKey = keyof typeof pages;
type AuthStatus = "checking" | "authenticated" | "unauthenticated";

function renderPage(page: PageKey, openScheduler: () => void) {
  if (page === "dashboard") return <DashboardPage onOpenScheduler={openScheduler} />;
  if (page === "scheduler") return <TaskSchedulerPage />;
  if (page === "tasks") return <TasksPage />;
  if (page === "devices") return <DevicesPage />;
  if (page === "remoteScripts") return <RemoteScriptsPage />;
  if (page === "publishTasks") return <PublishTasksPage />;
  if (page === "records") return <RecordsPage />;
  return <LogsPage />;
}

type LoginFormValues = {
  username: string;
  password: string;
};

function pageFromPath(): PageKey {
  if (window.location.pathname === "/publish-tasks") return "publishTasks";
  if (window.location.pathname === "/devices") return "devices";
  return window.location.pathname === "/remote-scripts" ? "remoteScripts" : "dashboard";
}

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
  const [page, setPage] = useState<PageKey>(pageFromPath);
  const [authStatus, setAuthStatus] = useState<AuthStatus>(() => (getAdminToken() ? "checking" : "unauthenticated"));
  const [adminUser, setAdminUser] = useState<AdminUser | null>(null);
  const current = useMemo(() => ({
    title: pages[page].title,
    component: renderPage(page, () => setPage("scheduler"))
  }), [page]);

  function logout() {
    clearAdminToken();
    queryClient.clear();
    setAdminUser(null);
    setAuthStatus("unauthenticated");
  }

  function navigateToPage(nextPage: PageKey) {
    setPage(nextPage);
    const nextPath = nextPage === "remoteScripts"
      ? "/remote-scripts"
      : nextPage === "publishTasks" ? "/publish-tasks"
      : nextPage === "devices" ? "/devices" : "/";
    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, "", nextPath);
    }
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

  useEffect(() => {
    const handlePopState = () => setPage(pageFromPath());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
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
          onClick={(item) => navigateToPage(item.key as PageKey)}
          items={[
            { key: "dashboard", icon: <BarChartOutlined />, label: "工作台" },
            { key: "scheduler", icon: <ControlOutlined />, label: "任务调度" },
            { key: "tasks", icon: <SettingOutlined />, label: "配置" },
            { key: "devices", icon: <MobileOutlined />, label: "设备" },
            { key: "remoteScripts", icon: <CodeOutlined />, label: "远程脚本" },
            { key: "publishTasks", icon: <CloudUploadOutlined />, label: "发布任务" },
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
