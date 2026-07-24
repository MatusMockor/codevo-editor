import { isNodeDebugPort, type DebuggerState, type DebugLaunchTarget } from "../domain/debug";
import type { NodeDebugJustMyCodePolicy } from "../domain/nodeDebugJustMyCode";
import { isNodeDebugJustMyCodePolicy } from "../domain/nodeDebugJustMyCode";
import { isWellFormedUnicode } from "../domain/unicodeText";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export const MAX_DEBUG_RESTART_ROOT_BYTES = 4_096;
export const MAX_DEBUG_RESTART_PATH_BYTES = 4_096;
export const MAX_DEBUG_RESTART_NAME_BYTES = 4_096;
export const MAX_DEBUG_RESTART_SCRIPT_NAME_BYTES = 256;
export const MAX_DEBUG_RESTART_ARGUMENTS = 128;
export const MAX_DEBUG_RESTART_ARGUMENT_BYTES = 16 * 1_024;
export const MAX_DEBUG_RESTART_ENVIRONMENT_ENTRIES = 128;
export const MAX_DEBUG_RESTART_ENVIRONMENT_NAME_BYTES = 256;
export const MAX_DEBUG_RESTART_ENVIRONMENT_VALUE_BYTES = 16 * 1_024;
export const MAX_DEBUG_RESTART_RETAINED_TEXT_BYTES = 512 * 1_024;

export type NodeDebugLaunchKind =
  | "node-attach"
  | "node-script"
  | "js-test-file"
  | "js-test-selection"
  | "node-configured-script"
  | "js-configured-test"
  | "node-npm-script";

export type NodeDebugLaunchTarget = Extract<DebugLaunchTarget, { kind: NodeDebugLaunchKind }>;

export interface DebugRestartEligibilityContext {
  readonly rootPath: string | null;
  readonly sessionId: number | null;
  readonly stateKind: DebuggerState["kind"];
  readonly workspaceTrusted: boolean;
}

export interface DebugRestartResolutionContext {
  readonly rootPath: string | null;
  readonly sessionId: number | null;
  readonly workspaceTrusted: boolean;
}

/** UI-safe state. The retained launch arguments and environment stay private. */
export interface DebugRestartAvailability {
  readonly canRestart: boolean;
  readonly rootKey: string | null;
  readonly sessionId: number | null;
  readonly targetKind: NodeDebugLaunchKind | null;
}

/** Opaque, single-use lease captured before the old session is stopped. */
export interface DebugRestartAttempt {
  readonly attemptId: number;
  readonly rootKey: string;
  readonly sessionId: number;
  readonly targetKind: NodeDebugLaunchKind;
}

interface RetainedLaunch {
  readonly launch: NodeDebugLaunchTarget;
  readonly rootKey: string;
  readonly sessionId: number;
}

interface PendingAttempt {
  readonly attempt: DebugRestartAttempt;
  readonly launch: NodeDebugLaunchTarget;
}

const EMPTY_AVAILABILITY: DebugRestartAvailability = Object.freeze({
  canRestart: false,
  rootKey: null,
  sessionId: null,
  targetKind: null,
});
const unsafeDisplayCharacterPattern = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const encoder = new TextEncoder();

/** Owns the private launch recipe for one exact successful Node debug session. */
export class DebugRestartCoordinator {
  private nextAttemptId = 0;
  private pending: PendingAttempt | null = null;
  private retained: RetainedLaunch | null = null;

  retain(rootPath: string, sessionId: number, launch: DebugLaunchTarget): boolean {
    const rootKey = validRootKey(rootPath);
    const clonedLaunch = cloneNodeLaunchTarget(launch);
    if (!rootKey || !isSessionId(sessionId) || !clonedLaunch) {
      this.clear();
      return false;
    }
    this.retained = Object.freeze({ launch: clonedLaunch, rootKey, sessionId });
    this.pending = null;
    return true;
  }

