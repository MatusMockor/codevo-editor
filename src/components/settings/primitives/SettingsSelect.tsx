import { useId } from "react";
import { useSettingsControlAria } from "./settingsRowLabel";

export type SettingsSelectWidth = "auto" | "sm" | "md";

export interface SettingsSelectOption {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
}

export interface SettingsSelectProps {
  readonly disabled?: boolean;
  readonly label?: string;
  readonly options: ReadonlyArray<SettingsSelectOption>;
  readonly value: string;
  readonly width?: SettingsSelectWidth;
  onChange(value: string): void;
}

export function SettingsSelect({
  disabled = false,
  label,
  onChange,
  options,
  value,
  width = "sm",
}: SettingsSelectProps) {
  const aria = useSettingsControlAria(label);
  const selectId = `${useId()}-select`;

  return (
    <span className="settings-select" data-width={width}>
      <select
        {...aria}
        className="settings-select__input"
        disabled={disabled}
        id={selectId}
        onChange={(event) => {
          const next = event.currentTarget.value;
          const option = options.find((candidate) => candidate.value === next);

          if (option === undefined || option.disabled === true) return;

          onChange(option.value);
        }}
        value={value}
      >
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}
