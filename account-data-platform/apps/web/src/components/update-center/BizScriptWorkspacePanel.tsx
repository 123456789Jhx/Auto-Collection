import { CloudUploadOutlined, FolderOpenOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent, type InputHTMLAttributes } from "react";
import { Alert, App, Button, Descriptions, Input, Space, Table, Tag, Typography, type TableColumnsType } from "antd";
import type { BizScriptPreview, BizScriptPreviewInput } from "@pkg/types";
import {
  bizScriptDevicesKey, bizScriptPreviewsKey, bizScriptWorkspaceKey, createBizScriptPreview,
  getBizScriptPreviews, getBizScriptWorkspace, getBizScriptWorkspaceDevices,
  promoteBizScriptPreview, revokeBizScriptPreview, testBizScriptPreview
} from "../../lib/api-client-biz-script-workspace";
import { prepareBizScriptFolder, type PreparedBizScriptFolder } from "../../lib/biz-script-folder";
import { BizScriptDeviceTable, HashValue } from "./BizScriptDeviceTable";
import { BizScriptPreviewDetail, type PreviewAction } from "./BizScriptPreviewDetail";
import { BizScriptScopeDialog } from "./BizScriptScopeDialog";
import { formatBizDate, stageLabels } from "./biz-script-workflow";

const directoryAttributes = { webkitdirectory: "", directory: "" } as InputHTMLAttributes<HTMLInputElement>;
const emptyDevices: Awaited<ReturnType<typeof getBizScriptWorkspaceDevices>>["data"] = [];