  availability(context: DebugRestartEligibilityContext): DebugRestartAvailability {
    const retained = this.matchingRetained(context.rootPath, context.sessionId);
    if (
      !retained ||
      !context.workspaceTrusted ||
      (context.stateKind !== "running" && context.stateKind !== "stopped")
    ) {
      return EMPTY_AVAILABILITY;
    }
    return Object.freeze({
      canRestart: this.pending === null,
      rootKey: retained.rootKey,
      sessionId: retained.sessionId,
      targetKind: retained.launch.kind,
    });
  }

  begin(context: DebugRestartEligibilityContext): DebugRestartAttempt | null {
    const available = this.availability(context);
    const retained = this.retained;
    if (!available.canRestart || !retained) return null;
    const attempt = Object.freeze({
      attemptId: this.nextAttemptId === Number.MAX_SAFE_INTEGER ? 1 : this.nextAttemptId + 1,
      rootKey: retained.rootKey,
      sessionId: retained.sessionId,
      targetKind: retained.launch.kind,
    });
    this.nextAttemptId = attempt.attemptId;
    this.pending = Object.freeze({
      attempt,
      launch: cloneNodeLaunchTarget(retained.launch)!,
    });
    return attempt;
  }

  /** Resolves a lease once, after stop. Any owner/session/trust drift fails closed. */
  resolve(
    attempt: DebugRestartAttempt,
    context: DebugRestartResolutionContext,
  ): NodeDebugLaunchTarget | null {
    const pending = this.pending;
    if (!pending || pending.attempt !== attempt) return null;
    this.pending = null;
    const rootKey = validRootKey(context.rootPath);
    if (
      !context.workspaceTrusted ||
      rootKey !== attempt.rootKey ||
      context.sessionId !== attempt.sessionId ||
      pending.launch.kind !== attempt.targetKind
    ) {
      return null;
    }
    return cloneNodeLaunchTarget(pending.launch);
  }

  cancel(attempt: DebugRestartAttempt): boolean {
    if (!this.pending || this.pending.attempt !== attempt) return false;
    this.pending = null;
    return true;
  }

  release(rootPath: string, sessionId: number): boolean {
    if (!this.matchingRetained(rootPath, sessionId)) return false;
    this.retained = null;
    if (
      this.pending?.attempt.rootKey !== validRootKey(rootPath) ||
      this.pending.attempt.sessionId !== sessionId
    ) {
      this.pending = null;
    }
    return true;
  }

  clear(): void {
    this.retained = null;
    this.pending = null;
  }

  private matchingRetained(
    rootPath: string | null,
    sessionId: number | null,
  ): RetainedLaunch | null {
    const retained = this.retained;
    if (!retained || !isSessionId(sessionId)) return null;
    const rootKey = validRootKey(rootPath);
    return rootKey === retained.rootKey && sessionId === retained.sessionId ? retained : null;
  }
}

