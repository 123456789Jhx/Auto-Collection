import { MoreOutlined, PauseOutlined, PlayCircleOutlined, ReloadOutlined, StopOutlined, SyncOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Dropdown, Form, Input, InputNumber, Modal, Popconfirm, Select, Skeleton, Space, Switch, Table, Tag, Tooltip, message } from "antd";
import { useState } from "react";
import { createMobileCommand, getDeviceTaskConfig, getDevices, updateDevice, updateDeviceTaskConfig } from "../lib/api-client";
import { statusColor, statusText } from "../lib/display-maps";

type DeviceRow = {
  id: string;
  deviceCode: string;
  deviceName?: string;
  platform?: string;
  status: string;
  reportedStatus?: string;
  currentTask?: "video" | "live" | "none";
  effectiveStatus: string;
  lastHeartbeatAt?: string;
  heartbeatAgeMinutes?: number | null;
  appVersion?: string | null;
  targetVersion?: string | null;
  enabled?: boolean;
  lastIp?: string | null;
  lastRegion?: string | null;
  remark?: string | null;
};

type TaskRow = {
  taskId?: string;
  taskCode?: string;
  source?: string;
  platform?: string;
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  autoStart?: boolean;
  commentLimit?: number;
  heartbeatMinutes?: number;
};

