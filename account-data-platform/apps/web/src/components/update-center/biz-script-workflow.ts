import type { BizScriptDevice, BizScriptPreview } from "@pkg/types";

export function getDeviceScopeBlocker(device: BizScriptDevice, preview: BizScriptPreview): string | null {
  if (!device.enabled) return "设备已停用";
  if (!device.fresh) return "心跳已过期";
  if (!device.hotUpdateAllowed) return "设备未开放业务热更新";
  if (device.baseCompatibilityId !== preview.baseCompatibilityId) return "基座不兼容，需更新 APK";
  return null;
}

export function getPromotionBlocker(preview: BizScriptPreview, devices: BizScriptDevice[]): string | null {
  if (preview.stage !== "TESTING") return "尚未进入试运行";
  if (!preview.testDeviceIds.length) return "没有试运行设备";
  const byId = new Map(devices.map((device) => [device.deviceId, device]));
  for (const id of preview.testDeviceIds) {
    const device = byId.get(id);
    if (!device) return `试运行设备 ${id} 暂无状态`;
    const label = device.deviceName || device.deviceCode;
    const blocker = getDeviceScopeBlocker(device, preview);
    if (blocker) return `${label}：${blocker}`;
    if (device.currentVersion !== preview.version || device.source !== "overlay"
      || device.sourceSha256 !== preview.sourceSha256) return `${label} 尚未确认加载本版本覆盖层`;
  }
  return null;
}

export function formatBizDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}

export const stageLabels = { DRAFT: "待试运行", TESTING: "试运行中", PROMOTED: "已推广", REVOKED: "已撤回" } as const;
export const deviceStateLabels = {
  UNKNOWN: "未上报", NEEDS_APK: "需更新 APK", OFFLINE: "离线", READY: "可更新", PENDING: "待下载",
  PENDING_RESTART: "待重启加载", CURRENT: "当前已加载", FAILED: "更新失败", REJECTED: "加载被拒绝"
} as const;
