import { PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntdApp, Button, Form, Input, InputNumber, Select, Space, Table, Tag, Typography, type TableColumnsType } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { SharedVocabularySelect } from "../components/account-warmup/SharedVocabularySelect";
import { getDevices } from "../lib/api-client";
import { agentDisconnectMessage, claimAgentDisconnectNotice, isAgentCommandChannelOpen } from "../lib/agent-command-channel";
import {
  getAccountWarmupCommands,
  saveAccountWarmupVocabulary,
  startAccountWarmupDevice,
  stopAccountWarmupDevice,
  type AccountWarmupMobileCommand
} from "../lib/api-client-account-warmup";
import {
  buildAccountWarmupCommands,
  dispatchAccountWarmupCommandsAndSaveVocabulary,
  dispatchAccountWarmupStops,
  mapAccountWarmupCommandStatus,
  normalizeCommentLibrary,
  normalizeRelatedTerms,
  readActiveAccountWarmupBatchId,
  writeActiveAccountWarmupBatchId
} from "../lib/account-warmup-form";
import type { DeviceRow } from "./DeviceList";

type WarmupFormValues = {
  targetKeyword: string;
  relatedTerms: string[];
  commentLibrary?: string[];
  commentCount?: number;
  singleLiveDurationMinutes: number;
  totalWarmupDurationMinutes: number;
  deviceCodes: string[];
};

type WarmupRow = AccountWarmupMobileCommand & {
  deviceCode: string;
  deviceName: string;
  agentReachable?: boolean;
};

function isTerminal(command: AccountWarmupMobileCommand) {
  return command.status === "DONE" || command.status === "FAILED" || command.status === "IGNORED";
}

