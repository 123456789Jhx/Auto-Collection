import { ExperimentOutlined, InboxOutlined, SendOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, message } from "antd";
import { useEffect, useMemo, useState } from "react";
import { getDevices } from "../lib/api-client";
import {
  claimPublishTaskOnce,
  createManualPublishTest,
  dispatchPublishTasksNow,
  type ManualPublishTestPayload
} from "../lib/api-client-publish-tasks";
import { getRemoteScriptConfigs } from "../lib/api-client-remote-scripts";
import type { DeviceRow } from "./DeviceList";
import { ManualPublishTestModal } from "./ManualPublishTestModal";

type Props = { onTaskCreated: () => void };

export function PublishTaskOperations({ onTaskCreated }: Props) {
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [selectedConfigId, setSelectedConfigId] = useState<string>();
  const [manualOpen, setManualOpen] = useState(false);
  const configsQuery = useQuery({
    queryKey: ["remoteScriptConfigs", "publish_video", "ENABLED", "operations"],
    queryFn: () => getRemoteScriptConfigs({
      scriptKey: "publish_video",
      status: "ENABLED",
      page: 1,
      pageSize: 100
    })
  });
  const devicesQuery = useQuery({ queryKey: ["devices"], queryFn: getDevices });
  const configs = configsQuery.data?.data ?? [];
  const devices = (devicesQuery.data ?? []) as DeviceRow[];
  const configOptions = useMemo(
    () => configs.map((config) => ({ value: config.id, label: config.configName })),
    [configs]
  );

  useEffect(() => {
    if (configs.length && !configs.some((config) => config.id === selectedConfigId)) {
      setSelectedConfigId(configs[0].id);
    }
  }, [configs, selectedConfigId]);

  const claimMutation = useMutation({
    mutationFn: claimPublishTaskOnce,
    onSuccess: async (result) => {
      if (!result.claimed || !result.task) {
        messageApi.info("无待发布任务");
      } else {
        const account = result.task.accountName ? ` · ${result.task.accountName}` : "";
        messageApi.success(`已领取：${result.task.title}${account}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["publishTasks"] });
    },
    onError: (error: Error) => messageApi.error(error.message || "领取任务失败")
  });
  const dispatchMutation = useMutation({
    mutationFn: dispatchPublishTasksNow,
    onSuccess: async (result) => {
      messageApi.success(`调度完成：已下发 ${result.dispatched} 条，已回传 ${result.reported} 条`);
      await queryClient.invalidateQueries({ queryKey: ["publishTasks"] });
    },
    onError: (error: Error) => messageApi.error(error.message || "立即调度失败")
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

  const configSelect = (
    <Select
      value={selectedConfigId}
      loading={configsQuery.isLoading}
      placeholder="选择已启用配置"
      options={configOptions}
      onChange={setSelectedConfigId}
    />
  );

  return (
    <>
      {contextHolder}
      <div className="publish-task-operations-grid">
        <section className="ops-panel">
          <div className="ops-panel-head"><span>领取一条</span></div>
          <div className="ops-panel-body publish-task-operation-body">
            {configSelect}
            <Button
              icon={<InboxOutlined />}
              loading={claimMutation.isPending}
              disabled={!selectedConfigId}
              onClick={() => selectedConfigId && claimMutation.mutate(selectedConfigId)}
            >
              领取一条
            </Button>
          </div>
        </section>
        <section className="ops-panel">
          <div className="ops-panel-head"><span>立即调度</span></div>
          <div className="ops-panel-body publish-task-operation-body">
            {configSelect}
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={dispatchMutation.isPending}
              disabled={!selectedConfigId}
              onClick={() => selectedConfigId && dispatchMutation.mutate(selectedConfigId)}
            >
              立即调度
            </Button>
          </div>
        </section>
        <section className="ops-panel">
          <div className="ops-panel-head"><span>手动测试发布</span></div>
          <div className="ops-panel-body publish-task-operation-body">
            <Button type="primary" icon={<ExperimentOutlined />} onClick={() => setManualOpen(true)}>
              手动测试发布
            </Button>
          </div>
        </section>
      </div>
      <ManualPublishTestModal
        open={manualOpen}
        loading={manualMutation.isPending}
        configs={configs}
        devices={devices}
        defaultConfigId={selectedConfigId}
        onCancel={() => setManualOpen(false)}
        onSubmit={(values: ManualPublishTestPayload) => manualMutation.mutate({
          ...values,
          coverUrl: values.coverUrl?.trim() || null
        })}
      />
    </>
  );
}
