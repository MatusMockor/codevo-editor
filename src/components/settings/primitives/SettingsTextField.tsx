import { useId } from "react";
import { useSettingsControlAria } from "./settingsRowLabel";

export interface SettingsTextFieldProps {
  readonly disabled?: boolean;
  readonly label?: string;
  readonly mono?: boolean;
  readonly placeholder?: string;
  readonly readOnly?: boolean;
  readonly value: string;
  readonly width?: "auto" | "sm" | "md" | "full";
  onBlur?(value: string): void;
  onChange?(value: string): void;
}

export function SettingsTextField({
  disabled = false,
  label,
  mono = false,
  onBlur,
  onChange,
  placeholder,
  readOnly = false,
  value,
  width = "md",
}: SettingsTextFieldProps) {
  const aria = useSettingsControlAria(label);
  const inputId = `${useId()}-text`;

  return (
    <input
      {...aria}
      className="settings-input"
      data-mono={mono ? "true" : undefined}
      data-width={width}
      disabled={disabled}
      id={inputId}
      onBlur={(event) => onBlur?.(event.currentTarget.value)}
      onChange={(event) => onChange?.(event.currentTarget.value)}
      placeholder={placeholder}
      readOnly={readOnly || onChange === undefined}
      spellCheck={false}
      type="text"
      value={value}
    />
  );
}
