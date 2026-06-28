import { CommentOutlined, PauseCircleOutlined, PlaySquareOutlined, VideoCameraOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { createTaskAssignment, getDevices, getTaskAssignments } from "../lib/api-client";

type TaskType = "video" | "live" | "live_comment";
type CommandType = "START" | "RESUME" | "PAUSE" | "STOP";

type DeviceRow = {
  id?: string;
  deviceCode: string;
  deviceName?: string;
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

type AssignmentRow = {
  id: string;
  deviceCode?: string;
  deviceName?: string;
  deviceStatus?: string;
  taskType?: string;
  targetContext?: string | null;
  status?: string;
  priority?: number;
  source?: string;
  reason?: string | null;
  desiredPayload?: Record<string, unknown> | null;
  commandId?: string | null;
  commandType?: string | null;
  commandStatus?: string | null;
  commandFetchedAt?: string | null;
  commandAcknowledgedAt?: string | null;
  commandResult?: Record<string, unknown> | null;
  createdAt?: string;
  issuedAt?: string | null;
  acknowledgedAt?: string | null;
  expiresAt?: string | null;
  completedAt?: string | null;
  lastHeartbeatAt?: string | null;
  latestHeartbeat?: {
    status?: string;
    sceneType?: string | null;
    lastMessage?: string | null;
    rawPayload?: Record<string, unknown> | null;
    reportedAt?: string | null;
  } | null;
};

type DeviceTaskState = {
  device: DeviceRow;
  assignment?: AssignmentRow;
  deviceCode: string;
  deviceName?: string;
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
  return value === "video" || value === "live" || value === "live_comment";
}

function taskTypeText(value?: string | null) {
  if (value === "video") return "视频";
  if (value === "live") return "直播";
  if (value === "live_comment") return "直播评论";
  if (value === "none") return "待命";
  return value || "未知";
}

function taskTypeTone(value?: string | null) {
  if (value === "live_comment") return "purple";
  if (value === "live") return "green";
  if (value === "video") return "blue";
  return "gray";
}

function assignmentStatusText(value?: string | null) {
  const map: Record<string, string> = {
    PENDING: "待下发",
    ISSUED: "已下发",
    ACKED: "手机已确认",
    ACTIVE: "执行中",
    PAUSED: "已暂停",
    STOPPED: "已停止",
    SUPERSEDED: "已被新任务替换",
    EXPIRED: "已过期",
    FAILED: "失败"
  };
  return value ? (map[value] ?? value) : "未分配";
}

function assignmentStatusTone(value?: string | null) {
  if (value === "ACTIVE" || value === "ACKED") return "green";
  if (value === "PENDING" || value === "ISSUED" || value === "PAUSED") return "amber";
  if (value === "FAILED") return "red";
  if (value === "STOPPED" || value === "SUPERSEDED" || value === "EXPIRED") return "gray";
  return "gray";
}

function detailStatusText(value?: string | null) {
  if (value === "ACTIVE" || value === "ACKED") return "执行中";
  if (value === "PENDING" || value === "ISSUED") return "等待确认";
  if (value === "PAUSED") return "已暂停";
  if (value === "FAILED") return "失败";
  if (value === "STOPPED" || value === "SUPERSEDED" || value === "EXPIRED") return "已结束";
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
  return ["PENDING", "ISSUED", "ACKED", "ACTIVE"].includes(value || "");
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
  if (taskType === "live_comment") return "手动切到直播评论";
  if (taskType === "live") return "手动切到直播";
  return "手动切到视频";
}

function compactText(value?: string | null, fallback = "-") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return text.length > 58 ? `${text.slice(0, 58)}...` : text;
}

function latestCommandTime(assignment?: AssignmentRow | null) {
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
  if (value === "comment_context" || value === "live_comment_context") return "直播评论";
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

export function TaskSchedulerPage() {
  const queryClient = useQueryClient();
  const [deviceKeyword, setDeviceKeyword] = useState("");
  const [taskFilter, setTaskFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedAssignmentId, setSelectedAssignmentId] = useState<string>();
  const [selectedDeviceCode, setSelectedDeviceCode] = useState<string>();
  const [notice, setNotice] = useState<Notice>(null);

  const devicesQuery = useQuery({ queryKey: ["devices"], queryFn: getDevices, refetchInterval: 15000 });
  const assignmentsQuery = useQuery({ queryKey: ["task-assignments"], queryFn: getTaskAssignments, refetchInterval: 10000 });
  const mutation = useMutation({
    mutationFn: (values: {
      deviceId: string;
      taskType: TaskType;
      commandType: CommandType;
      reason?: string;
      priority?: number;
    }) => createTaskAssignment({
      ...values,
      source: "manual",
      priority: values.priority ?? 100,
      expiresInSeconds: 3600
    }),
    onSuccess: async () => {
      setNotice({ kind: "success", text: "任务已下发，等待手机领取并通过心跳确认。" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["task-assignments"] }),
        queryClient.invalidateQueries({ queryKey: ["devices"] })
      ]);
    },
    onError: (error: Error) => setNotice({ kind: "error", text: error.message })
  });

  const devices = useMemo(() => (devicesQuery.data ?? []) as DeviceRow[], [devicesQuery.data]);
  const assignments = useMemo(() => (assignmentsQuery.data ?? []) as AssignmentRow[], [assignmentsQuery.data]);
  const assignmentByDeviceCode = useMemo(() => {
    const map = new Map<string, AssignmentRow>();
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
      actualTask: actualTaskFromDevice(device),
      lastHeartbeatAt: device.latestHeartbeat?.reportedAt || device.lastHeartbeatAt,
      deviceStatus: device.effectiveStatus || device.status
    };
  }), [assignmentByDeviceCode, devices]);
  const filteredDeviceTaskRows = useMemo(() => deviceTaskRows.filter((item) => {
    const deviceText = `${item.deviceName || ""} ${item.deviceCode || ""}`.toLowerCase();
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

  const activeAssignments = assignments.filter((item) => isActiveAssignment(item.status));
  const onlineCount = devices.filter((item) => !["offline", "stopped", "error"].includes(item.effectiveStatus || item.status || "")).length;
  const desiredRunningCount = activeAssignments.length;
  const taskConsistentCount = deviceTaskRows.filter((item) => item.assignment?.taskType && item.actualTask === item.assignment.taskType).length;
  const pendingCount = assignments.filter((item) => item.status === "PENDING" || item.status === "ISSUED" || item.commandStatus === "PENDING").length;
  const exceptionCount = deviceTaskRows.filter((item) => ["offline", "error", "stopped"].includes(item.deviceStatus || "") || item.assignment?.status === "FAILED" || item.assignment?.commandStatus === "FAILED").length;

  function refreshData() {
    setNotice({ kind: "info", text: "正在刷新设备与任务分配。" });
    void Promise.all([assignmentsQuery.refetch(), devicesQuery.refetch()]);
  }

  function selectDevice(row: DeviceTaskState) {
    setSelectedDeviceCode(row.deviceCode);
    setSelectedAssignmentId(row.assignment?.id);
  }

  function assignTask(row: DeviceTaskState, taskType: TaskType, commandType: CommandType = "START", reason?: string) {
    selectDevice(row);
    mutation.mutate({
      deviceId: row.deviceCode,
      taskType,
      commandType,
      reason: reason || quickReason(taskType, commandType),
      priority: commandType === "STOP" ? 1000 : 100
    });
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
          <p>查看每台设备的任务安排和手机实际执行情况，快速切换视频、直播和评论任务。</p>
        </div>
        <div className="scheduler-toolbar">
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
          <div className="scheduler-stat-note">含视频、直播、直播评论</div>
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
          <div className="scheduler-stat-note">切换超时或离线</div>
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
            <option value="live_comment">直播评论</option>
            <option value="none">待命</option>
          </select>
        </div>
        <div className="scheduler-field">
          <label htmlFor="scheduler-status-filter">调度状态</label>
          <select id="scheduler-status-filter" className="scheduler-input" value={statusFilter} onChange={(event) => setStatusFilter(event.currentTarget.value)}>
            <option value="">全部状态</option>
            <option value="PENDING">待下发</option>
            <option value="ISSUED">已下发</option>
            <option value="ACKED">手机已确认</option>
            <option value="ACTIVE">执行中</option>
            <option value="PAUSED">已暂停</option>
            <option value="STOPPED">已停止</option>
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
                  return (
                    <tr
                      key={row.deviceCode}
                      className={row.deviceCode === selectedDeviceState?.deviceCode ? "selected" : ""}
                      onClick={() => selectDevice(row)}
                    >
                      <td>
                        <div className="scheduler-device">{row.deviceName || row.deviceCode}</div>
                        <div className="scheduler-small">{row.deviceCode} · {heartbeatLine(row)}</div>
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
                          <button className="scheduler-action-btn video" type="button" disabled={mutation.isPending} onClick={() => assignTask(row, "video")}><VideoCameraOutlined />视频</button>
                          <button className="scheduler-action-btn live" type="button" disabled={mutation.isPending} onClick={() => assignTask(row, "live")}><PlaySquareOutlined />直播</button>
                          <button className="scheduler-action-btn comment" type="button" disabled={mutation.isPending} onClick={() => assignTask(row, "live_comment")}><CommentOutlined />评论</button>
                          <button className="scheduler-action-btn stop" type="button" disabled={mutation.isPending} onClick={() => assignTask(row, isTaskType(assignment?.taskType) ? assignment.taskType : "video", "STOP")}><PauseCircleOutlined />停止</button>
                        </div>
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
            <h2>{selectedDeviceState?.deviceName || selectedDeviceState?.deviceCode || "未选择设备"}</h2>
            <div className="scheduler-kv">
              <div className="scheduler-k">分配编号</div><div>{detailAssignment?.id || "-"}</div>
              <div className="scheduler-k">任务安排</div><div><span className={`scheduler-tag ${taskTypeTone(detailAssignment?.taskType)}`}>{detailAssignment ? taskTypeText(detailAssignment.taskType) : "待命"}</span></div>
              <div className="scheduler-k">手机实际</div><div><span className={`scheduler-tag ${taskTypeTone(selectedDeviceState?.actualTask)}`}>{selectedDeviceState?.actualTask ? taskTypeText(selectedDeviceState.actualTask) : "未知"}</span></div>
              <div className="scheduler-k">目标上下文</div><div>{targetContextText(detailAssignment?.targetContext)}</div>
              <div className="scheduler-k">调度来源</div><div>{sourceText(detailAssignment?.source)}</div>
              <div className="scheduler-k">调度原因</div><div>{reasonText(detailAssignment?.reason)}</div>
              <div className="scheduler-k">最后心跳</div><div>{formatDateTime(selectedDeviceState?.lastHeartbeatAt)}</div>
              <div className="scheduler-k">失败原因</div><div>{detailAssignment?.status === "FAILED" ? compactText(String(detailAssignment.commandResult?.message || detailAssignment.commandResult?.error || detailAssignment.reason || "-")) : "-"}</div>
            </div>

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

            <div className="scheduler-toolbar detail-toolbar">
              <button className="scheduler-btn primary" type="button" disabled={!selectedDeviceState || mutation.isPending} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, "video")}>切视频</button>
              <button className="scheduler-btn" type="button" disabled={!selectedDeviceState || mutation.isPending} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, "live")}>切直播</button>
              <button className="scheduler-btn" type="button" disabled={!selectedDeviceState || mutation.isPending} onClick={() => selectedDeviceState && assignTask(selectedDeviceState, "live_comment")}>切评论</button>
              <button
                className="scheduler-btn danger"
                type="button"
                disabled={!selectedDeviceState || mutation.isPending}
                onClick={() => selectedDeviceState && assignTask(selectedDeviceState, isTaskType(detailAssignment?.taskType) ? detailAssignment.taskType : "video", "STOP")}
              >
                停止
              </button>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
