import type { FunctionBreakpoint, FunctionBreakpointVerification } from "./debug";

export const MAX_FUNCTION_BREAKPOINT_NAME_BYTES = 256;
export const MAX_FUNCTION_BREAKPOINT_SEGMENTS = 8;
export const MAX_FUNCTION_BREAKPOINTS = 128;
const MAX_FUNCTION_BREAKPOINT_ID_BYTES = 128;
const IDENTIFIER_SEGMENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

export type FunctionBreakpointIdFactory = () => string;

export function functionBreakpointNameError(name: string): string | null {
  if (name.length === 0) return "A function name is required.";
  if (new TextEncoder().encode(name).length > MAX_FUNCTION_BREAKPOINT_NAME_BYTES) {
    return `Function names must be at most ${MAX_FUNCTION_BREAKPOINT_NAME_BYTES} bytes.`;
  }
  const segments = name.split(".");
  if (
    segments.length > MAX_FUNCTION_BREAKPOINT_SEGMENTS ||
    segments.some((segment) => !IDENTIFIER_SEGMENT.test(segment))
  ) {
    return "Use a JavaScript name or dotted path such as render or app.render.";
  }
  return null;
}

export function isFunctionBreakpointName(name: unknown): name is string {
  return typeof name === "string" && functionBreakpointNameError(name) === null;
}

export function addFunctionBreakpoint(
  list: readonly FunctionBreakpoint[],
  functionName: string,
  createId: FunctionBreakpointIdFactory,
): FunctionBreakpoint[] {
  if (
    !isFunctionBreakpointName(functionName) ||
    list.length >= MAX_FUNCTION_BREAKPOINTS ||
    list.some((entry) => entry.functionName === functionName)
  ) {
    return list as FunctionBreakpoint[];
  }
  const candidate = { id: createId(), functionName, enabled: true };
  if (list.some((entry) => entry.id === candidate.id)) return list as FunctionBreakpoint[];
  return isFunctionBreakpoint(candidate) ? [...list, candidate] : (list as FunctionBreakpoint[]);
}

export function removeFunctionBreakpoint(
  list: readonly FunctionBreakpoint[],
  id: string,
): FunctionBreakpoint[] {
  if (!list.some((entry) => entry.id === id)) return list as FunctionBreakpoint[];
  return list.filter((entry) => entry.id !== id);
}

export function setFunctionBreakpointEnabled(
  list: readonly FunctionBreakpoint[],
  id: string,
  enabled: boolean,
): FunctionBreakpoint[] {
  if (!list.some((entry) => entry.id === id && entry.enabled !== enabled)) {
    return list as FunctionBreakpoint[];
  }
  return list.map((entry) => (entry.id === id ? { ...entry, enabled } : entry));
}

export function serializeFunctionBreakpoints(list: readonly FunctionBreakpoint[]): string {
  return JSON.stringify(list);
}

export function deserializeFunctionBreakpoints(raw: string): FunctionBreakpoint[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const result: FunctionBreakpoint[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const candidate of parsed.slice(0, MAX_FUNCTION_BREAKPOINTS)) {
    if (
      !isFunctionBreakpoint(candidate) ||
      ids.has(candidate.id) ||
      names.has(candidate.functionName)
    ) {
      continue;
    }
    ids.add(candidate.id);
    names.add(candidate.functionName);
    result.push(candidate);
  }
  return result;
}

export function functionBreakpointModelError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "model";
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 3 ||
    !Object.prototype.hasOwnProperty.call(record, "id") ||
    !Object.prototype.hasOwnProperty.call(record, "functionName") ||
    !Object.prototype.hasOwnProperty.call(record, "enabled")
  ) {
    return "model";
  }
  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    new TextEncoder().encode(record.id).length > MAX_FUNCTION_BREAKPOINT_ID_BYTES ||
    record.id.includes("\0")
  ) {
    return "id";
  }
  if (!isFunctionBreakpointName(record.functionName)) return "functionName";
  return typeof record.enabled === "boolean" ? null : "enabled";
}

