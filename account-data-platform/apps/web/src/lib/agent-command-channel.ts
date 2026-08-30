type AgentChannelState = {
  agentReachable?: boolean;
  desiredAgentState?: string | null;
  agentStatus?: string | null;
  agentLifecycleState?: string | null;
  pollingEnabled?: boolean | null;
  agentStateReason?: string | null;
  agentStateChangedAt?: string | null;
  agentSessionId?: string | null;
};

/** A task can be sent only while the phone Agent is actively reachable. */
export function isAgentCommandChannelOpen(device: AgentChannelState) {
  if (device.desiredAgentState === "stopped") return false;
  if (device.agentStatus === "stopped") return false;
  if (device.agentLifecycleState && device.agentLifecycleState !== "RUNNING") return false;
  if (device.pollingEnabled === false) return false;
  return device.agentReachable !== false;
}

export function shouldNotifyAgentDisconnect(device: AgentChannelState) {
  if (device.agentLifecycleState !== "STOPPED") return false;
  return ["LOCAL_STOP_BUTTON", "LOCAL_STOP_BUTTON_BEFORE_AGENT_STOP", "REMOTE_EXIT_AGENT", "REMOTE_WAKE_EXIT"]
    .includes(String(device.agentStateReason || ""));
}

export function claimAgentDisconnectNotice(device: AgentChannelState) {
  if (!shouldNotifyAgentDisconnect(device) || typeof window === "undefined") return false;
  const eventKey = [device.agentSessionId || "unknown", device.agentStateChangedAt || device.agentStateReason].join(":");
  const storageKey = `agent-disconnect-notice:${eventKey}`;
  if (window.sessionStorage.getItem(storageKey) === "1") return false;
  window.sessionStorage.setItem(storageKey, "1");
  return true;
}

export function agentDisconnectMessage(device: AgentChannelState) {
  if (String(device.agentStateReason || "") === "LOCAL_STOP_BUTTON") {
    return {
      title: "Agent 已手动停止",
      description: "当前业务任务已停止，旧任务已完成收口。",
      recovery: ""
    };
  }
  const reason = device.agentLifecycleState === "STOPPED" || device.pollingEnabled === false
    ? "内部 Agent 已断联，当前业务任务已通过外部 Agent 安全停止。"
    : "内部 Agent 暂不可用，当前无法发送新的业务命令。";
  return {
    title: "设备操作暂不可用",
    description: reason,
    recovery: "请先在手机端点击“一键启动”。"
  };
}
