import { PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntdApp,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  type TableColumnsType
} from "antd";
import { useEffect, useState } from "react";
import type { InterfacePublishBindingStatus, InterfacePublishRunConfig } from "@pkg/types";
import { ApiError } from "../lib/api-client";
import { getInterfacePublishBindingPreflight } from "../lib/api-client-interface-publish-bindings";
import {
  confirmInterfacePublishRun,
  getCurrentInterfacePublishRun,
  preflightInterfacePublishRun,
  stopInterfacePublishRun,
  type InterfacePublishPreflightResponse,
  type InterfacePublishRunPreflightRow
} from "../lib/api-client-interface-publish-runs";
import { assessInterfacePublishManualStart } from "../lib/interface-publish-time";

export type InterfacePublishConfigOption = {
  id: string;
  name: string;
};

type Props = {
  configs?: InterfacePublishConfigOption[];
};

type RunFormValues = {
  configId: string;
  morningPublishTime: string;
  afternoonPublishTime: string;
  maxConcurrentPublishing: number;
};

const bindingStatus: Record<InterfacePublishBindingStatus, { text: string; color: string }> = {
  MATCHED: { text: "绑定完整", color: "green" },
  BINDING_INCOMPLETE: { text: "字段不完整", color: "orange" },
  BINDING_CONFLICT: { text: "绑定冲突", color: "red" },
  DEVICE_OFFLINE: { text: "设备离线", color: "default" },
  DEVICE_BUSY: { text: "设备繁忙", color: "gold" },
  UNBOUND: { text: "未绑定", color: "default" },
  SKIPPED_FOR_RUN: { text: "本次跳过", color: "default" }
};

const runStatusText: Record<string, string> = {
  CHECKING_BINDINGS: "检查绑定中",
  WAITING_USER_CONFIRMATION: "等待启动确认",
  SCHEDULED: "等待发布时间",
  RUNNING: "运行中",
  STOPPING: "停止中",
  PAUSED: "已暂停",
  FAILED: "运行异常"
};

function runConfig(values: RunFormValues): InterfacePublishRunConfig {
  return {
    ...values,
    maxConcurrentPublishing: Number(values.maxConcurrentPublishing),
    noMaterialRetryMinutes: 10,
    timezone: "Asia/Shanghai",
    platform: "DOUYIN"
  };
}

function detailsRecord(error: ApiError) {
  return error.details && typeof error.details === "object"
    ? error.details as Record<string, unknown>
    : {};
}

function startErrorMessage(error: Error) {
  if (!(error instanceof ApiError) || error.code !== "RUN_START_TIME_INVALID") {
    return error.message || "任务启动检查失败";
  }
  const reasonCode = detailsRecord(error).reasonCode;
  if (reasonCode === "MORNING_PUBLISH_TIME_PASSED") {
    return "上午发布时间已过，请重新设置当前时间之后的上午发布时间";
  }
  if (reasonCode === "AFTERNOON_PUBLISH_TIME_PASSED") {
    return "下午发布时间已过，请设置当前时间之后的发布时间";
  }
  return "当前输入时间不合法";
}

