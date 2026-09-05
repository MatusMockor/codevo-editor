import { useSettingsControlAria } from "./settingsRowLabel";

export interface SettingsSwitchProps {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly label?: string;
  onChange(checked: boolean): void;
}

export function SettingsSwitch({
  checked,
  disabled = false,
  label,
  onChange,
}: SettingsSwitchProps) {
  const aria = useSettingsControlAria(label);

  return (
    <button
      {...aria}
      aria-checked={checked}
      className="settings-switch"
      data-state={checked ? "on" : "off"}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span aria-hidden="true" className="settings-switch__thumb" />
    </button>
  );
}
