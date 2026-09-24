import type { ReactNode } from "react";
import { cx } from "./classNames";
import { fieldHintId } from "./fieldIds";
import "./fields.css";

export interface FieldFrameProps {
  readonly id: string;
  readonly label: string;
  readonly optional?: boolean;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
}

export function FieldFrame({
  children,
  error,
  hint,
  id,
  label,
  optional = false,
}: FieldFrameProps) {
  const message = error ?? hint;
  return (
    <div className="cv-field">
      <label className="cv-field__label" htmlFor={id}>
        <span>{label}</span>
        {optional ? <span className="cv-field__optional">Optional</span> : null}
      </label>
      {children}
      {message === undefined ? null : (
        <p
          className={cx("cv-field__hint", error !== undefined && "cv-field__hint--error")}
          id={fieldHintId(id)}
          role={error === undefined ? undefined : "alert"}
        >
          {message}
        </p>
      )}
    </div>
  );
}
