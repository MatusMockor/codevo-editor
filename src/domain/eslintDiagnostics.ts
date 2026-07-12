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
}

export type EslintAnalysisResult =
  | {
      status: "ok";
      diagnostics: EslintDiagnostic[];
      totals: { errorCount: number; warningCount: number; fileCount: number };
    }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export interface EslintDiagnosticsGateway {
  analyse(
    rootPath: string,
    binaryPath: string | null,
  ): Promise<EslintAnalysisResult>;
}

export function eslintNoticeGroup(rootPath: string): string {
  return `eslint:${rootPath}`;
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
