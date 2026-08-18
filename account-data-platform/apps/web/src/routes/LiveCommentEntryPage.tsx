import { PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App as AntdApp,
  Button,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
  type TableColumnsType
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDevices } from "../lib/api-client";
import {
  getLiveCommentEntryCommands,
  startLiveCommentEntryDevice,
  stopLiveCommentEntryDevice,
  type LiveCommentEntryMobileCommand
} from "../lib/api-client-live-comment-entry";
import {
  buildLiveCommentEntryCommands,
  buildLiveCommentEntryStopCommands,
  readActiveLiveCommentEntryBatchId,
  readLastLiveCommentEntryInput,
  resolveLiveCommentEntryState,
  resolveLiveCommentEntryStopState,
  summarizeLiveCommentEntryStates,
  writeActiveLiveCommentEntryBatchId,
  writeLastLiveCommentEntryInput,
  type LiveCommentEntryState
} from "../lib/live-comment-entry-form";
import { formatDateTime, type DeviceRow } from "./DeviceList";
type EntryRow = LiveCommentEntryMobileCommand & {
  deviceCode: string;
  deviceName: string;
  viewState: LiveCommentEntryState;
};
function hasBusinessTask(device: DeviceRow) {
  return Boolean(device.currentTask && device.currentTask !== "none");
}

function commandBatchId(command: LiveCommentEntryMobileCommand) {
  return typeof command.payloadJson?.batchId === "string" ? command.payloadJson.batchId : "";
}
function stopTargetId(command: LiveCommentEntryMobileCommand) {
  return typeof command.payloadJson?.targetCommandId === "string" ? command.payloadJson.targetCommandId : "";
}

