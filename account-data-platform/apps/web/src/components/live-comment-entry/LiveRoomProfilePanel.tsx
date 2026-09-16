import { DownloadOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App as AntdApp, Button, Descriptions, Empty, List, Space, Spin, Tabs, Tag, Typography } from "antd";
import { useMemo } from "react";
import {
  downloadLiveRoomProfileMarkdown,
  getLiveRoomProfile,
  startLiveRoomProfile,
  type LiveRoomCapture
} from "../../lib/api-client-live-comment-entry";
import { LiveCommentCandidates } from "./LiveCommentCandidates";

export function isLiveRoomCaptureComplete(capture: LiveRoomCapture) {
  return capture.captureCompleted === true || ["COMPLETED", "CAPTURED", "LIVE_COMMENT_ENTRY_CAPTURED"].includes(String(capture.captureStatus));
}

function listValue(value: string[] | undefined) {
  return value?.filter(Boolean) ?? [];
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function LiveRoomProfilePanel(props: { capture: LiveRoomCapture }) {
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({
    queryKey: ["liveRoomProfile", props.capture.id],
    queryFn: () => getLiveRoomProfile(props.capture.id),
    enabled: Boolean(props.capture.id),
    refetchInterval: (query) => ["PENDING", "RUNNING"].includes(String(query.state.data?.status)) ? 2_000 : false
  });
  const profile = profileQuery.data;
  const captureCompleted = isLiveRoomCaptureComplete(props.capture);
  const parsing = profile?.status === "PENDING" || profile?.status === "RUNNING";
  const profileReady = profile?.status === "SUCCEEDED";
  const evidence = useMemo(() => profile?.evidenceComments?.filter((item) => item.text || item.reason) ?? [], [profile?.evidenceComments]);
  const startMutation = useMutation({
    mutationFn: () => startLiveRoomProfile(props.capture.id),
    onSuccess: (result) => {
      queryClient.setQueryData(["liveRoomProfile", props.capture.id], result);
    },
    onError: (error: Error) => message.error(error.message || "画像解析启动失败")
  });
  const downloadMutation = useMutation({
    mutationFn: () => downloadLiveRoomProfileMarkdown(props.capture.id),
    onSuccess: (result) => saveBlob(result.blob, result.filename || `${props.capture.roomKey}-用户画像.md`),
    onError: (error: Error) => message.error(error.message || "Markdown 导出失败")
  });

  const rawContent = (props.capture.rawOcrText || props.capture.rawOcrPages?.map((page) => page.text || "").filter(Boolean).join("\n") || "")
    .split(/\r?\n/).flatMap((line) => { const separator = line.search(/[:：;；]/); return separator < 0 ? [] : [line.slice(separator + 1).trim()]; }).filter(Boolean).join("\n");
  const rawComments = props.capture.rawComments?.filter((item) => item.commentText) ?? [];
  const roomLabel = props.capture.accountName || props.capture.accountId || props.capture.roomKey;

  return (
    <section className="lc-room-profile" aria-label="当前直播间结果">
      <div className="lc-room-heading">
        <div><span className="lc-section-eyebrow">当前直播间 · 主播账号</span><h3>{roomLabel || "未识别主播"}</h3></div>
        <Tag color={captureCompleted ? "success" : "processing"}>{captureCompleted ? "抓取已完成" : "正在抓取"}</Tag>
      </div>
      <dl className="lc-room-meta">
        <div><dt>直播间键</dt><dd>{props.capture.roomKey}</dd></div>
        <div><dt>在线人数</dt><dd>{props.capture.viewerCount ?? "-"}</dd></div>
      </dl>
      <Tabs className="lc-results-tabs" defaultActiveKey="import" items={[
          {
            key: "import",
            label: "评论入库",
            children: <LiveCommentCandidates key={props.capture.id} capture={props.capture} captureCompleted={captureCompleted} />
          },
          {
            key: "raw",
            label: "原始记录",
            children: rawContent || rawComments.length ? (
              <div className="lc-raw-records">
                <p className="lc-section-description">查看本直播间的评论识别记录，核对抓取内容。</p>
                {rawComments.length ? <section className="lc-raw-section"><h4>识别评论 <span>{rawComments.length} 条</span></h4><List size="small" dataSource={rawComments} renderItem={(item) => <List.Item><Typography.Text>{item.commentText || ""}</Typography.Text></List.Item>} /></section> : null}
                {rawContent ? <section className="lc-raw-section"><h4>OCR 文本摘录</h4><Typography.Paragraph className="lc-raw-text" copyable={{ text: rawContent, tooltips: ["复制文本摘录", "已复制"] }}>{rawContent}</Typography.Paragraph></section> : null}
              </div>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无原始评论记录" />
          },
          {
            key: "profile",
            label: "用户画像",
            children: (
              <div className="lc-profile-content">
                <div className="lc-profile-toolbar"><div><h4>用户画像</h4><p className="lc-section-description">基于本直播间的评论，整理人群特征与需求。</p></div><Space wrap>
                  <Button
                    type="primary"
                    icon={profileReady ? undefined : parsing ? <Spin size="small" /> : profile?.status === "FAILED" ? <ReloadOutlined /> : <PlayCircleOutlined />}
                    disabled={!captureCompleted || profileReady || parsing || startMutation.isPending || profileQuery.isLoading || profileQuery.isError}
                    loading={startMutation.isPending}
                    onClick={() => startMutation.mutate()}
                  >{profileReady ? "已解析" : parsing ? "解析中" : profile?.status === "FAILED" ? "重新解析" : "解析用户画像"}</Button>
                  <Button
                    icon={<DownloadOutlined />}
                    disabled={!profileReady || downloadMutation.isPending}
                    loading={downloadMutation.isPending}
                    onClick={() => downloadMutation.mutate()}
                  >导出 Markdown</Button>
                </Space></div>
                {!captureCompleted ? <Alert type="info" showIcon message="抓取未结束，完成后才能解析用户画像" /> : null}
                {profileQuery.isError ? <Alert type="error" showIcon message="画像状态加载失败" description={profileQuery.error.message}
                  action={<Button size="small" icon={<ReloadOutlined />} loading={profileQuery.isFetching} onClick={() => void profileQuery.refetch()}>重新读取</Button>} /> : null}
                {profile?.status === "FAILED" ? <Alert type="error" showIcon message="画像解析失败" description={profile.errorMessage || "请重试"} /> : null}
                {profileReady ? (
                  <div className="lc-profile-output">
                    <section className="lc-profile-summary"><h4>画像摘要</h4><Typography.Paragraph>{profile.summary || "暂无摘要"}</Typography.Paragraph></section>
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="主要人群特征">{listValue(profile.audienceFeatures).join("、") || "暂无"}</Descriptions.Item>
                      <Descriptions.Item label="兴趣 / 需求倾向">{listValue(profile.interestNeeds).join("、") || "暂无"}</Descriptions.Item>
                      <Descriptions.Item label="消费 / 互动特征">{listValue(profile.interactionTraits).join("、") || "暂无"}</Descriptions.Item>
                      <Descriptions.Item label="置信度">{profile.confidence ?? "未提供"}</Descriptions.Item>
                      <Descriptions.Item label="置信度说明">{profile.confidenceExplanation || "暂无说明"}</Descriptions.Item>
                    </Descriptions>
                    <div>
                      <h4>证据评论样本</h4>
                      {evidence.length ? <List className="lc-profile-evidence" size="small">{evidence.map((item, index) => <List.Item key={`${props.capture.id}-evidence-${index}`}><Space direction="vertical" size={4}><Typography.Text>“{item.text}”</Typography.Text>{item.reason ? <Typography.Text type="secondary">{item.reason}</Typography.Text> : null}{item.confidence !== undefined ? <Tag>置信度 {String(item.confidence)}</Tag> : null}</Space></List.Item>)}</List> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无证据评论" />}
                    </div>
                  </div>
                ) : profileQuery.isLoading ? <div className="lc-results-state"><Spin /><span>正在读取画像状态</span></div>
                  : parsing || startMutation.isPending ? <div className="lc-profile-pending" role="status"><Spin /><div><strong>正在解析用户画像</strong><p>解析完成后，这里会自动显示结果。</p></div></div>
                    : !profileQuery.isError && profile?.status !== "FAILED" ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={captureCompleted ? "尚未生成画像，可点击“解析用户画像”开始" : "等待抓取完成后生成画像"} /> : null}
              </div>
            )
          }
        ]} />
    </section>
  );
}
