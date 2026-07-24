import { CONTROL_CHARACTER_PATTERN, shellQuoteFilter } from "./shellQuote";

export type JsTestRunner = "vitest" | "jest";

export interface JsTestRunCommandInput {
  filePath?: string | null;
  filter?: string | null;
  runner: JsTestRunner;
  executablePath?: string | null;
  workingDirectory?: string | null;
}

const RUNNER_PREFIX: Record<JsTestRunner, string> = {
  jest: "node_modules/.bin/jest",
  vitest: "node_modules/.bin/vitest run",
};

export function jsTestRunCommand(input: JsTestRunCommandInput): string | null {
  const executable = input.executablePath?.trim() ?? "";
  if (executable && CONTROL_CHARACTER_PATTERN.test(executable)) {
    return null;
  }
  if (executable.startsWith("/")) {
    return null;
  }
  const runnerPrefix = executable
    ? `${shellQuoteFilter(executable)}${input.runner === "vitest" ? " run" : ""}`
    : RUNNER_PREFIX[input.runner];
  const parts = [runnerPrefix];
  const filePath = input.filePath ?? null;

  if (filePath !== null) {
    const quotedPath = shellQuoteFilter(filePath);

    if (!quotedPath) {
      return null;
    }

    parts.push(quotedPath);
  }

  const filter = input.filter ?? null;

  if (filter !== null) {
    const quotedFilter = shellQuoteFilter(filter);

    if (!quotedFilter) {
      return null;
    }

    parts.push("-t", quotedFilter);
  }

  const command = parts.join(" ");
  const workingDirectory = input.workingDirectory?.trim() ?? "";
  if (!workingDirectory) {
    return command;
  }
  if (!safeWorkingDirectory(workingDirectory)) {
    return null;
  }
  const quotedDirectory = shellQuoteFilter(workingDirectory);
  return quotedDirectory ? `cd ${quotedDirectory} && ${command}` : null;
}

function safeWorkingDirectory(path: string): boolean {
  return !path.startsWith("/") && path.split(/[\\/]/).every((segment) => segment && segment !== "." && segment !== "..");
}
