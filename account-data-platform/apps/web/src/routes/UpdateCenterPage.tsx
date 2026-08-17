import { CloudUploadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntdApp,
  Button,
  Form,
  Input,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableColumnsType
} from "antd";
import {
  buildAndPublishBizScripts,
  getBizScriptReleases,
  getDeviceUpdateStatuses,
  type BuildBizScriptReleasePayload,
  type BizScriptRelease,
  type DeviceUpdateStatus
} from "../lib/api-client-update-center";
import { ApiError } from "../lib/api-client";

const releasesKey = ["bizScriptReleases"] as const;
const deviceStatusesKey = ["bizScriptDeviceUpdateStatuses"] as const;

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

export function UpdateCenterPage() {
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
  const buildMutation = useMutation({
    mutationFn: (values: BuildBizScriptReleasePayload) => buildAndPublishBizScripts({
      releaseNote: values.releaseNote,
      forceUpdate: false
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

  const summary = deviceStatusesQuery.data?.summary;

  return (
    <div className="ops-page">
      <div className="ops-page-header">
        <div>
          <Typography.Title level={3}>业务脚本更新</Typography.Title>
          <Typography.Text type="secondary">发布已生成的 bundle manifest，手机在线拉取并校验后生效。</Typography.Text>
        </div>
        <Button
          icon={<ReloadOutlined />}
          loading={releasesQuery.isFetching || deviceStatusesQuery.isFetching}
          onClick={() => {
            void releasesQuery.refetch();
            void deviceStatusesQuery.refetch();
          }}
        >
          刷新
        </Button>
      </div>

      <section className="ops-panel">
        <div className="ops-panel-head"><span>构建并发布</span></div>
        <div className="ops-panel-body">
          <Alert
            type="info"
            showIcon
            message="服务端将固定构建当前仓库中的业务脚本，自动生成版本、更新包和校验值。"
            style={{ marginBottom: 16 }}
          />
          <Form
            form={form}
            layout="vertical"
            onFinish={(values) => buildMutation.mutate(values)}
          >
            <Form.Item label="发布说明" name="releaseNote">
              <Input.TextArea rows={3} maxLength={5000} showCount placeholder="本次更新内容" />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              icon={<CloudUploadOutlined />}
              loading={buildMutation.isPending}
              disabled={buildMutation.isPending}
            >
              一键构建并发布当前业务脚本
            </Button>
          </Form>
        </div>
      </section>

      <section className="ops-panel">
        <div className="ops-panel-head"><span>设备生效状态</span><span className="ops-small">目标版本 {deviceStatusesQuery.data?.targetVersion || "-"}</span></div>
        <div className="ops-panel-body">
          <Space size="large" wrap style={{ marginBottom: 16 }}>
            <Statistic title="设备总数" value={summary?.total ?? 0} />
            <Statistic title="已生效" value={summary?.applied ?? 0} />
            <Statistic title="更新中" value={summary?.pending ?? 0} />
            <Statistic title="失败" value={summary?.failed ?? 0} />
            <Statistic title="未上报" value={summary?.noReport ?? 0} />
          </Space>
          <Table<DeviceUpdateStatus>
            rowKey="deviceId"
            columns={deviceColumns}
            dataSource={deviceStatusesQuery.data?.data ?? []}
            loading={deviceStatusesQuery.isLoading}
            locale={{ emptyText: "暂无设备更新上报" }}
            pagination={false}
            scroll={{ x: 900 }}
          />
        </div>
      </section>

      <section className="ops-panel">
        <div className="ops-panel-head"><span>版本历史</span></div>
        <div className="ops-panel-body">
          <Table<BizScriptRelease>
            rowKey="id"
            columns={releaseColumns}
            dataSource={releasesQuery.data?.data ?? []}
            loading={releasesQuery.isLoading}
            pagination={{ pageSize: 10, hideOnSinglePage: true }}
            scroll={{ x: 1050 }}
          />
        </div>
      </section>
    </div>
  );
}
