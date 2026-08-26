import { PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  App as AntdApp,
  Button,
  Col,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Typography
} from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { LiveCommentCandidates } from "../components/account-warmup/LiveCommentCandidates";
import {
  LiveCommentEntryProgress,
  liveCommentEntryResultText,
  type LiveCommentEntryRow
} from "../components/account-warmup/LiveCommentEntryProgress";
import { getDevices } from "../lib/api-client";
import {
  getLiveCommentEntryCommands,
  startLiveCommentEntryDevice,
  stopLiveCommentEntryDevice,
  type LiveCommentEntryMobileCommand
} from "../lib/api-client-live-comment-entry";
import {
  createLiveCommentEntryBatchPlan,
  dispatchLiveCommentEntryDevices,
  findUndispatchedLiveCommentEntryDevices,
  readLiveCommentEntryBatchPlan,
  withLiveCommentEntryDispatchErrors,
  writeLiveCommentEntryBatchPlan,
  type LiveCommentEntryBatchPlan
} from "../lib/live-comment-entry-batch";
import { collectLiveCommentCandidates } from "../lib/live-comment-entry-candidates";
import {
  buildLiveCommentEntryStopCommands,
  getRestoredLiveCommentEntryWarningIds,
  isLiveCommentEntryCaptureCompleted,
  readActiveLiveCommentEntryBatchId,
  readLastLiveCommentEntryInput,
  isLiveCommentEntryBatchFinished,
  resolveLiveCommentEntryState,
  resolveLiveCommentEntryStopState,
  summarizeLiveCommentEntryStates,
  writeActiveLiveCommentEntryBatchId,
  writeLastLiveCommentEntryInput
} from "../lib/live-comment-entry-form";
import type { DeviceRow } from "./DeviceList";
function hasBusinessTask(device: DeviceRow) {
  return Boolean(device.currentTask && device.currentTask !== "none");
}
function commandBatchId(command: LiveCommentEntryMobileCommand) {
  return typeof command.payloadJson?.batchId === "string" ? command.payloadJson.batchId : "";
}
function stopTargetId(command: LiveCommentEntryMobileCommand) {
  return typeof command.payloadJson?.targetCommandId === "string" ? command.payloadJson.targetCommandId : "";
}

