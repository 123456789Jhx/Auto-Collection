import { ClockCircleOutlined, MobileOutlined, PlayCircleOutlined, SearchOutlined, SettingOutlined, StopOutlined, TeamOutlined } from "@ant-design/icons";
import { Alert, Button, Input, InputNumber, Select, Space } from "antd";
import { useState } from "react";
import type { DeviceRow } from "../../routes/DeviceList";
import { CommentActionTimingPanel } from "../device-profile/CommentActionTimingPanel";

type Props = {
  targetKeyword: string;
  minViewerCount: number;
  captureDurationMinutes: number;
  selectedDeviceCodes: string[];
  selectableDevices: DeviceRow[];
  devices: DeviceRow[];
  locked: boolean;
  loadingDevices: boolean;
  devicesError: boolean;
  starting: boolean;
  stopping: boolean;
  canStop: boolean;
  onKeywordChange: (value: string) => void;
  onViewerCountChange: (value: number) => void;
  onDurationChange: (value: number) => void;
  onDevicesChange: (value: string[]) => void;
  onReloadDevices: () => void;
  onStart: () => void;
  onStop: () => void;
};

export function LiveCommentTaskSetup(props: Props) {
  const [settingsDeviceCode, setSettingsDeviceCode] = useState<string>();
  const [timingOpen, setTimingOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<{ deviceCode: string; deviceName?: string }>();
  const settingsDevice = props.devices.find((device) => device.deviceCode === settingsDeviceCode)
    ?? props.devices.find((device) => props.selectedDeviceCodes.includes(device.deviceCode))
    ?? props.devices[0];
  const selectedOptions = new Set(props.selectableDevices.map((device) => device.deviceCode));
  const deviceOptions = [
    ...props.selectableDevices,
    ...props.devices.filter((device) => props.selectedDeviceCodes.includes(device.deviceCode) && !selectedOptions.has(device.deviceCode))
  ];
  return (
    <aside className="lc-task-setup" aria-label="抓取任务设置">
      <div className="lc-section-title"><span className="lc-section-number">01</span><div><h2>任务设置</h2><p>设定目标，选择本次执行设备</p></div></div>
      <div className="lc-task-fields">
        <label className="lc-field" htmlFor="lc-keyword">
          <span>目标直播间关键词</span>
          <Input id="lc-keyword" prefix={<SearchOutlined />} aria-label="目标直播间关键词" placeholder="输入直播名称关键词"
            maxLength={100} value={props.targetKeyword} disabled={props.locked} onChange={(event) => props.onKeywordChange(event.target.value)} />
        </label>
        <div className="lc-field-pair">
          <label className="lc-field" htmlFor="lc-viewers">
            <span><TeamOutlined /> 人数下限</span>
            <Space.Compact className="lc-unit-input"><InputNumber id="lc-viewers" aria-label="直播间人数下限" min={0} precision={0} value={props.minViewerCount}
              disabled={props.locked} onChange={(value) => props.onViewerCountChange(value ?? 300)} /><span className="lc-field-unit">人</span></Space.Compact>
            <small>填 0 则不限制人数</small>
          </label>
          <label className="lc-field" htmlFor="lc-duration">
            <span><ClockCircleOutlined /> 单场抓取时长</span>
            <Space.Compact className="lc-unit-input"><InputNumber id="lc-duration" aria-label="每个直播间抓取时长（分钟）" min={1} max={60} precision={0}
              value={props.captureDurationMinutes} disabled={props.locked} onChange={(value) => props.onDurationChange(value ?? 5)} /><span className="lc-field-unit">分钟</span></Space.Compact>
            <small>每个直播间 1–60 分钟</small>
          </label>
        </div>
        <div className="lc-field lc-device-selection">
          <div className="lc-field-heading"><label htmlFor="lc-devices">选择执行设备</label><span>{props.selectableDevices.length} 台可用</span></div>
          <Select id="lc-devices" mode="multiple" aria-label="选择执行设备" placeholder="选择一台或多台在线设备"
            value={props.selectedDeviceCodes} disabled={props.locked} maxCount={200} maxTagCount="responsive"
            loading={props.loadingDevices} optionFilterProp="label"
            options={deviceOptions.map((device) => ({ value: device.deviceCode, label: device.deviceName ? `${device.deviceName} · ${device.deviceCode}` : device.deviceCode, disabled: !selectedOptions.has(device.deviceCode) }))}
            onChange={props.onDevicesChange} />
          <div className="lc-selection-tools">
            <span><MobileOutlined /> 已选 {props.selectedDeviceCodes.length} 台</span>
            <Button type="link" size="small" disabled={props.locked || !props.selectableDevices.length}
              onClick={() => props.onDevicesChange(props.selectableDevices.slice(0, 200).map((device) => device.deviceCode))}>选择全部可用</Button>
          </div>
          {props.devicesError ? <Alert showIcon type="error" message="设备列表读取失败" action={<Button size="small" onClick={props.onReloadDevices}>重试</Button>} /> : null}
          {!props.devicesError && !props.loadingDevices && !props.selectableDevices.length ? <p className="lc-field-note">暂无空闲可用设备，请检查连接状态或等待当前任务结束。</p> : null}
        </div>
      </div>
      <div className="lc-task-dispatch">
        <Button block size="large" type="primary" icon={<PlayCircleOutlined />}
          disabled={props.locked || props.devicesError || !props.targetKeyword.trim() || !props.selectedDeviceCodes.length}
          loading={props.starting} onClick={props.onStart}>开始抓取评论</Button>
        <Button block danger icon={<StopOutlined />} disabled={!props.canStop} loading={props.stopping} onClick={props.onStop}>停止本批任务</Button>
        <p>{props.locked ? "任务执行期间，当前抓取条件已锁定。" : "任务按设备执行，可在右侧分别查看和停止。"}</p>
      </div>
      <section className="lc-device-settings" aria-labelledby="lc-settings-heading">
        <div className="lc-settings-heading"><SettingOutlined /><h3 id="lc-settings-heading">设备动作设置</h3></div>
        <p>为每台设备调整动作前后的等待时间。</p>
        <Select aria-label="选择要配置的设备" placeholder="选择要配置的设备" value={settingsDevice?.deviceCode}
          showSearch optionFilterProp="label" loading={props.loadingDevices} disabled={props.devicesError || !props.devices.length}
          options={props.devices.map((device) => ({ value: device.deviceCode, label: device.deviceName ? `${device.deviceName} · ${device.deviceCode}` : device.deviceCode }))}
          onChange={setSettingsDeviceCode} />
        <Button block icon={<ClockCircleOutlined />} disabled={props.devicesError || !settingsDevice} onClick={() => {
          if (!settingsDevice) return;
          setEditingDevice({ deviceCode: settingsDevice.deviceCode, deviceName: settingsDevice.deviceName });
          setTimingOpen(true);
        }}>调整动作间隔</Button>
        <small>保存后，还可以复制到其他设备。</small>
      </section>
      <CommentActionTimingPanel open={timingOpen} device={{ deviceCode: editingDevice?.deviceCode ?? "",
        deviceName: editingDevice?.deviceName, platform: "douyin" }} onClose={() => setTimingOpen(false)} />
    </aside>
  );
}
