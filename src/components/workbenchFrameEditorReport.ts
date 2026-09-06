import { createContext, useContext, useEffect, useId } from "react";

export type WorkbenchFrameEditorState = "empty" | "documents";

export type WorkbenchFrameEditorReporter = (
  key: string,
  state: WorkbenchFrameEditorState | null,
) => void;

export type WorkbenchFrameEditorReports = ReadonlyMap<string, WorkbenchFrameEditorState>;

export const MAX_WORKBENCH_FRAME_EDITOR_REPORTS = 64;

export const EMPTY_WORKBENCH_FRAME_EDITOR_REPORTS: WorkbenchFrameEditorReports = new Map();

export const WorkbenchFrameEditorContext = createContext<WorkbenchFrameEditorReporter>(
  () => undefined,
);

export const WorkbenchFrameEditorStateContext = createContext<WorkbenchFrameEditorState>("empty");

export function useWorkbenchFrameEditorReport(empty: boolean): void {
  const report = useContext(WorkbenchFrameEditorContext);
  const key = useId();
  useEffect(() => {
    report(key, empty ? "empty" : "documents");
    return () => report(key, null);
  }, [empty, key, report]);
}

export function useWorkbenchFrameEditorState(): WorkbenchFrameEditorState {
  return useContext(WorkbenchFrameEditorStateContext);
}

export function nextWorkbenchFrameEditorReports(
  reports: WorkbenchFrameEditorReports,
  key: string,
  state: WorkbenchFrameEditorState | null,
): WorkbenchFrameEditorReports {
  if (state === null) {
    if (!reports.has(key)) return reports;
    const next = new Map(reports);
    next.delete(key);
    return next;
  }
  if (reports.get(key) === state) return reports;
  const overflowing = !reports.has(key) && reports.size >= MAX_WORKBENCH_FRAME_EDITOR_REPORTS;
  if (overflowing && state === "empty") return reports;
  const next = new Map(reports);
  if (overflowing) {
    const evicted = firstEmptyReport(reports);
    if (evicted === null) return reports;
    next.delete(evicted);
  }
  next.set(key, state);
  return next;
}

export function workbenchFrameEditorState(
  reports: WorkbenchFrameEditorReports,
): WorkbenchFrameEditorState {
  for (const state of reports.values()) {
    if (state === "documents") return "documents";
  }
  return "empty";
}

function firstEmptyReport(reports: WorkbenchFrameEditorReports): string | null {
  for (const [key, state] of reports) {
    if (state === "empty") return key;
  }
  return null;
}
