import { CommentOutlined, PauseCircleOutlined, PlayCircleOutlined, PlaySquareOutlined, SettingOutlined, ShopOutlined, StopOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Form, Input, Modal, Select } from "antd";
import { useMemo, useState } from "react";
import {
  createTaskAssignment,
  createTaskAssignmentCommand,
  getCommerceCardExecutionApprovals,
  getDevices,
  getLiveCommentActions,
  getLiveTargets,
  getTaskAssignmentEvents,
  getTaskAssignments,
  resolveLiveCommentAction,
  type CommerceCardExecutionApproval,
  type LiveCommentAction,
  type LiveTarget,
  type TaskAssignment
} from "../lib/api-client";
import { deviceDisplayName, deviceSubTitle } from "../lib/display-maps";
import { DeviceLiveCommentConfigModal } from "./DeviceLiveCommentConfigModal";

type TaskType = "video" | "live" | "live_comment" | "commerce_card_live_comment";
type CommandType = "START" | "RESUME" | "PAUSE" | "STOP";

type DeviceRow = {
  id?: string;
  deviceCode: string;
  deviceName?: string;
  douyinAccountName?: string | null;
  platform?: string | null;
  deviceGroup?: string | null;
  group?: string | null;
  effectiveStatus?: string;
  status?: string;
  reportedStatus?: string;
  currentTask?: string;
  lastHeartbeatAt?: string | null;
  heartbeatAgeMinutes?: number | null;
  enabled?: boolean;
  latestHeartbeat?: {
    status?: string;
    sceneType?: string | null;
    lastMessage?: string | null;
    rawPayload?: Record<string, unknown> | null;
    reportedAt?: string | null;
  } | null;
};

type CommerceStartFormValues = {
  targetId: string;
  expectedAccountName: string;
  executionApprovalId?: string;
};

type ResolveActionFormValues = {
  resolution: "sent" | "failed";
  evidence: string;
};

type DeviceTaskState = {
  device: DeviceRow;
  assignment?: TaskAssignment;
  deviceCode: string;
  deviceName?: string;
  douyinAccountName?: string | null;
  actualTask?: string;
  lastHeartbeatAt?: string | null;
  deviceStatus?: string;
};

type Notice = {
  kind: "success" | "error" | "info";
  text: string;
} | null;

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function isTaskType(value?: string | null): value is TaskType {
  return value === "video" || value === "live" || value === "live_comment" || value === "commerce_card_live_comment";
}

function taskTypeText(value?: string | null) {
  if (value === "video") return "视频";
  if (value === "live") return "直播";
  if (value === "live_comment") return "搜索直播间评论";
  if (value === "commerce_card_live_comment") return "商品卡直播评论";
  if (value === "none") return "待命";
  return value || "未知";
}

function taskTypeTone(value?: string | null) {
  if (value === "live_comment") return "purple";
  if (value === "commerce_card_live_comment") return "amber";
  if (value === "live") return "green";
  if (value === "video") return "blue";
  return "gray";
}

function assignmentStatusText(value?: string | null) {
  const map: Record<string, string> = {
    PENDING: "待下发",
    DISPATCHED: "已下发",
    RUNNING: "执行中",
    PAUSING: "暂停中",
    PAUSED: "已暂停",
    RESUMING: "恢复中",
    BLOCKED: "待人工处理",
    SUCCEEDED: "已完成",
    CANCELLED: "已取消",
    EXPIRED: "已过期",
    FAILED: "失败"
  };
  return value ? (map[value] ?? value) : "未分配";
}

function assignmentStatusTone(value?: string | null) {
  if (value === "RUNNING" || value === "SUCCEEDED") return "green";
  if (value === "PENDING" || value === "DISPATCHED" || value === "PAUSING" || value === "PAUSED" || value === "RESUMING") return "amber";
  if (value === "FAILED") return "red";
  if (value === "BLOCKED") return "red";
  if (value === "CANCELLED" || value === "EXPIRED") return "gray";
  return "gray";
}

function detailStatusText(value?: string | null) {
  if (value === "RUNNING") return "执行中";
  if (value === "PENDING" || value === "DISPATCHED") return "等待确认";
  if (value === "PAUSING") return "暂停中";
  if (value === "PAUSED") return "已暂停";
  if (value === "RESUMING") return "恢复中";
  if (value === "BLOCKED") return "待人工处理";
  if (value === "SUCCEEDED") return "已完成";
  if (value === "FAILED") return "失败";
  if (value === "CANCELLED" || value === "EXPIRED") return "已结束";
  return "未分配";
}

function commandText(value?: string | null) {
  if (value === "START") return "启动";
  if (value === "RESUME") return "恢复";
  if (value === "PAUSE") return "暂停";
  if (value === "STOP") return "停止";
  return value || "-";
}

function commandStatusText(value?: string | null) {
  const map: Record<string, string> = {
    PENDING: "等待领取",
    SENT: "手机已领取",
    ACKED: "手机已回执",
    DONE: "执行完成",
    FAILED: "执行失败",
    EXPIRED: "已过期"
  };
  return value ? (map[value] ?? value) : "等待领取";
}

function commandStatusTone(value?: string | null) {
  if (value === "DONE" || value === "ACKED") return "green";
  if (value === "FAILED") return "red";
  if (value === "SENT") return "blue";
  if (value === "PENDING") return "amber";
  return "gray";
}

function isActiveAssignment(value?: string | null) {
  return ["PENDING", "DISPATCHED", "RUNNING", "PAUSING", "PAUSED", "RESUMING", "BLOCKED"].includes(value || "");
}

function startBlockedMessage(value?: string | null) {
  return `当前任务为${assignmentStatusText(value)}，请先停止并等待任务进入已取消、已完成、失败或已过期状态。`;
}

function taskAssignmentCommandIdempotencyKey(assignmentId: string, commandType: Exclude<CommandType, "START">, stateVersion: number) {
  return `admin:${assignmentId}:${commandType.toLowerCase()}:state:${stateVersion}`;
}

