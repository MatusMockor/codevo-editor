export type WorkbenchNoticeSeverity = "info" | "warning" | "error";

/**
 * Distinguishes notices that require bespoke presentation from ordinary
 * diagnostics without coupling domain diagnostics to the application layer.
 */
export type WorkbenchNoticeKind = "overflow";

export interface WorkbenchNotice {
  groupKey?: string;
  id: string;
  kind?: WorkbenchNoticeKind;
  navigationTarget?: WorkbenchNoticeNavigationTarget;
  severity: WorkbenchNoticeSeverity;
  source: string;
  message: string;
  toastDismissKey?: string;
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
  kind?: WorkbenchNoticeKind,
): WorkbenchNotice {
  return {
    groupKey,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    kind,
    message,
    navigationTarget,
    severity,
    source,
  };
}
