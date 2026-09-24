import { useId, type TextareaHTMLAttributes } from "react";
import { FieldFrame } from "./FieldFrame";
import { fieldDescribedBy } from "./fieldIds";

export interface TextAreaProps extends Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  "id" | "className" | "onChange" | "value"
> {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly error?: string;
  readonly optional?: boolean;
  onChange(value: string): void;
}

export function TextArea({
  error,
  hint,
  label,
  onChange,
  optional,
  value,
  ...rest
}: TextAreaProps) {
  const id = useId();
  return (
    <FieldFrame error={error} hint={hint} id={id} label={label} optional={optional}>
      <textarea
        {...rest}
        aria-describedby={fieldDescribedBy(id, hint, error)}
        aria-invalid={error !== undefined}
        className="cv-textarea"
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        value={value}
      />
    </FieldFrame>
  );
}
