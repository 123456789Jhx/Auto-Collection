import { Alert } from "antd";
import { BooleanField } from "./BooleanField";
import { EnumField } from "./EnumField";
import { NumberField } from "./NumberField";
import { normalizeObjectSchema, type DynamicFieldProps } from "./schema";
import { StringArrayField } from "./StringArrayField";
import { StringField } from "./StringField";

type Props = {
  schema?: Record<string, unknown>;
  namePrefix?: string;
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

export function DynamicConfigForm({ schema, namePrefix = "configPayload" }: Props) {
  const normalized = normalizeObjectSchema(schema);
  if (!normalized) {
    return <Alert type="error" showIcon message="当前脚本类型缺少有效的配置 Schema" />;
  }
  return (
    <div>
      {Object.entries(normalized.properties).map(([fieldKey, fieldSchema]) => renderField({
        fieldKey,
        schema: fieldSchema,
        required: normalized.required.includes(fieldKey),
        namePrefix
      }))}
    </div>
  );
}