export function AccountWarmupPage() {
  const [form] = Form.useForm<WarmupFormValues>();
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [activeBatchId, setActiveBatchId] = useState(readActiveAccountWarmupBatchId);
  const [stoppingCommandIds, setStoppingCommandIds] = useState<Set<string>>(() => new Set());
  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    refetchInterval: 3_000
  });
  const commandsQuery = useQuery({
    queryKey: ["accountWarmupCommands", activeBatchId],
    queryFn: getAccountWarmupCommands,
    enabled: Boolean(activeBatchId),
    refetchInterval: 3_000
  });
  const devices = (devicesQuery.data ?? []) as DeviceRow[];
  const eligibleDevices = devices.filter((device) => device.enabled !== false && device.effectiveStatus !== "offline" && isAgentCommandChannelOpen(device));
  const agentNoticeKeys = useRef(new Set<string>());

  useEffect(() => {
    devices.forEach((device) => {
      if (isAgentCommandChannelOpen(device) || !claimAgentDisconnectNotice(device)) return;
      const key = `${device.id}:${device.agentLifecycleState || device.agentStatus || "unknown"}:${device.agentSessionId || ""}`;
      if (agentNoticeKeys.current.has(key)) return;
      agentNoticeKeys.current.add(key);
      const notice = agentDisconnectMessage(device);
      message.info(`${notice.title}：${notice.description}${notice.recovery}`);
    });
  }, [devices, message]);

  const startMutation = useMutation({
    mutationFn: async (values: WarmupFormValues) => {
      const batchId = crypto.randomUUID();
      const commands = buildAccountWarmupCommands({
        batchId,
        targetKeyword: values.targetKeyword,
        relatedTerms: values.relatedTerms,
        commentLibrary: values.commentLibrary ?? [],
        commentCount: values.commentCount ?? 0,
        singleLiveDurationMinutes: values.singleLiveDurationMinutes,
        totalWarmupDurationMinutes: values.totalWarmupDurationMinutes,
        deviceCodes: values.deviceCodes
      });
      const result = await dispatchAccountWarmupCommandsAndSaveVocabulary(
        commands,
        (command) => startAccountWarmupDevice({
          deviceId: command.deviceId,
          payload: command.payload
        }),
        saveAccountWarmupVocabulary
      );
      if (!result.succeededCount) {
        throw result.firstError instanceof Error ? result.firstError : new Error("任务下发失败");
      }
      return { batchId, ...result };
    },
    onSuccess: async (result) => {
      setActiveBatchId(result.batchId);
      writeActiveAccountWarmupBatchId(result.batchId);
      if (result.failedCount) message.warning(`${result.succeededCount} 台已下发，${result.failedCount} 台失败`);
      else message.success("养号任务已下发");
      if (result.vocabularySaveError) message.warning("任务已发布，但共享词库保存失败");
      else await queryClient.invalidateQueries({ queryKey: ["accountWarmupVocabulary"] });
      await queryClient.invalidateQueries({ queryKey: ["accountWarmupCommands"] });
    },
    onError: (error: Error) => message.error(error.message || "任务下发失败")
  });

  const stopMutation = useMutation({
    mutationFn: async (commands: WarmupRow[]) => dispatchAccountWarmupStops(commands, (command) =>
      stopAccountWarmupDevice({
        deviceId: command.deviceCode,
        payload: { batchId: activeBatchId, targetCommandId: command.id }
      })),
    onMutate: (commands) => {
      setStoppingCommandIds((current) => new Set([...current, ...commands.map((command) => command.id)]));
    },
    onSuccess: async (result) => {
      setStoppingCommandIds((current) => {
        const next = new Set(current);
        result.failedIds.forEach((id) => next.delete(id));
        return next;
      });
      if (!result.succeededCount) {
        const reason = result.firstError instanceof Error ? result.firstError.message : "停止失败";
        message.error(reason);
      } else if (result.failedCount) {
        message.warning(`${result.succeededCount} 台停止指令已下发，${result.failedCount} 台失败`);
      } else {
        message.success("停止指令已下发");
      }
      await queryClient.invalidateQueries({ queryKey: ["accountWarmupCommands", activeBatchId] });
    },
    onError: (error: Error, commands) => {
      setStoppingCommandIds((current) => {
        const next = new Set(current);
        commands.forEach((command) => next.delete(command.id));
        return next;
      });
      message.error(error.message || "停止失败");
    }
  });

  const rows = useMemo<WarmupRow[]>(() => {
    if (!activeBatchId) return [];
    const deviceById = new Map(devices.map((device) => [device.id, device]));
    return (commandsQuery.data ?? [])
      .filter((command) => command.commandType === "ACCOUNT_WARMUP_RUN" &&
        command.payloadJson?.featureKey === "target_live_interaction" &&
        command.payloadJson?.batchId === activeBatchId)
      .map((command) => {
        const device = deviceById.get(command.deviceId);
        return {
          ...command,
          deviceCode: device?.deviceCode ?? "",
          deviceName: device?.deviceName || device?.deviceCode || command.deviceId,
          agentReachable: device?.agentReachable
        };
      });
  }, [activeBatchId, commandsQuery.data, devices]);
  const activeRows = rows.filter((command) => !isTerminal(command) && command.agentReachable !== false);
  const stoppableRows = activeRows.filter((command) => !stoppingCommandIds.has(command.id) && command.agentReachable !== false);
  const batchStopping = activeRows.some((command) => stoppingCommandIds.has(command.id));

  function requestStop(commands: WarmupRow[]) {
    const pending = commands.filter((command) => !isTerminal(command) && !stoppingCommandIds.has(command.id));
    if (pending.length) stopMutation.mutate(pending);
  }

  const columns: TableColumnsType<WarmupRow> = [
    { title: "设备", dataIndex: "deviceName" },
    {
      title: "状态",
      key: "status",
      render: (_, command) => {
        const status = mapAccountWarmupCommandStatus(command, stoppingCommandIds.has(command.id) && !isTerminal(command));
        return <Tag color={status.color}>{status.label}</Tag>;
      }
    },
    {
      title: "结果",
      key: "result",
      render: (_, command) => String(command.resultJson?.message || command.resultJson?.matchedTerm || "-")
    },
    {
      title: "操作",
      key: "actions",
      width: 100,
      render: (_, command) => {
        const stopping = stoppingCommandIds.has(command.id) && !isTerminal(command);
        return (
          <Button
            danger
            size="small"
            icon={<StopOutlined />}
            disabled={isTerminal(command) || !command.deviceCode || stopping}
            loading={stopMutation.isPending && stopping}
            onClick={() => requestStop([command])}
          >{stopping ? "停止中" : "停止"}</Button>
        );
      }
    }
  ];

  return (
    <div className="ops-page account-warmup-page">
      <div className="ops-page-header">
        <Typography.Title level={3}>目标直播间互动养号</Typography.Title>
      </div>
      <section className="ops-panel">
        <div className="ops-panel-head"><span>立即任务</span></div>
        <div className="ops-panel-body">
          <Form<WarmupFormValues>
            form={form}
            layout="vertical"
            onFinish={(values) => startMutation.mutate({
              ...values,
              relatedTerms: normalizeRelatedTerms(values.relatedTerms),
              commentLibrary: normalizeCommentLibrary(values.commentLibrary ?? [])
            })}
          >
            <Form.Item name="targetKeyword" label="目标直播间关键词" rules={[{ required: true, whitespace: true, message: "请输入目标直播间关键词" }, { max: 100 }]}>
              <Input placeholder="例如：药材种植" maxLength={100} />
            </Form.Item>
            <Form.Item
              name="relatedTerms"
              label="直播间相关名词"
              rules={[{
                validator: (_, value: string[]) => {
                  const terms = normalizeRelatedTerms(value ?? []);
                  if (!terms.length) return Promise.reject(new Error("请至少输入一个相关名词"));
                  if (terms.length > 30) return Promise.reject(new Error("相关名词最多 30 个"));
                  if (terms.some((term) => term.length > 20)) return Promise.reject(new Error("每个相关名词最多 20 个字符"));
                  return Promise.resolve();
                }
              }]}
            >
              <SharedVocabularySelect
                kind="RELATED_TERM"
                tokenSeparators={[",", "，", "\n"]}
                placeholder="输入新名词或搜索共享历史"
              />
            </Form.Item>
            <Form.Item
              name="commentLibrary"
              label="评论词库"
              dependencies={["commentCount"]}
              rules={[{
                validator: (_, value: string[]) => {
                  const comments = normalizeCommentLibrary(value ?? []);
                  if (Number(form.getFieldValue("commentCount") ?? 0) > 0 && !comments.length) return Promise.reject(new Error("评论次数大于 0 时请至少配置一条评论"));
                  if (comments.length > 100) return Promise.reject(new Error("评论词库最多 100 条"));
                  if (comments.some((comment) => comment.length > 100)) return Promise.reject(new Error("每条评论最多 100 个字符"));
                  return Promise.resolve();
                }
              }]}
            >
              <SharedVocabularySelect
                kind="COMMENT"
                tokenSeparators={[",", "，", "\n"]}
                placeholder="输入新评论或搜索共享历史"
              />
            </Form.Item>
            <Form.Item name="commentCount" label="评论次数" initialValue={0} rules={[{ required: true, message: "请输入评论次数" }]}>
              <InputNumber min={0} max={20} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="singleLiveDurationMinutes" label="单直播时长（分钟）" rules={[{ required: true, message: "请输入单直播时长" }]}>
              <InputNumber min={1} max={1440} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="totalWarmupDurationMinutes" label="直播养号总时长（分钟）" rules={[{ required: true, message: "请输入直播养号总时长" }]}>
              <InputNumber min={1} max={1440} precision={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item name="deviceCodes" label="选择执行设备" rules={[{ required: true, type: "array", min: 1, message: "请至少选择一台设备" }]}>
              <Select
                mode="multiple"
                loading={devicesQuery.isLoading}
                options={eligibleDevices.map((device) => ({
                  label: device.deviceName || device.deviceCode,
                  value: device.deviceCode
                }))}
                placeholder="选择在线设备"
              />
            </Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={startMutation.isPending}>开始查找</Button>
              <Button
                danger
                icon={<StopOutlined />}
                disabled={!stoppableRows.length}
                loading={stopMutation.isPending || batchStopping}
                onClick={() => requestStop(activeRows)}
              >{batchStopping ? "停止中" : "停止任务"}</Button>
            </Space>
          </Form>
        </div>
      </section>
      <section className="ops-panel">
        <div className="ops-panel-head"><span>本次设备状态</span><span className="ops-small">{rows.length} 台</span></div>
        <Table<WarmupRow>
          size="small"
          rowKey="id"
          loading={commandsQuery.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          locale={{ emptyText: activeBatchId ? "等待设备领取任务" : "尚未下发任务" }}
        />
      </section>
    </div>
  );
}
