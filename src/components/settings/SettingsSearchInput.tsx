import { Search } from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { SettingsKbd } from "./primitives/SettingsKbd";

export interface SettingsSearchInputProps {
  readonly activeOptionId: string | null;
  readonly expanded: boolean;
  readonly inputRef: RefObject<HTMLInputElement | null>;
  readonly query: string;
  readonly resultsId: string;
  onKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  onQueryChange(value: string): void;
}

export function SettingsSearchInput({
  activeOptionId,
  expanded,
  inputRef,
  onKeyDown,
  onQueryChange,
  query,
  resultsId,
}: SettingsSearchInputProps) {
  return (
    <div className="settings-search">
      <Search aria-hidden="true" size={14} />
      <input
        aria-activedescendant={activeOptionId ?? undefined}
        aria-autocomplete="list"
        aria-controls={resultsId}
        aria-expanded={expanded}
        aria-label="Search settings"
        autoComplete="off"
        className="settings-search__input"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search"
        ref={inputRef}
        role="combobox"
        spellCheck={false}
        type="text"
        value={query}
      />
      <SettingsKbd>/</SettingsKbd>
    </div>
  );
}
