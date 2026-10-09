import { expect, vi, type MockInstance } from "vitest";

export type ConsoleErrorSpy = MockInstance<typeof console.error>;

type ConsoleErrorCall = ReadonlyArray<unknown>;

const BOUNDARY_REPORT = "ErrorBoundary caught a render error";
const REACT_REPORT_FORMAT = "%o\n\n%s\n\n%s\n";
const REACT_REPORT_ORIGIN = "The above error occurred in ";
const REACT_REPORT_RECOVERY = "using the error boundary you provided, ErrorBoundary";

export function captureConsoleErrors(): ConsoleErrorSpy {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

export function expectOnlyCaughtErrorReports(
  consoleError: ConsoleErrorSpy,
  caughtErrors: number,
): void {
  const calls: ReadonlyArray<ConsoleErrorCall> = consoleError.mock.calls;

  expect(calls.filter(isUnexpected)).toEqual([]);
  expect(calls.filter(isBoundaryReport)).toHaveLength(caughtErrors);
  expect(calls.filter(isReactReport)).toHaveLength(caughtErrors);
}

export function expectNoUnexpectedConsoleErrors(consoleError: ConsoleErrorSpy): void {
  const calls: ReadonlyArray<ConsoleErrorCall> = consoleError.mock.calls;

  expect(calls.filter(isUnexpected)).toEqual([]);
}

function isUnexpected(call: ConsoleErrorCall): boolean {
  return !isBoundaryReport(call) && !isReactReport(call);
}

function isBoundaryReport(call: ConsoleErrorCall): boolean {
  return call.length === 3 && call[0] === BOUNDARY_REPORT && call[1] instanceof Error;
}

function isReactReport(call: ConsoleErrorCall): boolean {
  const [format, error, origin, recovery] = call;
  return (
    call.length === 4 &&
    format === REACT_REPORT_FORMAT &&
    error instanceof Error &&
    typeof origin === "string" &&
    origin.startsWith(REACT_REPORT_ORIGIN) &&
    typeof recovery === "string" &&
    recovery.includes(REACT_REPORT_RECOVERY)
  );
}
