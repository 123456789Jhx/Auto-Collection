import { UserSwitchOutlined } from "@ant-design/icons";
import type { DeviceAccountBinding } from "@pkg/types";
import { useMutation } from "@tanstack/react-query";
import { Form, Input, Modal, message } from "antd";
import { useState } from "react";
import { updateDeviceAccountBinding } from "../lib/api-client-devices";

type DeviceAccountBindingControlProps = {
  device: {
    deviceCode: string;
    deviceName?: string;
    accountProfile?: Record<string, unknown> | null;
  };
  onSaved: () => void;
};

function stringField(profile: Record<string, unknown> | null | undefined, key: string) {
  const value = profile?.[key];
  return typeof value === "string" ? value : "";
}

export function DeviceAccountBindingControl({ device, onSaved }: DeviceAccountBindingControlProps) {
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<DeviceAccountBinding>();
  const [messageApi, contextHolder] = message.useMessage();
  const mutation = useMutation({
    mutationFn: (values: DeviceAccountBinding) => updateDeviceAccountBinding(device.deviceCode, values),
    onSuccess: () => {
      messageApi.success("账号绑定已保存");
      setOpen(false);
      onSaved();
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  function showModal() {
    form.setFieldsValue({
      douyinAccountId: stringField(device.accountProfile, "douyinAccountId"),
      douyinAccountName: stringField(device.accountProfile, "douyinAccountName"),
      wechatChannelsName: stringField(device.accountProfile, "wechatChannelsName")
    });
    setOpen(true);
  }

  async function save() {
    const values = await form.validateFields();
    mutation.mutate({
      douyinAccountId: values.douyinAccountId.trim(),
      douyinAccountName: values.douyinAccountName.trim(),
      wechatChannelsName: values.wechatChannelsName.trim()
    });
  }

  return (
    <>
      {contextHolder}
      <button className="ops-mini-btn" type="button" onClick={showModal}>
        <UserSwitchOutlined /> 账号绑定
      </button>
      <Modal
        title={`${device.deviceName || device.deviceCode} 账号绑定`}
        open={open}
        confirmLoading={mutation.isPending}
        forceRender
        okText="保存"
        cancelText="取消"
        onOk={() => void save()}
        onCancel={() => setOpen(false)}
      >
        <Form form={form} layout="vertical">
          <Form.Item label="抖音号 ID" name="douyinAccountId">
            <Input placeholder="可留空" />
          </Form.Item>
          <Form.Item label="抖音号名称" name="douyinAccountName">
            <Input placeholder="可留空" />
          </Form.Item>
          <Form.Item label="微信视频号名称" name="wechatChannelsName">
            <Input placeholder="可留空" />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
