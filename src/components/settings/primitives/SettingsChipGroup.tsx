import { useSettingsControlAria } from "./settingsRowLabel";

export interface SettingsChipDescriptor {
  readonly label: string;
  readonly value: string;
}

export interface SettingsChipGroupProps {
  readonly chips: ReadonlyArray<SettingsChipDescriptor>;
  readonly disabled?: boolean;
  readonly label?: string;
  readonly selected: ReadonlyArray<string>;
  onToggle(value: string, selected: boolean): void;
}

export function SettingsChipGroup({
  chips,
  disabled = false,
  label,
  onToggle,
  selected,
}: SettingsChipGroupProps) {
  const aria = useSettingsControlAria(label);

  return (
    <div {...aria} className="settings-chips" role="group">
      {chips.map((chip) => {
        const on = selected.includes(chip.value);

        return (
          <button
            aria-pressed={on}
            className="settings-chip"
            data-state={on ? "on" : "off"}
            disabled={disabled}
            key={chip.value}
            onClick={() => onToggle(chip.value, !on)}
            type="button"
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
