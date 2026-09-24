import { useState, type KeyboardEvent } from "react";

export interface CommandListNavigationOptions {
  readonly keys: readonly string[];
  readonly resetKey: string;
  readonly homeEndEnabled: boolean;
  onExecute(index: number): void;
}

export interface CommandListNavigation {
  readonly activeIndex: number;
  setActiveIndex(index: number): void;
  handleKeyDown(event: KeyboardEvent<HTMLElement>): boolean;
}

interface ActiveState {
  readonly resetKey: string;
  readonly itemKey: string | null;
}

export function useCommandListNavigation({
  homeEndEnabled,
  keys,
  onExecute,
  resetKey,
}: CommandListNavigationOptions): CommandListNavigation {
  const [state, setState] = useState<ActiveState>({ resetKey, itemKey: null });
  const count = keys.length;
  const activeIndex = resolveActiveIndex(keys, state.resetKey === resetKey ? state.itemKey : null);
  const setActiveIndex = (index: number): void =>
    setState({ resetKey, itemKey: keys[index] ?? null });
  const move = (delta: number): void => {
    if (count <= 0) return;
    setActiveIndex((Math.max(activeIndex, 0) + delta + count) % count);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (event.nativeEvent.isComposing) return false;
    const ctrlOnly = event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const next = event.key === "ArrowDown" || (ctrlOnly && event.key === "n");
    const previous = event.key === "ArrowUp" || (ctrlOnly && event.key === "p");
    if (next || previous) {
      event.preventDefault();
      move(next ? 1 : -1);
      return true;
    }
    if ((event.key === "Home" || event.key === "End") && homeEndEnabled && count > 0) {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : count - 1);
      return true;
    }
    if (event.key !== "Enter") return false;
    event.preventDefault();
    if (activeIndex >= 0) onExecute(activeIndex);
    return true;
  };

  return { activeIndex, setActiveIndex, handleKeyDown };
}

function resolveActiveIndex(keys: readonly string[], itemKey: string | null): number {
  if (keys.length === 0) return -1;
  if (itemKey === null) return 0;
  return Math.max(keys.indexOf(itemKey), 0);
}
