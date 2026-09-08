import { Drawer, Empty, List, Spin, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLiveRoomCaptures, type LiveCommentEntryMobileCommand, type LiveRoomCapture } from "../../lib/api-client-live-comment-entry";
import { LiveRoomProfilePanel } from "./LiveRoomProfilePanel";

function roomTitle(room: LiveRoomCapture) {
  return room.accountName || room.accountId || room.roomName || room.roomKey || "未命名直播间";
}

export function LiveCommentDeviceDrawer(props: {
  open: boolean;
  batchId: string;
  row: LiveCommentEntryMobileCommand & { deviceName?: string; deviceCode?: string } | null;
  onClose: () => void;
}) {
  const [selectedRoomId, setSelectedRoomId] = useState("");
  const deviceId = props.row?.deviceId || "";
  const capturesQuery = useQuery({
    queryKey: ["liveRoomCaptures", props.batchId, deviceId],
    queryFn: () => getLiveRoomCaptures({ batchId: props.batchId, deviceId }),
    enabled: props.open && Boolean(props.batchId && deviceId),
    refetchInterval: props.open ? 3_000 : false
  });
  const captures = capturesQuery.data ?? [];
  const selectedRoom = captures.find((room) => room.id === selectedRoomId) || captures[0];

  useEffect(() => {
    if (!captures.some((room) => room.id === selectedRoomId)) setSelectedRoomId(captures[0]?.id || "");
  }, [captures, selectedRoomId]);

  return (
    <Drawer
      title={`设备详情：${props.row?.deviceName || props.row?.deviceCode || props.row?.deviceId || "-"}`}
      open={props.open}
      width={920}
      onClose={props.onClose}
    >
      {capturesQuery.isLoading ? <Spin tip="读取直播间记录" /> : null}
      {capturesQuery.isError ? <Typography.Text type="danger">直播间记录加载失败，请稍后重试。</Typography.Text> : null}
      {!capturesQuery.isLoading && !captures.length ? <Empty description="当前设备暂无直播间记录" /> : null}
      {captures.length ? (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 0.8fr) minmax(0, 2fr)", gap: 20 }}>
          <List
            size="small"
            bordered
            header={<Typography.Text strong>直播间记录（{captures.length}）</Typography.Text>}
            dataSource={captures}
            rowKey="id"
            renderItem={(room) => (
              <List.Item
                style={{ cursor: "pointer", background: room.id === selectedRoom?.id ? "#f0f5ff" : undefined }}
                onClick={() => setSelectedRoomId(room.id)}
              >
                <List.Item.Meta
                  title={roomTitle(room)}
                  description={<Typography.Text type="secondary" ellipsis={{ tooltip: room.roomKey }}>{room.roomKey}</Typography.Text>}
                />
                <Tag color={room.captureCompleted ? "success" : "processing"}>{room.captureCompleted ? "已抓取" : "抓取中"}</Tag>
              </List.Item>
            )}
          />
          {selectedRoom ? <LiveRoomProfilePanel capture={selectedRoom} /> : <Empty description="选择直播间" />}
        </div>
      ) : null}
    </Drawer>
  );
}
