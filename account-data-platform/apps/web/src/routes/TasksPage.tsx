import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Collapse, Form, Input, InputNumber, Modal, Select, Skeleton, Space, Switch, Table, Tag, message } from "antd";
import { useState } from "react";
import { getTasks, updateTask } from "../lib/api-client";
import { defaultLiveCommentBotConfig, parseLiveCommentConfig, parseP3ExtensionsConfig, stringifyLiveCommentConfig, stringifyP3ExtensionsConfig } from "../lib/live-comment-config";

type TaskRow = {
  id?: string;
  taskCode?: string;
  name?: string;
  platform?: string;
  mode?: string;
  status?: string;
  videoMinutesMin?: number;
  videoMinutesMax?: number;
  liveMinutesMin?: number;
  liveMinutesMax?: number;
  heartbeatMinutes?: number;
  liveCommentConfig?: Record<string, unknown> | null;
  liveCommentBotConfig?: Record<string, unknown> | null;
  p3ExtensionsConfig?: Record<string, unknown> | null;
};

type ConfigForm = {
  enabled?: boolean;
  botName?: string;
  commentTypes?: string[];
  topicTagsText?: string;
  maxCommentsPerRoom?: number;
  maxCommentsPerHour?: number;
  minIntervalSeconds?: number;
  sendDelayMinMs?: number;
  sendDelayMaxMs?: number;
  roomRelevanceThreshold?: number;
  lowConfidenceAction?: "skip" | "log_only";
  questionPoolText?: string;
  agreePoolText?: string;
  experiencePoolText?: string;
  knowledgePoolText?: string;
  liveCommentConfig: string;
  liveCommentBotConfig: string;
  p3ExtensionsConfig: string;
};

function toLines(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || "")).filter(Boolean).join("\n") : "";
}

