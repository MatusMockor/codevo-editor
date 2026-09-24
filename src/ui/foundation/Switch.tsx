import "./controls.css";

export interface SwitchProps {
  readonly checked: boolean;
  readonly label: string;
  readonly disabled?: boolean;
  onChange(checked: boolean): void;
}

export function Switch({ checked, disabled = false, label, onChange }: SwitchProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className="cv-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    />
  );
}
