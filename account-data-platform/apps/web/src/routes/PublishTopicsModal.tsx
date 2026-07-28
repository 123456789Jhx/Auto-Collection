import { Form, Input, Modal } from "antd";
import { useEffect } from "react";
import type { PublishTaskRow } from "../lib/api-client-publish-tasks";

type FormValues = { description: string };

type Props = {
  task: PublishTaskRow | null;
  loading: boolean;
  onCancel: () => void;
  onSubmit: (description: string) => void;
};

export function PublishTopicsModal({ task, loading, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>();

  useEffect(() => {
    if (task) form.setFieldsValue({ description: task.description });
  }, [form, task]);

  return (
    <Modal
      title="补全话题"
      open={Boolean(task)}
      okText="重新下发"
      cancelText="取消"
      confirmLoading={loading}
      onCancel={onCancel}
      onOk={() => void form.validateFields().then((values) => onSubmit(values.description.trim()))}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="description"
          label="发布文案"
          rules={[{ required: true, whitespace: true, message: "请输入包含完整话题的发布文案" }]}
        >
          <Input.TextArea rows={7} maxLength={4000} showCount />
        </Form.Item>
      </Form>
    </Modal>
  );
}
