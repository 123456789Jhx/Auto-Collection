import { BellOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  Descriptions,
  Empty,
  Flex,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  type TableColumnsType
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getInterfacePublishRunDetails,
  markInterfacePublishAlertRead,
  resolveInterfacePublishClaimUnknown,
  resolveInterfacePublishResultUnknown,
  type InterfacePublishMonitorAlert,
  type InterfacePublishMonitorBinding,
  type InterfacePublishMonitorSlot
} from "../lib/api-client-interface-publish-monitor";
import { getCurrentInterfacePublishRun } from "../lib/api-client-interface-publish-runs";
import { InterfacePublishAlertDrawer } from "./InterfacePublishAlertDrawer";

const ERROR_GROUPS = [
  { category: "INTERFACE_FLOW_FAILED", title: "接口流程失败", color: "red" },
  { category: "PUBLISH_EXECUTION_FAILED", title: "发布执行失败", color: "volcano" },
  { category: "EXTERNAL_SYNC_FAILED", title: "外部状态同步失败", color: "gold" }
] as const;

const slotStatusText: Record<string, string> = {
  WAITING: "等待发布时间",
  ELIGIBLE: "可领取",
  NO_MATERIAL: "NO_MATERIAL",
  DEVICE_UNAVAILABLE: "等待设备",
  CLAIM_RESULT_UNKNOWN: "CLAIM_RESULT_UNKNOWN",
  CLAIMED: "已领取",
  DISPATCHED: "已下发",
  PUBLISHING: "发布中",
  PUBLISHED: "已成功",
  FAILED: "未完成",
  RESULT_UNKNOWN: "RESULT_UNKNOWN",
  SKIPPED_FOR_RUN: "本次跳过",
  WINDOW_EXPIRED: "窗口已结束"
};

const reservationStatusText: Record<string, string> = {
  WAITING_DEVICE: "等待设备",
  RESERVED: "已预留",
  RELEASING: "释放中",
  RELEASED: "已释放"
};

function categoryForAlert(alert: InterfacePublishMonitorAlert) {
  if (alert.code === "EXTERNAL_SYNC_FAILED") return "EXTERNAL_SYNC_FAILED";
  if (alert.code === "RESULT_UNKNOWN") return "PUBLISH_EXECUTION_FAILED";
  return "INTERFACE_FLOW_FAILED";
}

function retryText(value: string | null) {
  return value ? new Date(value).toLocaleString() : "-";
}

