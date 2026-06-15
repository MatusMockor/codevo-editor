export type WorkbenchNoticeSeverity = "info" | "warning" | "error";

export interface WorkbenchNotice {
  groupKey?: string;
  id: string;
  severity: WorkbenchNoticeSeverity;
  source: string;
  message: string;
}

export function createWorkbenchNotice(
  severity: WorkbenchNoticeSeverity,
  source: string,
  message: string,
  groupKey?: string,
): WorkbenchNotice {
  return {
    groupKey,
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
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
