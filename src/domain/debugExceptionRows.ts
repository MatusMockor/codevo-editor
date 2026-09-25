import type { DebugExceptionPauseMode } from "./debug";

export type DebugExceptionRowId = "all" | "uncaught";

export interface DebugExceptionRow {
  readonly id: DebugExceptionRowId;
  readonly label: string;
  readonly checked: boolean;
  readonly implied: boolean;
}

export function debugExceptionRows(
  mode: DebugExceptionPauseMode,
): ReadonlyArray<DebugExceptionRow> {
  return [
    { id: "all", label: "All exceptions", checked: mode === "all", implied: false },
    {
      id: "uncaught",
      label: "Uncaught exceptions",
      checked: mode !== "none",
      implied: mode === "all",
    },
  ];
}

export function nextExceptionPauseMode(
  mode: DebugExceptionPauseMode,
  row: DebugExceptionRowId,
): DebugExceptionPauseMode {
  if (row === "all") return mode === "all" ? "uncaught" : "all";
  return mode === "none" ? "uncaught" : "none";
}