function commentActionStateText(value?: string | null) {
  if (value === "submitted") return "已提交待确认";
  if (value === "unknown") return "结果未知";
  return value || "待确认";
}

function taskTypeForControl(row?: DeviceTaskState | null): TaskType {
  if (isTaskType(row?.assignment?.taskType)) return row.assignment.taskType;
  if (isTaskType(row?.actualTask)) return row.actualTask;
  return "video";
}

function hasTaskMismatch(row?: DeviceTaskState | null) {
  if (!isTaskType(row?.assignment?.taskType) || !isTaskType(row?.actualTask)) return false;
  return row.assignment.taskType !== row.actualTask;
}

function taskMismatchText(row?: DeviceTaskState | null) {
  if (!hasTaskMismatch(row)) return "任务一致";
  return `任务不一致：安排 ${taskTypeText(row?.assignment?.taskType)}，实际 ${taskTypeText(row?.actualTask)}`;
}

function taskConsistencyText(row?: DeviceTaskState | null) {
  if (!isTaskType(row?.assignment?.taskType) || !isTaskType(row?.actualTask)) return "待确认";
  return taskMismatchText(row);
}

function taskConsistencyTone(row?: DeviceTaskState | null) {
  if (!isTaskType(row?.assignment?.taskType) || !isTaskType(row?.actualTask)) return "gray";
  return hasTaskMismatch(row) ? "red" : "green";
}

function actualTaskFromDevice(device?: DeviceRow | null) {
  if (!device) return "";
  const raw = device.latestHeartbeat?.rawPayload || {};
  const rawTaskType = typeof raw.currentTaskType === "string" ? raw.currentTaskType : "";
  if (rawTaskType) return rawTaskType;
  if (device.currentTask && device.currentTask !== "none") return device.currentTask;
  return device.latestHeartbeat?.sceneType || "";
}

function relativeHeartbeat(device?: DeviceRow | null) {
  if (!device?.lastHeartbeatAt) return "从未上报";
  if (typeof device.heartbeatAgeMinutes === "number") {
    if (device.heartbeatAgeMinutes <= 0) return "刚刚";
    if (device.heartbeatAgeMinutes < 60) return `${device.heartbeatAgeMinutes} 分钟`;
    return `${Math.floor(device.heartbeatAgeMinutes / 60)} 小时`;
  }
  return formatDateTime(device.lastHeartbeatAt);
}

function heartbeatLine(row: DeviceTaskState) {
  const isOffline = ["offline", "stopped", "error"].includes(row.deviceStatus || "");
  return `${isOffline ? "离线" : "在线"} ${relativeHeartbeat(row.device)}`;
}

function quickReason(taskType: TaskType, commandType: CommandType) {
  if (commandType === "STOP") return "手动停止当前分配";
  if (commandType === "PAUSE") return "手动暂停当前分配";
  if (commandType === "RESUME") return "手动恢复当前分配";
  if (taskType === "live_comment") return "手动切到搜索直播间评论";
  if (taskType === "commerce_card_live_comment") return "手动切到商品卡直播评论";
  if (taskType === "live") return "手动切到直播";
  return "手动切到视频";
}

function compactText(value?: string | null, fallback = "-") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.length > 58 ? `${text.slice(0, 58)}...` : text;
}

function latestCommandTime(assignment?: TaskAssignment | null) {
  return assignment?.commandFetchedAt
    || assignment?.commandAcknowledgedAt
    || assignment?.issuedAt
    || assignment?.createdAt
    || null;
}

function targetContextText(value?: string | null) {
  if (value === "target_live_room_context") return "指定直播间";
  if (value === "live_room_context") return "直播间";
  if (value === "video_context") return "视频采集";
  if (value === "live_context") return "直播采集";
  if (value === "comment_context" || value === "live_comment_context") return "搜索直播间评论";
  if (value === "commerce_card_live_context" || value === "commerce_card_live_comment_context") return "商品卡直播评论";
  return value || "-";
}

function sourceText(value?: string | null) {
  if (value === "manual") return "手动调整";
  if (value === "scheduler") return "自动调度";
  if (value === "system") return "系统下发";
  if (value === "recommendation") return "调度建议";
  return value || "-";
}

function reasonText(value?: string | null) {
  if (!value) return "-";
  if (value === "manual" || value === "manual_assignment") return "手动调整";
  if (value === "no_active_assignment") return "暂无活跃任务";
  return value;
}

function stageText(value?: string | null) {
  if (value === "product_nurture") return "商品卡养号";
  if (value === "target_comment") return "目标评论";
  if (value === "live_nurture") return "直播养号2";
  return value || "-";
}

function eventText(value?: string | null) {
  const map: Record<string, string> = {
    assignment_command_start: "启动命令已下发",
    assignment_command_pause: "暂停命令已下发",
    assignment_command_resume: "恢复命令已下发",
    assignment_command_stop: "停止命令已下发",
    commerce_card_workflow_started: "组合任务开始",
    stage_product_nurture_started: "商品卡养号开始",
    stage_product_nurture_completed: "商品卡养号完成",
    stage_target_comment_started: "目标评论开始",
    stage_target_comment_completed: "目标评论完成",
    stage_live_nurture_started: "直播养号2开始",
    stage_live_nurture_completed: "直播养号2完成",
    comment_unknown: "评论结果未知",
    assignment_completed: "任务结束"
  };
  return value ? (map[value] || value) : "运行事件";
}