export function functionBreakpointVerificationModelError(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "model";
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(record, "id") ||
    !Object.prototype.hasOwnProperty.call(record, "verified")
  ) {
    return "model";
  }
  if (
    typeof record.id !== "string" ||
    record.id.length === 0 ||
    new TextEncoder().encode(record.id).length > MAX_FUNCTION_BREAKPOINT_ID_BYTES ||
    record.id.includes("\0")
  ) {
    return "id";
  }
  return typeof record.verified === "boolean" ? null : "verified";
}

export function isFunctionBreakpoint(value: unknown): value is FunctionBreakpoint {
  return functionBreakpointModelError(value) === null;
}

export function isFunctionBreakpointVerification(
  value: unknown,
): value is FunctionBreakpointVerification {
  return functionBreakpointVerificationModelError(value) === null;
}

export interface FunctionBreakpointWireError {
  readonly expected: string;
  readonly path: string;
}

export function validateFunctionBreakpointCommandArgs(
  value: unknown,
): FunctionBreakpointWireError | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { expected: "an object", path: "" };
  }
  const args = value as Record<string, unknown>;
  if (!hasExactKeys(args, ["request"])) return { expected: "only request", path: "" };
  if (!args.request || typeof args.request !== "object" || Array.isArray(args.request)) {
    return { expected: "an object", path: "request" };
  }
  const request = args.request as Record<string, unknown>;
  if (!hasExactKeys(request, ["rootPath", "sessionId", "breakpoints"])) {
    return { expected: "a closed request", path: "request" };
  }
  if (
    typeof request.rootPath !== "string" ||
    request.rootPath.length === 0 ||
    new TextEncoder().encode(request.rootPath).length > 4_096 ||
    [...request.rootPath].some((character) => isControlCharacter(character))
  ) {
    return { expected: "a bounded control-free path", path: "request.rootPath" };
  }
  if (!Number.isSafeInteger(request.sessionId) || (request.sessionId as number) <= 0) {
    return { expected: "a positive safe integer", path: "request.sessionId" };
  }
  if (
    !Array.isArray(request.breakpoints) ||
    request.breakpoints.length > MAX_FUNCTION_BREAKPOINTS
  ) {
    return { expected: `at most ${MAX_FUNCTION_BREAKPOINTS} items`, path: "request.breakpoints" };
  }
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const [index, breakpoint] of request.breakpoints.entries()) {
    const error = functionBreakpointModelError(breakpoint);
    if (error) {
      return {
        expected: "a closed function breakpoint",
        path: `request.breakpoints[${index}].${error}`,
      };
    }
    const model = breakpoint as FunctionBreakpoint;
    if (!ids.add(model.id)) {
      return { expected: "a unique id", path: `request.breakpoints[${index}].id` };
    }
    if (!names.add(model.functionName)) {
      return {
        expected: "a unique name",
        path: `request.breakpoints[${index}].functionName`,
      };
    }
  }
  return null;
}

export function decodeFunctionBreakpointVerificationList(
  value: unknown,
): readonly FunctionBreakpointVerification[] | null {
  if (!Array.isArray(value) || value.length > MAX_FUNCTION_BREAKPOINTS) return null;
  if (value.some((entry) => !isFunctionBreakpointVerification(entry))) return null;
  return value.map((entry) => Object.freeze({ ...entry }));
}

export function functionBreakpointVerificationsMatch(
  verification: readonly FunctionBreakpointVerification[],
  breakpoints: readonly FunctionBreakpoint[],
): boolean {
  return (
    verification.length === breakpoints.length &&
    verification.every((entry, index) => entry.id === breakpoints[index]?.id)
  );
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(record).length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(record, key))
  );
}

function isControlCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 31 || (code >= 127 && code <= 159);
}
