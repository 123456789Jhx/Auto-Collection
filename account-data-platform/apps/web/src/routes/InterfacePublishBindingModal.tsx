import { DeleteOutlined, EditOutlined, LinkOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntdApp,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  type TableColumnsType
} from "antd";
import { ApiError } from "../lib/api-client";
import {
  getInterfacePublishBindingPreflight,
  getInterfacePublishBindings,
  removeInterfacePublishBinding,
  saveInterfacePublishBinding,
  type InterfacePublishBindingPreflightRecord,
  type InterfacePublishBindingRecord,
  type InterfacePublishBindingStatus,
  type SaveInterfacePublishBindingPayload
} from "../lib/api-client-interface-publish-bindings";

type Props = {
  open: boolean;
  onClose: () => void;
};

type BindingFormValues = SaveInterfacePublishBindingPayload & {
  deviceCode: string;
};

const statusPresentation: Record<InterfacePublishBindingStatus, { color: string; text: string }> = {
  MATCHED: { color: "green", text: "完整且唯一" },
  BINDING_INCOMPLETE: { color: "orange", text: "字段不完整" },
  BINDING_CONFLICT: { color: "red", text: "绑定冲突" },
  DEVICE_OFFLINE: { color: "default", text: "设备离线" },
  DEVICE_BUSY: { color: "gold", text: "设备繁忙" },
  UNBOUND: { color: "default", text: "未绑定" }
};

function bindingErrorMessage(error: Error) {
  if (error instanceof ApiError && error.code === "BINDING_CONFLICT") {
    return "该账号或设备已经存在启用绑定";
  }
  return error.message || "绑定保存失败";
}

