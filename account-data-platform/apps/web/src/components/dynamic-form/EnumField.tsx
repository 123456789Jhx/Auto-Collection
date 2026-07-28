import { Form, Select } from "antd";
import { fieldRules } from "./field-rules";
import { fieldLabel, type DynamicFieldProps } from "./schema";

export function EnumField({ fieldKey, schema, required, namePrefix }: DynamicFieldProps) {
  return (
    <Form.Item
      label={fieldLabel(fieldKey, schema)}
      name={[namePrefix, fieldKey]}
      required={required}
      rules={fieldRules(fieldKey, schema, required)}
    >
      <Select options={(schema.enum ?? []).map((value) => ({ value, label: String(value) }))} />
    </Form.Item>
  );
}
