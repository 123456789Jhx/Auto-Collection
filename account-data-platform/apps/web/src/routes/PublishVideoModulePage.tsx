import { Tabs, Typography } from "antd";
import { useState } from "react";
import { PublishExecutionSettingsPage } from "./PublishExecutionSettingsPage";
import { PublishPastePage } from "./PublishPastePage";
import { PublishSchedulesPage } from "./PublishSchedulesPage";
import { PublishTasksContent } from "./PublishTasksPage";
import { SingleInterfacePublishPage } from "./SingleInterfacePublishPage";

export function PublishVideoModulePage() {
  const [activeTab, setActiveTab] = useState("task-dashboard");
  const goToDashboard = () => setActiveTab("task-dashboard");

  return (
    <div className="ops-page publish-video-module-page">
      <div className="ops-page-header">
        <Typography.Title level={3}>视频发布</Typography.Title>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: "task-dashboard",
            label: "任务看板",
            children: <div className="publish-tasks-page"><PublishTasksContent /></div>
          },
          {
            key: "paste-publish",
            label: "粘贴发布",
            children: <PublishPastePage onTaskCreated={goToDashboard} />
          },
          {
            key: "single-interface-publish",
            label: "接口发布",
            children: <SingleInterfacePublishPage />
          },
          {
            key: "publish-schedules",
            label: "接口定时",
            children: <PublishSchedulesPage />
          },
          {
            key: "execution-settings",
            label: "发布设置",
            children: <PublishExecutionSettingsPage />
          },
        ]}
      />
    </div>
  );
}
