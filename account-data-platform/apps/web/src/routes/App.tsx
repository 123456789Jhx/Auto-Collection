import { CloudSyncOutlined, FileTextOutlined, FireOutlined, LockOutlined, LoginOutlined, LogoutOutlined, MobileOutlined, TeamOutlined, UserOutlined, VideoCameraAddOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Layout, Menu, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { clearAdminToken, getAdminToken, getCurrentAdmin, loginAdmin, setAdminToken, type AdminUser } from "../lib/api-client";
import { AccountWarmupModulePage } from "./AccountWarmupModulePage";
import { LogsPage } from "./LogsPage";
import { RemoteScriptsPage } from "./RemoteScriptsPage";
import { PublishTasksPage } from "./PublishTasksPage";
import { PublishVideoModulePage } from "./PublishVideoModulePage";
import { TaskSchedulerPage } from "./TaskSchedulerPage";
import { TasksPage } from "./TasksPage";
import { UpdateCenterPage } from "./UpdateCenterPage";
import { RemoteWakePage } from "../features/remote-wake/RemoteWakePage";
import { DeviceAccountsPage } from "./DeviceAccountsPage";

const { Header, Sider, Content } = Layout;

const pages = {
  publishVideo: { title: "视频发布" },
  accountWarmup: { title: "养号" },
  scheduler: { title: "任务调度" },
  tasks: { title: "配置" },
  remoteScripts: { title: "远程脚本" },
  publishTasks: { title: "发布任务" },
  updateCenter: { title: "更新中心" },
  logs: { title: "日志中心" },
  remoteWake: { title: "远程唤醒" },
  deviceAccounts: { title: "设备账号" }
};

type PageKey = keyof typeof pages;
type AuthStatus = "checking" | "authenticated" | "unauthenticated";

function renderPage(page: PageKey) {
  if (page === "publishVideo") return <PublishVideoModulePage />;
  if (page === "accountWarmup") return <AccountWarmupModulePage />;
  if (page === "scheduler") return <TaskSchedulerPage />;
  if (page === "tasks") return <TasksPage />;
  if (page === "remoteScripts") return <RemoteScriptsPage />;
  if (page === "publishTasks") return <PublishTasksPage />;
  if (page === "updateCenter") return <UpdateCenterPage />;
  if (page === "remoteWake") return <RemoteWakePage />;
  if (page === "deviceAccounts") return <DeviceAccountsPage />;
  return <LogsPage />;
}

type LoginFormValues = {
  username: string;
  password: string;
};

function pageFromPath(): PageKey {
  if (window.location.pathname === "/publish-video") return "publishVideo";
  if (window.location.pathname === "/account-warmup") return "accountWarmup";
  if (window.location.pathname === "/publish-tasks") return "publishTasks";
  if (window.location.pathname === "/remote-scripts") return "remoteScripts";
  if (window.location.pathname === "/update-center") return "updateCenter";
  if (window.location.pathname === "/logs") return "logs";
  if (window.location.pathname === "/remote-wake") return "remoteWake";
  if (window.location.pathname === "/device-accounts") return "deviceAccounts";
  return "publishVideo";
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
    component: renderPage(page)
  }), [page]);

  function logout() {
    clearAdminToken();
    queryClient.clear();
    setAdminUser(null);
    setAuthStatus("unauthenticated");
  }

  function navigateToPage(nextPage: PageKey) {
    setPage(nextPage);
    const nextPath = nextPage === "publishVideo"
      ? "/publish-video"
      : nextPage === "accountWarmup"
      ? "/account-warmup"
      : nextPage === "remoteScripts"
      ? "/remote-scripts"
      : nextPage === "publishTasks" ? "/publish-tasks"
      : nextPage === "updateCenter" ? "/update-center"
      : nextPage === "remoteWake" ? "/remote-wake"
      : nextPage === "deviceAccounts" ? "/device-accounts"
      : nextPage === "logs" ? "/logs" : "/publish-video";
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
            { key: "publishVideo", icon: <VideoCameraAddOutlined />, label: "视频发布" },
            { key: "accountWarmup", icon: <FireOutlined />, label: "养号" },
            // LEGACY_FREEZE: 保留调度与配置页面代码，恢复业务时再放回两个菜单项。
            // LEGACY_FREEZE: 远程脚本与发布任务保留旧 URL，只隐藏独立菜单入口。
            { key: "updateCenter", icon: <CloudSyncOutlined />, label: "更新中心" },
            { key: "logs", icon: <FileTextOutlined />, label: "日志中心" },
            { key: "remoteWake", icon: <MobileOutlined />, label: "远程唤醒" },
            { key: "deviceAccounts", icon: <TeamOutlined />, label: "设备账号" }
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
