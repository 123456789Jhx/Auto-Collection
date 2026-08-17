import { Form, Select } from "antd";
import { fieldRules, normalizePublishTimeSlots } from "./field-rules";
import { fieldLabel, type DynamicFieldProps } from "./schema";

export function StringArrayField({ fieldKey, schema, required, namePrefix }: DynamicFieldProps) {
  const form = Form.useFormInstance();
  return (
    <Form.Item
      label={fieldLabel(fieldKey, schema)}
      name={[namePrefix, fieldKey]}
      required={required}
      rules={fieldRules(fieldKey, schema, required)}
    >
      <Select
        mode="tags"
        tokenSeparators={[",", "，"]}
        onChange={(value: string[]) => {
          if (fieldKey === "publishTimeSlots") form.setFieldValue([namePrefix, fieldKey], normalizePublishTimeSlots(value));
        }}
      />
    </Form.Item>
  );
}
