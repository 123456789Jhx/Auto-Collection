import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { deviceDisplayName, deviceSubTitle, normalizeTaskDisplayText, statusText } from "../lib/display-maps";
import { DeviceProfileModal } from "../components/device-profile/DeviceProfileModal";
import "./device-list.css";

export type DeviceRow = {
  id: string;
  deviceCode: string;
  deviceName?: string;
  douyinAccountName?: string | null;
  platform?: string;
  status: string;
  reportedStatus?: string;
  currentTask?: "video" | "live" | "live_comment" | "commerce_card_live_comment" | "none";
  latestHeartbeat?: {
    status?: string;
    sceneType?: string | null;
    lastMessage?: string | null;
    rawPayload?: Record<string, unknown> | null;
    reportedAt?: string | null;
  } | null;
  effectiveStatus: string;
  lastHeartbeatAt?: string;
  heartbeatAgeMinutes?: number | null;
  agentStatus?: string;
  agentLastHeartbeatAt?: string | null;
  agentHeartbeatAge?: number | null;
  agentReachable?: boolean;
  baseStatus?: string;
  baseLastHeartbeatAt?: string | null;
  baseHeartbeatAge?: number | null;
  baseReachable?: boolean;
  baseConnectivityStatus?: "ONLINE" | "RECONNECTING" | "OFFLINE";
  baseConnectivityElapsedSeconds?: number | null;
  baseOfflineThresholdSeconds?: number;
  baseReconnectProgressPercent?: number;
  connectivityStatus?: "unreachable" | "base_online_agent_running" | "base_online_agent_unreachable" | string;
  screenState?: "locked" | "unlocked" | "unknown" | string;
  appUiState?: "foreground" | "background" | "not_running" | "unknown" | string;
  desiredAgentState?: "running" | "stopped" | string;
  agentLifecycleState?: "RUNNING" | "STOPPING" | "STOPPED" | "UNREACHABLE" | string;
  pollingEnabled?: boolean;
  agentStateReason?: string | null;
  agentStateChangedAt?: string | null;
  agentSessionId?: string | null;
  appVersion?: string | null;
  targetVersion?: string | null;
  enabled?: boolean;
  lastIp?: string | null;
  lastRegion?: string | null;
  remark?: string | null;
  accountProfile?: Record<string, unknown> | null;
};

type DeviceListProps = {
  devices: DeviceRow[];
  selectedDeviceCode?: string;
  onSelect?: (device: DeviceRow) => void;
  renderActions: (device: DeviceRow) => ReactNode;
  showBindingStatus?: boolean;
  actionsLabel?: string;
  title?: string;
};

export { deviceDisplayName, statusText };

export function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function taskText(value?: string | null) {
  if (value === "video") return "视频";
  if (value === "live") return "直播";
  if (value === "live_comment") return "搜索直播间评论";
  if (value === "commerce_card_live_comment") return "商品卡养号";
  return value ? normalizeTaskDisplayText(value) : "待命";
}

export function statusTone(value?: string | null) {
  if (value === "error" || value === "risk_control") return "red";
  if (value === "offline" || value === "stopped") return "gray";
  if (value === "paused" || value === "idle" || value === "booting" || value === "updating") return "amber";
  return "green";
}

export function agentStatus(device: DeviceRow) {
  return device.agentStatus || device.effectiveStatus || device.status;
}

export function agentHeartbeatAt(device: DeviceRow) {
  return device.agentLastHeartbeatAt || device.lastHeartbeatAt;
}

export function baseStatus(device: DeviceRow) {
  return device.baseStatus || "unknown";
}

export function taskTone(value?: string | null) {
  if (value === "live_comment") return "purple";
  if (value === "commerce_card_live_comment") return "amber";
  if (value === "live") return "green";
  if (value === "video") return "blue";
  return "gray";
}

export function enabledText(value?: boolean) {
  return value === false ? "禁用" : "启用";
}

function bindingStatus(device: DeviceRow) {
  const douyinAccountName = device.accountProfile?.douyinAccountName;
  const wechatChannelsName = device.accountProfile?.wechatChannelsName;
  return {
    douyin: typeof douyinAccountName === "string" ? douyinAccountName.trim() : "",
    hasChannelsCapability: typeof wechatChannelsName === "string" && wechatChannelsName.trim().length > 0
  };
}

type DeviceStatusFilter = "all" | "online" | "busy" | "offline";

function isOfflineDevice(device: DeviceRow) {
  const values = [baseStatus(device), agentStatus(device), device.status].map((value) => String(value).toLowerCase());
  return values.some((value) => ["offline", "unreachable", "stopped"].includes(value));
}

function isBusyDevice(device: DeviceRow) {
  return device.currentTask !== undefined && device.currentTask !== "none";
}

