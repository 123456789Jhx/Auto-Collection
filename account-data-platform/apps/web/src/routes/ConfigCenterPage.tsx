import { ApartmentOutlined, CommentOutlined, DeploymentUnitOutlined, FileTextOutlined, LinkOutlined, SettingOutlined } from "@ant-design/icons";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { LiveTargetsPage } from "./LiveTargetsPage";
import { TasksPage } from "./TasksPage";

type ConfigSectionKey = "liveTargets" | "searchLiveComment" | "commerceCardLiveComment" | "deviceBinding" | "publicTemplates";

type ConfigSection = {
  key: ConfigSectionKey;
  title: string;
  description: string;
  group: "功能配置" | "模板配置";
  icon: ReactNode;
  target: "liveTargets" | "publicTemplates";
  liveTargetTab?: "live_comment" | "commerce_card_live_comment" | "bindings";
};

const configSections: ConfigSection[] = [
  {
    key: "liveTargets",
    title: "直播目标配置",
    description: "维护目标直播间名称、别名和 90% 相似度匹配阈值。",
    group: "功能配置",
    icon: <ApartmentOutlined />,
    target: "liveTargets",
    liveTargetTab: "live_comment"
  },
  {
    key: "searchLiveComment",
    title: "搜索直播评论",
    description: "配置搜索关键词、必须包含词、排除词和进房评论规则。",
    group: "功能配置",
    icon: <CommentOutlined />,
    target: "liveTargets",
    liveTargetTab: "live_comment"
  },
  {
    key: "commerceCardLiveComment",
    title: "商品卡直播评论",
    description: "配置商品卡关键词、扫描时长、观看时长、循环轮次和评论池。",
    group: "功能配置",
    icon: <DeploymentUnitOutlined />,
    target: "liveTargets",
    liveTargetTab: "commerce_card_live_comment"
  },
  {
    key: "deviceBinding",
    title: "设备绑定",
    description: "明确哪些手机收到指定目标和功能配置，避免公共配置误下发。",
    group: "功能配置",
    icon: <LinkOutlined />,
    target: "liveTargets",
    liveTargetTab: "bindings"
  },
  {
    key: "publicTemplates",
    title: "公共模板",
    description: "维护话术池、高级 JSON 和默认任务模板，只作为可引用素材。",
    group: "模板配置",
    icon: <FileTextOutlined />,
    target: "publicTemplates"
  }
];

const sectionGroups: Array<ConfigSection["group"]> = ["功能配置", "模板配置"];

export function ConfigCenterPage() {
  const [activeKey, setActiveKey] = useState<ConfigSectionKey>("liveTargets");
  const activeSection = useMemo(() => configSections.find((item) => item.key === activeKey) ?? configSections[0], [activeKey]);
  const activeTarget = activeSection.target;

  return (
    <div className="ops-page config-center-page">
      <header className="ops-topbar">
        <div>
          <h1>配置中心</h1>
          <p>把公共模板、直播目标、功能参数和设备绑定放在同一个链路里管理。</p>
        </div>
        <div className="config-center-status">
          <span>{"公共模板 -> 功能配置 -> 设备绑定 -> 手机下发"}</span>
        </div>
      </header>

      <section className="config-center-brief" aria-label="配置生效链路">
        <div className="config-center-chain">
          <span>公共模板</span>
          <b>-&gt;</b>
          <span>功能配置</span>
          <b>-&gt;</b>
          <span>设备绑定</span>
          <b>-&gt;</b>
          <span>手机下发</span>
        </div>
        <div className="config-center-rule">
          公共模板不会直接下发，也不会自动应用到所有手机。只有被直播目标或任务配置引用，并完成设备绑定后，手机才会收到对应参数。
        </div>
      </section>

      <div className="config-center-shell">
        <aside className="config-center-nav" aria-label="配置中心模块">
          <div className="config-center-nav-title">
            <SettingOutlined />
            <span>配置模块</span>
          </div>
          {sectionGroups.map((group) => (
            <div className="config-center-nav-group" key={group}>
              <div className="config-center-nav-group-title">{group}</div>
              {configSections
                .filter((section) => section.group === group)
                .map((section) => (
                  <button
                    className={`config-module-button ${section.key === activeKey ? "active" : ""}`}
                    type="button"
                    key={section.key}
                    onClick={() => setActiveKey(section.key)}
                  >
                    <span className="config-module-icon">{section.icon}</span>
                    <span>
                      <strong>{section.title}</strong>
                      <small>{section.description}</small>
                    </span>
                  </button>
                ))}
            </div>
          ))}
          <div className="config-scope-card">
            <strong>生效范围</strong>
            <p>公共模板是素材池；功能配置决定怎么跑；设备绑定决定哪些手机跑。需要全部手机生效时，在设备绑定里显式开启全部下发。</p>
          </div>
        </aside>

        <main className="config-center-main" aria-label={activeSection.title}>
          <div className="config-center-context">
            <div>
              <span className="ops-tag blue">{activeSection.group}</span>
              <h2>{activeSection.title}</h2>
              <p>{activeSection.description}</p>
            </div>
            <div className="config-center-context-note">{activeTarget === "liveTargets" ? "右侧编辑目标、功能参数和设备绑定" : "右侧编辑公共话术与模板默认值"}</div>
          </div>
          {activeTarget === "liveTargets" ? <LiveTargetsPage embedded activeTab={activeSection.liveTargetTab} /> : <TasksPage embedded />}
        </main>
      </div>
    </div>
  );
}
