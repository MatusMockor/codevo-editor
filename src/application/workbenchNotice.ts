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
