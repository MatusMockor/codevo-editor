import {
  MAX_FUNCTION_BREAKPOINT_NAME_BYTES,
  MAX_FUNCTION_BREAKPOINT_SEGMENTS,
  functionBreakpointNameError,
} from "./debugFunctionBreakpoints";

export const MAX_EXCEPTION_TYPE_FILTER_COUNT = 8;
export const MAX_DEBUG_EXCEPTION_TYPE_FILTERS = MAX_EXCEPTION_TYPE_FILTER_COUNT;

export type DebugExceptionTypeFilter = readonly string[];

export function exceptionTypeFilterNameError(name: string): string | null {
  const error = functionBreakpointNameError(name);
  if (!error) return null;
  if (name.length === 0) return "An exception constructor name is required.";
  if (new TextEncoder().encode(name).length > MAX_FUNCTION_BREAKPOINT_NAME_BYTES) {
    return `Exception constructor names must be at most ${MAX_FUNCTION_BREAKPOINT_NAME_BYTES} bytes.`;
  }
  if (name.split(".").length > MAX_FUNCTION_BREAKPOINT_SEGMENTS) {
    return `Exception constructor names must have at most ${MAX_FUNCTION_BREAKPOINT_SEGMENTS} segments.`;
  }
  return "Use a JavaScript constructor name or dotted path such as Error or app.DomainError.";
}

export const debugExceptionTypeNameError = exceptionTypeFilterNameError;

export function isExceptionTypeFilter(value: unknown): value is DebugExceptionTypeFilter {
  if (!Array.isArray(value) || value.length > MAX_EXCEPTION_TYPE_FILTER_COUNT) return false;
  const names = new Set<string>();
  for (const name of value) {
    if (typeof name !== "string" || exceptionTypeFilterNameError(name)) return false;
    if (names.has(name)) return false;
    names.add(name);
  }
  return true;
}

export function shouldPauseForExceptionType(filter: unknown, className: unknown): boolean {
  if (!isExceptionTypeFilter(filter) || filter.length === 0) return true;
  if (
    typeof className !== "string" ||
    className.includes(".") ||
    exceptionTypeFilterNameError(className)
  ) {
    return true;
  }
  return filter.some((name) => {
    const segments = name.split(".");
    return segments[segments.length - 1] === className;
  });
}
