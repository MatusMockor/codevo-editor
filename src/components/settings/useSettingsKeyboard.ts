import { useEffect, useRef, type RefObject } from "react";

export interface SettingsKeyboardOptions {
  readonly surfaceRef: RefObject<HTMLElement | null>;
  onEscape(): boolean;
  onFocusSearch(): void;
}

export function useSettingsKeyboard({
  onEscape,
  onFocusSearch,
  surfaceRef,
}: SettingsKeyboardOptions): void {
  const handlersRef = useRef({ onEscape, onFocusSearch });

  useEffect(() => {
    handlersRef.current = { onEscape, onFocusSearch };
  }, [onEscape, onFocusSearch]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;

      if (event.key === "Escape") {
        if (!withinSurface(surfaceRef.current, event.target)) return;
        if (!handlersRef.current.onEscape()) return;

        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (event.key !== "/") return;
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (isEditableTarget(event.target)) return;

      event.preventDefault();
      handlersRef.current.onFocusSearch();
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [surfaceRef]);
}

const EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"], .monaco-editor';

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  return target.closest(EDITABLE_SELECTOR) !== null;
}

function withinSurface(surface: HTMLElement | null, target: EventTarget | null): boolean {
  if (surface === null) return false;
  if (!(target instanceof Node)) return false;

  return surface.contains(target) || target === document.body;
}
