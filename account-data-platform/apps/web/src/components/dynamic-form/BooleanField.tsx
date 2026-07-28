import { Form, Switch } from "antd";
import { fieldRules } from "./field-rules";
import { fieldLabel, type DynamicFieldProps } from "./schema";

export function BooleanField({ fieldKey, schema, required, namePrefix }: DynamicFieldProps) {
  return (
    <Form.Item
      label={fieldLabel(fieldKey, schema)}
      name={[namePrefix, fieldKey]}
      required={required}
      rules={fieldRules(fieldKey, schema, required)}
      valuePropName="checked"
    >
      <Switch />
    </Form.Item>
  );
}
