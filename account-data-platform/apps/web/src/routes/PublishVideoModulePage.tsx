import { Tabs, Typography } from "antd";
import { useState } from "react";
import { DeviceBindingList } from "./DeviceBindingList";
import { PublishTasksContent } from "./PublishTasksPage";
import { RemoteScriptsContent } from "./RemoteScriptsPage";
import { PublishTaskOperations } from "./PublishTaskOperations";

export function PublishVideoModulePage() {
  const [activeTab, setActiveTab] = useState("task-dashboard");

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
            key: "task-operations",
            label: "任务操作",
            children: <PublishTaskOperations onTaskCreated={() => setActiveTab("task-dashboard")} />
          },
          {
            key: "business-config",
            label: "业务配置",
            children: <RemoteScriptsContent fixedScriptKey="publish_video" title="业务配置" />
          },
          {
            key: "device-binding",
            label: "设备绑定",
            children: <DeviceBindingList />
          }
        ]}
      />
    </div>
  );
}
