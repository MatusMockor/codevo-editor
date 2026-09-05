import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { SettingsRowId } from "./settingsRegistry";

export const SETTINGS_TARGET_PULSE_MS = 1600;

export interface SettingsTargetContextValue {
  readonly targetRowId: SettingsRowId | null;
  onTargetHandled(): void;
}

export const SettingsTargetContext = createContext<SettingsTargetContextValue>({
  targetRowId: null,
  onTargetHandled: () => undefined,
});

export function useSettingsRowTarget(rowId: SettingsRowId): RefObject<HTMLDivElement | null> {
  const elementRef = useRef<HTMLDivElement | null>(null);
  const { onTargetHandled, targetRowId } = useContext(SettingsTargetContext);
  const [pulsing, setPulsing] = useState(false);
  const targeted = targetRowId === rowId;

  useEffect(() => {
    if (!targeted) return;

    const element = elementRef.current;

    if (element !== null) {
      revealSettingsRow(element);
      setPulsing(true);
    }

    onTargetHandled();
  }, [onTargetHandled, targeted]);

  useEffect(() => {
    if (!pulsing) return;

    const element = elementRef.current;

    if (element === null) {
      setPulsing(false);
      return;
    }

    element.setAttribute("data-target", "true");
    const stop = (): void => setPulsing(false);
    const timer = window.setTimeout(stop, SETTINGS_TARGET_PULSE_MS);
    element.addEventListener("blur", stop);

    return () => {
      window.clearTimeout(timer);
      element.removeEventListener("blur", stop);
      element.removeAttribute("data-target");
    };
  }, [pulsing]);

  return elementRef;
}

function revealSettingsRow(element: HTMLElement): void {
  if (typeof element.scrollIntoView === "function") {
    element.scrollIntoView({
      block: "center",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }

  element.focus({ preventScroll: true });
}

function prefersReducedMotion(): boolean {
  if (typeof window.matchMedia !== "function") return false;

  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
