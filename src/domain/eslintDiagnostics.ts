import { createWorkbenchNotice, type WorkbenchNotice } from "../application/workbenchNotice";
import { joinWorkspacePath } from "./workspace";

export interface EslintDiagnostic {
  filePath: string;
  line: number | null;
  column: number | null;
  endLine: number | null;
  endColumn: number | null;
  message: string;
  identifier: string | null;
  severity: 1 | 2;
  fix?: EslintFix | null;
}

export interface EslintFix {
  range: [number, number];
  text: string;
}

export interface RetainedEslintDiagnostic {
  identifier: string;
  line: number;
}

export type EslintDiagnosticsByRoot = Record<
  string,
  Record<string, RetainedEslintDiagnostic[]>
>;

export interface AppliedEslintFixes {
  content: string;
  appliedCount: number;
}

export type EslintAnalysisResult =
  | {
      status: "ok";
      diagnostics: EslintDiagnostic[];
      totals: { errorCount: number; warningCount: number; fileCount: number };
    }
  | { status: "unavailable"; message?: string }
  | { status: "error"; message: string };

export interface EslintDiagnosticsGateway {
  analyse(
    rootPath: string,
    binaryPath: string | null,
  ): Promise<EslintAnalysisResult>;
}

export function applyEslintFixes(
  content: string,
  fixes: readonly EslintFix[],
): AppliedEslintFixes {
  const applicable = applicableEslintFixes(content, fixes);
  const fixedContent = applicable.reduceRight((current, fix) => {
    const [start, end] = fix.range;
    return `${current.slice(0, start)}${fix.text}${current.slice(end)}`;
  }, content);

  return { content: fixedContent, appliedCount: applicable.length };
}

export function applicableEslintFixes(
  content: string,
  fixes: readonly EslintFix[],
): EslintFix[] {
  return fixes
    .map((fix, index) => ({ fix, index }))
    .sort((left, right) => left.fix.range[0] - right.fix.range[0] || left.index - right.index)
    .reduce<EslintFix[]>((accepted, { fix }) => {
      const [start, end] = fix.range;

      if (!Number.isInteger(start) || !Number.isInteger(end)) {
        return accepted;
      }

      if (start < 0 || end < start || end > content.length) {
        return accepted;
      }

      const previous = accepted[accepted.length - 1];

      if (previous && start < previous.range[1]) {
        return accepted;
      }

      accepted.push(fix);
      return accepted;
    }, []);
}

export function eslintNoticeGroup(rootPath: string): string {
  return `eslint:${rootPath}`;
}

export function supportsEslintLineComment(language: string): boolean {
  return language === "javascript" || language === "typescript";
}

export function replaceEslintDiagnosticsForRoot(
  current: EslintDiagnosticsByRoot,
  rootPath: string,
  result: EslintAnalysisResult,
): EslintDiagnosticsByRoot {
  const diagnosticsByPath: Record<string, RetainedEslintDiagnostic[]> = {};

  if (result.status === "ok") {
    result.diagnostics.forEach((diagnostic) => {
      if (!diagnostic.filePath || !diagnostic.identifier || diagnostic.line === null) {
        return;
      }

      const path = joinWorkspacePath(rootPath, diagnostic.filePath);
      diagnosticsByPath[path] = [
        ...(diagnosticsByPath[path] ?? []),
        { identifier: diagnostic.identifier, line: Math.max(1, diagnostic.line) },
      ];
    });
  }

  return { ...current, [rootPath]: diagnosticsByPath };
}

export function clearEslintDiagnosticsForFile(
  current: EslintDiagnosticsByRoot,
  rootPath: string,
  filePath: string,
): EslintDiagnosticsByRoot {
  const rootDiagnostics = current[rootPath];

  if (!rootDiagnostics?.[filePath]) {
    return current;
  }

  const nextRootDiagnostics = { ...rootDiagnostics };
  delete nextRootDiagnostics[filePath];
  return { ...current, [rootPath]: nextRootDiagnostics };
}

export function parseEslintDiagnostics(
  result: EslintAnalysisResult,
  rootPath: string,
): WorkbenchNotice[] {
  const groupKey = eslintNoticeGroup(rootPath);

  if (result.status === "unavailable") {
    return [
      createWorkbenchNotice(
        "info",
        "ESLint",
        result.message ??
          "ESLint is unavailable. Configure eslintPath or install ESLint in the workspace.",
        groupKey,
      ),
    ];
  }

  if (result.status === "error") {
    return [createWorkbenchNotice("error", "ESLint", result.message, groupKey)];
  }

  return result.diagnostics.map((diagnostic) => {
    const lineNumber = Math.max(1, diagnostic.line ?? 1);
    const column = Math.max(1, diagnostic.column ?? 1);
    const endLineNumber = Math.max(lineNumber, diagnostic.endLine ?? lineNumber);
    const endColumn = Math.max(1, diagnostic.endColumn ?? column);
    const navigationTarget = diagnostic.filePath
      ? {
          path: joinWorkspacePath(rootPath, diagnostic.filePath),
          range: {
            start: { lineNumber, column },
            end: { lineNumber: endLineNumber, column: endColumn },
          },
        }
      : undefined;
    return createWorkbenchNotice(
      diagnostic.severity === 1 ? "warning" : "error",
      "ESLint",
      diagnostic.message,
      groupKey,
      navigationTarget,
    );
  });
}