export function InterfacePublishRunControl({ configs = [] }: Props) {
  const [form] = Form.useForm<RunFormValues>();
  const [preflight, setPreflight] = useState<InterfacePublishPreflightResponse | null>(null);
  const [skippedBindingIds, setSkippedBindingIds] = useState<string[]>([]);
  const [stopRisk, setStopRisk] = useState<{ incompleteAccountCount: number } | null>(null);
  const queryClient = useQueryClient();
  const { message, modal } = AntdApp.useApp();
  const currentRunQuery = useQuery({
    queryKey: ["interfacePublishRun", "current"],
    queryFn: getCurrentInterfacePublishRun,
    refetchInterval: 10_000
  });
  const currentRun = currentRunQuery.data?.data ?? null;
  const isActiveRun = Boolean(currentRun && !["STOPPED", "FAILED", "CANCELED"].includes(currentRun.status));
  const waitingForConfirmation = Boolean(
    currentRun && currentRun.status === "WAITING_USER_CONFIRMATION"
  );
  const pendingPreflightQuery = useQuery({
    queryKey: ["interfacePublishBindingPreflight", "pendingRun"],
    queryFn: getInterfacePublishBindingPreflight,
    enabled: waitingForConfirmation
  });

  useEffect(() => {
    if (currentRun) {
      form.setFieldsValue({
        configId: currentRun.configId,
        morningPublishTime: currentRun.morningPublishTime,
        afternoonPublishTime: currentRun.afternoonPublishTime,
        maxConcurrentPublishing: currentRun.maxConcurrentPublishing
      });
    } else if (configs.length === 1 && !form.getFieldValue("configId")) {
      form.setFieldValue("configId", configs[0].id);
    }
  }, [configs, currentRun, form]);

  async function refreshRun() {
    await queryClient.invalidateQueries({ queryKey: ["interfacePublishRun"] });
  }

  const preflightMutation = useMutation({
    mutationFn: preflightInterfacePublishRun,
    onSuccess: ({ data }) => {
      setPreflight(data);
      setSkippedBindingIds([]);
    },
    onError: (error: Error) => message.error(startErrorMessage(error))
  });
  const confirmMutation = useMutation({
    mutationFn: () => {
      if (!preflight) throw new Error("启动预检不存在");
      return confirmInterfacePublishRun(preflight.run.id, skippedBindingIds);
    },
    onSuccess: async () => {
      setPreflight(null);
      message.success("接口发布任务已开启");
      await refreshRun();
    },
    onError: (error: Error) => message.error(error.message || "任务确认失败")
  });
  const stopMutation = useMutation({
    mutationFn: (confirmedDailyFallbackRisk: boolean) => {
      if (!currentRun) throw new Error("当前没有运行中的任务");
      return stopInterfacePublishRun(currentRun.id, confirmedDailyFallbackRisk);
    },
    onSuccess: async () => {
      setStopRisk(null);
      message.success("任务正在安全停止");
      await refreshRun();
    },
    onError: (error: Error) => {
      if (error instanceof ApiError && error.code === "RUN_STOP_CONFIRMATION_REQUIRED") {
        const count = Number(detailsRecord(error).incompleteAccountCount ?? 0);
        setStopRisk({ incompleteAccountCount: count });
        return;
      }
      message.error(error.message || "停止任务失败");
    }
  });

  function start(values: RunFormValues) {
    const config = runConfig(values);
    const assessment = assessInterfacePublishManualStart(config);
    if (!assessment.valid) {
      message.error(assessment.message);
      return;
    }
    if (assessment.warnings.length) {
      modal.confirm({
        title: "启动时间确认",
        content: assessment.warnings.join("；"),
        okText: "继续启动",
        cancelText: "返回修改",
        onOk: () => preflightMutation.mutate(config)
      });
      return;
    }
    preflightMutation.mutate(config);
  }

  function toggleSkip(bindingId: string, checked: boolean) {
    setSkippedBindingIds((current) => checked
      ? [...new Set([...current, bindingId])]
      : current.filter((id) => id !== bindingId));
  }

  function resumePendingPreflight() {
    if (currentRun?.status !== "WAITING_USER_CONFIRMATION" || !pendingPreflightQuery.data) return;
    setSkippedBindingIds([]);
    setPreflight({
      run: currentRun,
      preflight: pendingPreflightQuery.data.data,
      startTime: { valid: true, businessDate: "" }
    });
  }

  const columns: TableColumnsType<InterfacePublishRunPreflightRow> = [
    { title: "设备 ID", dataIndex: "deviceCode" },
    { title: "账号名称", dataIndex: "accountName", render: (value: string | null) => value || "未填写" },
    { title: "抖音号", dataIndex: "accountNo", render: (value: string | null) => value || "未填写" },
    { title: "外部查询标识", dataIndex: "externalAccountKey", render: (value: string | null) => value || "未填写" },
    {
      title: "检查结果",
      dataIndex: "status",
      render: (value: InterfacePublishBindingStatus) => (
        <Tag color={bindingStatus[value].color}>{bindingStatus[value].text}</Tag>
      )
    },
    {
      title: "本次跳过",
      width: 100,
      render: (_, row) => (
        <Checkbox
          disabled={!row.bindingId}
          checked={Boolean(row.bindingId && skippedBindingIds.includes(row.bindingId))}
          onChange={(event) => row.bindingId && toggleSkip(row.bindingId, event.target.checked)}
        />
      )
    }
  ];

  return (
    <section className="ops-panel">
      <div className="ops-panel-head"><span>运行控制</span></div>
      <div className="ops-panel-body">
        {currentRunQuery.isError ? (
          <Alert type="error" showIcon message="运行状态加载失败" description={currentRunQuery.error.message} />
        ) : null}
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Typography.Text>上午固定窗口 06:00-12:00</Typography.Text>
            <Typography.Text>下午固定窗口 13:00-24:00</Typography.Text>
            {currentRun ? (
              <Tag color={currentRun.status === "RUNNING" ? "green" : "blue"}>
                {runStatusText[currentRun.status] ?? currentRun.status}
              </Tag>
            ) : <Tag>未启动</Tag>}
          </Space>

          <Form<RunFormValues>
            form={form}
            layout="inline"
            disabled={isActiveRun}
            initialValues={{
              morningPublishTime: "09:00",
              afternoonPublishTime: "15:00",
              maxConcurrentPublishing: 3
            }}
            onFinish={start}
          >
            <Form.Item label="接口配置" name="configId" rules={[{ required: true, message: "请选择接口配置" }]}>
              <Select
                placeholder="选择接口配置"
                style={{ width: 220 }}
                options={configs.map((item) => ({ value: item.id, label: item.name }))}
              />
            </Form.Item>
            <Form.Item label="上午发布时间" name="morningPublishTime" rules={[{ required: true, message: "请输入上午发布时间" }]}>
              <Input type="time" min="06:00" max="11:59" step={60} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item label="下午发布时间" name="afternoonPublishTime" rules={[{ required: true, message: "请输入下午发布时间" }]}>
              <Input type="time" min="13:00" max="23:59" step={60} style={{ width: 130 }} />
            </Form.Item>
            <Form.Item
              label="最大同时发布设备数"
              name="maxConcurrentPublishing"
              rules={[{ required: true, message: "请输入正整数" }]}
            >
              <InputNumber min={1} precision={0} style={{ width: 100 }} />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                icon={<PlayCircleOutlined />}
                loading={preflightMutation.isPending}
              >开启任务</Button>
            </Form.Item>
          </Form>

          {isActiveRun ? <Typography.Text type="secondary">运行中如需修改，请先停止任务</Typography.Text> : null}
          {waitingForConfirmation ? (
            <Button
              onClick={resumePendingPreflight}
              loading={pendingPreflightQuery.isLoading}
              disabled={!pendingPreflightQuery.data}
            >继续启动确认</Button>
          ) : null}
          <Button
            danger
            icon={<StopOutlined />}
            disabled={!currentRun || !["SCHEDULED", "RUNNING"].includes(currentRun.status)}
            loading={stopMutation.isPending}
            onClick={() => stopMutation.mutate(false)}
          >{currentRun?.status === "STOPPING" ? "停止中" : "停止任务"}</Button>
        </Space>
      </div>

      <Modal
        title="启动预检"
        open={Boolean(preflight)}
        width={920}
        okText="确认开启"
        cancelText="取消"
        confirmLoading={confirmMutation.isPending}
        onOk={() => confirmMutation.mutate()}
        onCancel={() => setPreflight(null)}
      >
        <Typography.Paragraph type="secondary">
          {preflight?.run.status === "WAITING_USER_CONFIRMATION" ? "请确认本次参与任务的绑定" : ""}
        </Typography.Paragraph>
        <Table<InterfacePublishRunPreflightRow>
          size="small"
          rowKey="deviceCode"
          columns={columns}
          dataSource={preflight?.preflight ?? []}
          pagination={false}
          scroll={{ x: 900 }}
        />
      </Modal>

      <Modal
        title="确认停止任务"
        open={Boolean(stopRisk)}
        okText="确认停止"
        cancelText="继续运行"
        okButtonProps={{ danger: true, loading: stopMutation.isPending }}
        onOk={() => stopMutation.mutate(true)}
        onCancel={() => setStopRisk(null)}
      >
        <Alert
          type="warning"
          showIcon
          message="停止后这些账号今天可能无法完成保底发布"
          description={`当前有 ${stopRisk?.incompleteAccountCount ?? 0} 个账号今天尚未成功发布。`}
        />
      </Modal>
    </section>
  );
}