/** Creates the bounded immutable Node launch recipe used by restart lifecycles. */
export function cloneNodeLaunchTarget(launch: DebugLaunchTarget): NodeDebugLaunchTarget | null {
  if (!isRecord(launch) || typeof launch.kind !== "string") return null;
  const sourceMaps = cloneSourceMaps(launch);
  if (!sourceMaps) return null;
  let clone: NodeDebugLaunchTarget | null = null;
  switch (launch.kind) {
    case "node-attach":
      clone =
        !hasJustMyCode(launch) && isNodeDebugPort(launch.port)
          ? { kind: launch.kind, port: launch.port }
          : null;
      break;
    case "node-script":
      clone =
        !hasJustMyCode(launch) && safePath(launch.scriptPath)
          ? { kind: launch.kind, scriptPath: launch.scriptPath }
          : null;
      break;
    case "js-test-file":
      clone =
        !hasJustMyCode(launch) &&
        isJsTestRunner(launch.runner) &&
        safePath(launch.filePath) &&
        safePath(launch.packageRootPath)
          ? {
              filePath: launch.filePath,
              kind: launch.kind,
              packageRootPath: launch.packageRootPath,
              runner: launch.runner,
            }
          : null;
      break;
    case "js-test-selection":
      clone = cloneSelectedTestLaunch(launch);
      break;
    case "node-configured-script": {
      const options = cloneOptions(launch, true);
      clone =
        options && safePath(launch.scriptPath)
          ? { kind: launch.kind, scriptPath: launch.scriptPath, ...options }
          : null;
      break;
    }
    case "js-configured-test": {
      const options = cloneOptions(launch, false);
      clone =
        options &&
        isJsTestRunner(launch.runner) &&
        safePath(launch.filePath) &&
        safePath(launch.packageRootPath)
          ? {
              filePath: launch.filePath,
              kind: launch.kind,
              packageRootPath: launch.packageRootPath,
              runner: launch.runner,
              ...options,
            }
          : null;
      break;
    }
    case "node-npm-script": {
      const options = cloneOptions(launch, true);
      clone =
        options &&
        safeDisplayString(launch.script, MAX_DEBUG_RESTART_SCRIPT_NAME_BYTES) &&
        safePath(launch.packageRootPath)
          ? {
              kind: launch.kind,
              packageRootPath: launch.packageRootPath,
              script: launch.script,
              ...options,
            }
          : null;
      break;
    }
    default:
      return null;
  }
  const launchWithSourceMaps = clone
    ? ({ ...clone, ...sourceMaps } as NodeDebugLaunchTarget)
    : null;
  return launchWithSourceMaps &&
    launchTextBytes(launchWithSourceMaps) <= MAX_DEBUG_RESTART_RETAINED_TEXT_BYTES
    ? deepFreezeLaunch(launchWithSourceMaps)
    : null;
}

function cloneSourceMaps(
  launch: Record<string, unknown>,
): { readonly sourceMaps?: boolean } | null {
  if (!Object.prototype.hasOwnProperty.call(launch, "sourceMaps")) return {};
  if (
    launch.kind !== "node-attach" &&
    launch.kind !== "node-script" &&
    launch.kind !== "node-configured-script" &&
    launch.kind !== "node-npm-script"
  ) {
    return null;
  }
  return typeof launch.sourceMaps === "boolean" ? { sourceMaps: launch.sourceMaps } : null;
}

function cloneSelectedTestLaunch(
  launch: Extract<DebugLaunchTarget, { kind: "js-test-selection" }>,
): NodeDebugLaunchTarget | null {
  if (
    hasJustMyCode(launch) ||
    !isJsTestRunner(launch.runner) ||
    !safePath(launch.filePath) ||
    !safePath(launch.packageRootPath)
  )
    return null;
  const selection = launch.selection;
  if (!isRecord(selection) || typeof selection.kind !== "string") return null;
  if (selection.kind === "file") {
    return {
      filePath: launch.filePath,
      kind: launch.kind,
      packageRootPath: launch.packageRootPath,
      runner: launch.runner,
      selection: { kind: "file" },
    };
  }
  if (!safeDisplayString(selection.fullName, MAX_DEBUG_RESTART_NAME_BYTES)) return null;
  if (
    selection.kind === "test" &&
    selection.nameMatch !== "exact" &&
    selection.nameMatch !== "prefix"
  )
    return null;
  return {
    filePath: launch.filePath,
    kind: launch.kind,
    packageRootPath: launch.packageRootPath,
    runner: launch.runner,
    selection:
      selection.kind === "suite"
        ? { fullName: selection.fullName, kind: "suite" }
        : {
            fullName: selection.fullName,
            kind: "test",
            nameMatch: selection.nameMatch,
          },
  };
}

function cloneOptions(
  launch: Extract<
    DebugLaunchTarget,
    { kind: "node-configured-script" | "js-configured-test" | "node-npm-script" }
  >,
  allowJustMyCode: boolean,
): {
  readonly args: string[];
  readonly cwd?: string;
  readonly env: Record<string, string>;
  readonly justMyCode?: NodeDebugJustMyCodePolicy;
} | null {
  const justMyCode = cloneJustMyCode(launch, allowJustMyCode);
  if (
    justMyCode === null ||
    !Array.isArray(launch.args) ||
    launch.args.length > MAX_DEBUG_RESTART_ARGUMENTS ||
    !launch.args.every((argument) => safeValue(argument, MAX_DEBUG_RESTART_ARGUMENT_BYTES)) ||
    (launch.cwd !== undefined && !safePath(launch.cwd)) ||
    !isEnvironment(launch.env)
  ) {
    return null;
  }
  return {
    args: [...launch.args],
    ...(launch.cwd === undefined ? {} : { cwd: launch.cwd }),
    env: Object.fromEntries(Object.entries(launch.env)),
    ...justMyCode,
  };
}