export function BizScriptWorkspacePanel() {
  const client = useQueryClient();
  const { message } = App.useApp();
  const folderInput = useRef<HTMLInputElement>(null);
  const selectionSequence = useRef(0);
  const [folder, setFolder] = useState<PreparedBizScriptFolder | null>(null);
  const [reading, setReading] = useState(false);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [releaseNote, setReleaseNote] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ preview: BizScriptPreview; action: PreviewAction } | null>(null);
  const workspaceQuery = useQuery({ queryKey: bizScriptWorkspaceKey, queryFn: getBizScriptWorkspace });
  const previewsQuery = useQuery({ queryKey: bizScriptPreviewsKey, queryFn: getBizScriptPreviews, refetchInterval: 15_000 });
  const devicesQuery = useQuery({ queryKey: bizScriptDevicesKey, queryFn: getBizScriptWorkspaceDevices, refetchInterval: 15_000 });
  const workspace = workspaceQuery.data;
  const baseline = workspace?.baseline;
  const previews = previewsQuery.data?.data ?? [];
  const devices = devicesQuery.data?.data ?? emptyDevices;
  const selected = previews.find((preview) => preview.id === selectedId) ?? previews[0];
  const ready = !!workspace?.ready && !!baseline && !workspaceQuery.isError;
  const baselineMatches = !!folder && !!baseline && folder.input.baselineVersion === baseline.version
    && folder.input.baseCompatibilityId === baseline.baseCompatibilityId;
  const queryBlocker = workspaceQuery.isLoading ? "正在读取 APK 基线" : workspaceQuery.error?.message
    || (!ready ? workspace?.reason || "缺少有效 APK 基线，暂不可发布" : null)
    || (devicesQuery.isLoading ? "正在读取设备状态" : devicesQuery.error?.message)
    || (previewsQuery.isError ? previewsQuery.error.message : null);

  function savePreview(preview: BizScriptPreview) {
    client.setQueryData<{ data: BizScriptPreview[] }>(bizScriptPreviewsKey, (current) => ({
      data: [preview, ...(current?.data ?? []).filter((item) => item.id !== preview.id)]
    }));
    setSelectedId(preview.id);
    void client.invalidateQueries({ queryKey: bizScriptPreviewsKey });
    void client.invalidateQueries({ queryKey: bizScriptDevicesKey });
  }

  const createMutation = useMutation({
    mutationFn: (input: BizScriptPreviewInput) => createBizScriptPreview(input),
    onSuccess: (preview) => { savePreview(preview); message.success("业务脚本预览已生成"); },
    onError: (error: Error) => { message.error(`生成预览失败：${error.message}`); }
  });
  const actionMutation = useMutation({
    mutationFn: ({ preview, action, deviceIds }: { preview: BizScriptPreview; action: PreviewAction; deviceIds: string[] }) => {
      if (action === "revoke") return revokeBizScriptPreview(preview.id, preview.revision);
      const input = { revision: preview.revision, deviceIds };
      return action === "test" ? testBizScriptPreview(preview.id, input) : promoteBizScriptPreview(preview.id, input);
    },
    onSuccess: (preview) => {
      savePreview(preview);
      setDialog(null);
      message.success(preview.stage === "REVOKED" ? "已停止后续下发" : preview.stage === "TESTING" ? "已提交所选设备试运行" : "已提交所选设备推广");
    },
    onError: () => {
      void client.invalidateQueries({ queryKey: bizScriptPreviewsKey });
      void client.invalidateQueries({ queryKey: bizScriptDevicesKey });
    }
  });

  async function selectFolder(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || !baseline || !workspace) return;
    const sequence = ++selectionSequence.current;
    setFolder(null);
    setFolderError(null);
    createMutation.reset();
    setReading(true);
    try {
      const prepared = await prepareBizScriptFolder(files, baseline, workspace.limits);
      if (sequence === selectionSequence.current) setFolder(prepared);
    } catch (error) {
      if (sequence === selectionSequence.current) setFolderError(error instanceof Error ? error.message : "目录校验失败");
    } finally {
      if (sequence === selectionSequence.current) setReading(false);
    }
  }

  function createPreview() {
    if (!ready || !folder || !baselineMatches || !workspace) return;
    const input = { ...folder.input, releaseNote };
    if (new TextEncoder().encode(JSON.stringify(input)).byteLength > workspace.limits.maxRequestBytes) {
      setFolderError("发布说明加入后上传请求大小超限");
      return;
    }
    createMutation.mutate(input);
  }

  const previewColumns: TableColumnsType<BizScriptPreview> = [
    { title: "版本", dataIndex: "version", width: 185, render: (value: string, preview) => <Button type="link" style={{ padding: 0, whiteSpace: "normal", textAlign: "left" }} onClick={() => setSelectedId(preview.id)}>{value}</Button> },
    { title: "状态", dataIndex: "stage", width: 110, render: (stage: BizScriptPreview["stage"]) => <Tag color={stage === "PROMOTED" ? "green" : stage === "TESTING" ? "blue" : "default"}>{stageLabels[stage]}</Tag> },
    { title: "比较基线", dataIndex: "baselineVersion", width: 185 },
    { title: "文件变更", width: 155, render: (_, preview) => `+${preview.changes.added.length} / ~${preview.changes.modified.length} / -${preview.changes.removed.length}` },
    { title: "发布说明", dataIndex: "releaseNote", ellipsis: true, render: (value: string) => value || "-" },
    { title: "创建时间", dataIndex: "createdAt", width: 185, render: formatBizDate }
  ];

  return <>
    <section className="ops-panel">
      <div className="ops-panel-head"><span>本机业务脚本目录</span><Tag>完整业务包</Tag></div>
      <div className="ops-panel-body">
        {workspaceQuery.isLoading ? <Alert type="info" showIcon message="正在读取 APK 基线" style={{ marginBottom: 16 }} /> : null}
        {workspaceQuery.isError || (!workspaceQuery.isLoading && !ready) ? <Alert type="warning" showIcon message={workspaceQuery.error?.message || workspace?.reason || "缺少有效 APK 基线，暂不可发布"} style={{ marginBottom: 16 }} /> : null}
        {baseline ? <Descriptions size="small" column={{ xs: 1, sm: 1, md: 2 }} items={[
          { key: "version", label: "APK 业务基线", children: baseline.version },
          { key: "build", label: "APK Build ID", children: baseline.apkBuildId },
          { key: "base", label: "基座兼容标识", span: 2, children: <HashValue value={baseline.baseCompatibilityId} /> }
        ]} /> : null}
        <Space wrap style={{ marginBlock: 16 }}>
          <input {...directoryAttributes} ref={folderInput} type="file" multiple hidden aria-label="业务脚本目录" disabled={!ready || createMutation.isPending} onChange={(event) => { void selectFolder(event); }} />
          <Button icon={<FolderOpenOutlined />} disabled={!ready || createMutation.isPending} loading={reading} onClick={() => folderInput.current?.click()}>选择脚本目录</Button>
          {folder ? <Typography.Text style={{ overflowWrap: "anywhere" }}>{folder.folderName} / {folder.input.files.length} 个业务文件 / {(folder.totalBytes / 1024).toFixed(1)} KiB</Typography.Text> : <Typography.Text type="secondary">未选择目录</Typography.Text>}
        </Space>
        {folderError || (folder && !baselineMatches) ? <Alert type="error" showIcon message={folderError || "APK 基线已变化，请重新选择目录"} style={{ marginBottom: 16 }} /> : null}
        {folder ? <Descriptions size="small" column={1} items={[{ key: "hash", label: "本机业务指纹", children: <HashValue value={folder.sourceSha256} /> }]} /> : null}
        <label htmlFor="biz-release-note" style={{ display: "block", marginBottom: 8 }}>发布说明</label>
        <Input.TextArea id="biz-release-note" value={releaseNote} onChange={(event) => setReleaseNote(event.target.value)} maxLength={5000} rows={2} disabled={createMutation.isPending} style={{ marginBottom: 16 }} />
        {createMutation.isError ? <Alert type="error" showIcon message={createMutation.error.message} style={{ marginBottom: 16 }} /> : null}
        <Button type="primary" icon={<CloudUploadOutlined />} loading={createMutation.isPending} disabled={!ready || !baselineMatches || reading || !!folderError} onClick={createPreview}>生成预览</Button>
      </div>
    </section>
    <section className="ops-panel">
      <div className="ops-panel-head"><span>业务脚本版本</span></div>
      <div className="ops-panel-body">
        {previewsQuery.isError ? <Alert type="error" showIcon message={`版本读取失败：${previewsQuery.error.message}`} style={{ marginBottom: 16 }} /> : null}
        <Table<BizScriptPreview> rowKey="id" columns={previewColumns} dataSource={previews} loading={previewsQuery.isLoading}
          pagination={{ pageSize: 5, hideOnSinglePage: true }} scroll={{ x: 1000 }} locale={{ emptyText: "暂无业务脚本预览" }} />
      </div>
    </section>
    {selected ? <section className="ops-panel">
      <div className="ops-panel-head"><span>版本预览</span></div>
      <div className="ops-panel-body"><BizScriptPreviewDetail preview={selected} devices={devices} blocked={queryBlocker || (selected.baseCompatibilityId !== baseline?.baseCompatibilityId ? "此版本基座与当前 APK 基线不一致" : null)} busy={actionMutation.isPending}
        onAction={(action) => { actionMutation.reset(); setDialog({ preview: selected, action }); }} /></div>
    </section> : null}
    <section className="ops-panel">
      <div className="ops-panel-head"><span>设备实际加载状态</span><span>{devices.filter((device) => device.fresh).length} / {devices.length} 台在线</span></div>
      <div className="ops-panel-body">
        {devicesQuery.isError ? <Alert type="error" showIcon message={`设备状态读取失败：${devicesQuery.error.message}`} style={{ marginBottom: 16 }} /> : null}
        <BizScriptDeviceTable devices={devices} loading={devicesQuery.isLoading} />
      </div>
    </section>
    {dialog ? <BizScriptScopeDialog key={`${dialog.preview.id}-${dialog.action}`} {...dialog} devices={devices}
      blocked={queryBlocker || (previews.find((preview) => preview.id === dialog.preview.id)?.revision !== dialog.preview.revision ? "版本状态已变化，请关闭后重新操作" : null)}
      busy={actionMutation.isPending} error={actionMutation.error?.message ?? null}
      onCancel={() => setDialog(null)} onConfirm={(deviceIds) => actionMutation.mutate({ ...dialog, deviceIds })} /> : null}
  </>;
}
