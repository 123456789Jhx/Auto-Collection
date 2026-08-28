type AgentChannelState = {
  agentReachable?: boolean;
  desiredAgentState?: string | null;
  agentStatus?: string | null;
  agentLifecycleState?: string | null;
  pollingEnabled?: boolean | null;
};

/** A task can be sent only while the phone Agent is actively reachable. */
export function isAgentCommandChannelOpen(device: AgentChannelState) {
  if (device.desiredAgentState === "stopped") return false;
  if (device.agentStatus === "stopped") return false;
  if (device.agentLifecycleState && device.agentLifecycleState !== "RUNNING") return false;
  if (device.pollingEnabled === false) return false;
  return device.agentReachable !== false;
}

export function agentDisconnectMessage(device: AgentChannelState) {
  const reason = device.agentLifecycleState === "STOPPED" || device.pollingEnabled === false
    ? "内部 Agent 已断联，当前业务任务已通过外部 Agent 安全停止。"
    : "内部 Agent 暂不可用，当前无法发送新的业务命令。";
  return {
    title: "设备操作暂不可用",
    description: reason,
    recovery: "请先在手机端点击“一键启动”。"
  };
}
