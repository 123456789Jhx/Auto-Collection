import { Form, InputNumber } from "antd";
import { fieldRules } from "./field-rules";
import { fieldLabel, type DynamicFieldProps } from "./schema";

export function NumberField({ fieldKey, schema, required, namePrefix }: DynamicFieldProps) {
  return (
    <Form.Item
      label={fieldLabel(fieldKey, schema)}
      name={[namePrefix, fieldKey]}
      required={required}
      rules={fieldRules(fieldKey, schema, required)}
    >
      <InputNumber
        min={schema.minimum}
        max={schema.maximum}
        precision={schema.type === "integer" ? 0 : undefined}
        style={{ width: "100%" }}
      />
    </Form.Item>
  );
}
