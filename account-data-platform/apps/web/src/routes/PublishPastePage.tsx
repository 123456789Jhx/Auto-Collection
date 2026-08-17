import { useQuery } from "@tanstack/react-query";
import { Alert, Skeleton, Typography } from "antd";
import { getDevices } from "../lib/api-client";
import { getRemoteScriptConfigs } from "../lib/api-client-remote-scripts";
import type { DeviceRow } from "./DeviceList";
import { QuickPastePublishPanel } from "./QuickPastePublishPanel";

type Props = {
  onTaskCreated: () => void;
};

export function PublishPastePage({ onTaskCreated }: Props) {
  const configsQuery = useQuery({
    queryKey: ["remoteScriptConfigs", "publish_video", "ENABLED", "paste-publish"],
    queryFn: () => getRemoteScriptConfigs({
      scriptKey: "publish_video",
      status: "ENABLED",
      sourceMode: "direct_material",
      page: 1,
      pageSize: 100
    })
  });
  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices
  });

  if (configsQuery.isLoading && devicesQuery.isLoading) {
    return <Skeleton active />;
  }

  const loadError = configsQuery.error ?? devicesQuery.error;
  if (loadError) {
    return (
      <Alert
        type="error"
        showIcon
        message="粘贴发布页面加载失败"
        description={loadError.message}
      />
    );
  }

  return (
    <section className="ops-section publish-paste-page">
      <div className="ops-section-header">
        <div>
          <Typography.Title level={4}>粘贴发布</Typography.Title>
          <Typography.Paragraph type="secondary">
            粘贴素材链接和发布文案，创建任务后仅下发到所选设备，不回写外部系统。
          </Typography.Paragraph>
        </div>
      </div>
      <QuickPastePublishPanel
        configs={configsQuery.data?.data ?? []}
        devices={(devicesQuery.data ?? []) as DeviceRow[]}
        loading={configsQuery.isLoading || devicesQuery.isLoading}
        onTaskCreated={onTaskCreated}
      />
    </section>
  );
}
