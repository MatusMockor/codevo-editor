import { Minus, Plus } from "lucide-react";
import type { KeyboardEvent } from "react";
import "./controls.css";

export interface StepperProps {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly step?: number;
  readonly unit?: string;
  onChange(value: number): void;
}

export function Stepper({ label, max, min, onChange, step = 1, unit = "", value }: StepperProps) {
  const current = Number.isFinite(value) ? clamp(value, min, max) : min;
  const commit = (next: number): void => {
    const clamped = clamp(next, min, max);
    if (clamped === value) return;
    onChange(clamped);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>): void => {
    const next = steppedValue(event.key, current, min, max, step);
    if (next === null) return;
    event.preventDefault();
    commit(next);
  };

  return (
    <span className="cv-stepper">
      <button
        aria-label={`Decrease ${label}`}
        className="cv-stepper__button"
        disabled={current <= min}
        onClick={() => commit(current - step)}
        tabIndex={-1}
        type="button"
      >
        <Minus aria-hidden="true" size={14} />
      </button>
      <span
        aria-label={label}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={current}
        aria-valuetext={`${current}${unit}`}
        className="cv-stepper__value"
        onBlur={() => commit(current)}
        onKeyDown={handleKeyDown}
        role="spinbutton"
        tabIndex={0}
      >
        {`${current}${unit}`}
      </span>
      <button
        aria-label={`Increase ${label}`}
        className="cv-stepper__button"
        disabled={current >= max}
        onClick={() => commit(current + step)}
        tabIndex={-1}
        type="button"
      >
        <Plus aria-hidden="true" size={14} />
      </button>
    </span>
  );
}

function steppedValue(
  key: string,
  value: number,
  min: number,
  max: number,
  step: number,
): number | null {
  if (key === "ArrowUp" || key === "ArrowRight") return value + step;
  if (key === "ArrowDown" || key === "ArrowLeft") return value - step;
  if (key === "PageUp") return value + step * 10;
  if (key === "PageDown") return value - step * 10;
  if (key === "Home") return min;
  if (key === "End") return max;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