export function InterfacePublishRunMonitor() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const shownNoMaterialAttempts = useRef(new Set<string>());
  const queryClient = useQueryClient();
  const { modal } = AntdApp.useApp();
  const currentQuery = useQuery({
    queryKey: ["interfacePublishRun", "monitorCurrent"],
    queryFn: getCurrentInterfacePublishRun,
    refetchInterval: () => document.visibilityState === "visible" ? 10_000 : 60_000
  });
  const runId = currentQuery.data?.data?.id ?? null;
  const detailsQuery = useQuery({
    queryKey: ["interfacePublishMonitor", runId],
    queryFn: () => getInterfacePublishRunDetails(runId!),
    enabled: Boolean(runId),
    refetchInterval: () => document.visibilityState === "visible" ? 10_000 : 60_000
  });
  const details = detailsQuery.data?.data;

  async function refreshMonitor() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["interfacePublishMonitor"] }),
      queryClient.invalidateQueries({ queryKey: ["interfacePublishRun"] })
    ]);
  }

  const readMutation = useMutation({
    mutationFn: markInterfacePublishAlertRead,
    onSuccess: refreshMonitor
  });
  const resolveResultMutation = useMutation({
    mutationFn: (input: {
      publishTaskId: string;
      resolution: "PUBLISHED" | "FAILED";
      evidence: string;
    }) => resolveInterfacePublishResultUnknown(input.publishTaskId, input),
    onSuccess: refreshMonitor
  });
  const resolveClaimMutation = useMutation({
    mutationFn: (input: { slotExecutionId: string; evidence: string }) =>
      resolveInterfacePublishClaimUnknown(input.slotExecutionId, input.evidence),
    onSuccess: refreshMonitor
  });

  const bindingById = useMemo(() => new Map(
    (details?.bindings ?? []).map((binding) => [binding.bindingId, binding])
  ), [details?.bindings]);

  useEffect(() => {
    if (!details) return;
    const newNoMaterialSlots = details.slots.filter((slot) => {
      if (slot.status !== "NO_MATERIAL") return false;
      const attemptKey = `${details.run.id}:${slot.id}:${slot.attemptCount}`;
      if (shownNoMaterialAttempts.current.has(attemptKey)) return false;
      shownNoMaterialAttempts.current.add(attemptKey);
      return true;
    });
    if (!newNoMaterialSlots.length) return;

    const accountNames = [...new Set(newNoMaterialSlots.map((slot) =>
      bindingById.get(slot.bindingId)?.accountName || "未知账号"
    ))];
    modal.warning({
      title: "暂无可领取的待发布素材",
      content: (
        <Space direction="vertical" size={8}>
          <Typography.Text>
            {accountNames.map((accountName) => `“${accountName}”`).join("、")}
            当前没有可领取的待发布视频素材。
          </Typography.Text>
          <Typography.Text type="secondary">
            系统将在 {details.run.noMaterialRetryMinutes} 分钟后自动重试。
          </Typography.Text>
        </Space>
      ),
      okText: "知道了"
    });
  }, [bindingById, details, modal]);

  const alerts = details?.alerts ?? [];
  const alertContexts = Object.fromEntries(alerts.map((alert) => {
    const slot = details?.slots.find((item) => item.id === alert.slotExecutionId);
    const binding = slot ? bindingById.get(slot.bindingId) : null;
    const detailTaskId = alert.detailsJson?.publishTaskId;
    return [alert.id, {
      accountName: binding?.accountName ?? "",
      deviceCode: binding?.deviceCode ?? "",
      publishTaskId: typeof detailTaskId === "string" ? detailTaskId : slot?.publishTaskId ?? ""
    }];
  }));
  const unreadCount = alerts.filter((alert) => !alert.readAt).length;
  const bindingCounts = {
    total: details?.bindings.length ?? 0,
    reserved: details?.bindings.filter((binding) => binding.reservationStatus === "RESERVED").length ?? 0,
    waiting: details?.bindings.filter((binding) => binding.reservationStatus === "WAITING_DEVICE").length ?? 0,
    skipped: details?.bindings.filter((binding) => binding.skippedForRun).length ?? 0
  };
  const activePublishing = details?.slots.filter((slot) =>
    slot.status === "DISPATCHED" || slot.status === "PUBLISHING"
  ).length ?? 0;

  const bindingColumns: TableColumnsType<InterfacePublishMonitorBinding> = [
    { title: "账号", dataIndex: "accountName" },
    { title: "抖音号", dataIndex: "accountNo" },
    { title: "外部查询标识", dataIndex: "externalAccountKey" },
    { title: "设备 ID", dataIndex: "deviceCode" },
    {
      title: "设备预留",
      dataIndex: "reservationStatus",
      render: (value: string) => (
        <Tag color={value === "RESERVED" ? "green" : value === "WAITING_DEVICE" ? "gold" : "default"}>
          {reservationStatusText[value] ?? value}
        </Tag>
      )
    }
  ];
  const slotColumns: TableColumnsType<InterfacePublishMonitorSlot> = [
    {
      title: "账号",
      dataIndex: "bindingId",
      render: (bindingId: string) => bindingById.get(bindingId)?.accountName ?? bindingId
    },
    { title: "业务日期", dataIndex: "businessDate" },
    { title: "时段", dataIndex: "slot", render: (value: string) => value === "MORNING" ? "上午" : "下午" },
    {
      title: "状态",
      dataIndex: "status",
      render: (value: string) => <Tag>{slotStatusText[value] ?? value}</Tag>
    },
    {
      title: "下次重试",
      dataIndex: "nextRetryAt",
      render: (value: string | null, row) => row.status === "NO_MATERIAL" || value ? retryText(value) : "-"
    },
    { title: "最近错误", dataIndex: "lastError", render: (value: string | null) => value || "-" }
  ];

  const errorItems = ERROR_GROUPS.map((group) => ({
    ...group,
    slots: (details?.slots ?? []).filter((slot) => slot.errorCategory === group.category),
    alerts: alerts.filter((alert) => categoryForAlert(alert) === group.category && !alert.resolvedAt)
  }));
  const hasExternalSyncFailure = errorItems.find((item) => item.category === "EXTERNAL_SYNC_FAILED")!
    .alerts.length > 0;

  return (
    <section className="ops-panel">
      <div className="ops-panel-head">
        <span>运行监控</span>
        <Space>
          <Badge count={unreadCount} size="small">
            <Button icon={<BellOutlined />} onClick={() => setDrawerOpen(true)}>告警</Button>
          </Badge>
          <Button icon={<ReloadOutlined />} loading={detailsQuery.isFetching} onClick={() => void refreshMonitor()}>
            刷新
          </Button>
        </Space>
      </div>
      <div className="ops-panel-body">
        {!runId ? <Empty description="当前没有运行中的接口发布任务" /> : null}
        {detailsQuery.isError ? <Alert type="error" showIcon message="运行详情加载失败" description={detailsQuery.error.message} /> : null}
        {details ? (
          <Space direction="vertical" size={18} style={{ width: "100%" }}>
            <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
              <Descriptions.Item label="runId">{details.run.id}</Descriptions.Item>
              <Descriptions.Item label="运行状态">{details.run.status}</Descriptions.Item>
              <Descriptions.Item label="上午">06:00-12:00 / {details.run.morningPublishTime}</Descriptions.Item>
              <Descriptions.Item label="下午">13:00-24:00 / {details.run.afternoonPublishTime}</Descriptions.Item>
              <Descriptions.Item label="启动人">{details.run.startedBy}</Descriptions.Item>
              <Descriptions.Item label="启动时间">{new Date(details.run.startedAt).toLocaleString()}</Descriptions.Item>
            </Descriptions>

            <Flex gap={24} wrap>
              <Statistic title="绑定总数" value={bindingCounts.total} />
              <Statistic title="已预留" value={bindingCounts.reserved} />
              <Statistic title="等待设备" value={bindingCounts.waiting} />
              <Statistic title="本次跳过" value={bindingCounts.skipped} />
              <Statistic title="发布中设备" value={`${activePublishing}/${details.run.maxConcurrentPublishing}`} />
            </Flex>

            {hasExternalSyncFailure ? (
              <Alert
                type="warning"
                showIcon
                message="发布成功，外部状态待同步"
                description="[AIR-FILL: Q-007] 当前展示已形成告警的外部同步异常；自动退避中的完整 outbox 数量以后端摘要为准。"
              />
            ) : null}

            <div>
              <Typography.Title level={5}>账号与设备</Typography.Title>
              <Table rowKey="id" size="small" pagination={false} columns={bindingColumns} dataSource={details.bindings} scroll={{ x: 900 }} />
            </div>
            <div>
              <Typography.Title level={5}>上午 / 下午时段</Typography.Title>
              <Table rowKey="id" size="small" pagination={false} columns={slotColumns} dataSource={details.slots} scroll={{ x: 920 }} />
            </div>
            <div>
              <Typography.Title level={5}>异常分类</Typography.Title>
              <Flex gap={12} wrap>
                {errorItems.map((item) => (
                  <Alert
                    key={item.category}
                    type={item.category === "EXTERNAL_SYNC_FAILED" ? "warning" : "error"}
                    showIcon
                    message={<Space><Tag color={item.color}>{item.category}</Tag>{item.title}</Space>}
                    description={`${item.slots.length + item.alerts.length} 项待处理`}
                  />
                ))}
              </Flex>
            </div>
          </Space>
        ) : null}
      </div>

      <InterfacePublishAlertDrawer
        open={drawerOpen}
        alerts={alerts}
        alertContexts={alertContexts}
        loading={readMutation.isPending || resolveResultMutation.isPending || resolveClaimMutation.isPending}
        onClose={() => setDrawerOpen(false)}
        onMarkRead={(alertId) => readMutation.mutate(alertId)}
        onResolveResult={(publishTaskId, resolution, evidence) =>
          resolveResultMutation.mutate({ publishTaskId, resolution, evidence })}
        onResolveClaim={(slotExecutionId, evidence) =>
          resolveClaimMutation.mutate({ slotExecutionId, evidence })}
      />
    </section>
  );
}
