import { Empty, Tabs, Typography } from "antd";
import { DeviceBindingList } from "./DeviceBindingList";
import { PublishTasksContent } from "./PublishTasksPage";
import { RemoteScriptsContent } from "./RemoteScriptsPage";

export function PublishVideoModulePage() {
  return (
    <div className="ops-page publish-video-module-page">
      <div className="ops-page-header">
        <Typography.Title level={3}>视频发布</Typography.Title>
      </div>
      <Tabs
        defaultActiveKey="task-dashboard"
        items={[
          {
            key: "task-dashboard",
            label: "任务看板",
            children: <div className="publish-tasks-page"><PublishTasksContent /></div>
          },
          {
            key: "task-operations",
            label: "任务操作",
            children: (
              <section className="ops-panel">
                <div className="ops-panel-body"><Empty description="开发中" /></div>
              </section>
            )
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
