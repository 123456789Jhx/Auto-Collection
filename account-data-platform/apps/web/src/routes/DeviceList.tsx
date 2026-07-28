import type { ReactNode } from "react";
import { deviceDisplayName, deviceSubTitle, normalizeTaskDisplayText, statusText } from "../lib/display-maps";

export type DeviceRow = {
  id: string;
  deviceCode: string;
  deviceName?: string;
  douyinAccountName?: string | null;
  platform?: string;
  status: string;
  reportedStatus?: string;
  currentTask?: "video" | "live" | "live_comment" | "commerce_card_live_comment" | "none";
  effectiveStatus: string;
  lastHeartbeatAt?: string;
  heartbeatAgeMinutes?: number | null;
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

function bindingAccountName(device: DeviceRow) {
  const profile = device.accountProfile;
  const value = profile?.douyinAccountName;
  return typeof value === "string" ? value.trim() : "";
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

  return (
    <div className="ops-panel">
      <div className="ops-panel-head">
        <span>{title}</span>
        <span className="ops-small">{devices.length} 台</span>
      </div>
      <div className="ops-table-wrap">
        <table className="ops-table">
          <thead>
            <tr>
              <th>设备</th>
              <th>当前状态</th>
              <th>当前任务</th>
              <th>平台 / 启用</th>
              <th>版本 / IP</th>
              <th>最后心跳</th>
              {showBindingStatus ? <th>绑定状态</th> : null}
              <th>{actionsLabel}</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? <tr><td className="ops-empty" colSpan={columnCount}>没有符合条件的设备</td></tr> : null}
            {devices.map((device) => {
              const accountName = bindingAccountName(device);
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
                  <td><span className={`ops-tag ${statusTone(device.effectiveStatus || device.status)}`}>{statusText(device.effectiveStatus || device.status)}</span></td>
                  <td><span className={`ops-tag ${taskTone(device.currentTask)}`}>{taskText(device.currentTask)}</span></td>
                  <td>
                    <div>{device.platform || "-"}</div>
                    <span className={`ops-tag ${device.enabled === false ? "red" : "green"}`}>{enabledText(device.enabled)}</span>
                  </td>
                  <td>
                    <div>{device.appVersion || "-"} / {device.targetVersion || "-"}</div>
                    <div className="ops-small">{device.lastIp || "-"}</div>
                  </td>
                  <td>{formatDateTime(device.lastHeartbeatAt)}</td>
                  {showBindingStatus ? (
                    <td><span className={`ops-tag ${accountName ? "green" : "gray"}`}>{accountName || "未绑定"}</span></td>
                  ) : null}
                  <td>
                    <div className="ops-actions-cell" onClick={(event) => event.stopPropagation()}>
                      {renderActions(device)}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
