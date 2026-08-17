import type {
  CreateRemoteScriptConfigPayload,
  UpdateRemoteScriptConfigPayload
} from "@pkg/types";
import { Collapse, Form, Input, Modal, Select } from "antd";
import { useEffect } from "react";
import { DynamicConfigForm } from "../components/dynamic-form/DynamicConfigForm";
import {
  publishTimingPayloadToMilliseconds,
  publishTimingPayloadToSeconds,
  publishTimingSchemaForUi,
  validatePublishTimingSeconds
} from "../lib/publish-execution-timing";
import type {
  RemoteScriptConfig,
  RemoteScriptDefinition,
  RemoteScriptStatus
} from "../lib/api-client-remote-scripts";

type ConfigFormValues = {
  scriptKey: string;
  configName: string;
  remark?: string;
  status: RemoteScriptStatus;
  configPayload: ConfigPayloadFormValue;
  configPayloadText: string;
};

type ConfigPayloadFormValue = Record<string, string | number | boolean | string[] | undefined>;
type PublishSourceMode = "direct_material" | "external_pull";

type SavePayload =
  | { mode: "create"; payload: CreateRemoteScriptConfigPayload }
  | { mode: "update"; id: string; payload: UpdateRemoteScriptConfigPayload };

type Props = {
  open: boolean;
  config: RemoteScriptConfig | null;
  definitions: RemoteScriptDefinition[];
  loading: boolean;
  defaultPublishSourceMode?: PublishSourceMode;
  lockedPublishSourceMode?: PublishSourceMode;
  hideAdvancedJson?: boolean;
  onCancel: () => void;
  onSave: (payload: SavePayload) => void;
};

function parseConfigPayload(value: string): ConfigPayloadFormValue {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置内容必须是 JSON 对象");
  }
  return parsed as ConfigPayloadFormValue;
}

const directMaterialDefaults: ConfigPayloadFormValue = {
  responseDelayMsMin: 700,
  responseDelayMsMax: 1200,
  actionWaitMsMin: 900,
  actionWaitMsMax: 1500,
  expectedTopicCount: 5,
  requireCover: true,
  topicResolveTimeoutMinutes: 30,
  downloadDir: "/sdcard/",
  isDefault: false
};
const directMaterialExternalFields = [
  "externalBaseUrl",
  "externalTokenEnv",
  "publishTimeSlots",
  "platforms"
] as const;

function normalizePublishVideoPayload(
  scriptKey: string | undefined,
  payload: ConfigPayloadFormValue,
  defaultPublishSourceMode?: PublishSourceMode
) {
  const normalized = { ...payload };
  if (scriptKey !== "publish_video") return normalized;
  delete normalized.dailyLimitPerAccount;
  if (defaultPublishSourceMode && normalized.sourceMode === undefined) {
    normalized.sourceMode = defaultPublishSourceMode;
  }
  if (normalized.sourceMode === "direct_material") {
    for (const field of directMaterialExternalFields) delete normalized[field];
    return { ...directMaterialDefaults, ...normalized, sourceMode: "direct_material" };
  }
  if (typeof normalized.topicResolveTimeoutMinutes !== "number") {
    return { ...normalized, topicResolveTimeoutMinutes: 30 };
  }
  return normalized;
}