function parseLines(value?: string) {
  return (value || "")
    .split(/[\n,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function botConfigFromRow(row: TaskRow) {
  return {
    ...defaultLiveCommentBotConfig,
    ...(row.liveCommentBotConfig || {})
  } as Record<string, unknown>;
}

function numberFromBotConfig(config: Record<string, unknown>, key: string, fallback: number) {
  const value = config[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function formValuesFromBotConfig(config: Record<string, unknown>): Partial<ConfigForm> {
  const pools = (config.templatePools || {}) as Record<string, unknown>;
  return {
    enabled: config.enabled !== false,
    botName: String(config.botName || "三农聊天机器人"),
    commentTypes: Array.isArray(config.commentTypes) ? config.commentTypes.map(String) : ["question", "agree", "experience_share", "knowledge_tip"],
    topicTagsText: toLines(config.topicTags),
    maxCommentsPerRoom: Number(config.maxCommentsPerRoom || 3),
    maxCommentsPerHour: Number(config.maxCommentsPerHour || 10),
    minIntervalSeconds: Number(config.minIntervalSeconds || 120),
    sendDelayMinMs: Number(config.sendDelayMinMs || 3000),
    sendDelayMaxMs: Number(config.sendDelayMaxMs || 12000),
    roomRelevanceThreshold: Number(config.roomRelevanceThreshold || 60),
    lowConfidenceAction: config.lowConfidenceAction === "log_only" ? "log_only" : "skip",
    questionPoolText: toLines(pools.question),
    agreePoolText: toLines(pools.agree),
    experiencePoolText: toLines(pools.experience_share),
    knowledgePoolText: toLines(pools.knowledge_tip)
  };
}

function buildBotConfig(values: ConfigForm) {
  return {
    enabled: values.enabled !== false,
    botName: values.botName?.trim() || "三农聊天机器人",
    commentTypes: values.commentTypes?.length ? values.commentTypes : ["question", "agree", "experience_share", "knowledge_tip"],
    topicTags: parseLines(values.topicTagsText),
    maxCommentsPerRoom: Number(values.maxCommentsPerRoom || 3),
    maxCommentsPerHour: Number(values.maxCommentsPerHour || 10),
    minIntervalSeconds: Number(values.minIntervalSeconds || 120),
    sendDelayMinMs: Number(values.sendDelayMinMs || 3000),
    sendDelayMaxMs: Number(values.sendDelayMaxMs || 12000),
    roomRelevanceThreshold: Number(values.roomRelevanceThreshold || 60),
    lowConfidenceAction: values.lowConfidenceAction || "skip",
    templatePools: {
      question: parseLines(values.questionPoolText),
      agree: parseLines(values.agreePoolText),
      experience_share: parseLines(values.experiencePoolText),
      knowledge_tip: parseLines(values.knowledgePoolText)
    }
  };
}

export function TasksPage() {
  const [form] = Form.useForm<ConfigForm>();
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null);
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["tasks"], queryFn: getTasks });
  const mutation = useMutation({
    mutationFn: (payload: { taskId: string; liveCommentConfig: Record<string, unknown>; liveCommentBotConfig: Record<string, unknown>; p3ExtensionsConfig: Record<string, unknown> }) =>
      updateTask(payload.taskId, {
        liveCommentConfig: payload.liveCommentConfig,
        liveCommentBotConfig: payload.liveCommentBotConfig,
        p3ExtensionsConfig: payload.p3ExtensionsConfig
      }),
    onSuccess: async () => {
      message.success("任务模板已保存");
      setEditingTask(null);
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (error: Error) => {
      message.error(error.message || "任务模板保存失败");
    }
  });

  function openConfig(row: TaskRow) {
    const botConfig = botConfigFromRow(row);
    setEditingTask(row);
    form.setFieldsValue({
      ...formValuesFromBotConfig(botConfig),
      liveCommentConfig: stringifyLiveCommentConfig(row.liveCommentConfig),
      liveCommentBotConfig: JSON.stringify(botConfig, null, 2),
      p3ExtensionsConfig: stringifyP3ExtensionsConfig(row.p3ExtensionsConfig)
    });
  }

  function saveConfig() {
    if (!editingTask?.id) return;
    const values = form.getFieldsValue();
    const botConfig = buildBotConfig(values);
    const parsedLiveComment = parseLiveCommentConfig(values.liveCommentConfig || "{}");
    if (!parsedLiveComment.ok) {
      message.error(parsedLiveComment.error);
      return;
    }
    const parsedAdvancedBot = values.liveCommentBotConfig ? parseLiveCommentConfig(values.liveCommentBotConfig) : { ok: true as const, value: botConfig };
    if (!parsedAdvancedBot.ok) {
      message.error(parsedAdvancedBot.error);
      return;
    }
    const parsedP3 = parseP3ExtensionsConfig(values.p3ExtensionsConfig || "{}");
    if (!parsedP3.ok) {
      message.error(parsedP3.error);
      return;
    }
    mutation.mutate({
      taskId: editingTask.id,
      liveCommentConfig: parsedLiveComment.value,
      liveCommentBotConfig: {
        ...parsedAdvancedBot.value,
        ...botConfig
      },
      p3ExtensionsConfig: parsedP3.value
    });
  }

  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" message="任务配置加载失败" description={query.error.message} showIcon />;

  return (
    <>
      <Card title="任务配置">
        <Table<TaskRow> rowKey={(row) => String(row.id)} dataSource={(query.data ?? []) as TaskRow[]} scroll={{ x: 1080 }}>
          <Table.Column<TaskRow> title="任务编号" dataIndex="taskCode" />
          <Table.Column<TaskRow> title="名称" dataIndex="name" />
          <Table.Column<TaskRow> title="平台" dataIndex="platform" />
          <Table.Column<TaskRow> title="模式" dataIndex="mode" />
          <Table.Column<TaskRow> title="视频时长" render={(_, row) => `${row.videoMinutesMin}-${row.videoMinutesMax} 分钟`} />
          <Table.Column<TaskRow> title="直播时长" render={(_, row) => `${row.liveMinutesMin}-${row.liveMinutesMax} 分钟`} />
          <Table.Column<TaskRow> title="心跳间隔" render={(_, row) => `${row.heartbeatMinutes ?? 1} 分钟`} />
          <Table.Column<TaskRow>
            title="聊天机器人模板"
            width={260}
            render={(_, row) => {
              const botConfig = botConfigFromRow(row);
              return (
                <Space direction="vertical" size={2}>
                  <Tag color={row.liveCommentBotConfig ? "green" : "blue"}>{row.liveCommentBotConfig ? "已保存模板" : "默认模板"}</Tag>
                  <span style={{ color: "#6b7280", fontSize: 12 }}>
                    每房 {numberFromBotConfig(botConfig, "maxCommentsPerRoom", 3)} / 每小时 {numberFromBotConfig(botConfig, "maxCommentsPerHour", 10)} / 间隔 {numberFromBotConfig(botConfig, "minIntervalSeconds", 120)}s / 阈值 {numberFromBotConfig(botConfig, "roomRelevanceThreshold", 60)}
                  </span>
                </Space>
              );
            }}
          />
          <Table.Column<TaskRow>
            title="P3"
            render={(_, row) => <Tag color={row.p3ExtensionsConfig ? "blue" : "default"}>{row.p3ExtensionsConfig ? "已配置" : "未配置"}</Tag>}
          />
          <Table.Column<TaskRow> title="状态" dataIndex="status" render={(value) => <Tag color={value === "ENABLED" ? "green" : "default"}>{value}</Tag>} />
          <Table.Column<TaskRow>
            title="操作"
            width={160}
            render={(_, row) => (
              <Space>
                <Button size="small" onClick={() => openConfig(row)}>
                  模板配置
                </Button>
              </Space>
            )}
          />
        </Table>
      </Card>

      <Modal
        title="直播聊天机器人公共模板"
        open={!!editingTask}
        onCancel={() => setEditingTask(null)}
        onOk={saveConfig}
        confirmLoading={mutation.isPending}
        width={860}
        okText="保存"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="启用机器人" name="enabled" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="关闭" />
          </Form.Item>
          <Form.Item label="机器人名称" name="botName">
            <Input maxLength={100} />
          </Form.Item>
          <Form.Item label="话术类型" name="commentTypes">
            <Select
              mode="multiple"
              options={[
                { value: "question", label: "提问" },
                { value: "agree", label: "赞同" },
                { value: "experience_share", label: "经验分享" },
                { value: "knowledge_tip", label: "常识提醒" }
              ]}
            />
          </Form.Item>
          <Form.Item label="话题标签" name="topicTagsText">
            <Input.TextArea rows={3} placeholder="一行一个，也可用逗号分隔" />
          </Form.Item>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item label="每直播间上限" name="maxCommentsPerRoom" style={{ width: "33.33%" }}>
              <InputNumber min={0} max={20} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="每小时上限" name="maxCommentsPerHour" style={{ width: "33.33%" }}>
              <InputNumber min={0} max={100} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="最小间隔秒" name="minIntervalSeconds" style={{ width: "33.33%" }}>
              <InputNumber min={10} max={3600} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Space.Compact style={{ width: "100%" }}>
            <Form.Item label="发送延迟下限 ms" name="sendDelayMinMs" style={{ width: "33.33%" }}>
              <InputNumber min={500} max={60000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="发送延迟上限 ms" name="sendDelayMaxMs" style={{ width: "33.33%" }}>
              <InputNumber min={500} max={120000} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="相关度阈值" name="roomRelevanceThreshold" style={{ width: "33.33%" }}>
              <InputNumber min={0} max={100} style={{ width: "100%" }} />
            </Form.Item>
          </Space.Compact>
          <Form.Item label="低置信处理" name="lowConfidenceAction">
            <Select
              options={[
                { value: "skip", label: "跳过" },
                { value: "log_only", label: "只记录" }
              ]}
            />
          </Form.Item>
          <Form.Item label="提问话术池" name="questionPoolText">
            <Input.TextArea rows={4} placeholder="一行一句" />
          </Form.Item>
          <Form.Item label="赞同话术池" name="agreePoolText">
            <Input.TextArea rows={4} placeholder="一行一句" />
          </Form.Item>
          <Form.Item label="经验分享话术池" name="experiencePoolText">
            <Input.TextArea rows={4} placeholder="一行一句" />
          </Form.Item>
          <Form.Item label="常识提醒话术池" name="knowledgePoolText">
            <Input.TextArea rows={4} placeholder="一行一句" />
          </Form.Item>
          <Collapse
            items={[
              {
                key: "advanced",
                label: "高级 JSON 配置",
                children: (
                  <>
                    <Form.Item name="liveCommentBotConfig" label="liveCommentBotConfig JSON">
                      <Input.TextArea rows={10} spellCheck={false} />
                    </Form.Item>
                    <Form.Item name="liveCommentConfig" label="liveCommentConfig JSON">
                      <Input.TextArea rows={8} spellCheck={false} />
                    </Form.Item>
                    <Form.Item name="p3ExtensionsConfig" label="p3ExtensionsConfig JSON">
                      <Input.TextArea rows={8} spellCheck={false} />
                    </Form.Item>
                  </>
                )
              }
            ]}
          />
          <Alert
            type="warning"
            showIcon
            message="模板配置会作为所有设备默认值"
            description="设备级配置可以覆盖模板；当前主线默认只生成 planned/skipped 记录。测试真实发送时需要显式开启 executeEnabled 和 manualExecutionApproved，并从手机端或后台启动直播评论控制。"
            style={{ marginTop: 16 }}
          />
        </Form>
      </Modal>
    </>
  );
}
