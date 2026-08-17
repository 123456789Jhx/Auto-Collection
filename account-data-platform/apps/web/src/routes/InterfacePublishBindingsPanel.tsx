import { UserSwitchOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useState } from "react";
import { InterfacePublishBindingModal } from "./InterfacePublishBindingModal";

export function InterfacePublishBindingsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button icon={<UserSwitchOutlined />} onClick={() => setOpen(true)}>
        匹配设备
      </Button>
      <InterfacePublishBindingModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
