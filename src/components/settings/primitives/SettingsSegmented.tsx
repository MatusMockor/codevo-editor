import { useRef, type KeyboardEvent } from "react";
import { useSettingsControlAria } from "./settingsRowLabel";

export interface SettingsSegmentedOption {
  readonly label: string;
  readonly value: string;
}

export interface SettingsSegmentedProps {
  readonly disabled?: boolean;
  readonly label?: string;
  readonly options: ReadonlyArray<SettingsSegmentedOption>;
  readonly value: string;
  onChange(value: string): void;
}

const STEP_BY_KEY: Readonly<Record<string, number>> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

export function SettingsSegmented({
  disabled = false,
  label,
  onChange,
  options,
  value,
}: SettingsSegmentedProps) {
  const aria = useSettingsControlAria(label);
  const groupRef = useRef<HTMLDivElement | null>(null);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = STEP_BY_KEY[event.key];

    if (step === undefined || disabled) return;

    const current = options.findIndex((option) => option.value === value);
    const next = options[(Math.max(current, 0) + step + options.length) % options.length];

    if (next === undefined) return;

    event.preventDefault();
    onChange(next.value);
    groupRef.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus();
  };

  return (
    <div {...aria} className="settings-segmented" onKeyDown={move} ref={groupRef} role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={option.value === value}
          className="settings-segmented__option"
          data-value={option.value}
          disabled={disabled}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          tabIndex={option.value === value ? 0 : -1}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
