import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Collapse, Form, Input, InputNumber, Modal, Select, Skeleton, Space, Switch, message } from "antd";
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

function statusTone(value?: string | null) {
  return value === "ENABLED" || value === "enabled" ? "green" : "gray";
}

function modeText(value?: string | null) {
  if (value === "daily") return "日常任务";
  if (value === "manual") return "手动任务";
  return value || "-";
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

export function TasksPage({ embedded = false }: { embedded?: boolean } = {}) {
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

  const tasks = (query.data ?? []) as TaskRow[];
  const selectedTask = editingTask ?? tasks[0] ?? null;
  const selectedBotConfig = selectedTask ? botConfigFromRow(selectedTask) : defaultLiveCommentBotConfig as Record<string, unknown>;
  const enabledCount = tasks.filter((item) => item.status === "ENABLED").length;
  const botConfigCount = tasks.filter((item) => item.liveCommentBotConfig).length;
  const p3ConfigCount = tasks.filter((item) => item.p3ExtensionsConfig).length;

  return (
    <>
      <div className={`ops-page task-templates-page ${embedded ? "embedded-ops-page" : ""}`}>
        <header className="ops-topbar">
          <div>
            <h1>配置</h1>
            <p>维护公共任务模板、直播评论机器人话术和高级 JSON；设备单独覆盖在设备运行页处理。</p>
          </div>
          <div className="ops-toolbar">
            <button className="ops-btn" type="button" onClick={() => void query.refetch()}>刷新</button>
            {selectedTask ? <button className="ops-btn primary" type="button" onClick={() => openConfig(selectedTask)}>配置模板</button> : null}
          </div>
        </header>

        <section className="ops-stats four">
          <div className="ops-stat">
            <div className="ops-stat-label">模板总数</div>
            <div className="ops-stat-value">{tasks.length}</div>
            <div className="ops-stat-note">后台公共任务模板</div>
          </div>
          <div className="ops-stat">
            <div className="ops-stat-label">启用模板</div>
            <div className="ops-stat-value ok">{enabledCount}</div>
            <div className="ops-stat-note">当前可用配置</div>
          </div>
          <div className="ops-stat">
            <div className="ops-stat-label">聊天模板</div>
            <div className="ops-stat-value">{botConfigCount}</div>
            <div className="ops-stat-note">已保存机器人模板</div>
          </div>
          <div className="ops-stat">
            <div className="ops-stat-label">P3 扩展</div>
            <div className="ops-stat-value">{p3ConfigCount}</div>
            <div className="ops-stat-note">已启用扩展配置</div>
          </div>
        </section>

        <section className="ops-workbench wide-side">
          <div className="ops-panel">
            <div className="ops-panel-head">
              <span>公共任务模板</span>
              <span className="ops-small">{tasks.length} 条</span>
            </div>
            <div className="ops-table-wrap">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th>模板</th>
                    <th>平台 / 模式</th>
                    <th>视频时长</th>
                    <th>直播时长</th>
                    <th>聊天机器人</th>
                    <th>P3</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.length === 0 ? <tr><td className="ops-empty" colSpan={8}>暂无任务配置</td></tr> : null}
                  {tasks.map((row) => {
                    const botConfig = botConfigFromRow(row);
                    return (
                      <tr key={row.id || row.taskCode} className={row.id === selectedTask?.id ? "selected" : ""} onClick={() => openConfig(row)}>
                        <td>
                          <div className="ops-title">{row.name || row.taskCode}</div>
                          <div className="ops-small">{row.taskCode || "-"}</div>
                        </td>
                        <td>
                          <div>{row.platform || "-"}</div>
                          <div className="ops-small">{modeText(row.mode)}</div>
                        </td>
                        <td>{row.videoMinutesMin ?? "-"}-{row.videoMinutesMax ?? "-"} 分钟</td>
                        <td>{row.liveMinutesMin ?? "-"}-{row.liveMinutesMax ?? "-"} 分钟</td>
                        <td>
                          <span className={`ops-tag ${row.liveCommentBotConfig ? "green" : "blue"}`}>{row.liveCommentBotConfig ? "已保存模板" : "默认模板"}</span>
                          <div className="ops-small">每房 {numberFromBotConfig(botConfig, "maxCommentsPerRoom", 3)} / 每小时 {numberFromBotConfig(botConfig, "maxCommentsPerHour", 10)}</div>
                        </td>
                        <td><span className={`ops-tag ${row.p3ExtensionsConfig ? "blue" : "gray"}`}>{row.p3ExtensionsConfig ? "已配置" : "未配置"}</span></td>
                        <td><span className={`ops-tag ${statusTone(row.status)}`}>{row.status || "-"}</span></td>
                        <td><button className="ops-mini-btn primary" type="button" onClick={(event) => { event.stopPropagation(); openConfig(row); }}>配置模板</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="ops-panel">
            <div className="ops-panel-head">
              <span>模板摘要</span>
              <span className={`ops-tag ${statusTone(selectedTask?.status)}`}>{selectedTask?.status || "未选择"}</span>
            </div>
            <div className="ops-panel-body">
              {selectedTask ? (
                <>
                  <h2 style={{ margin: "0 0 10px", fontSize: 16 }}>{selectedTask.name || selectedTask.taskCode}</h2>
                  <div className="ops-kv">
                    <div className="ops-k">任务编号</div><div>{selectedTask.taskCode || "-"}</div>
                    <div className="ops-k">平台</div><div>{selectedTask.platform || "-"}</div>
                    <div className="ops-k">模式</div><div>{modeText(selectedTask.mode)}</div>
                    <div className="ops-k">视频时长</div><div>{selectedTask.videoMinutesMin ?? "-"}-{selectedTask.videoMinutesMax ?? "-"} 分钟</div>
                    <div className="ops-k">直播时长</div><div>{selectedTask.liveMinutesMin ?? "-"}-{selectedTask.liveMinutesMax ?? "-"} 分钟</div>
                    <div className="ops-k">心跳间隔</div><div>{selectedTask.heartbeatMinutes ?? 1} 分钟</div>
                    <div className="ops-k">每直播间</div><div>{numberFromBotConfig(selectedBotConfig, "maxCommentsPerRoom", 3)} 条</div>
                    <div className="ops-k">每小时</div><div>{numberFromBotConfig(selectedBotConfig, "maxCommentsPerHour", 10)} 条</div>
                    <div className="ops-k">最小间隔</div><div>{numberFromBotConfig(selectedBotConfig, "minIntervalSeconds", 120)} 秒</div>
                    <div className="ops-k">相关阈值</div><div>{numberFromBotConfig(selectedBotConfig, "roomRelevanceThreshold", 60)}</div>
                  </div>
                  <div className="ops-toolbar detail-toolbar">
                    <button className="ops-btn primary" type="button" onClick={() => openConfig(selectedTask)}>编辑模板</button>
                  </div>
                  <div className="ops-panel-note" style={{ marginTop: 14 }}>高级 JSON 预览</div>
                  <pre className="ops-json-box">{JSON.stringify({
                    liveCommentBotConfig: selectedTask.liveCommentBotConfig || selectedBotConfig,
                    liveCommentConfig: selectedTask.liveCommentConfig || {},
                    p3ExtensionsConfig: selectedTask.p3ExtensionsConfig || {}
                  }, null, 2)}</pre>
                </>
              ) : <div className="ops-empty">暂无模板</div>}
            </div>
          </aside>
        </section>
      </div>

      <Modal
        title="直播聊天机器人配置"
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
