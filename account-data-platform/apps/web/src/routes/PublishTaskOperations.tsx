import { ExperimentOutlined, SendOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, message } from "antd";
import { useMemo, useState } from "react";
import { getDevices } from "../lib/api-client";
import {
  createManualPublishTest,
  dispatchExistingPublishTask,
  type ManualPublishTestPayload
} from "../lib/api-client-publish-tasks";
import { getRemoteScriptConfigs } from "../lib/api-client-remote-scripts";
import type { DeviceRow } from "./DeviceList";
import { ManualPublishTestModal } from "./ManualPublishTestModal";

type Props = { onTaskCreated: () => void };

export function PublishTaskOperations({ onTaskCreated }: Props) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [directTaskId, setDirectTaskId] = useState("");
  const [manualOpen, setManualOpen] = useState(false);
  const directConfigsQuery = useQuery({
    queryKey: ["remoteScriptConfigs", "publish_video", "ENABLED", "operations", "direct_material"],
    queryFn: () => getRemoteScriptConfigs({
      scriptKey: "publish_video",
      status: "ENABLED",
      sourceMode: "direct_material",
      page: 1,
      pageSize: 100
    })
  });
  const devicesQuery = useQuery({ queryKey: ["devices"], queryFn: getDevices });
  const directConfigs = useMemo(
    () => (directConfigsQuery.data?.data ?? []).filter(
      (config) => config.configPayload.sourceMode === "direct_material"
    ),
    [directConfigsQuery.data?.data]
  );
  const devices = (devicesQuery.data ?? []) as DeviceRow[];
  const manualDefaultConfigId = useMemo(
    () => directConfigs.find((config) => config.configPayload.isDefault === true)?.id ?? directConfigs[0]?.id,
    [directConfigs]
  );

  const directTaskMutation = useMutation({
    mutationFn: dispatchExistingPublishTask,
    onSuccess: async (result) => {
      messageApi.success("已下发接口任务：" + result.task.title);
      setDirectTaskId("");
      await queryClient.invalidateQueries({ queryKey: ["publishTasks"] });
      onTaskCreated();
    },
    onError: (error: Error) => messageApi.error(error.message || "接口任务下发失败")
  });
  const manualMutation = useMutation({
    mutationFn: createManualPublishTest,
    onSuccess: async (result) => {
      messageApi.success(`手动测试已下发：${result.task.title}`);
      setManualOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["publishTasks"] });
      onTaskCreated();
    },
    onError: (error: Error) => messageApi.error(error.message || "手动测试发布失败")
  });

  return (
    <>
      {contextHolder}
      <div className="publish-task-operations-grid">
        <section className="ops-panel">
          <div className="ops-panel-head"><span>指定接口任务直发（单条）</span></div>
          <div className="ops-panel-body publish-task-operation-body">
            <Input
              value={directTaskId}
              placeholder="粘贴已入库的接口任务 ID"
              onChange={(event) => setDirectTaskId(event.target.value)}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={directTaskMutation.isPending}
              disabled={!directTaskId.trim()}
              onClick={() => directTaskMutation.mutate(directTaskId.trim())}
            >
              只下发这一条任务
            </Button>
          </div>
        </section>
        <section className="ops-panel">
          <div className="ops-panel-head"><span>手动测试发布（联调工具）</span></div>
          <div className="ops-panel-body publish-task-operation-body">
            <Button
              type="primary"
              icon={<ExperimentOutlined />}
              loading={directConfigsQuery.isLoading}
              disabled={directConfigsQuery.isLoading}
              onClick={() => {
                if (!directConfigs.length) {
                  messageApi.warning("请先到发布设置创建直接素材发布配置");
                  return;
                }
                setManualOpen(true);
              }}
            >
              手动测试发布（联调工具）
            </Button>
          </div>
        </section>
      </div>
      <ManualPublishTestModal
        open={manualOpen}
        loading={manualMutation.isPending}
        configs={directConfigs}
        devices={devices}
        defaultConfigId={manualDefaultConfigId}
        onCancel={() => setManualOpen(false)}
        onSubmit={(values: ManualPublishTestPayload) => manualMutation.mutate({
          ...values,
          coverUrl: values.coverUrl.trim()
        })}
      />
    </>
  );
}
