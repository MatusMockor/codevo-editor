import { createWorkbenchNotice, type WorkbenchNotice } from "../application/workbenchNotice";
import { joinWorkspacePath } from "./workspace";

export interface PhpstanDiagnostic {
  filePath: string;
  line: number | null;
  message: string;
  identifier: string | null;
  ignorable: boolean;
}

export type PhpstanAnalysisResult =
  | {
      status: "ok";
      diagnostics: PhpstanDiagnostic[];
      totals: { fileErrors: number; generalErrors: number; fileCount: number };
    }
  | { status: "unavailable" }
  | { status: "error"; message: string };

export interface PhpstanDiagnosticsGateway {
  analyse(
    rootPath: string,
    binaryPath: string | null,
    configPath: string | null,
  ): Promise<PhpstanAnalysisResult>;
}

export function phpstanNoticeGroup(rootPath: string): string {
  return `phpstan:${rootPath}`;
}

export function parsePhpstanDiagnostics(
  result: PhpstanAnalysisResult,
  rootPath: string,
): WorkbenchNotice[] {
  const groupKey = phpstanNoticeGroup(rootPath);

  if (result.status === "unavailable") {
    return [
      createWorkbenchNotice(
        "info",
        "PHPStan",
        "PHPStan is unavailable. Configure phpstanPath or install PHPStan with Composer.",
        groupKey,
      ),
    ];
  }

  if (result.status === "error") {
    return [
      createWorkbenchNotice("error", "PHPStan", result.message, groupKey),
    ];
  }

  return result.diagnostics.map((diagnostic) => {
    const lineNumber = Math.max(1, diagnostic.line ?? 1);
    const navigationTarget = diagnostic.filePath
      ? {
          path: joinWorkspacePath(rootPath, diagnostic.filePath),
          range: {
            start: { lineNumber, column: 1 },
            end: { lineNumber, column: 1 },
          },
        }
      : undefined;
    return createWorkbenchNotice(
      "error",
      "PHPStan",
      diagnostic.message,
      groupKey,
      navigationTarget,
    );
  });
}
