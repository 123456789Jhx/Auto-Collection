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

function captureIsComplete(capture: LiveRoomCapture) {
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
  const captureCompleted = captureIsComplete(props.capture);
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
    <section>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        <Descriptions size="small" column={2} bordered>
          <Descriptions.Item label="主播账号">{roomLabel || "未识别"}</Descriptions.Item>
          <Descriptions.Item label="直播间键">{props.capture.roomKey}</Descriptions.Item>
          <Descriptions.Item label="在线人数">{props.capture.viewerCount ?? "-"}</Descriptions.Item>
          <Descriptions.Item label="抓取完成">{captureCompleted ? "是" : "否"}</Descriptions.Item>
        </Descriptions>
        <Tabs items={[
          {
            key: "profile",
            label: "用户画像",
            children: (
              <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Space wrap>
                  <Button
                    type="primary"
                    icon={profileReady ? undefined : parsing ? <Spin size="small" /> : profile?.status === "FAILED" ? <ReloadOutlined /> : <PlayCircleOutlined />}
                    disabled={!captureCompleted || profileReady || parsing || startMutation.isPending}
                    loading={startMutation.isPending}
                    onClick={() => startMutation.mutate()}
                  >{profileReady ? "已解析" : parsing ? "解析中" : profile?.status === "FAILED" ? "重新解析" : "解析用户画像"}</Button>
                  <Button
                    icon={<DownloadOutlined />}
                    disabled={!profileReady || downloadMutation.isPending}
                    loading={downloadMutation.isPending}
                    onClick={() => downloadMutation.mutate()}
                  >导出 Markdown</Button>
                </Space>
                {!captureCompleted ? <Alert type="info" showIcon message="抓取未结束，完成后才能解析用户画像" /> : null}
                {profile?.status === "FAILED" ? <Alert type="error" showIcon message="画像解析失败" description={profile.errorMessage || "请重试"} /> : null}
                {profileReady ? (
                  <Space direction="vertical" size={16} style={{ width: "100%" }}>
                    <div><Typography.Title level={5}>画像摘要</Typography.Title><Typography.Paragraph>{profile.summary || "暂无摘要"}</Typography.Paragraph></div>
                    <Descriptions size="small" column={1} bordered>
                      <Descriptions.Item label="主要人群特征">{listValue(profile.audienceFeatures).join("、") || "暂无"}</Descriptions.Item>
                      <Descriptions.Item label="兴趣 / 需求倾向">{listValue(profile.interestNeeds).join("、") || "暂无"}</Descriptions.Item>
                      <Descriptions.Item label="消费 / 互动特征">{listValue(profile.interactionTraits).join("、") || "暂无"}</Descriptions.Item>
                      <Descriptions.Item label="置信度">{profile.confidence ?? "未提供"}</Descriptions.Item>
                      <Descriptions.Item label="置信度说明">{profile.confidenceExplanation || "暂无说明"}</Descriptions.Item>
                    </Descriptions>
                    <div>
                      <Typography.Title level={5}>证据评论样本</Typography.Title>
                      {evidence.length ? <List size="small" bordered>{evidence.map((item, index) => <List.Item key={`${props.capture.id}-evidence-${index}`}><Space direction="vertical" size={2}><Typography.Text>“{item.text}”</Typography.Text>{item.reason ? <Typography.Text type="secondary">{item.reason}</Typography.Text> : null}{item.confidence !== undefined ? <Tag>{String(item.confidence)}</Tag> : null}</Space></List.Item>)}</List> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无证据评论" />}
                    </div>
                  </Space>
                ) : profileQuery.isLoading ? <Spin tip="读取画像状态" /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未生成画像" />}
              </Space>
            )
          },
          {
            key: "raw",
            label: "原始评论",
            children: rawContent || rawComments.length ? (
              <Space direction="vertical" size={12} style={{ width: "100%" }}>
                {rawComments.length ? <List size="small" bordered dataSource={rawComments} renderItem={(item) => <List.Item><Typography.Text>{item.commentText || ""}</Typography.Text></List.Item>} /> : null}
                {rawContent ? <Typography.Paragraph copyable={{ text: rawContent }} style={{ whiteSpace: "pre-wrap", maxHeight: 360, overflow: "auto" }}>{rawContent}</Typography.Paragraph> : null}
              </Space>
            ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无原始评论" />
          }
        ]} />
      </Space>
    </section>
  );
}
