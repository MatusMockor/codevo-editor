import { createContext, useContext, useEffect } from "react";

export type WorkbenchFrameTreeReporter = (visible: boolean) => void;

export const WorkbenchFrameTreeContext = createContext<WorkbenchFrameTreeReporter>(() => undefined);

export function useWorkbenchFrameTreeReport(visible: boolean): void {
  const report = useContext(WorkbenchFrameTreeContext);
  useEffect(() => {
    report(visible);
    return () => report(false);
  }, [report, visible]);
}
