import { createContext, useContext, useEffect, useState } from "react";

export const WORKBENCH_SURFACE_ENTER_CLASS = "workbench-surface--enter";
// The CSS entrance lasts 200ms. Never leave its backwards fill attached indefinitely.
export const WORKBENCH_SURFACE_ENTER_TIMEOUT_MS = 250;

export const WorkbenchFrameBootContext = createContext(false);

export function useWorkbenchFrameBooted(): boolean {
  const [booted, setBooted] = useState(false);
  useEffect(() => {
    setBooted(true);
  }, []);
  return booted;
}

export function useSurfaceEnterClass(): string | undefined {
  const booted = useContext(WorkbenchFrameBootContext);
  const [enter, setEnter] = useState(booted);
  useEffect(() => {
    if (!enter) return;
    // A background WKWebView can leave an animation pending at its invisible first frame.
    // The surface must become visible even when animationend is never delivered.
    const timer = setTimeout(() => setEnter(false), WORKBENCH_SURFACE_ENTER_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [enter]);
  if (!enter) {
    return undefined;
  }

  return WORKBENCH_SURFACE_ENTER_CLASS;
}
