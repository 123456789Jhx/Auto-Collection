import { AppstoreOutlined, RadarChartOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import { DeviceBindingList } from "./DeviceBindingList";

export function DeviceAccountsPage() {
  return (
    <div className="ops-page device-accounts-page">
      <div className="device-accounts-hero">
        <div className="device-accounts-hero-copy">
          <div className="device-accounts-hero-kicker"><RadarChartOutlined /> 设备控制台</div>
          <Typography.Title level={2}>设备账号</Typography.Title>
          <Typography.Paragraph>集中查看设备状态、账号绑定和机型方案</Typography.Paragraph>
        </div>
        <div className="device-accounts-hero-mark" aria-hidden="true">
          <AppstoreOutlined />
        </div>
      </div>
      <DeviceBindingList />
    </div>
  );
}
