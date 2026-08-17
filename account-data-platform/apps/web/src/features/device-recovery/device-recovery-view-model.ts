import type {
  DeviceRecoveryErrorCode,
  DeviceRecoverySource,
  DeviceRecoveryStage
} from "@pkg/types";

const stages: DeviceRecoveryStage[] = [
  "WAITING_DEVICE",
  "SYSTEM_BOOTED",
  "NETWORK_CONNECTED",
  "AGENT_LAUNCHED",
  "DEVICE_REGISTERED",
  "HEARTBEAT_RESTORED",
  "COMMAND_CHANNEL_READY"
];

const stageText: Record<DeviceRecoveryStage, string> = {
  WAITING_DEVICE: "等待 Agent 响应",
  SYSTEM_BOOTED: "手机系统已启动",
  NETWORK_CONNECTED: "网络已连接",
  AGENT_LAUNCHED: "燎原星火已启动",
  DEVICE_REGISTERED: "设备已注册",
  HEARTBEAT_RESTORED: "心跳已恢复",
  COMMAND_CHANNEL_READY: "Agent 已就绪"
};

const errorText: Record<DeviceRecoveryErrorCode, string> = {
  DEVICE_UNREACHABLE: "未收到 Agent 响应，无法确认手机是否开机",
  NETWORK_READY_TIMEOUT: "手机已启动，但网络连接超时",
  AGENT_LAUNCH_TIMEOUT: "网络已连接，但燎原星火启动超时",
  DEVICE_REGISTRATION_TIMEOUT: "燎原星火已启动，但设备注册超时",
  HEARTBEAT_RESTORE_TIMEOUT: "设备已注册，但心跳恢复超时",
  COMMAND_CHANNEL_TIMEOUT: "心跳已恢复，但命令通道尚未就绪",
  SCREEN_WAKE_FAILED: "手机亮屏失败",
  KEYGUARD_DISMISS_FAILED: "锁屏解除失败",
  APP_LAUNCH_FAILED: "燎原星火启动失败",
  SECURE_KEYGUARD_REQUIRES_USER: "安全锁无法自动解除，请手动解锁手机"
};

export function deviceRecoverySourceText(source: DeviceRecoverySource) {
  return source === "AUTO_BOOT" ? "开机自动恢复" : "后台手动唤醒";
}

export function deviceRecoveryStageText(stage: DeviceRecoveryStage) {
  return stageText[stage];
}

export function deviceRecoveryProgress(stage: DeviceRecoveryStage) {
  return Math.round((stages.indexOf(stage) / (stages.length - 1)) * 100);
}

export function deviceRecoveryErrorText(code?: DeviceRecoveryErrorCode, message?: string) {
  if (code === "DEVICE_UNREACHABLE") return errorText[code];
  return message?.trim() || (code ? errorText[code] : "设备恢复失败");
}

export function formatRecoveryDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return minutes ? `${minutes}分${remainingSeconds}秒` : `${remainingSeconds}秒`;
}
