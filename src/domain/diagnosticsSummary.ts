import { languageServerDiagnosticNoticeGroup } from "./languageServerDiagnostics";

export interface DiagnosticsSummary {
  errors: number;
  warnings: number;
}

interface DiagnosticNoticeLike {
  groupKey?: string;
  severity: "info" | "warning" | "error";
}

const javaScriptTypeScriptDiagnosticGroupPrefix =
  "javascript-typescript-diagnostics:";

export function isDiagnosticNotice(notice: DiagnosticNoticeLike): boolean {
  const groupKey = notice.groupKey;

  if (!groupKey) {
    return false;
  }

  if (groupKey.startsWith(languageServerDiagnosticNoticeGroup(""))) {
    return true;
  }

  return groupKey.startsWith(javaScriptTypeScriptDiagnosticGroupPrefix);
}

export function summarizeDiagnostics(
  notices: DiagnosticNoticeLike[],
): DiagnosticsSummary {
  let errors = 0;
  let warnings = 0;

  for (const notice of notices) {
    if (!isDiagnosticNotice(notice)) {
      continue;
    }

    if (notice.severity === "error") {
      errors += 1;
      continue;
    }

    if (notice.severity === "warning") {
      warnings += 1;
    }
  }

  return { errors, warnings };
}