type DeviceFormValues = {
  deviceName?: string;
  enabled?: boolean;
  lastRegion?: string;
  remark?: string;
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function DevicesPage() {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [configOpen, setConfigOpen] = useState(false);
  const [deviceOpen, setDeviceOpen] = useState(false);
  const [currentDevice, setCurrentDevice] = useState<DeviceRow | null>(null);
  const [keyword, setKeyword] = useState("");
  const [statusFilter, setStatusFilter] = useState<string | undefined>();
  const [autoRefreshSeconds, setAutoRefreshSeconds] = useState(15);
  const [form] = Form.useForm();
  const [deviceForm] = Form.useForm();
  const query = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    refetchInterval: autoRefreshSeconds > 0 ? autoRefreshSeconds * 1000 : false
  });
  const commandMutation = useMutation({
    mutationFn: ({ deviceId, commandType }: { deviceId: string; commandType: "START" | "PAUSE" | "RESUME" | "STOP" | "REFRESH_CONFIG" | "STATUS" | "RESTART_APP" | "RESTART_AGENT" | "CHECK_UPDATE" | "UPDATE_AGENT" }) =>
      createMobileCommand({ deviceId, commandType, expiresInSeconds: 3600 }),
    onSuccess: () => {
      messageApi.success("控制指令已下发，等待手机脚本拉取");
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) => messageApi.error(error.message)
  });
  const configMutation = useMutation({
    mutationFn: ({ deviceCode, platform, values }: { deviceCode: string; platform?: string; values: Partial<TaskRow> }) =>
      updateDeviceTaskConfig(deviceCode, values, platform),
    onSuccess: () => {
      messageApi.success("该设备脚本参数已保存，并已自动下发刷新配置指令");
      setConfigOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) => messageApi.error(error.message)
  });
  const deviceMutation = useMutation({
    mutationFn: ({ deviceCode, values }: { deviceCode: string; values: DeviceFormValues }) => updateDevice(deviceCode, values),
    onSuccess: () => {
      messageApi.success("设备信息已保存");
      setDeviceOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["devices"] });
    },
    onError: (error) => messageApi.error(error.message)
  });
  function sendCommand(deviceCode: string, commandType: "START" | "PAUSE" | "RESUME" | "STOP" | "REFRESH_CONFIG" | "STATUS" | "RESTART_APP" | "RESTART_AGENT" | "CHECK_UPDATE" | "UPDATE_AGENT") {
    commandMutation.mutate({ deviceId: deviceCode, commandType });
  }

  async function manualRefresh() {
    try {
      const result = await query.refetch();
      if (result.error) {
        messageApi.error(result.error.message);
        return;
      }
      messageApi.success("设备列表已刷新");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "设备列表刷新失败");
    }
  }

  async function openConfig(device: DeviceRow) {
    setCurrentDevice(device);
    const task = (await getDeviceTaskConfig(device.deviceCode, device.platform ?? "douyin")) as TaskRow;
    setCurrentDevice(device);
    form.setFieldsValue({
      heartbeatMinutes: task?.heartbeatMinutes ?? 1,
      videoMinutesMin: task?.videoMinutesMin ?? 120,
      videoMinutesMax: task?.videoMinutesMax ?? 180,
      liveMinutesMin: task?.liveMinutesMin ?? 60,
      liveMinutesMax: task?.liveMinutesMax ?? 120,
      autoStart: task?.autoStart ?? false,
      commentLimit: task?.commentLimit ?? 10
    });
    setConfigOpen(true);
  }

  function openDeviceEditor(device: DeviceRow) {
    setCurrentDevice(device);
    deviceForm.setFieldsValue({
      deviceName: device.deviceName || device.deviceCode,
      enabled: device.enabled !== false,
      lastRegion: device.lastRegion || "",
      remark: device.remark || ""
    });
    setDeviceOpen(true);
  }

  function saveDevice() {
    if (!currentDevice?.deviceCode) {
      messageApi.error("未找到当前设备");
      return;
    }
    deviceMutation.mutate({ deviceCode: currentDevice.deviceCode, values: deviceForm.getFieldsValue() });
  }

  function saveConfig() {
    if (!currentDevice?.deviceCode) {
      messageApi.error("未找到当前设备");
      return;
    }
    const values = form.getFieldsValue();
    configMutation.mutate({ deviceCode: currentDevice.deviceCode, platform: currentDevice.platform ?? "douyin", values });
  }

  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" message="设备列表加载失败" description={query.error.message} showIcon />;

  const devices = ((query.data ?? []) as DeviceRow[]).filter((item) => {
    const text = `${item.deviceCode} ${item.deviceName ?? ""} ${item.platform ?? ""}`.toLowerCase();
    const matchedKeyword = !keyword || text.includes(keyword.toLowerCase());
    const matchedStatus = !statusFilter || item.effectiveStatus === statusFilter || item.reportedStatus === statusFilter;
    return matchedKeyword && matchedStatus;
  });

  return (
    <Card title="设备状态">
      {contextHolder}
      <Space style={{ marginBottom: 16, width: "100%", justifyContent: "space-between" }} wrap>
        <Space wrap>
          <Input.Search placeholder="搜索设备编号/名称" allowClear style={{ width: 260 }} value={keyword} onChange={(event) => setKeyword(event.target.value)} />
          <Select
            allowClear
            placeholder="状态"
            style={{ width: 150 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: "运行中", value: "running" },
              { label: "待命", value: "idle" },
              { label: "暂停", value: "paused" },
              { label: "离线", value: "offline" },
              { label: "异常", value: "error" }
            ]}
          />
          <Select
            style={{ width: 150 }}
            value={autoRefreshSeconds}
            onChange={setAutoRefreshSeconds}
            options={[
              { label: "5秒刷新", value: 5 },
              { label: "15秒刷新", value: 15 },
              { label: "30秒刷新", value: 30 },
              { label: "暂停刷新", value: 0 }
            ]}
          />
        </Space>
        <Button icon={<ReloadOutlined />} loading={query.isFetching} onClick={() => void manualRefresh()}>
          手动刷新
        </Button>
      </Space>
      <Table rowKey={(row) => String((row as DeviceRow).id)} dataSource={devices} scroll={{ x: 1180 }} pagination={{ pageSize: 10 }}>
        <Table.Column
          title="设备"
          fixed="left"
          width={220}
          render={(_, row) => {
            const device = row as DeviceRow;
            return (
              <Space direction="vertical" size={0}>
                <strong>{device.deviceName || device.deviceCode}</strong>
                <span style={{ color: "#6b7280", fontSize: 12 }}>{device.deviceCode}</span>
              </Space>
            );
          }}
        />
        <Table.Column
          title="当前状态"
          dataIndex="effectiveStatus"
          width={110}
          render={(value) => <Tag color={statusColor(value)}>{statusText(value)}</Tag>}
        />
        <Table.Column
          title="当前任务"
          dataIndex="currentTask"
          width={120}
          render={(value) => {
            if (value === "video") return <Tag color="blue">视频</Tag>;
            if (value === "live") return <Tag color="purple">直播</Tag>;
            return <Tag>未执行任务</Tag>;
          }}
        />
        <Table.Column title="平台" dataIndex="platform" width={90} render={(value) => value || "-"} />
        <Table.Column title="启用" dataIndex="enabled" width={80} render={(value) => <Tag color={value === false ? "red" : "green"}>{value === false ? "禁用" : "启用"}</Tag>} />
        <Table.Column title="最近 IP" dataIndex="lastIp" width={140} render={(value) => value || "-"} />
        <Table.Column
          title="最后心跳"
          width={190}
          render={(_, row) => {
            const device = row as DeviceRow;
            return (
              <span>{formatDateTime(device.lastHeartbeatAt)}</span>
            );
          }}
        />
        <Table.Column
          title="版本"
          width={150}
          render={(_, row) => {
            const device = row as DeviceRow;
            return `${device.appVersion || "-"} / ${device.targetVersion || "-"}`;
          }}
        />
        <Table.Column
          title="控制"
          fixed="right"
          width={360}
          render={(_, row) => {
            const device = row as DeviceRow;
            return (
              <Space size={6} wrap>
                <Tooltip title="启动或继续今天的采集任务，Agent 脚本保持常驻">
                  <Button size="small" icon={<PlayCircleOutlined />} onClick={() => sendCommand(device.deviceCode, "START")}>
                    启动/继续任务
                  </Button>
                </Tooltip>
                <Tooltip title="暂停当前采集任务，Agent 脚本继续常驻">
                  <Button size="small" icon={<PauseOutlined />} onClick={() => sendCommand(device.deviceCode, "PAUSE")}>
                    暂停任务
                  </Button>
                </Tooltip>
                <Tooltip title="查看并修改当前平台脚本参数">
                  <Button size="small" onClick={() => openConfig(device)}>
                    脚本参数
                  </Button>
                </Tooltip>
                <Tooltip title="编辑设备名称、部署区域和备注">
                  <Button size="small" onClick={() => openDeviceEditor(device)}>
                    设备信息
                  </Button>
                </Tooltip>
                <Popconfirm
                  title="确认关闭手机 Agent 脚本？"
                  description="关闭后后台将无法继续下发任务，除非本地或守护脚本重新拉起。"
                  okText="确认关闭"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => sendCommand(device.deviceCode, "STOP")}
                >
                  <Button size="small" danger icon={<StopOutlined />}>
                    关闭脚本
                  </Button>
                </Popconfirm>
                <Dropdown
                  menu={{
                    items: [
                      { key: "REFRESH_CONFIG", icon: <SyncOutlined />, label: "刷新配置" },
                      { key: "CHECK_UPDATE", icon: <SyncOutlined />, label: "检查版本" },
                      { key: "UPDATE_AGENT", icon: <SyncOutlined />, label: "更新脚本" },
                      { key: "RESTART_APP", icon: <ReloadOutlined />, label: "故障重启抖音" }
                    ],
                    onClick: ({ key }) => {
                      sendCommand(device.deviceCode, key as "REFRESH_CONFIG" | "CHECK_UPDATE" | "UPDATE_AGENT" | "RESTART_APP");
                    }
                  }}
                >
                  <Button size="small" icon={<MoreOutlined />} />
                </Dropdown>
              </Space>
            );
          }}
        />
      </Table>
      <Modal
        title={currentDevice ? `${currentDevice.deviceName || currentDevice.deviceCode} 脚本参数` : "脚本参数"}
        open={configOpen}
        onOk={saveConfig}
        confirmLoading={configMutation.isPending}
        onCancel={() => setConfigOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="心跳发送间隔（分钟）" name="heartbeatMinutes" rules={[{ required: true, message: "请输入心跳发送间隔" }]}>
            <InputNumber min={1} max={60} style={{ width: "100%" }} />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item label="视频随机下限（分钟）" name="videoMinutesMin" rules={[{ required: true, message: "请输入视频时长下限" }]} style={{ width: "50%" }}>
              <InputNumber min={120} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="视频随机上限（分钟）" name="videoMinutesMax" rules={[{ required: true, message: "请输入视频时长上限" }]} style={{ width: "50%" }}>
              <InputNumber min={120} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item label="直播随机下限（分钟）" name="liveMinutesMin" rules={[{ required: true, message: "请输入直播时长下限" }]} style={{ width: "50%" }}>
              <InputNumber min={60} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="直播随机上限（分钟）" name="liveMinutesMax" rules={[{ required: true, message: "请输入直播时长上限" }]} style={{ width: "50%" }}>
              <InputNumber min={60} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item label="Agent 启动后自动执行任务" name="autoStart" valuePropName="checked">
            <Switch checkedChildren="自动执行" unCheckedChildren="只常驻" />
          </Form.Item>
          <Form.Item label="评论采集数量" name="commentLimit" rules={[{ required: true, message: "请输入评论采集数量" }]}>
            <InputNumber min={0} max={50} style={{ width: "100%" }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={currentDevice ? `${currentDevice.deviceName || currentDevice.deviceCode} 设备信息` : "设备信息"}
        open={deviceOpen}
        onOk={saveDevice}
        confirmLoading={deviceMutation.isPending}
        onCancel={() => setDeviceOpen(false)}
        okText="保存"
        cancelText="取消"
      >
        <Form form={deviceForm} layout="vertical">
          <Form.Item label="设备名称" name="deviceName" rules={[{ required: true, message: "请输入设备名称" }]}>
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="设备状态" name="enabled">
            <Select
              options={[
                { label: "启用", value: true },
                { label: "禁用", value: false }
              ]}
            />
          </Form.Item>
          <Form.Item label="部署区域" name="lastRegion">
            <Input maxLength={100} placeholder="例如 广东广州、山东寿光" />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea maxLength={500} rows={4} />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
