import { Alert, Descriptions, Empty, Tag, Typography } from "antd";
import type {
  QuickPasteParseResult,
  QuickPastePlatform
} from "../lib/quick-paste-publish";

export type QuickPasteCoverStatus = "idle" | "checking" | "ok" | "missing" | "warning";

export type QuickPastePreviewDevice = {
  deviceCode?: string | null;
  deviceName?: string | null;
  accountProfile?: Record<string, unknown> | null;
};

type Props = {
  parseResult: QuickPasteParseResult;
  selectedDevice?: QuickPastePreviewDevice | null;
  platforms: QuickPastePlatform[];
  coverStatus?: QuickPasteCoverStatus;
  coverStatusMessage?: string;
};

const coverStatusCopy: Record<QuickPasteCoverStatus, { label: string; color: string }> = {
  idle: { label: "待校验", color: "default" },
  checking: { label: "校验中", color: "processing" },
  ok: { label: "封面可访问", color: "success" },
  missing: { label: "封面不存在", color: "error" },
  warning: { label: "仅提示，可继续下发", color: "warning" }
};

const coverSourceCopy = {
  provided: "显式提供",
  derived: "自动派生",
  missing: "缺失"
} as const;

function profileText(profile: Record<string, unknown> | null | undefined, key: string) {
  const value = profile?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "未绑定";
}

function deviceBindingStatus(device?: QuickPastePreviewDevice | null) {
  if (!device) return "未选择设备";
  const profile = device.accountProfile;
  const douyinAccount = profileText(profile, "douyinAccountName") !== "未绑定"
    ? profileText(profile, "douyinAccountName")
    : profileText(profile, "douyinAccountId");
  return "抖音：" + douyinAccount + "；视频号：" + profileText(profile, "wechatChannelsName");
}

function deviceLabel(device?: QuickPastePreviewDevice | null) {
  if (!device) return "未选择设备";
  return device.deviceName?.trim() || device.deviceCode?.trim() || "未命名设备";
}

function displayValue(value?: string | null) {
  return value?.trim() || "-";
}

export function QuickPastePublishPreview({
  parseResult,
  selectedDevice,
  platforms,
  coverStatus = "idle",
  coverStatusMessage
}: Props) {
  const data = parseResult.value;
  const cover = coverStatusCopy[coverStatus];
  const taskCount = data && parseResult.errors.length === 0 ? platforms.length : 0;

  return (
    <section className="quick-paste-preview" aria-label="快速粘贴预览">
      <div className="quick-paste-preview-head">
        <Typography.Title level={5}>快速粘贴预览</Typography.Title>
        <Tag color={taskCount > 0 ? "blue" : "default"}>将创建 {taskCount} 条任务</Tag>
      </div>

      {parseResult.errors.length > 0 ? (
        <Alert
          type="error"
          showIcon
          message="解析未通过，暂不能创建发布任务"
          description={
            <ul className="quick-paste-error-list">
              {parseResult.errors.map((error) => <li key={error}>{error}</li>)}
            </ul>
          }
        />
      ) : null}

      {!data && parseResult.errors.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="粘贴三行或四行内容后查看解析预览" />
      ) : null}

      {data ? (
        <Descriptions bordered size="small" column={1} className="quick-paste-preview-details">
          <Descriptions.Item label="成片 id">{displayValue(data.videoId)}</Descriptions.Item>
          <Descriptions.Item label="视频地址">
            <Typography.Text copyable={{ text: data.videoUrl }} ellipsis={{ tooltip: data.videoUrl }}>
              {data.videoUrl}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="封面地址">
            <Typography.Text copyable={{ text: data.coverUrl }} ellipsis={{ tooltip: data.coverUrl }}>
              {data.coverUrl}
            </Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="封面来源">
            <Tag color={data.coverSource === "provided" ? "blue" : "default"}>{coverSourceCopy[data.coverSource]}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="封面状态">
            <Tag color={cover.color}>{cover.label}</Tag>
            {coverStatusMessage ? <Typography.Text type="secondary"> {coverStatusMessage}</Typography.Text> : null}
          </Descriptions.Item>
          <Descriptions.Item label="标题">{displayValue(data.title)}</Descriptions.Item>
          <Descriptions.Item label="描述">
            <Typography.Paragraph className="quick-paste-description">{data.description}</Typography.Paragraph>
          </Descriptions.Item>
          <Descriptions.Item label="5 个话题">
            <div className="quick-paste-topic-list">
              {data.topics.map((topic, index) => <Tag color="purple" key={topic + "-" + index}>#{topic}</Tag>)}
            </div>
          </Descriptions.Item>
          <Descriptions.Item label="目标设备">
            <div>{deviceLabel(selectedDevice)}</div>
            <Typography.Text type="secondary">{deviceBindingStatus(selectedDevice)}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="发布平台">
            {platforms.length ? platforms.map((platform) => <Tag color="blue" key={platform}>{platform}</Tag>) : "未选择平台"}
          </Descriptions.Item>
          <Descriptions.Item label="将创建任务数">{taskCount} 条</Descriptions.Item>
        </Descriptions>
      ) : null}
    </section>
  );
}