export function RemoteScriptConfigModal({
  open,
  config,
  definitions,
  loading,
  defaultPublishSourceMode,
  lockedPublishSourceMode,
  hideAdvancedJson = false,
  onCancel,
  onSave
}: Props) {
  const [form] = Form.useForm<ConfigFormValues>();
  const selectedScriptKey = Form.useWatch("scriptKey", form);
  const selectedDefinition = definitions.find((item) => item.scriptKey === selectedScriptKey);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    const scriptKey = config?.scriptKey ?? definitions.find((item) => item.status === "ENABLED")?.scriptKey;
    const initialPublishSourceMode = lockedPublishSourceMode
      ?? (!config ? defaultPublishSourceMode ?? "direct_material" : undefined);
    const payloadInMilliseconds = normalizePublishVideoPayload(
      scriptKey,
      (config?.configPayload ?? {}) as ConfigPayloadFormValue,
      initialPublishSourceMode
    );
    const configPayload = publishTimingPayloadToSeconds(scriptKey, payloadInMilliseconds);
    form.setFieldsValue({
      scriptKey,
      configName: config?.configName ?? "",
      remark: config?.remark ?? "",
      status: config?.status ?? "ENABLED",
      configPayload,
      configPayloadText: JSON.stringify(payloadInMilliseconds, null, 2)
    });
  }, [config, defaultPublishSourceMode, definitions, form, lockedPublishSourceMode, open]);

  function submit(values: ConfigFormValues) {
    const timingValidation = values.scriptKey === "publish_video"
      ? validatePublishTimingSeconds(values.configPayload ?? {})
      : null;
    if (timingValidation) {
      form.setFields([{ name: ["configPayload", timingValidation.field], errors: [timingValidation.message] }]);
      return;
    }
    const payloadInMilliseconds = publishTimingPayloadToMilliseconds(values.scriptKey, values.configPayload ?? {});
    const common = {
      configName: values.configName.trim(),
      remark: values.remark?.trim() || null,
      status: values.status,
      configPayload: values.scriptKey === "publish_video" && lockedPublishSourceMode
        ? { ...payloadInMilliseconds, sourceMode: lockedPublishSourceMode }
        : payloadInMilliseconds
    };
    if (config) {
      onSave({ mode: "update", id: config.id, payload: common });
      return;
    }
    onSave({
      mode: "create",
      payload: { ...common, scriptKey: values.scriptKey }
    });
  }

  return (
    <Modal
      open={open}
      title={config ? "编辑远程脚本配置" : "新建远程脚本配置"}
      okText="保存"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
      onCancel={onCancel}
      onOk={() => form.submit()}
      width={720}
    >
      <Form<ConfigFormValues>
        form={form}
        layout="vertical"
        onFinish={submit}
        onValuesChange={(changedValues) => {
          if (!("configPayload" in changedValues)) return;
          const configPayload = form.getFieldValue("configPayload") ?? {};
          if (
            selectedScriptKey === "publish_video"
            && lockedPublishSourceMode
            && configPayload.sourceMode !== lockedPublishSourceMode
          ) {
            form.setFieldValue(["configPayload", "sourceMode"], lockedPublishSourceMode);
          }
          const payloadInMilliseconds = publishTimingPayloadToMilliseconds(
            selectedScriptKey,
            form.getFieldValue("configPayload") ?? {}
          );
          form.setFieldValue("configPayloadText", JSON.stringify(payloadInMilliseconds, null, 2));
        }}
      >
        <Form.Item label="脚本类型" name="scriptKey" rules={[{ required: true, message: "请选择脚本类型" }]}>
          <Select
            disabled={Boolean(config)}
            options={definitions
              .filter((item) => item.status === "ENABLED" || item.scriptKey === config?.scriptKey)
              .map((item) => ({
                value: item.scriptKey,
                label: item.scriptName || item.displayName || item.scriptKey
              }))}
            onChange={(scriptKey) => {
              const configPayload = normalizePublishVideoPayload(
                scriptKey,
                {},
                lockedPublishSourceMode ?? defaultPublishSourceMode ?? "direct_material"
              );
              form.setFieldValue("configPayload", publishTimingPayloadToSeconds(scriptKey, configPayload));
              form.setFieldValue("configPayloadText", JSON.stringify(configPayload, null, 2));
            }}
          />
        </Form.Item>
        <Form.Item label="配置名" name="configName" rules={[{ required: true, whitespace: true, message: "请输入配置名" }]}>
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item label="状态" name="status" rules={[{ required: true }]}>
          <Select options={[
            { value: "ENABLED", label: "已启用" },
            { value: "DISABLED", label: "已停用" }
          ]} />
        </Form.Item>
        <Form.Item label="备注" name="remark">
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
        <DynamicConfigForm
          schema={selectedScriptKey === "publish_video"
            ? publishTimingSchemaForUi(selectedDefinition?.configSchema)
            : selectedDefinition?.configSchema}
          hiddenFieldKeys={selectedScriptKey === "publish_video" && lockedPublishSourceMode ? ["sourceMode"] : undefined}
        />
        {!hideAdvancedJson ? (
          <Collapse
          ghost
          items={[{
            key: "json",
            label: "JSON 高级编辑（时间字段保持毫秒）",
            children: (
              <Form.Item
                name="configPayloadText"
                rules={[
                  { required: true, message: "请输入配置内容" },
                  {
                    validator: async (_, value: string) => {
                      try {
                        parseConfigPayload(value);
                      } catch (error) {
                        throw new Error(error instanceof Error ? error.message : "请输入合法 JSON");
                      }
                    }
                  }
                ]}
              >
                <Input.TextArea
                  rows={10}
                  spellCheck={false}
                  onChange={(event) => {
                    try {
                      const parsed = parseConfigPayload(event.target.value);
                      const formPayload = publishTimingPayloadToSeconds(selectedScriptKey, parsed);
                      const current = form.getFieldValue("configPayload") ?? {};
                      const fieldKeys = Array.from(new Set([...Object.keys(current), ...Object.keys(formPayload)]));
                      for (const fieldKey of fieldKeys) {
                        form.setFieldValue(["configPayload", fieldKey], formPayload[fieldKey]);
                      }
                    } catch {
                      // Keep the last valid dynamic field values until the JSON becomes valid again.
                    }
                  }}
                />
              </Form.Item>
            )
          }]}
          />
        ) : null}
      </Form>
    </Modal>
  );
}

export type { SavePayload as RemoteScriptConfigSavePayload };
