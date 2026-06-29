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
const phpLocalDiagnosticGroupPrefix = "php-local-diagnostics:";

export function isDiagnosticNotice(notice: DiagnosticNoticeLike): boolean {
  const groupKey = notice.groupKey;

  if (!groupKey) {
    return false;
  }

  if (groupKey.startsWith(languageServerDiagnosticNoticeGroup(""))) {
    return true;
  }

  return (
    groupKey.startsWith(javaScriptTypeScriptDiagnosticGroupPrefix) ||
    groupKey.startsWith(phpLocalDiagnosticGroupPrefix)
  );
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

interface DiagnosticSeverityLike {
  severity: "error" | "warning" | "information" | "hint";
}

/**
 * Summarizes diagnostics straight from the (uncapped) per-path diagnostics
 * source that also feeds editor markers. Counting here — rather than from the
 * notices list — keeps the status-bar error/warning count truthful even when
 * the notices panel is capped to protect the main thread. `information` and
 * `hint` severities are not counted, mirroring the notice severity mapping.
 */
export function summarizeDiagnosticsByPath(
  diagnosticsByPath: Record<string, DiagnosticSeverityLike[]>,
): DiagnosticsSummary {
  let errors = 0;
  let warnings = 0;

  for (const diagnostics of Object.values(diagnosticsByPath)) {
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === "error") {
        errors += 1;
        continue;
      }

      if (diagnostic.severity === "warning") {
        warnings += 1;
      }
    }
  }

  return { errors, warnings };
}
