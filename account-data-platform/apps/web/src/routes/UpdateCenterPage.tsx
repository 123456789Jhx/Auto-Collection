import { CloudUploadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Form,
  Input,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tabs,
  Typography,
  type TableColumnsType
} from "antd";
import {
  buildAndPublishBizScripts,
  getAgentDeviceUpdateStatuses,
  getAgentReleases,
  getBizScriptFiles,
  getBizScriptReleases,
  getDeviceUpdateStatuses,
  type BuildBizScriptReleasePayload,
  type AgentRelease,
  type AgentReleaseChannel,
  type BizScriptRelease,
  type DeviceUpdateStatus
} from "../lib/api-client-update-center";
import { useState } from "react";
import { ApiError } from "../lib/api-client";

const releasesKey = ["bizScriptReleases"] as const;
const deviceStatusesKey = ["bizScriptDeviceUpdateStatuses"] as const;
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
  const [form] = Form.useForm<BuildBizScriptReleasePayload>();
  const queryClient = useQueryClient();
  const { message } = AntdApp.useApp();
  const releasesQuery = useQuery({
    queryKey: releasesKey,
    queryFn: getBizScriptReleases
  });
  const deviceStatusesQuery = useQuery({
    queryKey: deviceStatusesKey,
    queryFn: getDeviceUpdateStatuses,
    refetchInterval: 15_000
  });
  const filesQuery = useQuery({ queryKey: ["bizScriptFiles"], queryFn: getBizScriptFiles });
  const apkReleasesQuery = useQuery({
    queryKey: ["apkReleases", apkChannel],
    queryFn: () => getAgentReleases(apkChannel)
  });
  const apkDeviceStatusesQuery = useQuery({
    queryKey: ["apkDeviceUpdateStatuses", apkChannel],
    queryFn: () => getAgentDeviceUpdateStatuses(apkChannel),
    refetchInterval: 15_000
  });
  const buildMutation = useMutation({
    mutationFn: (values: BuildBizScriptReleasePayload) => buildAndPublishBizScripts({
      releaseNote: values.releaseNote,
      forceUpdate: false,
      files: values.files,
      baseVersion: values.baseVersion
    }),
    onSuccess: (release) => {
      message.success(release.idempotent ? "该版本已发布，元数据一致" : "业务脚本版本已发布");
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: releasesKey });
      void queryClient.invalidateQueries({ queryKey: deviceStatusesKey });
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.code === "BUILD_IN_PROGRESS") {
        message.warning("业务脚本构建正在进行，请等待完成后刷新");
        return;
      }
      message.error(`构建或发布失败：${error.message || "请查看服务端日志"}`);
    }
  });

  const releaseColumns: TableColumnsType<BizScriptRelease> = [
    { title: "版本", dataIndex: "version", width: 130 },
    {
      title: "状态",
      dataIndex: "status",
      width: 100,
      render: (value: string) => <Tag color={value === "PUBLISHED" ? "green" : "default"}>{value}</Tag>
    },
    {
      title: "更新包",
      dataIndex: "packageUrl",
      ellipsis: true,
      render: (value: string | null) => value
        ? <Typography.Link href={value} target="_blank" rel="noreferrer">{value}</Typography.Link>
        : "-"
    },
    {
      title: "SHA-256",
      dataIndex: "sha256",
      width: 180,
      ellipsis: true,
      render: (value: string | null) => value ?? "-"
    },
    { title: "发布说明", dataIndex: "releaseNote", ellipsis: true, render: (value: string | null) => value || "-" },
    { title: "发布时间", dataIndex: "publishedAt", width: 180, render: formatDateTime }
  ];

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

  const summary = deviceStatusesQuery.data?.summary;
  const apkSummary = apkDeviceStatusesQuery.data?.summary;

  const bizScriptsContent = (
    <>
      <section className="ops-panel">
        <div className="ops-panel-head"><span>业务脚本构建并发布</span></div>
        <div className="ops-panel-body">
          <Alert
            type="info"
            showIcon
            message="服务端固定构建 features/domain 业务脚本；业务脚本发布不会构建 APK，也不会安装 APK。"
            style={{ marginBottom: 16 }}
          />
          <Form form={form} layout="vertical" onFinish={(values) => buildMutation.mutate(values)}>
            <Form.Item label="发布说明" name="releaseNote">
              <Input.TextArea rows={3} maxLength={5000} showCount placeholder="本次更新内容" />
            </Form.Item>
            <Form.Item label="发布模式" name="files">
              <Select
                placeholder="完整包（不选择文件）"
                allowClear
                options={[{ label: "完整业务脚本包", value: "__full__" }, { label: "指定文件增量包", value: "__partial__" }]}
                onChange={(value) => {
                  if (value === "__full__") form.setFieldValue("files", undefined);
                  if (value === "__partial__") form.setFieldValue("files", []);
                }}
              />
            </Form.Item>
            <Form.Item noStyle shouldUpdate={(prev, next) => prev.files !== next.files}>
              {({ getFieldValue }) => {
                const mode = getFieldValue("files");
                if (!Array.isArray(mode)) return null;
                return (
                  <>
                    {mode.length === 0 ? <Alert type="info" message="请选择要发布的 JS 文件；空列表会被拒绝。" style={{ marginBottom: 16 }} /> : null}
                    <Form.Item name="baseVersion" label="基线版本" rules={[{ required: true, message: "增量包必须指定基线版本" }]}>
                      <Input placeholder="例如 1.0.0" />
                    </Form.Item>
                    <Form.Item name="files" label="业务脚本文件" rules={[{ required: true, type: "array", min: 1, message: "至少选择一个 JS 文件" }]}>
                      <Checkbox.Group options={(filesQuery.data?.data ?? []).map((file) => ({ label: file, value: file }))} />
                    </Form.Item>
                  </>
                );
              }}
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<CloudUploadOutlined />} loading={buildMutation.isPending} disabled={buildMutation.isPending}>
              一键构建并发布当前业务脚本
            </Button>
          </Form>
        </div>
      </section>

      <section className="ops-panel">
        <div className="ops-panel-head"><span>业务脚本设备生效状态</span><span className="ops-small">目标版本 {deviceStatusesQuery.data?.targetVersion || "-"}</span></div>
        <div className="ops-panel-body">
          <Space size="large" wrap style={{ marginBottom: 16 }}>
            <Statistic title="设备总数" value={summary?.total ?? 0} />
            <Statistic title="已生效" value={summary?.applied ?? 0} />
            <Statistic title="更新中" value={summary?.pending ?? 0} />
            <Statistic title="失败" value={summary?.failed ?? 0} />
            <Statistic title="未上报" value={summary?.noReport ?? 0} />
          </Space>
          <Table<DeviceUpdateStatus> rowKey="deviceId" columns={deviceColumns} dataSource={deviceStatusesQuery.data?.data ?? []} loading={deviceStatusesQuery.isLoading} locale={{ emptyText: "暂无设备更新上报" }} pagination={false} scroll={{ x: 900 }} />
        </div>
      </section>

      <section className="ops-panel">
        <div className="ops-panel-head"><span>业务脚本版本历史</span></div>
        <div className="ops-panel-body">
          <Table<BizScriptRelease> rowKey="id" columns={releaseColumns} dataSource={releasesQuery.data?.data ?? []} loading={releasesQuery.isLoading} pagination={{ pageSize: 10, hideOnSinglePage: true }} scroll={{ x: 1050 }} />
        </div>
      </section>
    </>
  );

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
        <div>
          <Typography.Title level={3}>更新中心</Typography.Title>
          <Typography.Text type="secondary">业务脚本更新与 APK 基座更新分开管理；业务脚本发布不会构建 APK。</Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={releasesQuery.isFetching || deviceStatusesQuery.isFetching || apkReleasesQuery.isFetching || apkDeviceStatusesQuery.isFetching}
          onClick={() => {
            void releasesQuery.refetch();
            void deviceStatusesQuery.refetch();
            void apkReleasesQuery.refetch();
            void apkDeviceStatusesQuery.refetch();
          }}
        >
          刷新
        </Button>
      </div>
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: "biz-scripts", label: "业务脚本", children: bizScriptsContent },
          { key: "apk", label: "APK 基座", children: apkContent }
        ]}
      />
    </div>
  );
}