export function LiveCommentEntryPage() {
  const initialActiveBatchId = useRef(readActiveLiveCommentEntryBatchId());
  const initialBatchPlan = useRef(readLiveCommentEntryBatchPlan(initialActiveBatchId.current));
  const initialInput = useRef(initialBatchPlan.current ?? readLastLiveCommentEntryInput());
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [activeBatchId, setActiveBatchId] = useState(initialActiveBatchId.current);
  const [batchPlan, setBatchPlan] = useState<LiveCommentEntryBatchPlan | null>(initialBatchPlan.current);
  const [targetKeyword, setTargetKeyword] = useState(initialInput.current.targetKeyword);
  const [minViewerCount, setMinViewerCount] = useState(initialInput.current.minViewerCount);
  const [selectedDeviceCodes, setSelectedDeviceCodes] = useState<string[]>([]);
  const [stoppingCommandIds, setStoppingCommandIds] = useState<Set<string>>(() => new Set());
  const [warningAlert, setWarningAlert] = useState<{ id: string; deviceName: string; message: string } | null>(null);
  const acknowledgedWarningIds = useRef(new Set<string>());
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
  // The base heartbeat is the device's reachable signal. An online base with
  // an offline inner Agent must remain selectable so the command can wake it.
  const eligibleDevices = useMemo(() => devices.filter((device) =>
    device.enabled !== false &&
    (device.effectiveStatus !== "offline" || device.baseReachable === true)), [devices]);
  const stopByTargetId = useMemo(() => {
    const map = new Map<string, LiveCommentEntryMobileCommand>();
    commands.filter((command) => command.commandType === "ACCOUNT_WARMUP_STOP" &&
      commandBatchId(command) === activeBatchId).forEach((command) => {
      const targetCommandId = stopTargetId(command);
      if (targetCommandId && !map.has(targetCommandId)) map.set(targetCommandId, command);
    });
    return map;
  }, [activeBatchId, commands]);
  const rows = useMemo<LiveCommentEntryRow[]>(() => {
    if (!activeBatchId) return [];
    const deviceById = new Map(devices.map((device) => [device.id, device]));
    const plannedDeviceById = new Map((batchPlan?.devices ?? []).map((device) => [device.deviceId, device]));
    return commands
      .filter((command) => command.commandType === "ACCOUNT_WARMUP_RUN" &&
        command.payloadJson?.featureKey === "live_comment_entry" &&
        commandBatchId(command) === activeBatchId)
      .map((command) => {
        const device = deviceById.get(command.deviceId);
        const plannedDevice = plannedDeviceById.get(command.deviceId);
        const localStopState = stoppingCommandIds.has(command.id) ? "pending" : "none";
        const persistedStopState = resolveLiveCommentEntryStopState(stopByTargetId.get(command.id));
        const effectiveStopState = persistedStopState === "none" ? localStopState : persistedStopState;
        return {
          ...command,
          deviceCode: device?.deviceCode || plannedDevice?.deviceCode || "",
          deviceName: device?.deviceName || plannedDevice?.deviceName || device?.deviceCode || command.deviceId,
          viewState: resolveLiveCommentEntryState(command, effectiveStopState)
        };
      });
  }, [activeBatchId, batchPlan, commands, devices, stopByTargetId, stoppingCommandIds]);
  const activeRows = rows.filter((row) => row.viewState.active);
  const stoppableRows = activeRows.filter((row) => row.viewState.key !== "stopping" && row.deviceCode);
  const summary = summarizeLiveCommentEntryStates(rows.map((row) => row.viewState));
  const candidates = useMemo(() => collectLiveCommentCandidates(rows), [rows]);
  const warningRows = rows.filter((row) => [
    "platform_verification",
    "viewer_count_failed",
    "viewer_threshold_exhausted",
    "live_ended_exhausted",
    "live_ended_skip_failed",
    "cleanup_failed"
  ].includes(row.viewState.key));
  const busyDeviceIds = new Set(devices.filter(hasBusinessTask).map((device) => device.id));
  const selectableDevices = eligibleDevices.filter((device) => !busyDeviceIds.has(device.id));
  const selectableCodes = useMemo(() => new Set(selectableDevices.map((device) => device.deviceCode)), [selectableDevices]);
  useEffect(() => {
    if (!activeBatchId || restoredBatchId.current === activeBatchId || devicesQuery.isPending) return;
    const plannedCodes = batchPlan?.batchId === activeBatchId
      ? batchPlan.devices.map((device) => device.deviceCode)
      : [];
    if (!plannedCodes.length && (!rows.length || rows.some((row) => !row.deviceCode))) return;
    setSelectedDeviceCodes(plannedCodes.length ? plannedCodes : rows.map((row) => row.deviceCode).filter(Boolean));
    getRestoredLiveCommentEntryWarningIds(warningRows, initialActiveBatchId.current, activeBatchId)
      .forEach((id) => acknowledgedWarningIds.current.add(id));
    restoredBatchId.current = activeBatchId;
  }, [activeBatchId, batchPlan, devicesQuery.isPending, rows, warningRows]);
  useEffect(() => {
    if (!stopByTargetId.size) return;
    setStoppingCommandIds((current) => {
      const next = new Set([...current].filter((id) => !stopByTargetId.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [stopByTargetId]);
  useEffect(() => {
    const row = warningRows.find((item) => !acknowledgedWarningIds.current.has(item.id));
    if (!row) return;
    acknowledgedWarningIds.current.add(row.id);
    setWarningAlert({
      id: row.id,
      deviceName: row.deviceName || row.deviceCode || row.deviceId,
      message: liveCommentEntryResultText(row)
    });
  }, [warningRows]);
  useEffect(() => {
    if (activeRows.length) return;
    setSelectedDeviceCodes((current) => {
      const next = current.filter((deviceCode) => selectableCodes.has(deviceCode));
      return next.length === current.length ? current : next;
    });
  }, [activeRows.length, selectableCodes]);

  const startMutation = useMutation({
    mutationFn: async (input: { batch: LiveCommentEntryBatchPlan; deviceCodes: string[]; retry: boolean }) => {
      let deviceCodes = input.deviceCodes;
      if (input.retry) {
        const latest = await commandsQuery.refetch();
        if (latest.isError) throw latest.error;
        const runCommands = (latest.data ?? []).filter((command) => command.commandType === "ACCOUNT_WARMUP_RUN" &&
          command.payloadJson?.featureKey === "live_comment_entry" && commandBatchId(command) === input.batch.batchId);
        const missingCodes = new Set(findUndispatchedLiveCommentEntryDevices(input.batch, runCommands)
          .map((device) => device.deviceCode));
        deviceCodes = deviceCodes.filter((deviceCode) => missingCodes.has(deviceCode));
        if (!deviceCodes.length) return { ...input, attemptedCount: 0, succeededCount: 0, failures: [] };
      }
      const result = await dispatchLiveCommentEntryDevices({
        batch: input.batch,
        deviceCodes,
        send: (command) => startLiveCommentEntryDevice({ deviceId: command.deviceId, payload: command.payload })
      });
      return { ...input, ...result };
    },
    onMutate: (input) => {
      if (input.retry) return;
      setActiveBatchId(input.batch.batchId);
      setBatchPlan(input.batch);
      setStoppingCommandIds(new Set<string>());
      restoredBatchId.current = "";
      writeActiveLiveCommentEntryBatchId(input.batch.batchId);
      writeLiveCommentEntryBatchPlan(input.batch);
    },
    onSuccess: async (result) => {
      const nextBatch = withLiveCommentEntryDispatchErrors(result.batch, result.failures);
      setBatchPlan(nextBatch);
      writeLiveCommentEntryBatchPlan(nextBatch);
      writeLastLiveCommentEntryInput(result.batch);
      if (!result.attemptedCount) message.info("设备任务已存在，无需重复下发");
      else if (result.failures.length) message.warning(`${result.succeededCount} 台已下发，${result.failures.length} 台失败`);
      else message.success(`${result.succeededCount} 台进入直播间任务已下发`);
      await queryClient.invalidateQueries({ queryKey: ["liveCommentEntryCommands"] });
    },
    onError: (error: Error) => message.error(error.message || "任务下发失败")
  });

  const stopMutation = useMutation({
    mutationFn: async (targetRows: LiveCommentEntryRow[]) => {
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

  const dispatchFailures = useMemo(() => {
    if (!batchPlan || batchPlan.batchId !== activeBatchId || !commandsQuery.isSuccess || startMutation.isPending) return [];
    return findUndispatchedLiveCommentEntryDevices(batchPlan, rows);
  }, [activeBatchId, batchPlan, commandsQuery.isSuccess, rows, startMutation.isPending]);
  const deviceTotal = batchPlan?.batchId === activeBatchId ? batchPlan.devices.length : summary.total;
  const batchFinished = batchPlan?.batchId === activeBatchId
    ? !dispatchFailures.length && rows.length >= deviceTotal && isLiveCommentEntryBatchFinished(rows.map((row) => row.viewState))
    : isLiveCommentEntryBatchFinished(rows.map((row) => row.viewState));
  const batchRestoring = Boolean(activeBatchId && (
    commandsQuery.isPending || commandsQuery.isError || (!rows.length && commandsQuery.isFetching) ||
    (devicesQuery.isFetching && rows.length > 0 && rows.some((row) => !row.deviceCode))
  ));
  const locked = startMutation.isPending || activeRows.length > 0 || batchRestoring;

  function startNewBatch() {
    const deviceByCode = new Map(devices.map((device) => [device.deviceCode, device]));
    const batch = createLiveCommentEntryBatchPlan({
      batchId: crypto.randomUUID(),
      targetKeyword,
      minViewerCount,
      devices: selectedDeviceCodes.map((deviceCode) => {
        const device = deviceByCode.get(deviceCode);
        return {
          deviceCode,
          deviceId: device?.id || deviceCode,
          deviceName: device?.deviceName || deviceCode
        };
      })
    });
    startMutation.mutate({ batch, deviceCodes: batch.devices.map((device) => device.deviceCode), retry: false });
  }

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
              onClick={startNewBatch}
            >开始抓取评论</Button>
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

      <LiveCommentEntryProgress
        activeBatchId={activeBatchId}
        rows={rows}
        deviceTotal={deviceTotal}
        dispatchFailures={dispatchFailures}
        warningRows={warningRows}
        warningAlert={warningAlert}
        loading={commandsQuery.isLoading}
        loadError={commandsQuery.isError}
        stoppingCommandIds={stoppingCommandIds}
        retryingDispatch={startMutation.isPending}
        onRetryDispatch={() => batchPlan && startMutation.mutate({
          batch: batchPlan,
          deviceCodes: dispatchFailures.map((device) => device.deviceCode),
          retry: true
        })}
        onStop={(row) => stopMutation.mutate([row])}
        onCloseWarning={() => setWarningAlert(null)}
      />
      <LiveCommentCandidates
        key={activeBatchId || "no-batch"}
        batchId={activeBatchId}
        candidates={candidates}
        batchFinished={batchFinished}
        deviceTotal={deviceTotal}
        capturedCount={rows.filter(isLiveCommentEntryCaptureCompleted).length}
        failedCount={summary.failed + dispatchFailures.length}
      />
    </div>
  );
}
