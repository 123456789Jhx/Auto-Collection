import { CheckCircleOutlined, ReloadOutlined, SettingOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Spin, Tag } from "antd";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getLiveRoomCaptures, type LiveCommentEntryMobileCommand, type LiveRoomCapture } from "../../lib/api-client-live-comment-entry";
import { isLiveRoomCaptureComplete, LiveRoomProfilePanel } from "./LiveRoomProfilePanel";
import { CommentActionTimingPanel } from "../device-profile/CommentActionTimingPanel";
import "./live-comment-results.css";

const emptyCaptures: LiveRoomCapture[] = [];

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
  const [timingOpen, setTimingOpen] = useState(false);
  const deviceId = props.row?.deviceId || "";
  const capturesQuery = useQuery({
    queryKey: ["liveRoomCaptures", props.batchId, deviceId],
    queryFn: () => getLiveRoomCaptures({ batchId: props.batchId, deviceId }),
    enabled: props.open && Boolean(props.batchId && deviceId),
    refetchInterval: props.open ? 3_000 : false
  });
  const captures = capturesQuery.data ?? emptyCaptures;
  const selectedRoom = captures.find((room) => room.id === selectedRoomId) || captures[0];
  const completedRooms = captures.filter(isLiveRoomCaptureComplete).length;
  const deviceLabel = props.row?.deviceName || props.row?.deviceCode || props.row?.deviceId || "-";

  useEffect(() => {
    if (!captures.some((room) => room.id === selectedRoomId)) setSelectedRoomId(captures[0]?.id || "");
  }, [captures, selectedRoomId]);

  useEffect(() => {
    if (!props.open) setTimingOpen(false);
  }, [props.open]);

  function close() {
    setTimingOpen(false);
    props.onClose();
  }

  return (
    <>
      <Drawer
        rootClassName="lc-results-drawer"
        title={<div className="lc-results-title"><span>评论结果 · {deviceLabel}</span><small>查看本设备当前批次的抓取记录</small></div>}
        open={props.open}
        width="min(1140px, 100vw)"
        onClose={close}
        extra={<Button icon={<SettingOutlined />} disabled={!props.row?.deviceCode} onClick={() => setTimingOpen(true)}>设备动作设置</Button>}
      >
        <div className="lc-results-overview">
          <div><span className="lc-results-eyebrow">直播间评论</span><h2>从抓取记录，整理可用评论</h2><p>选择直播间，查看评论、清洗入库或解析用户画像。</p></div>
          <div className="lc-results-totals" aria-label="直播间抓取统计">
            <div><strong>{captures.length}</strong><span>直播间记录</span></div>
            <div><strong>{completedRooms}</strong><span><CheckCircleOutlined /> 已完成抓取</span></div>
          </div>
        </div>
        {capturesQuery.isLoading ? <div className="lc-results-state"><Spin /><span>正在读取直播间记录</span></div> : null}
        {capturesQuery.isError ? <Alert className="lc-results-query-alert" showIcon type="error" message="直播间记录加载失败" description={capturesQuery.error.message}
          action={<Button size="small" icon={<ReloadOutlined />} loading={capturesQuery.isFetching} onClick={() => void capturesQuery.refetch()}>重新读取</Button>} /> : null}
        {!capturesQuery.isLoading && !capturesQuery.isError && !captures.length ? <div className="lc-results-state"><Empty description="当前设备暂无直播间记录" /></div> : null}
        {captures.length ? (
          <div className="lc-results-workbench">
            <nav className="lc-room-nav" aria-label="选择直播间">
              <div className="lc-room-nav-heading"><strong>直播间记录</strong><span>自动更新</span></div>
              <div className="lc-room-nav-items">
                {captures.map((room, index) => {
                  const complete = isLiveRoomCaptureComplete(room);
                  return <button key={room.id} type="button" className="lc-room-nav-item" aria-current={room.id === selectedRoom?.id ? "true" : undefined} onClick={() => setSelectedRoomId(room.id)}>
                    <span className="lc-room-number">{String(index + 1).padStart(2, "0")}</span>
                    <span className="lc-room-nav-copy"><strong>{roomTitle(room)}</strong><span title={room.roomKey}>{room.roomKey}</span><Tag color={complete ? "success" : "processing"}>{complete ? "已抓取" : "抓取中"}</Tag></span>
                  </button>;
                })}
              </div>
            </nav>
            <div className="lc-room-detail">
              {selectedRoom ? <LiveRoomProfilePanel key={selectedRoom.id} capture={selectedRoom} /> : <Empty description="选择直播间查看结果" />}
            </div>
          </div>
        ) : null}
      </Drawer>
    {props.row?.deviceCode ? <CommentActionTimingPanel key={props.row.deviceCode} open={timingOpen && props.open}
      device={{ deviceCode: props.row.deviceCode, deviceName: props.row.deviceName, platform: "douyin" }} onClose={() => setTimingOpen(false)} /> : null}
    </>
  );
}