export function DeviceList({
  devices,
  selectedDeviceCode,
  onSelect,
  renderActions,
  showBindingStatus = false,
  actionsLabel = "常用操作",
  title = "设备运行清单"
}: DeviceListProps) {
  const columnCount = showBindingStatus ? 8 : 7;
  const [profileDevice, setProfileDevice] = useState<DeviceRow | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DeviceStatusFilter>("all");
  const summary = useMemo(() => ({
    online: devices.filter((device) => !isOfflineDevice(device)).length,
    busy: devices.filter((device) => !isOfflineDevice(device) && isBusyDevice(device)).length,
    offline: devices.filter(isOfflineDevice).length
  }), [devices]);
  const filteredDevices = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return devices.filter((device) => {
      const binding = bindingStatus(device);
      const searchable = [
        deviceDisplayName(device),
        deviceSubTitle(device),
        device.deviceCode,
        device.platform,
        device.lastIp,
        binding.douyin
      ].filter(Boolean).join(" ").toLocaleLowerCase();
      const matchesSearch = !query || searchable.includes(query);
      const matchesStatus = statusFilter === "all"
        || (statusFilter === "offline" && isOfflineDevice(device))
        || (statusFilter === "online" && !isOfflineDevice(device))
        || (statusFilter === "busy" && !isOfflineDevice(device) && isBusyDevice(device));
      return matchesSearch && matchesStatus;
    });
  }, [devices, search, statusFilter]);
  const hasFilters = search.trim().length > 0 || statusFilter !== "all";

  return (
    <div className="ops-panel">
      <div className="ops-panel-head">
        <div className="device-list-headline">
          <span className="device-list-kicker">设备总览</span>
          <span>{title}</span>
        </div>
        <span className="ops-small">显示 {filteredDevices.length} / {devices.length} 台</span>
      </div>
      <div className="device-list-toolbar">
        <div className="device-list-summary" aria-label="设备状态概览">
          <span><i className="device-list-dot online" />在线 <strong>{summary.online}</strong></span>
          <span><i className="device-list-dot busy" />工作中 <strong>{summary.busy}</strong></span>
          <span><i className="device-list-dot offline" />离线 <strong>{summary.offline}</strong></span>
        </div>
        <div className="device-list-controls">
          <label className="device-list-search">
            <span className="sr-only">搜索设备名称、型号或账号</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索设备名称、型号或账号"
              type="search"
            />
          </label>
          <label className="device-list-filter">
            <span className="sr-only">设备状态</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DeviceStatusFilter)}>
              <option value="all">全部状态</option>
              <option value="online">在线</option>
              <option value="busy">工作中</option>
              <option value="offline">离线</option>
            </select>
          </label>
        </div>
      </div>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>设备</th>
              <th>连接状态</th>
              <th>当前工作</th>
              <th>账号与平台</th>
              <th>版本信息</th>
              <th>最近在线</th>
              {showBindingStatus ? <th>绑定状态</th> : null}
              <th>{actionsLabel}</th>
            </tr>
          </thead>
          <tbody>
            {filteredDevices.length === 0 ? <tr><td className="ops-empty" colSpan={columnCount}>{hasFilters ? "没有匹配的设备，请调整搜索或状态筛选" : "暂无设备"}</td></tr> : null}
            {filteredDevices.map((device) => {
              const binding = bindingStatus(device);
              return (
                <tr
                  key={device.id || device.deviceCode}
                  className={device.deviceCode === selectedDeviceCode ? "selected" : ""}
                  onClick={() => onSelect?.(device)}
                >
                  <td>
                    <div className="ops-title">{deviceDisplayName(device)}</div>
                    <div className="ops-small">{deviceSubTitle(device)}</div>
                  </td>
                  <td>
                    <div className="device-list-status-line"><span className="device-list-status-label">主控</span><span className={`ops-tag ${statusTone(baseStatus(device))}`}>{statusText(baseStatus(device))}</span></div>
                    <div className="device-list-status-line"><span className="device-list-status-label">执行</span><span className={`ops-tag ${statusTone(agentStatus(device))}`}>{statusText(agentStatus(device))}</span></div>
                  </td>
                  <td>
                    <span className={`ops-tag ${taskTone(device.currentTask)}`}>{taskText(device.currentTask)}</span>
                    <div className="ops-small">{isBusyDevice(device) ? "正在执行" : "等待指令"}</div>
                  </td>
                  <td>
                    <div>{binding.douyin || "未绑定账号"}</div>
                    <div className="ops-small">{device.platform || "抖音"} · {enabledText(device.enabled)}</div>
                  </td>
                  <td>
                    <div>{device.appVersion || "未上报版本"}</div>
                    <div className="ops-small">目标 {device.targetVersion || "-"} · {device.lastIp || "无 IP"}</div>
                  </td>
                  <td>{formatDateTime(agentHeartbeatAt(device))}</td>
                  {showBindingStatus ? (
                    <td>
                      <div>抖音：{binding.douyin || "未绑定"}</div>
                      <div className="ops-small">视频号能力：{binding.hasChannelsCapability ? "已绑定" : "未绑定"}</div>
                    </td>
                  ) : null}
                  <td>
                    <div className="ops-actions-cell" onClick={(event) => event.stopPropagation()}>
                      <button
                        className="ops-mini-btn"
                        type="button"
                        title="编辑该设备的机型画像覆盖"
                        onClick={() => setProfileDevice(device)}
                      >
                        画像
                      </button>
                      {renderActions(device)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <DeviceProfileModal
        open={!!profileDevice}
        device={profileDevice}
        onClose={() => setProfileDevice(null)}
      />
    </div>
  );
}
