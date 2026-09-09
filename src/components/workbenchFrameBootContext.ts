import { createContext, useContext, useEffect, useState } from "react";

export const WORKBENCH_SURFACE_ENTER_CLASS = "workbench-surface--enter";

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
  const [enter] = useState(booted);
  if (!enter) {
    return undefined;
  }

  return WORKBENCH_SURFACE_ENTER_CLASS;
}
