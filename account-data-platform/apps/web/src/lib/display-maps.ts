export function statusText(value?: string | null) {
  const map: Record<string, string> = {
    booting: "启动中",
    idle: "待命",
    online: "在线",
    offline: "Agent 失联",
    agent_unreachable: "Agent 失联",
    unknown: "底座待接入",
    running: "运行中",
    paused: "已暂停",
    stopped: "已停止",
    updating: "更新中",
    risk_control: "风控停止",
    error: "异常"
  };
  return value ? (map[value] ?? value) : "-";
}

export function statusColor(value?: string | null) {
  if (value === "error") return "red";
  if (value === "risk_control") return "red";
  if (value === "offline" || value === "stopped" || value === "unknown" || value === "agent_unreachable") return "default";
  if (value === "paused" || value === "idle" || value === "booting" || value === "updating") return "orange";
  return "green";
}

export function sceneText(value?: string | null) {
  const map: Record<string, string> = {
    video: "视频",
    live: "直播",
    live_comment: "搜索直播间评论",
    commerce_card_live_comment: "商品卡养号"
  };
  return value ? (map[value] ?? value) : "-";
}

export function normalizeTaskDisplayText(value?: string | null) {
  if (!value) return value || "";
  return value
    .replace(/目标直播间评论（商品卡片养号）/g, "目标直播评论")
    .replace(/目标直播间评论/g, "目标直播评论")
    .replace(/目标评论/g, "目标直播评论")
    .replace(/商品卡直播评论任务/g, "商品卡养号任务")
    .replace(/商品卡直播评论启动流程/g, "商品卡养号启动流程")
    .replace(/商品卡直播评论配置/g, "商品卡养号配置")
    .replace(/商品卡直播评论/g, "商品卡养号")
    .replace(/商品卡组合任务/g, "商品卡养号")
    .replace(/组合任务/g, "商品卡养号");
}

export function levelText(value?: string | null) {
  const map: Record<string, string> = {
    INFO: "信息",
    WARN: "警告",
    ERROR: "错误"
  };
  return value ? (map[value] ?? value) : "-";
}

export function levelColor(value?: string | null) {
  if (value === "ERROR") return "red";
  if (value === "WARN") return "orange";
  return "blue";
}

export function stopReasonText(value?: string | null) {
  const map: Record<string, string> = {
    manual_stop: "手动停止",
    backend_stop: "后台停止",
    backend_close: "后台关闭脚本",
    risk_control: "风控停止",
    duration_finished: "时长完成",
    phase_finished: "阶段完成",
    recover_limit: "恢复超限",
    max_videos: "视频数量达上限",
    max_captures: "采集数量达上限",
    permission_failed: "权限失败"
  };
  return value ? (map[value] ?? value) : "-";
}

export function commandText(value?: string | null) {
  const map: Record<string, string> = {
    START: "启动/继续任务",
    PAUSE: "暂停",
    RESUME: "恢复",
    STOP: "关闭脚本",
    REFRESH_CONFIG: "刷新配置",
    STATUS: "查询状态",
    UPLOAD_LOG: "上传日志"
  };
  return value ? (map[value] ?? value) : "-";
}

export type DeviceDisplayLike = {
  deviceCode?: string | null;
  deviceName?: string | null;
  douyinAccountName?: string | null;
};

export function deviceDisplayName(device?: DeviceDisplayLike | null) {
  return device?.douyinAccountName || device?.deviceName || device?.deviceCode || "未知设备";
}

export function deviceSubTitle(device?: DeviceDisplayLike | null) {
  const code = device?.deviceCode || "未上报设备编号";
  if (device?.douyinAccountName && device?.deviceName && device.deviceName !== device.douyinAccountName) {
    return `${code} / ${device.deviceName}`;
  }
  return code;
}
