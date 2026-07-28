import { Form, Select } from "antd";
import { fieldRules } from "./field-rules";
import { fieldLabel, type DynamicFieldProps } from "./schema";

export function StringArrayField({ fieldKey, schema, required, namePrefix }: DynamicFieldProps) {
  return (
    <Form.Item
      label={fieldLabel(fieldKey, schema)}
      name={[namePrefix, fieldKey]}
      required={required}
      rules={fieldRules(fieldKey, schema, required)}
    >
      <Select mode="tags" tokenSeparators={[",", "，"]} />
    </Form.Item>
  );
}
