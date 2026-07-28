import { Form, Input, Modal, Select } from "antd";
import { useEffect, useMemo } from "react";
import type { ManualPublishTestPayload } from "../lib/api-client-publish-tasks";
import type { RemoteScriptConfig } from "../lib/api-client-remote-scripts";
import type { DeviceRow } from "./DeviceList";

type Props = {
  open: boolean;
  loading: boolean;
  configs: RemoteScriptConfig[];
  devices: DeviceRow[];
  defaultConfigId?: string;
  onCancel: () => void;
  onSubmit: (values: ManualPublishTestPayload) => void;
};

function isOnline(device: DeviceRow) {
  return ["online", "running"].includes((device.effectiveStatus || device.status).toLowerCase());
}

export function ManualPublishTestModal({
  open,
  loading,
  configs,
  devices,
  defaultConfigId,
  onCancel,
  onSubmit
}: Props) {
  const [form] = Form.useForm<ManualPublishTestPayload>();
  const orderedDevices = useMemo(
    () => [...devices].sort((left, right) => Number(isOnline(right)) - Number(isOnline(left))),
    [devices]
  );

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ configId: defaultConfigId, platform: "抖音" });
  }, [defaultConfigId, form, open]);

  return (
    <Modal
      open={open}
      title="手动测试发布"
      okText="下发测试任务"
      cancelText="取消"
      confirmLoading={loading}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then(onSubmit)}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" requiredMark="optional">
        <Form.Item name="configId" label="发布配置" rules={[{ required: true, message: "请选择发布配置" }]}>
          <Select
            placeholder="选择已启用配置"
            options={configs.map((config) => ({ value: config.id, label: config.configName }))}
          />
        </Form.Item>
        <Form.Item name="deviceId" label="设备" rules={[{ required: true, message: "请选择设备" }]}>
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="选择设备"
            options={orderedDevices.map((device) => ({
              value: device.id,
              label: `${device.deviceName || device.deviceCode} · ${isOnline(device) ? "在线" : "离线"}`
            }))}
          />
        </Form.Item>
        <Form.Item name="platform" label="平台" rules={[{ required: true, message: "请选择平台" }]}>
          <Select options={[{ value: "抖音", label: "抖音" }, { value: "视频号", label: "视频号" }]} />
        </Form.Item>
        <Form.Item name="videoUrl" label="视频 URL" rules={[
          { required: true, message: "请输入视频 URL" },
          { type: "url", message: "请输入有效 URL" }
        ]}>
          <Input placeholder="https://" />
        </Form.Item>
        <Form.Item
          name="coverUrl"
          label="封面 URL"
          extra="可留空，用于验证手机端“缺少封面素材”失败路径"
          rules={[{ type: "url", warningOnly: false, message: "请输入有效 URL" }]}
        >
          <Input placeholder="https://" allowClear />
        </Form.Item>
        <Form.Item name="title" label="标题" rules={[{ required: true, whitespace: true, message: "请输入标题" }]}>
          <Input maxLength={500} showCount />
        </Form.Item>
        <Form.Item
          name="description"
          label="描述"
          extra="描述需含5个#话题"
          rules={[{ required: true, whitespace: true, message: "请输入描述" }]}
        >
          <Input.TextArea rows={4} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
