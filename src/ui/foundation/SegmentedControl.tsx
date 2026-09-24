import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { rovingIndex } from "./roving";
import "./controls.css";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly icon?: ReactNode;
}

export interface SegmentedControlProps<T extends string> {
  readonly label: string;
  readonly options: ReadonlyArray<SegmentedOption<T>>;
  readonly value: T;
  readonly iconOnly?: boolean;
  onChange(value: T): void;
}

export function SegmentedControl<T extends string>({
  iconOnly = false,
  label,
  onChange,
  options,
  value,
}: SegmentedControlProps<T>) {
  const groupRef = useRef<HTMLDivElement | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = rovingIndex(event.key, selectedIndex, options.length, "both");
    if (next === null) return;
    const option = options[next];
    if (option === undefined) return;
    event.preventDefault();
    onChange(option.value);
    groupRef.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div
      aria-label={label}
      className="cv-segmented"
      onKeyDown={move}
      ref={groupRef}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        const tabbable = selected || (selectedIndex < 0 && index === 0);
        return (
          <button
            aria-checked={selected}
            aria-label={iconOnly ? option.label : undefined}
            className="cv-segmented__option"
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            tabIndex={tabbable ? 0 : -1}
            title={iconOnly ? option.label : undefined}
            type="button"
          >
            {option.icon === undefined ? null : (
              <span aria-hidden="true" className="cv-segmented__icon">
                {option.icon}
              </span>
            )}
            {iconOnly ? null : option.label}
          </button>
        );
      })}
    </div>
  );
}