export function TaskSchedulerPage() {
  const queryClient = useQueryClient();
  const [commerceStartForm] = Form.useForm<CommerceStartFormValues>();
  const [resolveActionForm] = Form.useForm<ResolveActionFormValues>();
  const selectedCommerceTargetId = Form.useWatch("targetId", commerceStartForm);
  const [deviceKeyword, setDeviceKeyword] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>();
  const [selectedDeviceCode, setSelectedDeviceCode] = useState<string>();
  const [configOpen, setConfigOpen] = useState(false);
  const [configDeviceState, setConfigDeviceState] = useState<DeviceTaskState | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [commerceStartOpen, setCommerceStartOpen] = useState(false);
  const [commerceStartDevice, setCommerceStartDevice] = useState<DeviceTaskState | null>(null);
  const [resolveAction, setResolveAction] = useState<LiveCommentAction | null>(null);

  const devicesQuery = useQuery({ queryKey: ["devices"], queryFn: getDevices, refetchInterval: 15000 });
  const assignmentsQuery = useQuery({ queryKey: ["task-assignments"], queryFn: getTaskAssignments, refetchInterval: 10000 });
  const liveTargetsQuery = useQuery({ queryKey: ["liveTargets", "scheduler"], queryFn: () => getLiveTargets("douyin") });
  const approvalsQuery = useQuery({ queryKey: ["commerceCardExecutionApprovals"], queryFn: getCommerceCardExecutionApprovals });
  const assignmentEventsQuery = useQuery({
    queryKey: ["task-assignment-events", selectedAssignmentId],
    queryFn: () => getTaskAssignmentEvents(selectedAssignmentId || ""),
    enabled: Boolean(selectedAssignmentId),
    refetchInterval: selectedAssignmentId ? 10000 : false
  });
  const mutation = useMutation({
    mutationFn: (values: {
      deviceId: string;
      taskType: TaskType;
      commandType: CommandType;
      assignmentId?: string;
      stateVersion?: number;
      workflowVersion?: 1 | 2;
      targetId?: string;
      executionApprovalId?: string | null;
      expectedAccountName?: string | null;
      reason?: string;
      priority?: number;
    }) => values.commandType === "START"
      ? createTaskAssignment({
        ...values,
        source: "manual",
        priority: values.priority ?? 100,
        expiresInSeconds: values.workflowVersion === 2 ? 28800 : 3600
      })
      : createTaskAssignmentCommand(values.assignmentId || "", {
        commandType: values.commandType,
        expectedStateVersion: values.stateVersion || 0,
        commandIdempotencyKey: taskAssignmentCommandIdempotencyKey(
          values.assignmentId || "",
          values.commandType,
          values.stateVersion || 0
        ),
        reason: values.reason,
        priority: values.priority ?? 100,
        expiresInSeconds: 3600
      }),
    onSuccess: async () => {
      setNotice({ kind: "success", text: "任务已下发，等待手机领取并通过心跳确认。" });
      setCommerceStartOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["devices"] }),
        queryClient.invalidateQueries({ queryKey: ["task-assignment-events"] })
      ]);
    },
    onError: (error: Error) => setNotice({ kind: "error", text: error.message })
  });
  const devices = useMemo(() => (devicesQuery.data ?? []) as DeviceRow[], [devicesQuery.data]);
  const assignments = useMemo(() => assignmentsQuery.data ?? [], [assignmentsQuery.data]);
  const commerceTargets = useMemo(() => (liveTargetsQuery.data ?? []).filter((target: LiveTarget) =>
    target.enabled && target.featureConfigs.some((feature) =>
      feature.featureType === "commerce_card_live_comment" && feature.enabled && feature.storedWorkflowVersion === 2
    )
  ), [liveTargetsQuery.data]);
  const approvals = useMemo(() => approvalsQuery.data ?? [], [approvalsQuery.data]);
  const availableApprovals = useMemo(() => approvals.filter((approval: CommerceCardExecutionApproval) =>
    approval.effectiveStatus === "ACTIVE" &&
    approval.remainingQuota > 0 &&
    approval.targetId === selectedCommerceTargetId &&
    approval.deviceCode === commerceStartDevice?.deviceCode
  ), [approvals, commerceStartDevice?.deviceCode, selectedCommerceTargetId]);
  const assignmentEvents = useMemo(
    () => assignmentEventsQuery.data ?? [],
    [assignmentEventsQuery.data]
  );
  const assignmentByDeviceCode = useMemo(() => {
    const map = new Map<string, TaskAssignment>();
    assignments.forEach((item) => {
      const code = item.deviceCode || "";
      if (!code) return;
      const current = map.get(code);
      if (!current || (isActiveAssignment(item.status) && !isActiveAssignment(current.status))) {
        map.set(code, item);
      }
    });
    return map;
  }, [assignments]);
  const deviceTaskRows = useMemo<DeviceTaskState[]>(() => devices.map((device) => {
    const assignment = assignmentByDeviceCode.get(device.deviceCode);
    return {
      device,
      assignment,
      deviceCode: device.deviceCode,
      deviceName: device.deviceName,
      douyinAccountName: device.douyinAccountName,
      actualTask: actualTaskFromDevice(device),
      lastHeartbeatAt: device.latestHeartbeat?.reportedAt || device.lastHeartbeatAt,
      deviceStatus: device.effectiveStatus || device.status
    };
  }), [assignmentByDeviceCode, devices]);
  const filteredDeviceTaskRows = useMemo(() => deviceTaskRows.filter((item) => {
    const deviceText = `${item.douyinAccountName || ""} ${item.deviceName || ""} ${item.deviceCode || ""}`.toLowerCase();
    if (deviceKeyword && !deviceText.includes(deviceKeyword.toLowerCase())) return false;
    if (taskFilter === "none" && item.assignment) return false;
    if (taskFilter && taskFilter !== "none" && item.assignment?.taskType !== taskFilter) return false;
    if (statusFilter && item.assignment?.status !== statusFilter && item.deviceStatus !== statusFilter) return false;
    return true;
  }), [deviceKeyword, deviceTaskRows, statusFilter, taskFilter]);
  const selectedAssignment = useMemo(
    () => assignments.find((item) => item.id === selectedAssignmentId) ?? null,
    [assignments, selectedAssignmentId]
  );
  const selectedDeviceState = useMemo(
    () => filteredDeviceTaskRows.find((item) => item.deviceCode === selectedDeviceCode)
      ?? (selectedAssignment ? filteredDeviceTaskRows.find((item) => item.deviceCode === selectedAssignment.deviceCode) : null)
      ?? filteredDeviceTaskRows[0]
      ?? null,
    [filteredDeviceTaskRows, selectedAssignment, selectedDeviceCode]
  );
  const detailAssignment = selectedAssignment ?? selectedDeviceState?.assignment ?? null;
  const commentActionsQuery = useQuery({
    queryKey: ["task-assignment-comment-actions", detailAssignment?.id, selectedDeviceState?.deviceCode],
    queryFn: async () => {
      const [unknownActions, submittedActions] = await Promise.all([
        getLiveCommentActions({ deviceCode: selectedDeviceState?.deviceCode, status: "unknown", pageSize: 100 }),
        getLiveCommentActions({ deviceCode: selectedDeviceState?.deviceCode, status: "submitted", pageSize: 100 })
      ]);
      return [...unknownActions.data, ...submittedActions.data];
    },
    enabled: Boolean(
      detailAssignment?.id &&
      detailAssignment.workflowVersion === 2 &&
      detailAssignment.taskType === "commerce_card_live_comment" &&
      selectedDeviceState?.deviceCode
    )
  });
  const unresolvedCommentActions = useMemo(
    () => (commentActionsQuery.data ?? []).filter((action) =>
      action.assignmentId === detailAssignment?.id &&
      (action.actionState === "unknown" || action.actionState === "submitted")
    ),
    [commentActionsQuery.data, detailAssignment?.id]
  );
  const resolveActionMutation = useMutation({
    mutationFn: ({ action, values }: { action: LiveCommentAction; values: ResolveActionFormValues }) => {
      if (!action.stateVersion) {
        throw new Error("评论动作缺少状态版本，请刷新后重试。");
      }
      return resolveLiveCommentAction(action.id, {
        expectedActionStateVersion: action.stateVersion,
        resolution: values.resolution,
        evidence: values.evidence
      });
    },
    onSuccess: async () => {
      setResolveAction(null);
      resolveActionForm.resetFields();
      setNotice({ kind: "success", text: "评论结果已人工确认。任务仍保持待人工处理，请显式恢复或停止。" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task-assignment-comment-actions"] }),
        queryClient.invalidateQueries({ queryKey: ["task-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["task-assignment-events"] })
      ]);
    },
    onError: async (error: Error) => {
      setNotice({ kind: "error", text: error.message });
      await queryClient.invalidateQueries({ queryKey: ["task-assignment-comment-actions"] });
    }
  });

  const activeAssignments = assignments.filter((item) => isActiveAssignment(item.status));
  const onlineCount = devices.filter((item) => !["offline", "stopped", "error"].includes(item.effectiveStatus || item.status || "")).length;
  const desiredRunningCount = activeAssignments.length;
  const taskConsistentCount = deviceTaskRows.filter((item) => item.assignment?.taskType && item.actualTask === item.assignment.taskType).length;
  const pendingCount = assignments.filter((item) => item.status === "PENDING" || item.status === "DISPATCHED" || item.status === "PAUSING" || item.status === "RESUMING" || item.commandStatus === "PENDING").length;
  const exceptionCount = deviceTaskRows.filter((item) => ["offline", "error", "stopped"].includes(item.deviceStatus || "") || item.assignment?.status === "FAILED" || item.assignment?.status === "BLOCKED" || item.assignment?.commandStatus === "FAILED" || hasTaskMismatch(item)).length;
  const detailStartBlocked = isActiveAssignment(selectedDeviceState?.assignment?.status);
  const detailCanPause = selectedDeviceState?.assignment?.status === "RUNNING";
  const detailCanResume = selectedDeviceState?.assignment?.status === "PAUSED" || selectedDeviceState?.assignment?.status === "BLOCKED";
  const detailCanStop = isActiveAssignment(selectedDeviceState?.assignment?.status);

  function refreshData() {
    setNotice({ kind: "info", text: "正在刷新设备与任务分配。" });
    void Promise.all([
      assignmentsQuery.refetch(),
      devicesQuery.refetch(),
      liveTargetsQuery.refetch(),
      approvalsQuery.refetch(),
      detailAssignment?.workflowVersion === 2 && detailAssignment.taskType === "commerce_card_live_comment"
        ? commentActionsQuery.refetch()
        : Promise.resolve()
    ]);
  }

  function selectDevice(row: DeviceTaskState) {
    setSelectedDeviceCode(row.deviceCode);
    setSelectedAssignmentId(row.assignment?.id);
  }

  function assignTask(row: DeviceTaskState, taskType: TaskType, commandType: CommandType = "START", reason?: string) {
    if (commandType === "START" && isActiveAssignment(row.assignment?.status)) {
      setNotice({ kind: "info", text: startBlockedMessage(row.assignment?.status) });
      return;
    }
    if (taskType === "commerce_card_live_comment" && commandType === "START") {
      openCommerceStart(row);
      return;
    }
    if (commandType !== "START" && (!row.assignment?.id || !row.assignment.stateVersion)) {
      setNotice({ kind: "error", text: "当前设备没有可控制的任务运行，请刷新后重试。" });
      return;
    }
    selectDevice(row);
    mutation.mutate({
      deviceId: row.deviceCode,
      taskType,
      commandType,
      assignmentId: row.assignment?.id,
      stateVersion: row.assignment?.stateVersion,
      workflowVersion: row.assignment?.workflowVersion === 2 ? 2 : 1,
      reason: reason || quickReason(taskType, commandType),
      priority: commandType === "STOP" ? 1000 : 100
    });
  }

  function openCommerceStart(row: DeviceTaskState) {
    selectDevice(row);
    setCommerceStartDevice(row);
    commerceStartForm.setFieldsValue({
      targetId: commerceTargets[0]?.id,
      expectedAccountName: row.douyinAccountName || "",
      executionApprovalId: undefined
    });
    setCommerceStartOpen(true);
  }

  function submitCommerceStart(values: CommerceStartFormValues) {
    if (!commerceStartDevice) return;
    mutation.mutate({
      deviceId: commerceStartDevice.deviceCode,
      taskType: "commerce_card_live_comment",
      commandType: "START",
      workflowVersion: 2,
      targetId: values.targetId,
      executionApprovalId: values.executionApprovalId || null,
      expectedAccountName: values.expectedAccountName,
      reason: "手动启动商品卡组合任务 V2",
      priority: 100
    });
  }

  function openResolveAction(action: LiveCommentAction) {
    setResolveAction(action);
  }

  function submitResolveAction() {
    if (!resolveAction) return;
    void resolveActionForm.validateFields().then((values) => {
      resolveActionMutation.mutate({ action: resolveAction, values });
    });
  }

  function openDeviceConfig(row?: DeviceTaskState | null) {
    if (!row?.deviceCode) {
      setNotice({ kind: "info", text: "请先选择要配置的手机。" });
      return;
    }
    selectDevice(row);
    setConfigDeviceState(row);
    setConfigOpen(true);
  }

  if (devicesQuery.isLoading || assignmentsQuery.isLoading) {
    return (
      <div className="scheduler-page">
        <div className="scheduler-loading-lines">
          <span />
          <span />
          <span />
        </div>
      </div>
    );
  }

  if (devicesQuery.isError || assignmentsQuery.isError) {
    const error = devicesQuery.error || assignmentsQuery.error;
    return (
      <div className="scheduler-page">
        <div className="scheduler-error">任务调度数据加载失败：{error instanceof Error ? error.message : String(error)}</div>
      </div>
    );
  }

  return (
    <div className="scheduler-page">
      {notice ? <div className={`scheduler-toast ${notice.kind}`}>{notice.text}</div> : null}
      <header className="scheduler-topbar">
        <div>
          <h1>任务调度中心</h1>
          <p>查看每台设备的任务安排和手机实际执行情况，视频、直播、搜索直播间评论和商品卡直播评论都从这里下发。</p>
        </div>
        <div className="scheduler-toolbar">
          <button className="scheduler-btn primary" type="button" disabled={!selectedDeviceState} onClick={() => openDeviceConfig(selectedDeviceState)}><SettingOutlined />配置</button>
          <button className="scheduler-btn" type="button" onClick={refreshData}>刷新</button>
        </div>
      </header>

      <section className="scheduler-stats">
        <div className="scheduler-stat-card">
          <div className="scheduler-stat-label">在线设备</div>
          <div className="scheduler-stat-value">{onlineCount}</div>
          <div className="scheduler-stat-note">3 分钟内有心跳</div>
        </div>
        <div className="scheduler-stat-card">
          <div className="scheduler-stat-label">已安排任务</div>
          <div className="scheduler-stat-value">{desiredRunningCount}</div>
          <div className="scheduler-stat-note">含视频、直播和两类评论任务</div>
        </div>
        <div className="scheduler-stat-card">
          <div className="scheduler-stat-label">执行一致</div>
          <div className="scheduler-stat-value">{taskConsistentCount}</div>
          <div className="scheduler-stat-note">安排任务和手机实际一致</div>
        </div>
        <div className="scheduler-stat-card">
          <div className="scheduler-stat-label">待确认</div>
          <div className="scheduler-stat-value">{pendingCount}</div>
          <div className="scheduler-stat-note">命令已下发未心跳确认</div>
        </div>
        <div className="scheduler-stat-card">
          <div className="scheduler-stat-label">异常</div>
          <div className="scheduler-stat-value danger">{exceptionCount}</div>
          <div className="scheduler-stat-note">切换超时、离线或任务不一致</div>
        </div>
      </section>

      <section className="scheduler-filter-panel">
        <div className="scheduler-field">
          <label htmlFor="scheduler-device-search">设备搜索</label>
          <input
            id="scheduler-device-search"
            className="scheduler-input"
            value={deviceKeyword}
            onChange={(event) => setDeviceKeyword(event.currentTarget.value)}
            placeholder="设备编号 / 名称"
          />
        </div>
        <div className="scheduler-field">
          <label htmlFor="scheduler-task-filter">任务类型</label>
          <select id="scheduler-task-filter" className="scheduler-input" value={taskFilter} onChange={(event) => setTaskFilter(event.currentTarget.value)}>
            <option value="">全部任务</option>
            <option value="video">视频</option>
            <option value="live">直播</option>
            <option value="live_comment">搜索直播间评论</option>
            <option value="commerce_card_live_comment">商品卡直播评论</option>
            <option value="none">待命</option>
          </select>
        </div>
        <div className="scheduler-field">
          <label htmlFor="scheduler-status-filter">调度状态</label>
          <select id="scheduler-status-filter" className="scheduler-input" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}>
            <option value="">全部状态</option>
            <option value="PENDING">待下发</option>
            <option value="DISPATCHED">已下发</option>
            <option value="RUNNING">执行中</option>
            <option value="PAUSING">暂停中</option>
            <option value="PAUSED">已暂停</option>
            <option value="RESUMING">恢复中</option>
            <option value="BLOCKED">待人工处理</option>
            <option value="SUCCEEDED">已完成</option>
            <option value="CANCELLED">已取消</option>
            <option value="FAILED">失败</option>
            <option value="offline">离线</option>
            <option value="running">运行中</option>
            <option value="idle">待命</option>
          </select>
        </div>
      </section>

      <section className="scheduler-workbench">
        <div className="scheduler-panel">
          <div className="scheduler-panel-head">
            <span>设备任务分配</span>
            <span className="scheduler-small">每台设备同一时间只执行一个主任务</span>
          </div>
          <div className="scheduler-table-wrap">
            <table className="scheduler-native-table">
              <thead>
                <tr>
                  <th>设备</th>
                  <th>任务安排</th>
                  <th>调度状态</th>
                  <th>最近命令</th>
                  <th>最近心跳</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredDeviceTaskRows.length === 0 ? (
                  <tr>
                    <td className="scheduler-empty-row" colSpan={6}>没有符合条件的设备</td>
                  </tr>
                ) : filteredDeviceTaskRows.map((row) => {
                  const assignment = row.assignment;
                  const actualTone = taskTypeTone(row.actualTask);
                  const mismatch = hasTaskMismatch(row);
                  const startBlocked = isActiveAssignment(assignment?.status);
                  const canPause = assignment?.status === "RUNNING";
                  const canResume = assignment?.status === "PAUSED" || assignment?.status === "BLOCKED";
                  const canStop = isActiveAssignment(assignment?.status);
                  return (
                    <tr
                      key={row.deviceCode}
                      className={row.deviceCode === selectedDeviceState?.deviceCode ? "selected" : ""}
                      onClick={() => selectDevice(row)}
                    >
                      <td>
                        <div className="scheduler-device">{deviceDisplayName(row)}</div>
                        <div className="scheduler-small">{deviceSubTitle(row)} · {heartbeatLine(row)}</div>
                      </td>
                      <td>
                        <div className="scheduler-compare">
                          <div className="scheduler-compare-row">
                            <span className="scheduler-compare-label">安排</span>
                            <span className={`scheduler-tag ${taskTypeTone(assignment?.taskType)}`}>{assignment ? taskTypeText(assignment.taskType) : "待命"}</span>
                          </div>
                          <div className="scheduler-compare-row">
                            <span className="scheduler-compare-label">实际</span>
                            <span className={`scheduler-tag ${actualTone}`}>{row.actualTask ? taskTypeText(row.actualTask) : "未知"}</span>
                          </div>
                          {mismatch ? <div className="scheduler-mismatch">任务不一致</div> : null}
                        </div>
                      </td>
                      <td>
                        <span className={`scheduler-tag ${assignmentStatusTone(assignment?.status)}`}>{assignmentStatusText(assignment?.status)}</span>
                      </td>
                      <td>
                        <div>{commandText(assignment?.commandType)} · <span className={`scheduler-inline-status ${commandStatusTone(assignment?.commandStatus)}`}>{commandStatusText(assignment?.commandStatus)}</span></div>
                        <div className="scheduler-small">{formatDateTime(latestCommandTime(assignment))} · {assignment?.commandId || "-"}</div>
                      </td>
                      <td>
                        <div>{formatDateTime(row.lastHeartbeatAt)}</div>
                        <div className="scheduler-small">{compactText(row.device.latestHeartbeat?.lastMessage, "暂无心跳消息")}</div>
                      </td>
                      <td>
                        <div className="scheduler-actions-cell compact" onClick={(event) => event.stopPropagation()}>
                          <button className="scheduler-action-btn video" type="button" title={startBlocked ? startBlockedMessage(assignment?.status) : "启动视频任务"} disabled={mutation.isPending || startBlocked} onClick={() => assignTask(row, "video")}><VideoCameraOutlined />视频</button>
                          <button className="scheduler-action-btn live" type="button" title={startBlocked ? startBlockedMessage(assignment?.status) : "启动直播任务"} disabled={mutation.isPending || startBlocked} onClick={() => assignTask(row, "live")}><PlaySquareOutlined />直播</button>
                          <button className="scheduler-action-btn comment" type="button" title={startBlocked ? startBlockedMessage(assignment?.status) : "启动搜索直播评论任务"} disabled={mutation.isPending || startBlocked} onClick={() => assignTask(row, "live_comment")}><CommentOutlined />搜直播评论</button>
                          <button className="scheduler-action-btn commerce" type="button" title={startBlocked ? startBlockedMessage(assignment?.status) : "启动商品卡组合任务"} disabled={mutation.isPending || startBlocked} onClick={() => assignTask(row, "commerce_card_live_comment")}><ShopOutlined />商品卡评论</button>
                          <button className="scheduler-action-btn pause" type="button" disabled={mutation.isPending || !canPause} onClick={() => assignTask(row, taskTypeForControl(row), "PAUSE")}><PauseCircleOutlined />暂停</button>
                          <button className="scheduler-action-btn resume" type="button" disabled={mutation.isPending || !canResume} onClick={() => assignTask(row, taskTypeForControl(row), "RESUME")}><PlayCircleOutlined />恢复</button>
                          <button className="scheduler-action-btn stop" type="button" disabled={mutation.isPending || !canStop} onClick={() => assignTask(row, taskTypeForControl(row), "STOP")}><StopOutlined />停止</button>
                        </div>
                        {startBlocked ? <div className="scheduler-small">先停止当前任务并等待结束后，才能启动新任务。</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <aside className="scheduler-panel">
          <div className="scheduler-panel-head">
            <span>分配详情</span>
            <span className={`scheduler-tag ${assignmentStatusTone(detailAssignment?.status)}`}>{detailStatusText(detailAssignment?.status)}</span>
          </div>
          <div className="scheduler-detail">
            <h2>{deviceDisplayName(selectedDeviceState)}</h2>
            <div className="scheduler-kv">
              <div className="scheduler-k">分配编号</div><div>{detailAssignment?.id || "-"}</div>
              <div className="scheduler-k">任务安排</div><div><span className={`scheduler-tag ${taskTypeTone(detailAssignment?.taskType)}`}>{detailAssignment ? taskTypeText(detailAssignment.taskType) : "待命"}</span></div>
              <div className="scheduler-k">手机实际</div><div><span className={`scheduler-tag ${taskTypeTone(selectedDeviceState?.actualTask)}`}>{selectedDeviceState?.actualTask ? taskTypeText(selectedDeviceState.actualTask) : "未知"}</span></div>
              <div className="scheduler-k">执行一致性</div><div><span className={`scheduler-tag ${taskConsistencyTone(selectedDeviceState)}`}>{taskConsistencyText(selectedDeviceState)}</span></div>
              <div className="scheduler-k">目标上下文</div><div>{targetContextText(detailAssignment?.targetContext)}</div>
              <div className="scheduler-k">调度来源</div><div>{sourceText(detailAssignment?.source)}</div>
              <div className="scheduler-k">调度原因</div><div>{reasonText(detailAssignment?.reason)}</div>
              <div className="scheduler-k">工作流版本</div><div>{detailAssignment?.workflowVersion === 2 ? "商品卡组合任务 V2" : "第一版任务"}</div>
              <div className="scheduler-k">当前阶段</div><div>{stageText(detailAssignment?.currentStage)}</div>
              <div className="scheduler-k">状态版本</div><div>{detailAssignment?.stateVersion ?? "-"}</div>
              <div className="scheduler-k">阻断原因</div><div>{reasonText(detailAssignment?.blockReason)}</div>
              <div className="scheduler-k">终态原因</div><div>{reasonText(detailAssignment?.terminalReason)}</div>
              <div className="scheduler-k">最后心跳</div><div>{formatDateTime(selectedDeviceState?.lastHeartbeatAt)}</div>
              <div className="scheduler-k">失败原因</div><div>{detailAssignment?.status === "FAILED" ? compactText(String(detailAssignment.commandResult?.message || detailAssignment.commandResult?.error || detailAssignment.reason || "-")) : "-"}</div>
            </div>

            {detailAssignment?.workflowVersion === 2 && detailAssignment.taskType === "commerce_card_live_comment" ? (
              <div className="scheduler-timeline">
                <div className="scheduler-step-title">待人工确认的评论结果</div>
                {commentActionsQuery.isLoading ? <div className="scheduler-small">正在检查待确认评论...</div> : null}
                {commentActionsQuery.isError ? (
                  <Alert
                    type="error"
                    showIcon
                    message="评论动作加载失败"
                    description={commentActionsQuery.error.message}
                  />
                ) : null}
                {!commentActionsQuery.isLoading && !commentActionsQuery.isError && unresolvedCommentActions.length === 0 ? (
                  <div className="scheduler-small">当前运行没有待人工确认的评论动作。</div>
                ) : null}
                {unresolvedCommentActions.map((action) => (
                  <div className="scheduler-step" key={action.id}>
                    <span className="scheduler-dot warn" />
                    <div>
                      <div className="scheduler-step-title">
                        {commentActionStateText(action.actionState || action.status)} · {action.roomName || action.roomKey || "未识别直播间"}
                      </div>
                      <div className="scheduler-small">
                        账号 {action.expectedAccountName || selectedDeviceState?.douyinAccountName || "未识别"} · 评论位置 {typeof action.commentSlot === "number" ? action.commentSlot + 1 : "-"}
                      </div>
                      <div>{compactText(action.replyText, "未记录评论内容")}</div>
                      <button
                        className="scheduler-btn"
                        type="button"
                        disabled={!action.stateVersion || resolveActionMutation.isPending}
                        onClick={() => openResolveAction(action)}
                      >
                        人工确认结果
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {detailAssignment?.id ? (
              <div className="scheduler-timeline">
                {assignmentEventsQuery.isLoading ? <div className="scheduler-small">正在加载运行事件...</div> : null}
                {!assignmentEventsQuery.isLoading && assignmentEvents.length === 0 ? <div className="scheduler-small">暂无结构化运行事件</div> : null}
                {assignmentEvents.slice(-12).reverse().map((event) => (
                  <div className="scheduler-step" key={event.id}>
                    <span className={`scheduler-dot ${event.status === "failed" || event.status === "blocked" ? "warn" : "done"}`} />
                    <div>
                      <div className="scheduler-step-title">{eventText(event.eventType)}</div>
                      <div className="scheduler-small">
                        #{event.sequence} · {stageText(event.stage)} · {event.fromState || "-"} → {event.toState || "-"} · {formatDateTime(event.occurredAt)}
                      </div>
                      {event.reasonCode ? <div className="scheduler-small">{reasonText(event.reasonCode)}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="scheduler-timeline">
              <div className="scheduler-step">
                <span className={`scheduler-dot ${detailAssignment ? "done" : ""}`} />
                <div>
                  <div className="scheduler-step-title">创建任务</div>
                  <div className="scheduler-small">{detailAssignment ? `已创建任务安排，优先级 ${detailAssignment.priority ?? "-"}` : "尚未创建任务分配"}</div>
                </div>
              </div>
              <div className="scheduler-step">
                <span className={`scheduler-dot ${detailAssignment?.commandId ? "done" : ""}`} />
                <div>
                  <div className="scheduler-step-title">下发命令</div>
                  <div className="scheduler-small">{detailAssignment?.commandId ? `已创建 ${commandText(detailAssignment.commandType)} 命令 ${detailAssignment.commandId}` : "尚未创建命令"}</div>
                </div>
              </div>
              <div className="scheduler-step">
                <span className={`scheduler-dot ${detailAssignment?.commandFetchedAt || detailAssignment?.acknowledgedAt ? "active" : detailAssignment ? "warn" : ""}`} />
                <div>
                  <div className="scheduler-step-title">手机确认 / 执行中</div>
                  <div className="scheduler-small">{detailAssignment ? `等待手机心跳确认任务：${taskTypeText(detailAssignment.taskType)}` : "等待后台下发任务"}</div>
                </div>
              </div>
              <div className="scheduler-step">
                <span className={`scheduler-dot ${detailAssignment?.completedAt ? "done" : ""}`} />
                <div>
                  <div className="scheduler-step-title">执行完成</div>
                  <div className="scheduler-small">{detailAssignment?.completedAt ? formatDateTime(detailAssignment.completedAt) : "任务结束或被新任务抢占"}</div>
                </div>
              </div>
            </div>

            {detailStartBlocked ? (
              <Alert
                type="warning"
                showIcon
                message="当前运行未结束，不能启动新任务"
                description={startBlockedMessage(selectedDeviceState?.assignment?.status)}
              />
            ) : null}

            <div className="scheduler-toolbar detail-toolbar">
              <button className="scheduler-btn primary" type="button" disabled={!selectedDeviceState} onClick={() => openDeviceConfig(selectedDeviceState)}><SettingOutlined />配置</button>
              <button className="scheduler-btn primary" type="button" disabled={!selectedDeviceState || mutation.isPending || detailStartBlocked} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, "video")}>启动视频</button>
              <button className="scheduler-btn" type="button" disabled={!selectedDeviceState || mutation.isPending || detailStartBlocked} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, "live")}>启动直播</button>
              <button className="scheduler-btn" type="button" disabled={!selectedDeviceState || mutation.isPending || detailStartBlocked} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, "live_comment")}>启动搜索直播评论</button>
              <button className="scheduler-btn" type="button" disabled={!selectedDeviceState || mutation.isPending || detailStartBlocked} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, "commerce_card_live_comment")}>启动商品卡评论</button>
              <button className="scheduler-btn pause" type="button" disabled={!selectedDeviceState || mutation.isPending || !detailCanPause} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, taskTypeForControl(selectedDeviceState), "PAUSE")}>暂停</button>
              <button className="scheduler-btn resume" type="button" disabled={!selectedDeviceState || mutation.isPending || !detailCanResume} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, taskTypeForControl(selectedDeviceState), "RESUME")}>恢复</button>
              <button
                className="scheduler-btn danger"
                type="button"
                disabled={!selectedDeviceState || mutation.isPending || !detailCanStop}
                onClick={() => selectedDeviceState && assignTask(selectedDeviceState, taskTypeForControl(selectedDeviceState), "STOP")}
              >
                停止
              </button>
            </div>
          </div>
        </aside>
      </section>

      <Modal
        title="人工确认评论结果"
        open={Boolean(resolveAction)}
        onCancel={() => {
          setResolveAction(null);
          resolveActionForm.resetFields();
        }}
        onOk={submitResolveAction}
        confirmLoading={resolveActionMutation.isPending}
        okText="确认结果"
        cancelText="取消"
        destroyOnClose
      >
        <Alert
          type="warning"
          showIcon
          message={commentActionStateText(resolveAction?.actionState || resolveAction?.status)}
          description="只根据真机截图、日志或现场确认填写结果。确认后任务仍保持待人工处理，需回到调度详情显式恢复或停止。"
          style={{ marginBottom: 16 }}
        />
        <div className="scheduler-kv">
          <div className="scheduler-k">直播间</div><div>{resolveAction?.roomName || resolveAction?.roomKey || "未识别"}</div>
          <div className="scheduler-k">执行账号</div><div>{resolveAction?.expectedAccountName || selectedDeviceState?.douyinAccountName || "未识别"}</div>
          <div className="scheduler-k">评论内容</div><div>{resolveAction?.replyText || "未记录"}</div>
        </div>
        <Form<ResolveActionFormValues>
          form={resolveActionForm}
          layout="vertical"
          initialValues={{ resolution: "sent", evidence: "" }}
        >
          <Form.Item name="resolution" label="确认结果" rules={[{ required: true, message: "请选择确认结果" }]}>
            <Select
              options={[
                { value: "sent", label: "已实际发送" },
                { value: "failed", label: "未发送或发送失败" }
              ]}
            />
          </Form.Item>
          <Form.Item
            name="evidence"
            label="确认依据"
            rules={[
              { required: true, message: "请填写确认依据" },
              { min: 3, message: "确认依据至少 3 个字符" }
            ]}
          >
            <Input.TextArea rows={4} maxLength={1000} placeholder="填写真机截图、日志时间或现场核对结果" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="启动商品卡组合任务 V2"
        open={commerceStartOpen}
        onCancel={() => setCommerceStartOpen(false)}
        onOk={() => commerceStartForm.submit()}
        confirmLoading={mutation.isPending}
        okText="启动任务"
        cancelText="取消"
        destroyOnClose
      >
        <Form<CommerceStartFormValues>
          form={commerceStartForm}
          layout="vertical"
          onFinish={submitCommerceStart}
        >
          {commerceTargets.length === 0 ? (
            <Alert type="warning" showIcon message="暂无可运行的 V2 目标配置" description="请先在直播目标中心完成商品卡组合任务配置和设备绑定。" />
          ) : null}
          <Form.Item name="targetId" label="直播目标" rules={[{ required: true, message: "请选择直播目标" }]}>
            <Select
              placeholder="选择已配置的商品卡目标"
              options={commerceTargets.map((target) => ({ value: target.id || "", label: target.targetName }))}
              onChange={() => commerceStartForm.setFieldValue("executionApprovalId", undefined)}
            />
          </Form.Item>
          <Form.Item name="expectedAccountName" label="本次执行账号" rules={[{ required: true, message: "请填写手机当前登录的抖音账号" }]}>
            <Input maxLength={100} placeholder="必须与手机当前登录账号一致" />
          </Form.Item>
          <Form.Item name="executionApprovalId" label="真实评论审批">
            <Select
              allowClear
              placeholder="不选择则只执行无评论流程"
              options={availableApprovals.map((approval) => ({
                value: approval.id,
                label: `${approval.expectedAccountName || "指定账号"} · 剩余额度 ${approval.remainingQuota} · ${formatDateTime(approval.expiresAt)}`
              }))}
            />
          </Form.Item>
          <Alert
            type="info"
            showIcon
            message="真实评论仍受全局急停、目标实时开关和短时许可控制"
            description="未选择有效审批时，手机只执行养号和目标识别，不会点击发送评论。"
          />
        </Form>
      </Modal>

      <DeviceLiveCommentConfigModal
        open={configOpen}
        device={configDeviceState}
        onClose={() => setConfigOpen(false)}
        onSaved={() => setNotice({ kind: "success", text: "配置已保存，后台已向手机下发 REFRESH_CONFIG，等待手机领取后生效。" })}
      />
    </div>
  );
}
