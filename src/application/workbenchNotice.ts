export type WorkbenchNoticeSeverity = "info" | "warning" | "error";

export interface WorkbenchNotice {
  groupKey?: string;
  id: string;
  navigationTarget?: WorkbenchNoticeNavigationTarget;
  severity: WorkbenchNoticeSeverity;
  source: string;
  message: string;
}

export interface WorkbenchNoticeNavigationTarget {
  path: string;
  range: {
    end: WorkbenchNoticePosition;
    start: WorkbenchNoticePosition;
  };
}

export interface WorkbenchNoticePosition {
  column: number;
  lineNumber: number;
}

export function createWorkbenchNotice(
  severity: WorkbenchNoticeSeverity,
  source: string,
  message: string,
  groupKey?: string,
  navigationTarget?: WorkbenchNoticeNavigationTarget,
): WorkbenchNotice {
  return {
    groupKey,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    navigationTarget,
    severity,
    source,
  };
}

export function replaceWorkbenchNoticeGroup(
  current: WorkbenchNotice[],
  groupKey: string,
  replacements: WorkbenchNotice[],
): WorkbenchNotice[] {
  return [
    ...replacements,
    ...current.filter((notice) => notice.groupKey !== groupKey),
  ];
}

/**
 * Bounds the number of per-document diagnostic notices rendered in the notices
 * panel. A single Laravel file can publish hundreds of diagnostics; mapping
 * every one to a notice and re-rendering the panel freezes the main thread.
 *
 * Markers in the editor (Monaco `setModelMarkers`) are populated from a
 * separate, uncapped diagnostics source, so capping notices here never hides a
 * squiggle. The kept notices are the server-ordered head of the list, and an
 * `info` overflow indicator carrying the truthful hidden count is appended so
 * diagnostics are never dropped silently.
 */
export function capDiagnosticNotices(
  notices: WorkbenchNotice[],
  limit: number,
  buildOverflowNotice: (hiddenCount: number) => WorkbenchNotice,
): WorkbenchNotice[] {
  if (notices.length <= limit) {
    return notices;
  }

  const hiddenCount = notices.length - limit;
  return [...notices.slice(0, limit), buildOverflowNotice(hiddenCount)];
}
