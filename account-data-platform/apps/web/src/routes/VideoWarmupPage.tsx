import { PlayCircleOutlined, StopOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { App as AntdApp, Button, Checkbox, Input, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDevices } from "../lib/api-client";
import { agentDisconnectMessage, claimAgentDisconnectNotice, isAgentCommandChannelOpen } from "../lib/agent-command-channel";
import {
  getAccountWarmupCommands,
  startAccountWarmupDevice,
  stopVideoWarmupDevice,
  type AccountWarmupMobileCommand
} from "../lib/api-client-account-warmup";
import {
  buildVideoWarmupCommands,
  buildVideoWarmupStopCommands,
  dispatchAccountWarmupCommands,
  dispatchAccountWarmupStops,
  readActiveVideoWarmupBatchId,
  readLastVideoWarmupKeyword,
  readVideoWarmupDeviceKeywords,
  resolveVideoWarmupCommandState,
  selectOnlineVideoWarmupDevices,
  shouldClearVideoWarmupBatch,
  videoWarmupDeviceName,
  writeActiveVideoWarmupBatchId,
  writeLastVideoWarmupKeyword,
  writeVideoWarmupDeviceKeyword
} from "../lib/account-warmup-form";
import type { DeviceRow } from "./DeviceList";

type VideoWarmupRow = AccountWarmupMobileCommand & {
  deviceCode: string;
  deviceName: string;
  agentReachable?: boolean;
};

function hasReportedTask(device: DeviceRow) {
  return Boolean(device.currentTask && device.currentTask !== "none");
}

export function VideoWarmupPage() {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const [activeBatchId, setActiveBatchId] = useState(readActiveVideoWarmupBatchId);
  const [targetKeyword, setTargetKeyword] = useState(readLastVideoWarmupKeyword);
  const [deviceKeywords, setDeviceKeywords] = useState<Record<string, string>>(readVideoWarmupDeviceKeywords);
  const [selectedDeviceCodes, setSelectedDeviceCodes] = useState<string[]>([]);
  const [stoppingCommandIds, setStoppingCommandIds] = useState<Set<string>>(() => new Set());
  const restoredBatchId = useRef("");
  const agentNoticeKeys = useRef(new Set<string>());
  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    refetchInterval: 3_000
  });
  const commandsQuery = useQuery({
    queryKey: ["videoWarmupCommands"],
    queryFn: getAccountWarmupCommands,
    refetchInterval: 3_000
  });
  const devices = (devicesQuery.data ?? []) as DeviceRow[];
  const commands = commandsQuery.data ?? [];
  const onlineDevices = useMemo(() => selectOnlineVideoWarmupDevices(devices), [devices]);

  const batchRows = useMemo<VideoWarmupRow[]>(() => {
    if (!activeBatchId) return [];
    const deviceById = new Map(devices.map((device) => [device.id, device]));
    return commands
      .filter((command) => command.commandType === "ACCOUNT_WARMUP_RUN" &&
        command.payloadJson?.featureKey === "video_warmup" &&
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
  }, [activeBatchId, commands, devices]);

  const videoStopCommands = useMemo(() => commands.filter((command) =>
    command.commandType === "VIDEO_WARMUP_STOP" &&
    command.payloadJson?.featureKey === "video_warmup" &&
    command.payloadJson?.batchId === activeBatchId), [activeBatchId, commands]);
  const stateFor = (row: VideoWarmupRow) => {
    const restored = resolveVideoWarmupCommandState(row, videoStopCommands, activeBatchId);
    const device = devices.find((item) => item.id === row.deviceId);
    if (device && !isAgentCommandChannelOpen(device) && !["stopped", "failed", "completed", "expired"].includes(restored.key)) {
      return { key: "agent_disconnected", label: "Agent 已停止", color: "default", active: false };
    }
    return stoppingCommandIds.has(row.id) && restored.active
      ? { key: "stopping", label: "停止中", color: "warning", active: true }
      : restored;
  };
  const activeRows = batchRows.filter((row) => stateFor(row).active && row.agentReachable !== false);
  const stoppableRows = activeRows.filter((row) => stateFor(row).key !== "stopping" && row.agentReachable !== false);
  const busyDeviceIds = new Set(devices.filter(hasReportedTask).map((device) => device.id));
  const selectableDevices = onlineDevices.filter((device) => !busyDeviceIds.has(device.id) && isAgentCommandChannelOpen(device));
  const selectableCodes = selectableDevices.map((device) => device.deviceCode);
  const batchRestoring = Boolean(activeBatchId && commandsQuery.isPending);
  const batchTerminal = shouldClearVideoWarmupBatch(batchRows.map((row) =>
    resolveVideoWarmupCommandState(row, videoStopCommands, activeBatchId)));

  useEffect(() => {
    devices.forEach((device) => {
      const closed = !isAgentCommandChannelOpen(device);
      const key = `${device.id}:${device.agentLifecycleState || device.agentStatus || "unknown"}:${device.agentSessionId || ""}`;
      if (closed && claimAgentDisconnectNotice(device) && !agentNoticeKeys.current.has(key)) {
        agentNoticeKeys.current.add(key);
        const notice = agentDisconnectMessage(device);
        message.info(`${notice.title}：${notice.description}${notice.recovery}`);
      }
      if (!closed) {
        [...agentNoticeKeys.current].filter((item) => item.startsWith(`${device.id}:`)).forEach((item) => agentNoticeKeys.current.delete(item));
      }
    });
  }, [devices, message]);

  useEffect(() => {
    if (!activeBatchId || !batchRows.length || restoredBatchId.current === activeBatchId) return;
    const onlineCodes = new Set(onlineDevices.map((device) => device.deviceCode));
    const restoredCodes = activeRows.map((row) => row.deviceCode).filter((code) => code && onlineCodes.has(code));
    setSelectedDeviceCodes(restoredCodes);
    restoredBatchId.current = activeBatchId;
  }, [activeBatchId, activeRows, batchRows.length, onlineDevices]);

  useEffect(() => {
    if (!activeBatchId || commandsQuery.isPending || !batchTerminal) return;
    setActiveBatchId("");
    writeActiveVideoWarmupBatchId("");
    setSelectedDeviceCodes([]);
    restoredBatchId.current = "";
  }, [activeBatchId, batchTerminal, commandsQuery.isPending]);

  useEffect(() => {
    const persistedDeviceIds = new Set(videoStopCommands.map((command) => command.deviceId));
    setStoppingCommandIds((current) => {
      const next = new Set([...current].filter((id) => {
        const row = batchRows.find((item) => item.id === id);
        return row ? !persistedDeviceIds.has(row.deviceId) : false;
      }));
      return next.size === current.size ? current : next;
    });
  }, [batchRows, videoStopCommands]);

  const startMutation = useMutation({
    mutationFn: async () => {
      const batchId = crypto.randomUUID();
      const normalizedKeyword = targetKeyword.trim();
      if (!normalizedKeyword) throw new Error("请输入搜索关键词");
      const taskCommands = buildVideoWarmupCommands({
        batchId,
        targetKeyword: normalizedKeyword,
        deviceCodes: selectedDeviceCodes,
        deviceKeywords
      });
      if (!taskCommands.length) throw new Error("请至少选择一台可用设备");
      const result = await dispatchAccountWarmupCommands(taskCommands, (command) =>
        startAccountWarmupDevice({ deviceId: command.deviceId, payload: command.payload }));
      if (!result.succeededCount) {
        throw result.firstError instanceof Error ? result.firstError : new Error("视频养号任务下发失败");
      }
      return { batchId, ...result };
    },
    onSuccess: async (result) => {
      setActiveBatchId(result.batchId);
      writeActiveVideoWarmupBatchId(result.batchId);
      if (result.failedCount) message.warning(`${result.succeededCount} 台已下发，${result.failedCount} 台失败`);
      else message.success(`${result.succeededCount} 台视频养号任务已下发`);
      await queryClient.invalidateQueries({ queryKey: ["videoWarmupCommands"] });
    },
    onError: (error: Error) => message.error(error.message || "视频养号启动失败")
  });

  const stopMutation = useMutation({
    mutationFn: async (rows: VideoWarmupRow[]) => {
      const rowByCode = new Map(rows.map((row) => [row.deviceCode, row]));
      const commandsToDispatch = buildVideoWarmupStopCommands({ batchId: activeBatchId, rows })
        .map((command) => ({ ...command, id: rowByCode.get(command.deviceId)?.id ?? command.deviceId }));
      return dispatchAccountWarmupStops(commandsToDispatch, (command) => stopVideoWarmupDevice({
        deviceId: command.deviceId,
        payload: command.payload
      }));
    },
    onMutate: (rows) => {
      setStoppingCommandIds((current) => new Set([...current, ...rows.map((row) => row.id)]));
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
        message.warning(`${result.succeededCount} 台停止命令已下发，${result.failedCount} 台失败`);
      } else {
        message.success(`${result.succeededCount} 台停止命令已下发`);
      }
      await queryClient.invalidateQueries({ queryKey: ["videoWarmupCommands"] });
    },
    onError: (error: Error, rows) => {
      setStoppingCommandIds((current) => {
        const next = new Set(current);
        rows.forEach((row) => next.delete(row.id));
        return next;
      });
      message.error(error.message || "视频养号停止失败");
    }
  });

  const rowByDeviceId = new Map(activeRows.map((row) => [row.deviceId, row]));
  const allSelected = selectableCodes.length > 0 && selectableCodes.every((code) => selectedDeviceCodes.includes(code));
  const partiallySelected = !allSelected && selectableCodes.some((code) => selectedDeviceCodes.includes(code));
  const batchStopping = activeRows.some((row) => stateFor(row).key === "stopping");
  const selectionLocked = startMutation.isPending || batchRestoring || activeRows.length > 0;

  function toggleDevice(deviceCode: string, checked: boolean) {
    setSelectedDeviceCodes((current) => checked
      ? [...new Set([...current, deviceCode])]
      : current.filter((code) => code !== deviceCode));
  }

  function updateTargetKeyword(value: string) {
    setTargetKeyword(value);
    writeLastVideoWarmupKeyword(value);
  }

  function updateDeviceKeyword(deviceCode: string, value: string) {
    setDeviceKeywords((current) => {
      const next = { ...current };
      if (value) next[deviceCode] = value;
      else delete next[deviceCode];
      return next;
    });
    writeVideoWarmupDeviceKeyword(deviceCode, value);
  }

  return (
    <div className="ops-page video-warmup-page">
      <div className="ops-page-header"><Typography.Title level={3}>视频养号</Typography.Title></div>
      <section className="ops-panel">
        <div className="ops-panel-head"><span>执行设备</span></div>
        <div className="ops-panel-body">
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Typography.Text strong>搜索关键词</Typography.Text>
            <Input
              aria-label="视频养号搜索关键词"
              placeholder="请输入视频搜索关键词"
              value={targetKeyword}
              maxLength={100}
              disabled={selectionLocked}
              onChange={(event) => updateTargetKeyword(event.target.value)}
            />
            <Checkbox
              checked={allSelected}
              indeterminate={partiallySelected}
              disabled={selectionLocked || !selectableCodes.length}
              onChange={(event) => setSelectedDeviceCodes(event.target.checked ? selectableCodes : [])}
            >全选可用设备</Checkbox>
            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              {onlineDevices.map((device) => {
                const row = rowByDeviceId.get(device.id);
                const available = isAgentCommandChannelOpen(device);
                const busy = busyDeviceIds.has(device.id) && !row;
                const rowState = row ? stateFor(row) : null;
                const displayName = videoWarmupDeviceName(device);
                const status = row
                  ? rowState!
                  : { label: busy ? "任务占用" : available ? "可用" : "Agent 已停止", color: busy ? "warning" : available ? "success" : "default" };
                return (
                  <Space key={device.id} size="middle" wrap>
                    <Checkbox
                      checked={selectedDeviceCodes.includes(device.deviceCode)}
                      disabled={selectionLocked || !available || busy}
                      onChange={(event) => toggleDevice(device.deviceCode, event.target.checked)}
                    />
                    <Typography.Text strong>{displayName}</Typography.Text>
                    <Typography.Text type="secondary">{device.deviceCode}</Typography.Text>
                    <Input
                      aria-label={`${displayName}视频养号关键词`}
                      placeholder="留空使用统一关键词"
                      value={deviceKeywords[device.deviceCode] ?? ""}
                      maxLength={100}
                      disabled={selectionLocked || busy}
                      style={{ width: 200 }}
                      onChange={(event) => updateDeviceKeyword(device.deviceCode, event.target.value)}
                      onBlur={(event) => updateDeviceKeyword(device.deviceCode, event.target.value.trim())}
                    />
                    <Tag color={status.color}>{status.label}</Tag>
                    {row && rowState?.active && (
                      <Button
                        danger
                        size="small"
                        icon={<StopOutlined />}
                        title={`停止 ${device.deviceName || device.deviceCode}`}
                        aria-label={`停止 ${device.deviceName || device.deviceCode}`}
                        disabled={rowState.key === "stopping"}
                        loading={stoppingCommandIds.has(row.id)}
                        onClick={() => stopMutation.mutate([row])}
                      />
                    )}
                  </Space>
                );
              })}
              {!devices.length && <Typography.Text type="secondary">暂无接入设备</Typography.Text>}
            </Space>
            <Typography.Text>已选择 {selectedDeviceCodes.length} 台设备</Typography.Text>
            <Space>
              <Button
                type="primary"
                icon={<PlayCircleOutlined />}
                disabled={selectionLocked || !selectedDeviceCodes.length || !targetKeyword.trim()}
                loading={startMutation.isPending}
                onClick={() => startMutation.mutate()}
              >启动所选设备</Button>
              <Button
                danger
                icon={<StopOutlined />}
                disabled={!stoppableRows.length || batchStopping}
                loading={batchStopping}
                onClick={() => stopMutation.mutate(stoppableRows)}
              >停止本批任务</Button>
            </Space>
          </Space>
        </div>
      </section>
    </div>
  );
}
