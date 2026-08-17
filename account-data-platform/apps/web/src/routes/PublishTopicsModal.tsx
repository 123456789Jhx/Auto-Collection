import { Form, Input, Modal, Typography } from "antd";
import { useEffect } from "react";
import { validateTopicDescription } from "../lib/quick-paste-publish";
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
  const description = Form.useWatch("description", form) ?? task?.description ?? "";
  const expectedTopicCount = task?.expectedTopicCount ?? 5;
  const topicValidation = validateTopicDescription(description, expectedTopicCount);

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
          label="描述（含话题）"
          rules={[
            { required: true, message: "请输入描述和话题" },
            {
              validator: async (_rule, value) => {
                const validation = validateTopicDescription(String(value ?? ""), expectedTopicCount);
                if (validation.valid) return;
                throw new Error(validation.reason);
              }
            }
          ]}
        >
          <Input.TextArea rows={6} placeholder="补全后需包含完整 #话题" />
        </Form.Item>
        <Typography.Text type={topicValidation.valid ? "success" : "secondary"}>
          {"当前话题：" + topicValidation.actualCount + "/" + expectedTopicCount + (topicValidation.valid ? "，校验通过" : "，" + topicValidation.reason)}
        </Typography.Text>
      </Form>
    </Modal>
  );
}
