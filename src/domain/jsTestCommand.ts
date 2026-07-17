import { shellQuoteFilter } from "./shellQuote";

export type JsTestRunner = "vitest" | "jest";

export interface JsTestRunCommandInput {
  filePath?: string | null;
  filter?: string | null;
  runner: JsTestRunner;
}

const RUNNER_PREFIX: Record<JsTestRunner, string> = {
  jest: "node_modules/.bin/jest",
  vitest: "node_modules/.bin/vitest run",
};

export function jsTestRunCommand(input: JsTestRunCommandInput): string | null {
  const parts = [RUNNER_PREFIX[input.runner]];
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

  return parts.join(" ");
}
