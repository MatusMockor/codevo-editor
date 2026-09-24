import { useId, type InputHTMLAttributes } from "react";
import { cx } from "./classNames";
import { FieldFrame } from "./FieldFrame";
import { fieldDescribedBy } from "./fieldIds";

export interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "id" | "className" | "onChange" | "value" | "type"
> {
  readonly label: string;
  readonly value: string;
  readonly hint?: string;
  readonly error?: string;
  readonly optional?: boolean;
  readonly mono?: boolean;
  readonly type?: "text" | "search" | "url";
  onChange(value: string): void;
}

export function TextField({
  error,
  hint,
  label,
  mono = false,
  onChange,
  optional,
  type = "text",
  value,
  ...rest
}: TextFieldProps) {
  const id = useId();
  return (
    <FieldFrame error={error} hint={hint} id={id} label={label} optional={optional}>
      <input
        {...rest}
        aria-describedby={fieldDescribedBy(id, hint, error)}
        aria-invalid={error !== undefined}
        className={cx("cv-input", mono && "cv-input--mono")}
        id={id}
        onChange={(event) => onChange(event.currentTarget.value)}
        type={type}
        value={value}
      />
    </FieldFrame>
  );
}
