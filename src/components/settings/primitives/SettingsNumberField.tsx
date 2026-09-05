import { Minus, Plus } from "lucide-react";
import { useId, useState, type KeyboardEvent } from "react";
import { useSettingsControlAria } from "./settingsRowLabel";

export interface SettingsNumberFieldProps {
  readonly disabled?: boolean;
  readonly label?: string;
  readonly max: number;
  readonly min: number;
  readonly step?: number;
  readonly unit?: string;
  readonly value: number;
  onChange(value: number): void;
}

export function SettingsNumberField({
  disabled = false,
  label,
  max,
  min,
  onChange,
  step = 1,
  unit,
  value,
}: SettingsNumberFieldProps) {
  const aria = useSettingsControlAria(label);
  const inputId = `${useId()}-number`;
  const [typed, setTyped] = useState<string | null>(null);

  const publish = (next: number): void => {
    setTyped(null);

    if (!Number.isFinite(next)) return;

    const clamped = Math.min(Math.max(Math.round(next), min), max);

    if (clamped === value) return;

    onChange(clamped);
  };

  const commit = (raw: string): void => {
    if (raw.trim() === "") {
      setTyped(null);
      return;
    }

    publish(Number(raw));
  };

  const keyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit(event.currentTarget.value);
      return;
    }

    if (event.key !== "Escape") return;

    event.preventDefault();
    setTyped(null);
  };

  return (
    <span className="settings-numfield-group">
      <span className="settings-numfield">
        <button
          aria-label="Decrease"
          className="settings-numfield__step"
          disabled={disabled || value <= min}
          onClick={() => publish(value - step)}
          type="button"
        >
          <Minus aria-hidden="true" size={12} />
        </button>
        <input
          {...aria}
          aria-invalid={typed !== null && outOfBounds(typed, min, max)}
          className="settings-numfield__value"
          disabled={disabled}
          id={inputId}
          max={max}
          min={min}
          onBlur={(event) => commit(event.currentTarget.value)}
          onChange={(event) => setTyped(event.currentTarget.value)}
          onKeyDown={keyDown}
          step={step}
          type="number"
          value={typed ?? String(value)}
        />
        <button
          aria-label="Increase"
          className="settings-numfield__step"
          disabled={disabled || value >= max}
          onClick={() => publish(value + step)}
          type="button"
        >
          <Plus aria-hidden="true" size={12} />
        </button>
      </span>
      {unit === undefined ? null : <span className="settings-numfield__unit">{unit}</span>}
    </span>
  );
}

function outOfBounds(raw: string, min: number, max: number): boolean {
  if (raw.trim() === "") return false;

  const parsed = Number(raw);

  if (!Number.isFinite(parsed)) return true;

  return parsed < min || parsed > max;
}
