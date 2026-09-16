import { ReloadOutlined } from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Select, Space, Statistic, Table, Tag, Tabs, Typography, type TableColumnsType } from "antd";
import { useState } from "react";
import {
  getAgentDeviceUpdateStatuses, getAgentReleases,
  type AgentRelease, type AgentReleaseChannel, type DeviceUpdateStatus
} from "../lib/api-client-update-center";
import { bizScriptDevicesKey, bizScriptPreviewsKey, bizScriptWorkspaceKey } from "../lib/api-client-biz-script-workspace";
import { BizScriptWorkspacePanel } from "../components/update-center/BizScriptWorkspacePanel";

const agentVersionChannels: Array<{ label: string; value: AgentReleaseChannel }> = [
  { label: "稳定版（stable）", value: "stable" },
  { label: "灰度版（gray）", value: "gray" },
  { label: "开发版（dev）", value: "dev" }
];

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}

function updateStatusLabel(value?: string | null) {
  const labels: Record<string, string> = {
    CHECKED: "已检查",
    DOWNLOADED: "已下载",
    VERIFIED: "已校验",
    APPLIED: "已生效",
    FAILED: "失败",
    ROLLBACK: "已回滚"
  };
  return value ? labels[value] ?? value : "未上报";
}

function updateStatusColor(value?: string | null) {
  if (value === "APPLIED") return "green";
  if (value === "FAILED" || value === "ROLLBACK") return "red";
  if (value === "DOWNLOADED" || value === "VERIFIED") return "blue";
  return "default";
}

function apkChannelLabel(channel = "stable") {
  return agentVersionChannels.find((item) => item.value === channel)?.label ?? channel;
}

export function UpdateCenterPage() {
  const [activeTab, setActiveTab] = useState("biz-scripts");
  const [apkChannel, setApkChannel] = useState<AgentReleaseChannel>("stable");
  const queryClient = useQueryClient();
  const apkReleasesQuery = useQuery({
    queryKey: ["apkReleases", apkChannel],
    queryFn: () => getAgentReleases(apkChannel),
    enabled: activeTab === "apk"
  });
  const apkDeviceStatusesQuery = useQuery({
    queryKey: ["apkDeviceUpdateStatuses", apkChannel],
    queryFn: () => getAgentDeviceUpdateStatuses(apkChannel),
    refetchInterval: 15_000,
    enabled: activeTab === "apk"
  });
  const deviceColumns: TableColumnsType<DeviceUpdateStatus> = [
    {
      title: "设备",
      dataIndex: "deviceCode",
      render: (value: string, row) => (
        <div>
          <Typography.Text strong>{row.deviceName || value}</Typography.Text>
          {row.deviceName ? <div><Typography.Text type="secondary">{value}</Typography.Text></div> : null}
        </div>
      )
    },
    { title: "当前版本", dataIndex: "currentVersion", width: 120, render: (value: string | null) => value || "-" },
    { title: "目标版本", dataIndex: "targetVersion", width: 120, render: (value: string | null) => value || "-" },
    {
      title: "更新状态",
      dataIndex: "updateStatus",
      width: 120,
      render: (value: string | null, row) => (
        <Tag color={row.isCurrent ? "green" : updateStatusColor(value)}>
          {row.isCurrent ? "当前已生效" : updateStatusLabel(value)}
        </Tag>
      )
    },
    { title: "上报信息", dataIndex: "eventMessage", ellipsis: true, render: (value: string | null) => value || "-" },
    { title: "最后更新", dataIndex: "updatedAt", width: 180, render: formatDateTime }
  ];

  const apkReleaseColumns: TableColumnsType<AgentRelease> = [
    { title: "版本", dataIndex: "version", width: 130 },
    {
      title: "通道",
      dataIndex: "channel",
      width: 130,
      render: (value: AgentReleaseChannel) => apkChannelLabel(value)
    },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => <Tag color={value === "PUBLISHED" ? "green" : "default"}>{value}</Tag>
    },
    {
      title: "APK 包",
      dataIndex: "packageUrl",
      ellipsis: true,
      render: (value: string | null) => value
        ? <Typography.Link href={value} target="_blank" rel="noreferrer">{value}</Typography.Link>
        : "-"
    },
    { title: "SHA-256", dataIndex: "sha256", width: 180, ellipsis: true, render: (value: string | null) => value ?? "-" },
    { title: "发布说明", dataIndex: "releaseNote", ellipsis: true, render: (value: string | null) => value || "-" },
    { title: "发布时间", dataIndex: "publishedAt", width: 180, render: formatDateTime }
  ];

  const apkSummary = apkDeviceStatusesQuery.data?.summary;

  const apkContent = (
    <>
      <section className="ops-panel">
        <div className="ops-panel-head"><span>APK 基座版本</span></div>
        <div className="ops-panel-body">
          <Alert
            type="warning"
            showIcon
            message="APK 基座包含原生代码、权限和引擎能力，必须单独构建、签名并安装；业务脚本更新不会触发 APK 构建。"
            style={{ marginBottom: 16 }}
          />
          <Space style={{ marginBottom: 16 }} wrap>
            <Typography.Text strong>版本通道</Typography.Text>
            <Select value={apkChannel} options={agentVersionChannels} onChange={setApkChannel} style={{ width: 180 }} />
          </Space>
          <Table<AgentRelease> rowKey="id" columns={apkReleaseColumns} dataSource={apkReleasesQuery.data?.data ?? []} loading={apkReleasesQuery.isLoading} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 1200 }} />
        </div>
      </section>

      <section className="ops-panel">
        <div className="ops-panel-head"><span>APK 设备状态</span><span className="ops-small">通道 {apkChannelLabel(apkChannel)} · 目标版本 {apkDeviceStatusesQuery.data?.targetVersion || "-"}</span></div>
        <div className="ops-panel-body">
          <Space size="large" wrap style={{ marginBottom: 16 }}>
            <Statistic title="设备总数" value={apkSummary?.total ?? 0} />
            <Statistic title="已生效" value={apkSummary?.applied ?? 0} />
            <Statistic title="更新中" value={apkSummary?.pending ?? 0} />
            <Statistic title="失败" value={apkSummary?.failed ?? 0} />
            <Statistic title="未上报" value={apkSummary?.noReport ?? 0} />
          </Space>
          <Table<DeviceUpdateStatus> rowKey="deviceId" columns={deviceColumns} dataSource={apkDeviceStatusesQuery.data?.data ?? []} loading={apkDeviceStatusesQuery.isLoading} locale={{ emptyText: "暂无 APK 更新上报" }} pagination={false} scroll={{ x: 900 }} />
        </div>
      </section>
    </>
  );

  return (
    <div className="ops-page">
      <div className="ops-page-header">
        <Typography.Title level={3}>更新中心</Typography.Title>
        <Button icon={<ReloadOutlined />} loading={apkReleasesQuery.isFetching || apkDeviceStatusesQuery.isFetching}
          onClick={() => {
            if (activeTab === "apk") {
              void apkReleasesQuery.refetch();
              void apkDeviceStatusesQuery.refetch();
            } else {
              void queryClient.invalidateQueries({ queryKey: bizScriptWorkspaceKey });
              void queryClient.invalidateQueries({ queryKey: bizScriptPreviewsKey });
              void queryClient.invalidateQueries({ queryKey: bizScriptDevicesKey });
            }
          }}>刷新</Button>
      </div>
      <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
        { key: "biz-scripts", label: "业务脚本", children: <BizScriptWorkspacePanel /> },
        { key: "apk", label: "APK 基座", children: apkContent }
      ]} />
    </div>
  );
}
