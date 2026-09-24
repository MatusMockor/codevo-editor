import { Check, Minus } from "lucide-react";
import "./controls.css";

export type CheckboxState = boolean | "mixed";

export interface CheckboxProps {
  readonly checked: CheckboxState;
  readonly label: string;
  readonly disabled?: boolean;
  onChange(checked: boolean): void;
}

export function Checkbox({ checked, disabled = false, label, onChange }: CheckboxProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="cv-checkbox"
      disabled={disabled}
      onClick={() => onChange(checked !== true)}
      role="checkbox"
      type="button"
    >
      {checked === "mixed" ? (
        <Minus aria-hidden="true" strokeWidth={2.5} />
      ) : (
        <Check aria-hidden="true" strokeWidth={2.5} />
      )}
    </button>
  );
}
