import { useQuery } from "@tanstack/react-query";
import { Alert, Skeleton, Tag, Typography } from "antd";
import { getDevices } from "../../lib/api-client";
import { deviceDisplayName, type DeviceRow } from "../../routes/DeviceList";
import { RemoteWakeDeviceAction } from "./RemoteWakeDeviceAction";
import { BaseConnectivityStatus } from "./BaseConnectivityStatus";

function normalizeDevice(value: unknown): DeviceRow | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.deviceCode !== "string" || !row.deviceCode.trim()) return null;
  const status = typeof row.status === "string" ? row.status : "unknown";
  return {
    ...row,
    id: typeof row.id === "string" && row.id ? row.id : row.deviceCode,
    deviceCode: row.deviceCode,
    deviceName: typeof row.deviceName === "string" ? row.deviceName : undefined,
    status,
    effectiveStatus: typeof row.effectiveStatus === "string" ? row.effectiveStatus : status
  } as DeviceRow;
}

function agentStatusText(device: DeviceRow) {
  return device.agentReachable ? "已开启" : "未开启";
}

function screenStatusText(device: DeviceRow) {
  if (!device.baseReachable || device.baseStatus !== "online") return "未知";
  return device.screenState === "locked" ? "已锁屏" : device.screenState === "unlocked" ? "已解锁" : "未知";
}

function appUiStatusText(device: DeviceRow) {
  if (!device.baseReachable || device.baseStatus !== "online") return "未知";
  const labels: Record<string, string> = {
    foreground: "前台",
    background: "后台",
    not_running: "未运行",
    unknown: "未知"
  };
  return labels[String(device.appUiState || "unknown")] || "未知";
}

export function RemoteWakePage() {
  const devicesQuery = useQuery({
    queryKey: ["remote-wake-devices"],
    queryFn: getDevices,
    refetchInterval: 1_000
  });
  const devices = (devicesQuery.data ?? []).flatMap((value) => {
    const device = normalizeDevice(value);
    return device ? [device] : [];
  });

  return (
    <div className="ops-page">
      <header className="ops-page-head">
        <Typography.Title level={3}>远程唤醒</Typography.Title>
      </header>
      {devicesQuery.isLoading ? <Skeleton active /> : null}
      {devicesQuery.isError ? <Alert type="error" showIcon message="设备列表加载失败" description={devicesQuery.error.message} /> : null}
      {!devicesQuery.isLoading && !devicesQuery.isError ? (
        <div className="ops-panel">
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th>设备</th>
                  <th>设备接入</th>
                  <th>Agent</th>
                  <th>屏幕</th>
                  <th>App界面</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {devices.length === 0 ? <tr><td className="ops-empty" colSpan={6}>暂无设备</td></tr> : null}
                {devices.map((device) => {
                  return (
                    <tr key={device.id || device.deviceCode}>
                      <td>{deviceDisplayName(device)}</td>
                      <td>
                        <BaseConnectivityStatus
                          deviceCode={device.deviceCode}
                          status={device.baseConnectivityStatus ?? "OFFLINE"}
                          elapsedSeconds={device.baseConnectivityElapsedSeconds ?? null}
                          offlineThresholdSeconds={device.baseOfflineThresholdSeconds ?? 15}
                          reconnectProgressPercent={device.baseReconnectProgressPercent ?? 100}
                        />
                      </td>
                      <td><Tag color={device.agentReachable ? "success" : "default"}>{agentStatusText(device)}</Tag></td>
                      <td><Tag>{screenStatusText(device)}</Tag></td>
                      <td><Tag>{appUiStatusText(device)}</Tag></td>
                      <td>
                        <RemoteWakeDeviceAction
                          device={device}
                          disabled={device.enabled === false}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
