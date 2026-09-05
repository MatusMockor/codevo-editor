import { useCallback, useMemo, useState, type KeyboardEvent } from "react";
import { SETTINGS_ROWS, type SettingsRowId } from "./settingsRegistry";
import { searchSettingsRows, type SettingsSearchHit } from "./settingsSearch";

export interface SettingsSearchOptions {
  readonly hasWorkspace: boolean;
  onClose(): void;
  onSelect(hit: SettingsSearchHit): void;
}

export interface SettingsSearchController {
  readonly activeIndex: number;
  readonly activeOptionId: string | null;
  readonly hits: ReadonlyArray<SettingsSearchHit>;
  readonly query: string;
  readonly searching: boolean;
  handleEscape(): boolean;
  handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void;
  selectHit(hit: SettingsSearchHit): void;
  setActiveIndex(index: number): void;
  setQuery(value: string): void;
}

export function settingsSearchOptionId(rowId: SettingsRowId): string {
  return `settings-search-option-${rowId}`;
}

export function useSettingsSearch({
  hasWorkspace,
  onClose,
  onSelect,
}: SettingsSearchOptions): SettingsSearchController {
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const hits = useMemo(
    () => searchSettingsRows(query, SETTINGS_ROWS, hasWorkspace),
    [hasWorkspace, query],
  );

  const setQuery = useCallback((value: string): void => {
    setQueryState(value);
    setActiveIndex(0);
  }, []);

  const selectHit = useCallback(
    (hit: SettingsSearchHit): void => {
      onSelect(hit);
      setQueryState("");
      setActiveIndex(0);
    },
    [onSelect],
  );

  const handleEscape = useCallback((): boolean => {
    if (query !== "") {
      setQuery("");
      return true;
    }

    onClose();
    return true;
  }, [onClose, query, setQuery]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      const movement = activeIndexMovement(event.key, activeIndex, hits.length);

      if (movement !== null) {
        event.preventDefault();
        setActiveIndex(movement);
        return;
      }

      if (event.key !== "Enter") return;

      const hit = hits[activeIndex];

      if (hit === undefined) return;

      event.preventDefault();
      selectHit(hit);
    },
    [activeIndex, hits, selectHit],
  );

  const active = hits[activeIndex];

  return {
    activeIndex,
    activeOptionId: active === undefined ? null : settingsSearchOptionId(active.row.id),
    handleEscape,
    handleKeyDown,
    hits,
    query,
    searching: query.trim() !== "",
    selectHit,
    setActiveIndex,
    setQuery,
  };
}

function activeIndexMovement(key: string, activeIndex: number, count: number): number | null {
  if (count === 0) return null;
  if (key === "ArrowDown") return Math.min(activeIndex + 1, count - 1);
  if (key === "ArrowUp") return Math.max(activeIndex - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;

  return null;
}
