import type {
  DebugVariablePage,
  DebugVariablePageLimitReason,
  DebugVariablePageRequest,
} from "../domain/debug";

interface DebugVariablePageCompletion {
  readonly path: string;
  readonly start: number;
  readonly returned: number;
  readonly total: number | null;
  readonly nextStart: number | null;
  readonly truncated: boolean;
  readonly limitReason: DebugVariablePageLimitReason | null;
}

export function validateDebugVariablePageCompletion({
  path,
  start,
  returned,
  total,
  nextStart,
  truncated,
  limitReason,
}: DebugVariablePageCompletion): void {
  const consumed = start + returned;
  if (!Number.isSafeInteger(consumed)) {
    throw invalidPage(path, "returned", "an offset that remains JavaScript-safe");
  }
  if (total !== null && total < consumed) {
    throw invalidPage(path, "total", "at least start + returned");
  }
  if (nextStart !== null && (returned === 0 || nextStart !== consumed)) {
    throw invalidPage(path, "nextStart", "the progressive start + returned offset");
  }
  if (nextStart !== null && total !== null && nextStart >= total) {
    throw invalidPage(path, "nextStart", "less than total when both are present");
  }
  if (!truncated) {
    if (total === null || limitReason !== null) {
      throw invalidPage(path, null, "an exhaustive total with no limit reason");
    }
    if (nextStart !== (consumed < total ? consumed : null)) {
      throw invalidPage(path, "nextStart", "the exact exhaustive continuation");
    }
    return;
  }
  if (limitReason === null) {
    throw invalidPage(path, "limitReason", "present when truncated");
  }
}

export function validateDebugVariablePageRequestMatch(
  page: DebugVariablePage,
  request: DebugVariablePageRequest,
): void {
  if (page.start !== request.start) {
    throw invalidPage("debug_variables result", "start", "the request start");
  }
  if (page.filter !== request.filter) {
    throw invalidPage("debug_variables result", "filter", "the request filter");
  }
  if (page.returned > request.count) {
    throw invalidPage("debug_variables result", "returned", "at most the request count");
  }
}

function invalidPage(path: string, field: string | null, expectation: string): TypeError {
  return new TypeError(
    `Invalid debug IPC value at ${path}${field === null ? "" : `.${field}`}: expected ${expectation}.`,
  );
}
