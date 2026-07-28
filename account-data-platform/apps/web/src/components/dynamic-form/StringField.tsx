import { Form, Input } from "antd";
import { fieldRules } from "./field-rules";
import { fieldLabel, type DynamicFieldProps } from "./schema";

export function StringField({ fieldKey, schema, required, namePrefix }: DynamicFieldProps) {
  return (
    <Form.Item
      label={fieldLabel(fieldKey, schema)}
      name={[namePrefix, fieldKey]}
      required={required}
      rules={fieldRules(fieldKey, schema, required)}
    >
      <Input maxLength={schema.maxLength} />
    </Form.Item>
  );
}
