import { RemoteScriptsContent } from "./RemoteScriptsPage";

export function PublishExecutionSettingsPage() {
  return (
    <div className="ops-page">
      <RemoteScriptsContent
        fixedScriptKey="publish_video"
        title="发布设置"
        description="管理直接素材发布的执行参数，不包含外部接口地址或令牌。"
        publishSourceMode="direct_material"
        defaultPublishSourceMode="direct_material"
        hideBindingAction
      />
    </div>
  );
}
