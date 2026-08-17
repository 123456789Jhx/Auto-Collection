import { Alert, Form } from "antd";
import { useEffect, useMemo } from "react";
import { BooleanField } from "./BooleanField";
import { EnumField } from "./EnumField";
import { NumberField } from "./NumberField";
import {
  isFieldVisible,
  normalizeObjectSchema,
  removeInactiveConditionalValues,
  type DynamicFieldProps
} from "./schema";
import { StringArrayField } from "./StringArrayField";
import { StringField } from "./StringField";

type Props = {
  schema?: Record<string, unknown>;
  namePrefix?: string;
  hiddenFieldKeys?: readonly string[];
};

function renderField(props: DynamicFieldProps) {
  const { fieldKey, schema } = props;
  if (schema.enum?.length) return <EnumField key={fieldKey} {...props} />;
  if (schema.type === "string") return <StringField key={fieldKey} {...props} />;
  if (schema.type === "integer" || schema.type === "number") return <NumberField key={fieldKey} {...props} />;
  if (schema.type === "boolean") return <BooleanField key={fieldKey} {...props} />;
  if (schema.type === "array" && schema.items?.type === "string") {
    return <StringArrayField key={fieldKey} {...props} />;
  }
  return <Alert key={fieldKey} type="error" showIcon message={`字段 ${fieldKey} 使用了不支持的 Schema`} />;
}

export function DynamicConfigForm({ schema, namePrefix = "configPayload", hiddenFieldKeys = [] }: Props) {
  const normalized = useMemo(() => normalizeObjectSchema(schema), [schema]);
  const form = Form.useFormInstance();
  const values = Form.useWatch(namePrefix, form) as Record<string, unknown> | undefined;

  useEffect(() => {
    if (!normalized || !values) return;
    const cleanedValues = removeInactiveConditionalValues(normalized, values);
    if (cleanedValues !== values) form.setFieldValue(namePrefix, cleanedValues);
  }, [form, namePrefix, normalized, values]);

  if (!normalized) {
    return <Alert type="error" showIcon message="当前脚本类型缺少有效的配置 Schema" />;
  }
  return (
    <div>
      {Object.entries(normalized.properties)
        .filter(([fieldKey, fieldSchema]) => !hiddenFieldKeys.includes(fieldKey) && isFieldVisible(fieldSchema, values ?? {}))
        .map(([fieldKey, fieldSchema]) => renderField({
          fieldKey,
          schema: fieldSchema,
          required: normalized.required.includes(fieldKey),
          namePrefix
        }))}
    </div>
  );
}
