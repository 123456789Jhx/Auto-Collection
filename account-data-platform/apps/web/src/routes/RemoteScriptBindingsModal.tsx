import { DeleteOutlined, LinkOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, InputNumber, Modal, Popconfirm, Select, Table, message, type TableColumnsType } from "antd";
import {
  bindRemoteScriptDevice,
  getRemoteScriptBindings,
  unbindRemoteScriptDevice,
  type RemoteScriptBinding,
  type RemoteScriptConfig
} from "../lib/api-client-remote-scripts";
import { getDevices } from "../lib/api-client";

type DeviceOption = {
  deviceCode?: string;
  deviceName?: string | null;
  enabled?: boolean;
};

type BindingFormValues = {
  deviceCode: string;
  priority: number;
};

type Props = {
  open: boolean;
  config: RemoteScriptConfig | null;
  onCancel: () => void;
};

export function RemoteScriptBindingsModal({ open, config, onCancel }: Props) {
  const [form] = Form.useForm<BindingFormValues>();
  const queryClient = useQueryClient();
  const bindingsQuery = useQuery({
    queryKey: ["remoteScriptBindings", config?.id],
    queryFn: () => getRemoteScriptBindings(config?.id ?? ""),
    enabled: Boolean(open && config?.id)
  });
  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    enabled: open
  });

  async function refresh() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["remoteScriptBindings", config?.id] }),
      queryClient.invalidateQueries({ queryKey: ["remoteScriptConfigs"] })
    ]);
  }

  const bindMutation = useMutation({
    mutationFn: (values: BindingFormValues) => bindRemoteScriptDevice(config?.id ?? "", values),
    onSuccess: async () => {
      message.success("设备已绑定");
      form.resetFields();
      await refresh();
    },
    onError: (error: Error) => message.error(error.message || "设备绑定失败")
  });
  const unbindMutation = useMutation({
    mutationFn: (deviceCode: string) => unbindRemoteScriptDevice(config?.id ?? "", deviceCode),
    onSuccess: async () => {
      message.success("设备已解绑");
      await refresh();
    },
    onError: (error: Error) => message.error(error.message || "设备解绑失败")
  });

  const bindings = bindingsQuery.data?.data ?? [];
  const boundCodes = new Set(bindings.map((item) => item.deviceCode));
  const deviceOptions = ((devicesQuery.data ?? []) as DeviceOption[])
    .filter((item) => item.deviceCode && item.enabled !== false && !boundCodes.has(item.deviceCode))
    .map((item) => ({
      value: item.deviceCode!,
      label: item.deviceName ? `${item.deviceName} / ${item.deviceCode}` : item.deviceCode!
    }));
  const columns: TableColumnsType<RemoteScriptBinding> = [
    {
      title: "设备",
      dataIndex: "deviceCode",
      render: (value: string, record) => record.deviceName ? `${record.deviceName} / ${value}` : value
    },
    { title: "优先级", dataIndex: "priority", width: 100 },
    {
      title: "操作",
      width: 90,
      render: (_, record) => (
        <Popconfirm
          title="解绑设备"
          description={`确定解绑“${record.deviceName || record.deviceCode}”吗？`}
          okText="解绑"
          cancelText="取消"
          onConfirm={() => unbindMutation.mutate(record.deviceCode)}
        >
          <Button type="text" danger icon={<DeleteOutlined />}>解绑</Button>
        </Popconfirm>
      )
    }
  ];

  return (
    <Modal open={open} title={`绑定设备 · ${config?.configName ?? ""}`} footer={null} onCancel={onCancel} destroyOnHidden width={720}>
      <Form<BindingFormValues>
        form={form}
        layout="inline"
        initialValues={{ priority: 100 }}
        onFinish={(values) => bindMutation.mutate(values)}
        style={{ marginBottom: 16 }}
      >
        <Form.Item name="deviceCode" rules={[{ required: true, message: "请选择设备" }]} style={{ flex: 1 }}>
          <Select placeholder="选择设备" loading={devicesQuery.isLoading} options={deviceOptions} />
        </Form.Item>
        <Form.Item name="priority" rules={[{ required: true, message: "请输入优先级" }]}>
          <InputNumber min={1} max={1000} addonBefore="优先级" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<LinkOutlined />} loading={bindMutation.isPending}>绑定</Button>
        </Form.Item>
      </Form>
      <Table<RemoteScriptBinding>
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={bindings}
        loading={bindingsQuery.isLoading}
        pagination={false}
      />
    </Modal>
  );
}
