import { Tabs, Typography } from "antd";
import { AccountWarmupPage } from "./AccountWarmupPage";
import { VideoWarmupPage } from "./VideoWarmupPage";

export function AccountWarmupModulePage() {
  return (
    <div className="ops-page account-warmup-module-page">
      <div className="ops-page-header">
        <Typography.Title level={3}>养号</Typography.Title>
      </div>
      <Tabs
        defaultActiveKey="target-live-interaction"
        items={[
          {
            key: "target-live-interaction",
            label: "目标直播间互动养号",
            children: <AccountWarmupPage />
          },
          {
            key: "video-warmup",
            label: "视频养号",
            children: <VideoWarmupPage />
          }
        ]}
      />
    </div>
  );
}
