import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Skeleton } from "antd";
import { getDevices } from "../lib/api-client";
import { DeviceAccountBindingControl } from "./DeviceAccountBindingControl";
import { DeviceList, type DeviceRow } from "./DeviceList";

export function DeviceBindingList() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["devices"],
    queryFn: getDevices,
    refetchInterval: 15_000
  });

  if (query.isLoading) return <Skeleton active />;
  if (query.isError) return <Alert type="error" message="设备列表加载失败" description={query.error.message} showIcon />;

  const devices = (query.data ?? []) as DeviceRow[];

  return (
    <DeviceList
      devices={devices}
      renderActions={(device) => (
        <DeviceAccountBindingControl
          device={device}
          onSaved={() => void queryClient.invalidateQueries({ queryKey: ["devices"] })}
        />
      )}
      showBindingStatus
      actionsLabel="绑定操作"
      title="设备绑定清单"
    />
  );
}