export function InterfacePublishBindingModal({ open, onClose }: Props) {
  const [form] = Form.useForm<BindingFormValues>();
  const queryClient = useQueryClient();
  const { message } = AntdApp.useApp();
  const bindingsQuery = useQuery({
    queryKey: ["interfacePublishBindings"],
    queryFn: getInterfacePublishBindings,
    enabled: open
  });
  const preflightQuery = useQuery({
    queryKey: ["interfacePublishBindingPreflight"],
    queryFn: getInterfacePublishBindingPreflight,
    enabled: open
  });

  async function refreshBindings() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["interfacePublishBindings"] }),
      queryClient.invalidateQueries({ queryKey: ["interfacePublishBindingPreflight"] })
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: (values: BindingFormValues) => saveInterfacePublishBinding(values.deviceCode, {
      accountName: values.accountName.trim(),
      accountNo: values.accountNo.trim(),
      externalAccountKey: values.externalAccountKey.trim(),
      enabled: true
    }),
    onSuccess: async () => {
      message.success("接口发布绑定已保存");
      form.resetFields();
      await refreshBindings();
    },
    onError: (error: Error) => message.error(bindingErrorMessage(error))
  });
  const removeMutation = useMutation({
    mutationFn: removeInterfacePublishBinding,
    onSuccess: async () => {
      message.success("接口发布绑定已解除");
      form.resetFields();
      await refreshBindings();
    },
    onError: (error: Error) => message.error(error.message || "解除绑定失败")
  });

  const bindings = bindingsQuery.data?.data ?? [];
  const preflightByDevice = new Map(
    (preflightQuery.data?.data ?? []).map((item) => [item.deviceCode, item])
  );
  const uniqueDevices = [...new Map(bindings.map((item) => [item.deviceCode, item])).values()];

  // [AIR-FILL: Q-002] Fixtures may populate this list, but a real device is always chosen by the user.
  const deviceOptions = uniqueDevices.map((item) => ({
    value: item.deviceCode,
    label: item.deviceName ? `${item.deviceName} / ${item.deviceCode}` : item.deviceCode
  }));

  function editBinding(record: InterfacePublishBindingRecord) {
    form.setFieldsValue({
      deviceCode: record.deviceCode,
      accountName: record.accountName ?? "",
      accountNo: record.accountNo ?? "",
      externalAccountKey: record.externalAccountKey ?? record.accountName ?? "",
      enabled: true
    });
  }

  const columns: TableColumnsType<InterfacePublishBindingRecord> = [
    {
      title: "设备名称",
      dataIndex: "deviceName",
      render: (value: string | null) => value || "未命名设备"
    },
    { title: "设备 ID", dataIndex: "deviceCode" },
    { title: "抖音名称", dataIndex: "accountName", render: (value: string | null) => value || "未绑定" },
    { title: "抖音号", dataIndex: "accountNo", render: (value: string | null) => value || "未填写" },
    {
      title: "外部接口查询标识",
      dataIndex: "externalAccountKey",
      render: (value: string | null) => value || "未填写"
    },
    {
      title: "在线状态",
      dataIndex: "deviceStatus",
      width: 100,
      render: (value: string) => (
        <Tag color={value === "offline" ? "default" : "green"}>
          {value === "offline" ? "离线" : "在线"}
        </Tag>
      )
    },
    {
      title: "占用状态",
      dataIndex: "activeAssignmentId",
      width: 100,
      render: (value: string | null) => <Tag color={value ? "gold" : "green"}>{value ? "繁忙" : "空闲"}</Tag>
    },
    {
      title: "绑定状态",
      width: 120,
      render: (_, record) => {
        const status = preflightByDevice.get(record.deviceCode)?.status ?? "UNBOUND";
        const presentation = statusPresentation[status];
        return <Tag color={presentation.color}>{presentation.text}</Tag>;
      }
    },
    {
      title: "操作",
      width: 150,
      render: (_, record) => (
        <Space size={4}>
          <Button type="text" icon={<EditOutlined />} onClick={() => editBinding(record)}>
            编辑
          </Button>
          {record.bindingId ? (
            <Popconfirm
              title="解除接口发布绑定"
              description="只会解除接口发布绑定，不会清空设备的其他业务资料"
              okText="解除"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => removeMutation.mutate(record.deviceCode)}
            >
              <Button type="text" danger icon={<DeleteOutlined />}>解除</Button>
            </Popconfirm>
          ) : null}
        </Space>
      )
    }
  ];

  return (
    <Modal
      title="匹配接口账号与设备"
      open={open}
      onCancel={onClose}
      footer={null}
      width={1120}
      destroyOnHidden
    >
      {bindingsQuery.isError || preflightQuery.isError ? (
        <Alert
          type="error"
          showIcon
          message="绑定信息加载失败"
          description={(bindingsQuery.error ?? preflightQuery.error)?.message}
          style={{ marginBottom: 16 }}
        />
      ) : null}

      <Form<BindingFormValues>
        form={form}
        layout="inline"
        onFinish={(values) => saveMutation.mutate(values)}
        style={{ marginBottom: 16, rowGap: 12 }}
      >
        <Form.Item label="设备 ID" name="deviceCode" rules={[{ required: true, message: "请选择设备" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择项目设备"
            options={deviceOptions}
            style={{ width: 240 }}
          />
        </Form.Item>
        <Form.Item label="抖音名称" name="accountName" rules={[{ required: true, whitespace: true, message: "请输入精确抖音名称" }]}>
          <Input maxLength={100} placeholder="与外部接口账号名称完全一致" style={{ width: 220 }} />
        </Form.Item>
        <Form.Item label="抖音号" name="accountNo" rules={[{ required: true, whitespace: true, message: "请输入抖音号" }]}>
          <Input maxLength={100} placeholder="例如 41218954470" style={{ width: 180 }} />
        </Form.Item>
        <Form.Item
          label="外部接口查询标识"
          name="externalAccountKey"
          rules={[{ required: true, whitespace: true, message: "请输入外部接口查询标识" }]}
        >
          <Input maxLength={255} placeholder="例如 开心幸福一家人" style={{ width: 220 }} />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" icon={<LinkOutlined />} loading={saveMutation.isPending}>
            保存绑定
          </Button>
        </Form.Item>
      </Form>

      <Table<InterfacePublishBindingRecord>
        rowKey="deviceCode"
        size="small"
        columns={columns}
        dataSource={uniqueDevices}
        loading={bindingsQuery.isLoading || preflightQuery.isLoading}
        pagination={{ pageSize: 10, showSizeChanger: false }}
        scroll={{ x: 1200 }}
      />
    </Modal>
  );
}

export type { InterfacePublishBindingPreflightRecord };