function resultText(row: EntryRow) {
  if (row.viewState.message) return row.viewState.message;
  if (row.viewState.key === "entered") return "已进入第一个直播结果";
  if (row.viewState.key === "stopped") return "任务已停止";
  return "-";
}
export function LiveCommentEntryPage() {
  const initialInput = useRef(readLastLiveCommentEntryInput());
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [activeBatchId, setActiveBatchId] = useState(readActiveLiveCommentEntryBatchId);
  const [targetKeyword, setTargetKeyword] = useState(initialInput.current.targetKeyword);
  const [minViewerCount, setMinViewerCount] = useState(initialInput.current.minViewerCount);
  const [selectedDeviceCodes, setSelectedDeviceCodes] = useState<string[]>([]);
  const [stoppingCommandIds, setStoppingCommandIds] = useState<Set<string>>(() => new Set());
  const restoredBatchId = useRef("");

  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    refetchInterval: 15_000
  });
  const commandsQuery = useQuery({
    queryKey: ["liveCommentEntryCommands", activeBatchId],
    queryFn: () => getLiveCommentEntryCommands(activeBatchId || undefined),
    refetchInterval: 2_000
  });
  const devices = (devicesQuery.data ?? []) as DeviceRow[];
  const commands = commandsQuery.data ?? [];
  const eligibleDevices = useMemo(() => devices.filter((device) =>
    device.enabled !== false && device.effectiveStatus !== "offline"), [devices]);
  const stopByTargetId = useMemo(() => {
    const map = new Map<string, LiveCommentEntryMobileCommand>();
    commands.filter((command) => command.commandType === "ACCOUNT_WARMUP_STOP" &&
      commandBatchId(command) === activeBatchId).forEach((command) => {
      const targetCommandId = stopTargetId(command);
      if (targetCommandId && !map.has(targetCommandId)) map.set(targetCommandId, command);
    });
    return map;
  }, [activeBatchId, commands]);
  const rows = useMemo<EntryRow[]>(() => {
    if (!activeBatchId) return [];
    const deviceById = new Map(devices.map((device) => [device.id, device]));
    return commands
      .filter((command) => command.commandType === "ACCOUNT_WARMUP_RUN" &&
        command.payloadJson?.featureKey === "live_comment_entry" &&
        commandBatchId(command) === activeBatchId)
      .map((command) => {
        const device = deviceById.get(command.deviceId);
        const localStopState = stoppingCommandIds.has(command.id) ? "pending" : "none";
        const persistedStopState = resolveLiveCommentEntryStopState(stopByTargetId.get(command.id));
        const effectiveStopState = persistedStopState === "none" ? localStopState : persistedStopState;
        return {
          ...command,
          deviceCode: device?.deviceCode ?? "",
          deviceName: device?.deviceName || device?.deviceCode || command.deviceId,
          viewState: resolveLiveCommentEntryState(command, effectiveStopState)
        };
      });
  }, [activeBatchId, commands, devices, stopByTargetId, stoppingCommandIds]);
  const activeRows = rows.filter((row) => row.viewState.active);
  const stoppableRows = activeRows.filter((row) => row.viewState.key !== "stopping" && row.deviceCode);
  const summary = summarizeLiveCommentEntryStates(rows.map((row) => row.viewState));
  const busyDeviceIds = new Set(devices.filter(hasBusinessTask).map((device) => device.id));
  const selectableDevices = eligibleDevices.filter((device) => !busyDeviceIds.has(device.id));
  const selectableCodes = useMemo(() => new Set(selectableDevices.map((device) => device.deviceCode)), [selectableDevices]);
  useEffect(() => {
    if (!activeBatchId || !rows.length || restoredBatchId.current === activeBatchId || devicesQuery.isPending) return;
    if (rows.some((row) => !row.deviceCode)) return;
    setSelectedDeviceCodes(rows.map((row) => row.deviceCode).filter(Boolean));
    restoredBatchId.current = activeBatchId;
  }, [activeBatchId, devicesQuery.isPending, rows]);
  useEffect(() => {
    if (!stopByTargetId.size) return;
    setStoppingCommandIds((current) => {
      const next = new Set([...current].filter((id) => !stopByTargetId.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [stopByTargetId]);

  useEffect(() => {
    if (activeRows.length) return;
    setSelectedDeviceCodes((current) => {
      const next = current.filter((deviceCode) => selectableCodes.has(deviceCode));
      return next.length === current.length ? current : next;
    });
  }, [activeRows.length, selectableCodes]);

  const startMutation = useMutation({
    mutationFn: async (batchId: string) => {
      const taskCommands = buildLiveCommentEntryCommands({
        batchId,
        targetKeyword,
        minViewerCount,
        deviceCodes: selectedDeviceCodes
      });
      if (!taskCommands.length) throw new Error("请至少选择一台可用设备");
      const results = await Promise.allSettled(taskCommands.map((command) =>
        startLiveCommentEntryDevice({ deviceId: command.deviceId, payload: command.payload })));
      const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
      const succeededCount = results.length - failures.length;
      if (!succeededCount) {
        throw failures[0]?.reason instanceof Error ? failures[0].reason : new Error("任务下发失败");
      }
      return { batchId, succeededCount, failedCount: failures.length };
    },
    onMutate: (batchId) => {
      setActiveBatchId(batchId);
      setStoppingCommandIds(new Set<string>());
      restoredBatchId.current = "";
      writeActiveLiveCommentEntryBatchId(batchId);
    },
    onSuccess: async (result) => {
      writeLastLiveCommentEntryInput({ targetKeyword, minViewerCount });
      if (result.failedCount) message.warning(`${result.succeededCount} 台已下发，${result.failedCount} 台失败`);
      else message.success(`${result.succeededCount} 台进入直播间任务已下发`);
      await queryClient.invalidateQueries({ queryKey: ["liveCommentEntryCommands"] });
    },
    onError: (error: Error) => message.error(error.message || "任务下发失败")
  });

  const stopMutation = useMutation({
    mutationFn: async (targetRows: EntryRow[]) => {
      const stopCommands = buildLiveCommentEntryStopCommands({ batchId: activeBatchId, rows: targetRows });
      const results = await Promise.allSettled(stopCommands.map((command) =>
        stopLiveCommentEntryDevice({ deviceId: command.deviceId, payload: command.payload })));
      const failedIds: string[] = [];
      let firstError: unknown;
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          failedIds.push(stopCommands[index].id);
          firstError ??= result.reason;
        }
      });
      return { succeededCount: results.length - failedIds.length, failedIds, firstError };
    },
    onMutate: (targetRows) => {
      setStoppingCommandIds((current) => new Set([...current, ...targetRows.map((row) => row.id)]));
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
      } else if (result.failedIds.length) {
        message.warning(`${result.succeededCount} 台停止命令已下发，${result.failedIds.length} 台失败`);
      } else {
        message.success(`${result.succeededCount} 台停止命令已下发`);
      }
      await queryClient.invalidateQueries({ queryKey: ["liveCommentEntryCommands"] });
    },
    onError: (error: Error, targetRows) => {
      setStoppingCommandIds((current) => {
        const next = new Set(current);
        targetRows.forEach((row) => next.delete(row.id));
        return next;
      });
      message.error(error.message || "停止失败");
    }
  });

  const batchRestoring = Boolean(activeBatchId && (
    commandsQuery.isPending || commandsQuery.isError || (!rows.length && commandsQuery.isFetching) ||
    (devicesQuery.isFetching && rows.length > 0 && rows.some((row) => !row.deviceCode))
  ));
  const locked = startMutation.isPending || activeRows.length > 0 || batchRestoring;
  const columns: TableColumnsType<EntryRow> = [
    {
      title: "设备",
      key: "device",
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{row.deviceName}</Typography.Text>
          <Typography.Text type="secondary">{row.deviceCode || row.deviceId}</Typography.Text>
        </Space>
      )
    },
    {
      title: "状态",
      key: "status",
      width: 110,
      render: (_, row) => <Tag color={row.viewState.color}>{row.viewState.label}</Tag>
    },
    {
      title: "当前阶段",
      key: "stage",
      width: 170,
      render: (_, row) => row.viewState.stageLabel
    },
    {
      title: "最后更新",
      key: "updatedAt",
      width: 180,
      render: (_, row) => formatDateTime(row.updatedAt || row.acknowledgedAt || row.fetchedAt || row.issuedAt)
    },
    {
      title: "阶段记录",
      key: "stageHistory",
      render: (_, row) => row.viewState.stageHistory.length ? (
        <Space size={[4, 4]} wrap>
          {row.viewState.stageHistory.map((stageHistory, index) => (
            <Tag key={`${row.id}-${index}`}>{stageHistory}</Tag>
          ))}
        </Space>
      ) : <Typography.Text type="secondary">等待阶段回执</Typography.Text>
    },
    {
      title: "结果 / 错误",
      key: "result",
      render: (_, row) => resultText(row)
    },
    {
      title: "操作",
      key: "action",
      width: 72,
      render: (_, row) => row.viewState.active ? (
        <Tooltip title="停止该设备任务">
          <Button
            danger
            size="small"
            icon={<StopOutlined />}
            aria-label={`停止 ${row.deviceName}`}
            disabled={row.viewState.key === "stopping" || !row.deviceCode}
            loading={stoppingCommandIds.has(row.id)}
            onClick={() => stopMutation.mutate([row])}
          />
        </Tooltip>
      ) : null
    }
  ];

  return (
    <div className="ops-page live-comment-entry-page">
      <div className="ops-page-header"><Typography.Title level={3}>抓取评论词</Typography.Title></div>
      <section className="ops-panel">
        <div className="ops-panel-head"><span>直播间入口设置</span></div>
        <div className="ops-panel-body">
          <Row gutter={[16, 16]} align="bottom">
            <Col xs={24} lg={8}>
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Typography.Text strong>目标直播间关键词</Typography.Text>
                <Input
                  aria-label="目标直播间关键词"
                  placeholder="请输入直播名称关键词"
                  maxLength={100}
                  value={targetKeyword}
                  disabled={locked}
                  onChange={(event) => setTargetKeyword(event.target.value)}
                />
              </Space>
            </Col>
            <Col xs={24} sm={12} lg={5}>
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Typography.Text strong>直播间人数下限（0 表示不限制）</Typography.Text>
                <InputNumber
                  aria-label="直播间人数下限"
                  min={0}
                  precision={0}
                  value={minViewerCount}
                  disabled={locked}
                  style={{ width: "100%" }}
                  onChange={(value) => setMinViewerCount(value ?? 300)}
                />
              </Space>
            </Col>
            <Col xs={24} lg={11}>
              <Space direction="vertical" size={6} style={{ width: "100%" }}>
                <Typography.Text strong>选择执行设备</Typography.Text>
                <Select
                  mode="multiple"
                  aria-label="选择执行设备"
                  placeholder="选择一台或多台在线设备"
                  value={selectedDeviceCodes}
                  disabled={locked}
                  maxCount={200}
                  style={{ width: "100%" }}
                  options={selectableDevices.map((device) => ({
                    value: device.deviceCode,
                    label: `${device.deviceName || device.deviceCode} (${device.deviceCode})`
                  }))}
                  onChange={setSelectedDeviceCodes}
                />
              </Space>
            </Col>
          </Row>
          <Space style={{ marginTop: 16 }}>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={locked || !targetKeyword.trim() || !selectedDeviceCodes.length}
              loading={startMutation.isPending}
              onClick={() => startMutation.mutate(crypto.randomUUID())}
            >开始进入直播间</Button>
            <Button
              danger
              icon={<StopOutlined />}
              disabled={!stoppableRows.length}
              loading={stopMutation.isPending || stoppingCommandIds.size > 0}
              onClick={() => stopMutation.mutate(stoppableRows)}
            >停止本批任务</Button>
          </Space>
        </div>
      </section>

      <section className="ops-panel">
        <div className="ops-panel-head">
          <span>执行进度</span>
          <span className="ops-small">{activeBatchId ? `批次 ${activeBatchId.slice(0, 8)}` : "尚未开始"}</span>
        </div>
        <div className="ops-panel-body">
          <Row gutter={[24, 16]}>
            <Col xs={12} sm={6}><Statistic title="设备总数" value={summary.total} /></Col>
            <Col xs={12} sm={6}><Statistic title="执行中" value={summary.running} /></Col>
            <Col xs={12} sm={6}><Statistic title="已进入" value={summary.entered} /></Col>
            <Col xs={12} sm={6}><Statistic title="失败" value={summary.failed} /></Col>
          </Row>
        </div>
        {commandsQuery.isError ? <Alert type="error" showIcon message="执行进度加载失败" /> : null}
        <Table<EntryRow>
          size="small"
          rowKey="id"
          loading={commandsQuery.isLoading}
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 1080 }}
          locale={{ emptyText: activeBatchId ? "等待设备领取任务" : "尚未下发任务" }}
        />
      </section>
    </div>
  );
}
