export type WorkbenchNoticeSeverity = "info" | "warning" | "error";

export interface WorkbenchNotice {
  id: string;
  severity: WorkbenchNoticeSeverity;
  source: string;
  message: string;
}

export function createWorkbenchNotice(
  severity: WorkbenchNoticeSeverity,
  source: string,
  message: string,
): WorkbenchNotice {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    message,
    severity,
    source,
  };
}
