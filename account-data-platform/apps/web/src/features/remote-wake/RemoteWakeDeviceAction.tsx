import { LogoutOutlined, PoweroffOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { App as AntdApp, Button, Descriptions, Space, Switch, Tag, Tooltip } from "antd";
import { useEffect, useRef, useState } from "react";
import { createMobileCommand, getMobileCommands, type MobileCommand } from "../../lib/api-client";
import type { DeviceRow } from "../../routes/DeviceList";
import {
  exitAgentAppBusinessResult,
  type ExitAgentAppCommandView,
  exitAgentAppStages,
  exitAgentAppTransportStatus,
  findActiveExitAgentAppCommand,
  isExitAgentAppCommandActive,
  readExitAgentAppCommandId,
  resolveExitAgentAppAction,
  resolveRemoteWakeAction,
  selectExitAgentAppCommand,
  writeExitAgentAppCommandId
} from "./remote-wake-action-plan";

type RemoteWakeDeviceActionProps = {
  device: DeviceRow;
  disabled?: boolean;
};

export function RemoteWakeDeviceAction({
  device,
  disabled = false
}: RemoteWakeDeviceActionProps) {
  const { message, modal } = AntdApp.useApp();
  const [submitting, setSubmitting] = useState(false);
  const [exitCommandId, setExitCommandId] = useState(() => readExitAgentAppCommandId(device.deviceCode));
  const [submittedExitCommand, setSubmittedExitCommand] = useState<MobileCommand | null>(null);
  const submittingRef = useRef(false);
  const deviceName = device.deviceName || device.deviceCode;
  const commandsQuery = useQuery({
    queryKey: ["remote-wake-mobile-commands"],
    queryFn: getMobileCommands,
    refetchInterval: 3_000
  });

  useEffect(() => {
    setExitCommandId(readExitAgentAppCommandId(device.deviceCode));
    setSubmittedExitCommand(null);
  }, [device.deviceCode]);

  const polledCommands = commandsQuery.data ?? [];
  const availableCommands = submittedExitCommand && !polledCommands.some((command) => command.id === submittedExitCommand.id)
    ? [...polledCommands, submittedExitCommand]
    : polledCommands;
  const activeExitCommand = findActiveExitAgentAppCommand(availableCommands, device);
  const persistedExitCommand = selectExitAgentAppCommand(
    availableCommands,
    exitCommandId,
    device
  );
  const exitCommand = activeExitCommand ?? persistedExitCommand;
  const exitCommandActive = exitCommand ? isExitAgentAppCommandActive(exitCommand) : false;

  const submitCommand = async (
    commandType: "START_AGENT" | "OPEN_AGENT_APP" | "EXIT_AGENT_APP",
    payload?: Record<string, unknown>
  ) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const command = await createMobileCommand({
        deviceId: device.deviceCode,
        commandType,
        ...(payload ? { payload } : {}),
        expiresInSeconds: 300
      });
      if (commandType === "EXIT_AGENT_APP" && command?.id) {
        writeExitAgentAppCommandId(device.deviceCode, command.id);
        setExitCommandId(command.id);
        setSubmittedExitCommand(command);
      }
      message.success(commandType === "EXIT_AGENT_APP"
        ? "退出燎原星火指令已下发"
        : commandType === "START_AGENT" ? "开启 Agent 指令已下发" : "打开燎原星火指令已下发");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "指令下发失败");
      throw error;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const handleClick = () => {
    const plan = resolveRemoteWakeAction(device);
    if (plan.kind !== "confirm" || !plan.commandType) {
      modal.info({ title: plan.title, content: plan.content, okText: "知道了" });
      return;
    }
    modal.confirm({
      title: plan.title,
      content: plan.content,
      okText: "确认",
      cancelText: "取消",
      onOk: () => submitCommand(plan.commandType!)
    });
  };

  const handleExitClick = () => {
    if (exitCommandActive || submitting || submittingRef.current) return;
    const plan = resolveExitAgentAppAction(device);
    if (plan.kind !== "confirm" || !plan.commandType) {
      modal.info({ title: plan.title, content: plan.content, okText: "知道了" });
      return;
    }

    let lockScreen = false;
    modal.confirm({
      title: plan.title,
      content: (
        <Space direction="vertical" size={12}>
          <span>{plan.content}</span>
          <Descriptions
            size="small"
            column={1}
            items={[
              {
                key: "agent",
                label: "Agent",
                children: device.agentReachable === true ? "RUNNING" : "STOPPED"
              },
              {
                key: "screen",
                label: "Screen",
                children: String(device.screenState || "unknown").toUpperCase()
              },
              {
                key: "app-ui-task",
                label: "App UI task",
                children: String(device.appUiState || "unknown").toUpperCase()
              }
            ]}
          />
          <Switch
            defaultChecked={false}
            checkedChildren="锁屏"
            unCheckedChildren="不锁屏"
            onChange={(checked) => { lockScreen = checked; }}
          /> 退出后锁屏
        </Space>
      ),
      okText: "确认退出",
      cancelText: "取消",
      onOk: () => submitCommand("EXIT_AGENT_APP", { lockScreen })
    });
  };

  return (
    <div className="ops-actions-cell">
      <Tooltip title={`打开${deviceName ? `“${deviceName}”` : "该设备"}上的燎原星火`}>
        <Button
          type="primary"
          icon={<PoweroffOutlined />}
          disabled={disabled || submitting}
          loading={submitting}
          onClick={handleClick}
        >
          打开燎原星火
        </Button>
      </Tooltip>
      <Tooltip title={`退出${deviceName ? `“${deviceName}”` : "该设备"}上的燎原星火，不影响底座连接`}>
        <Button
          danger
          icon={<LogoutOutlined />}
          disabled={disabled || submitting || exitCommandActive}
          loading={submitting}
          onClick={handleExitClick}
        >
          退出燎原星火
        </Button>
      </Tooltip>
      {exitCommand ? <ExitCommandStatus command={exitCommand} /> : null}
    </div>
  );
}

function ExitCommandStatus({ command }: { command: ExitAgentAppCommandView }) {
  const transportStatus = exitAgentAppTransportStatus(command);
  const businessResult = exitAgentAppBusinessResult(command);
  const stages = exitAgentAppStages(command);
  return (
    <div
      className="ops-small"
      aria-live="polite"
      style={{ flexBasis: "100%", maxWidth: 260, lineHeight: 1.35, wordBreak: "break-word" }}
    >
      <div>
        Transport: <Tag color={statusColor(transportStatus)}>{transportStatus}</Tag>
      </div>
      {businessResult ? (
        <div>
          Result: <Tag color={statusColor(businessResult)}>{businessResult}</Tag>
        </div>
      ) : null}
      <div>
        {stages.map((stage) => {
          const stageStatus = stage.status || "NOT_REPORTED";
          return (
            <div key={stage.name}>
              {stage.name}: {stageStatus}{stage.reason ? ` (${stage.reason})` : ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function statusColor(status: string) {
  if (status === "DONE" || status === "SUCCESS") return "success";
  if (status === "FAILED" || status === "TIMED_OUT") return "error";
  if (status === "PARTIAL") return "warning";
  if (status === "IGNORED") return "default";
  return "processing";
}
