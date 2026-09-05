import { useId } from "react";
import { useSettingsControlAria } from "./settingsRowLabel";

export interface SettingsTextAreaProps {
  readonly disabled?: boolean;
  readonly label?: string;
  readonly mono?: boolean;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly value: string;
  onChange?(value: string): void;
}

export function SettingsTextArea({
  disabled = false,
  label,
  mono = true,
  onChange,
  placeholder,
  rows = 6,
  value,
}: SettingsTextAreaProps) {
  const aria = useSettingsControlAria(label);
  const inputId = `${useId()}-textarea`;

  return (
    <textarea
      {...aria}
      className="settings-input settings-input--area"
      data-mono={mono ? "true" : undefined}
      disabled={disabled}
      id={inputId}
      onChange={(event) => onChange?.(event.currentTarget.value)}
      placeholder={placeholder}
      readOnly={onChange === undefined}
      rows={rows}
      spellCheck={false}
      value={value}
    />
  );
}