function cloneJustMyCode(
  launch: Record<string, unknown>,
  allowed: boolean,
): { readonly justMyCode?: NodeDebugJustMyCodePolicy } | null {
  if (!hasJustMyCode(launch)) return {};
  return allowed && isNodeDebugJustMyCodePolicy(launch.justMyCode)
    ? { justMyCode: launch.justMyCode }
    : null;
}

function hasJustMyCode(value: object): boolean {
  return Object.prototype.hasOwnProperty.call(value, "justMyCode");
}

function isEnvironment(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= MAX_DEBUG_RESTART_ENVIRONMENT_ENTRIES &&
    entries.every(
      ([name, entry]) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
        utf8ByteLength(name) <= MAX_DEBUG_RESTART_ENVIRONMENT_NAME_BYTES &&
        safeValue(entry, MAX_DEBUG_RESTART_ENVIRONMENT_VALUE_BYTES),
    )
  );
}

function deepFreezeLaunch(launch: NodeDebugLaunchTarget): NodeDebugLaunchTarget {
  if ("args" in launch) {
    Object.freeze(launch.args);
    Object.freeze(launch.env);
  }
  if (launch.kind === "js-test-selection") Object.freeze(launch.selection);
  return Object.freeze(launch);
}

function launchTextBytes(launch: NodeDebugLaunchTarget): number {
  let total = 0;
  const add = (value: string | undefined) => {
    if (value !== undefined) total += utf8ByteLength(value);
  };
  if (launch.kind === "node-script" || launch.kind === "node-configured-script") {
    add(launch.scriptPath);
  } else if (launch.kind === "node-npm-script") {
    add(launch.script);
    add(launch.packageRootPath);
  } else if (launch.kind === "js-test-file" || launch.kind === "js-configured-test") {
    add(launch.filePath);
    add(launch.packageRootPath);
  } else if (launch.kind === "js-test-selection") {
    add(launch.filePath);
    add(launch.packageRootPath);
    if (launch.selection.kind !== "file") add(launch.selection.fullName);
  }
  if ("args" in launch) {
    launch.args.forEach(add);
    add(launch.cwd);
    Object.entries(launch.env).forEach(([name, value]) => {
      add(name);
      add(value);
    });
  }
  return total;
}

function validRootKey(rootPath: string | null): string | null {
  if (
    !rootPath ||
    !safeValue(rootPath, MAX_DEBUG_RESTART_ROOT_BYTES) ||
    unsafeDisplayCharacterPattern.test(rootPath)
  ) {
    return null;
  }
  const rootKey = normalizedWorkspaceRootKey(rootPath);
  return rootKey && (rootKey.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rootKey)) ? rootKey : null;
}

function safePath(value: unknown): value is string {
  return (
    safeValue(value, MAX_DEBUG_RESTART_PATH_BYTES) &&
    value.trim().length > 0 &&
    !unsafeDisplayCharacterPattern.test(value)
  );
}

function safeDisplayString(value: unknown, maximumBytes: number): value is string {
  return (
    safeValue(value, maximumBytes) &&
    value.trim().length > 0 &&
    !unsafeDisplayCharacterPattern.test(value)
  );
}

function safeValue(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === "string" &&
    isWellFormedUnicode(value) &&
    !value.includes("\0") &&
    utf8ByteLength(value) <= maximumBytes
  );
}

function isSessionId(value: number | null): value is number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsTestRunner(value: unknown): value is "vitest" | "jest" {
  return value === "vitest" || value === "jest";
}

function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}
