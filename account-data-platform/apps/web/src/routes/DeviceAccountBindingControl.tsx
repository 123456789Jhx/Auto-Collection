import { UserSwitchOutlined } from "@ant-design/icons";
import type { DeviceAccountBinding } from "@pkg/types";
import { useMutation } from "@tanstack/react-query";
import { Form, Input, Modal, Switch, message } from "antd";
import { useState } from "react";
import { updateDeviceAccountBinding, type DeviceAccountProfile } from "../lib/api-client-devices";

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

function hasPublishBinding(profile: Record<string, unknown> | null | undefined) {
  return stringField(profile, "douyinAccountName").trim().length > 0;
}

type BindingFormValues = Partial<DeviceAccountBinding>;

export function DeviceAccountBindingControl({ device, onSaved }: DeviceAccountBindingControlProps) {
  const [open, setOpen] = useState(false);
  const [bindingEnabled, setBindingEnabled] = useState(false);
  const [form] = Form.useForm<BindingFormValues>();
  const [messageApi, contextHolder] = message.useMessage();
  const [modalApi, modalContextHolder] = Modal.useModal();
  const mutation = useMutation({
    mutationFn: (values: DeviceAccountProfile) => updateDeviceAccountBinding(device.deviceCode, values),
    onSuccess: () => {
      messageApi.success("账号绑定已保存");
      setOpen(false);
      onSaved();
    },
    onError: (error: Error) => messageApi.error(error.message)
  });

  function showModal() {
    form.resetFields();
    setBindingEnabled(hasPublishBinding(device.accountProfile));
    form.setFieldsValue({
      douyinAccountId: stringField(device.accountProfile, "douyinAccountId"),
      douyinAccountName: stringField(device.accountProfile, "douyinAccountName"),
      wechatChannelsName: stringField(device.accountProfile, "wechatChannelsName")
    });
    setOpen(true);
  }

  async function save() {
    if (!bindingEnabled) {
      mutation.mutate({});
      return;
    }
    const values = await form.validateFields();
    mutation.mutate({
      douyinAccountId: values.douyinAccountId?.trim() || "",
      douyinAccountName: values.douyinAccountName?.trim() || "",
      wechatChannelsName: values.wechatChannelsName?.trim() || ""
    });
  }

  function changeBindingEnabled(checked: boolean) {
    if (checked) {
      setBindingEnabled(true);
      return;
    }
    modalApi.confirm({
      title: "确认解除发布账号绑定？",
      content: "解除绑定后该设备将不再接收指定账号的发布任务",
      okText: "解除绑定",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: () => {
        setBindingEnabled(false);
        form.setFieldsValue({ douyinAccountId: "", douyinAccountName: "", wechatChannelsName: "" });
      }
    });
  }

  return (
    <>
      {contextHolder}
      {modalContextHolder}
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
          <Form.Item label="绑定发布账号">
            <Switch checked={bindingEnabled} onChange={changeBindingEnabled} />
          </Form.Item>
          {bindingEnabled ? (
            <>
              <Form.Item
                label="抖音账号名称"
                name="douyinAccountName"
                rules={[{ required: true, whitespace: true, message: "请输入抖音账号名称" }]}
              >
                <Input placeholder="发布任务的精确匹配键" />
              </Form.Item>
              <Form.Item label="抖音号 ID" name="douyinAccountId">
                <Input placeholder="可留空" />
              </Form.Item>
              <Form.Item label="微信视频号名称" name="wechatChannelsName">
                <Input placeholder="可留空，仅记录" />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
    </>
  );
}
