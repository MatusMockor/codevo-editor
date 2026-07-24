import type { DebugLaunchTarget } from "./debug";

export const MAX_NODE_RUN_TASK_RUN_ID_BYTES = 128;
export const MAX_NODE_RUN_TASK_WORKSPACE_ID_BYTES = 1_024;
export const MAX_NODE_RUN_TASK_PATH_BYTES = 4_096;
export const MAX_NODE_RUN_TASK_ARGUMENTS = 128;
export const MAX_NODE_RUN_TASK_ARGUMENT_BYTES = 16 * 1_024;
export const MAX_NODE_RUN_TASK_ENV_ENTRIES = 128;
export const MAX_NODE_RUN_TASK_ENV_KEY_BYTES = 256;
export const MAX_NODE_RUN_TASK_ENV_VALUE_BYTES = 16 * 1_024;
export const MAX_NODE_RUN_TASK_SCRIPT_BYTES = 214;
export const MAX_NODE_RUN_TASK_FAILURE_BYTES = 4_096;

type NodeRunTargetKind =
  | "node-script"
  | "node-configured-script"
  | "js-test-file"
  | "js-configured-test"
  | "node-npm-script";

export type NodeRunTarget = Extract<DebugLaunchTarget, { kind: NodeRunTargetKind }>;

export interface NodeRunTaskOwner {
  readonly runId: string;
  readonly workspaceId: string;
  readonly terminalSessionId: number;
}

export interface StartNodeRunTaskRequest extends NodeRunTaskOwner {
  readonly target: NodeRunTarget;
}

export interface StartNodeRunTaskResult {
  readonly runId: string;
}

export interface StopNodeRunTaskRequest {
  readonly runId: string;
  readonly workspaceId: string;
}

export type NodeRunTaskStatusEvent =
  | (NodeRunTaskOwner & { readonly status: "running" })
  | (NodeRunTaskOwner & { readonly status: "exited"; readonly exitCode: number | null })
  | (NodeRunTaskOwner & { readonly status: "failed"; readonly message: string })
  | (NodeRunTaskOwner & { readonly status: "stopped" });

export interface NodeRunTaskGateway {
  startNodeRunTask(request: StartNodeRunTaskRequest): Promise<StartNodeRunTaskResult>;
  acknowledgeNodeRunTaskStart(request: StopNodeRunTaskRequest): Promise<void>;
  stopNodeRunTask(request: StopNodeRunTaskRequest): Promise<void>;
  subscribeNodeRunTaskStatus(handler: (event: NodeRunTaskStatusEvent) => void): Promise<() => void>;
}

const UTF8_ENCODER = new TextEncoder();

/** Converts only launchable Node targets; attach, test selection, and PHP fail closed. */
export function toNodeRunTarget(launch: DebugLaunchTarget): NodeRunTarget | null {
  switch (launch.kind) {
    case "node-script":
    case "node-configured-script":
    case "js-test-file":
    case "js-configured-test":
    case "node-npm-script":
      return parseNodeRunTarget(launch);
    case "node-attach":
    case "js-test-selection":
    case "php-script":
    case "php-test-file":
    case "php-listen":
      return null;
  }
}

export function parseNodeRunTarget(value: unknown, path = "target"): NodeRunTarget {
  const target = record(value, path);
  switch (target.kind) {
    case "node-script":
      exactKeys(target, ["kind", "scriptPath"], path);
      return { kind: target.kind, scriptPath: nodePath(target.scriptPath, `${path}.scriptPath`) };
    case "js-test-file":
      exactKeys(target, ["kind", "runner", "filePath", "packageRootPath"], path);
      return {
        kind: target.kind,
        runner: runner(target.runner, `${path}.runner`),
        filePath: nodePath(target.filePath, `${path}.filePath`),
        packageRootPath: nodePath(target.packageRootPath, `${path}.packageRootPath`),
      };
    case "node-configured-script": {
      exactOptionalKeys(target, ["kind", "scriptPath", "args", "env"], ["cwd"], path);
      return {
        kind: target.kind,
        scriptPath: nodePath(target.scriptPath, `${path}.scriptPath`),
        ...launchOptions(target, path),
      };
    }
    case "js-configured-test": {
      exactOptionalKeys(
        target,
        ["kind", "runner", "filePath", "packageRootPath", "args", "env"],
        ["cwd"],
        path,
      );
      return {
        kind: target.kind,
        runner: runner(target.runner, `${path}.runner`),
        filePath: nodePath(target.filePath, `${path}.filePath`),
        packageRootPath: nodePath(target.packageRootPath, `${path}.packageRootPath`),
        ...launchOptions(target, path),
      };
    }
    case "node-npm-script": {
      exactOptionalKeys(
        target,
        ["kind", "script", "packageRootPath", "args", "env"],
        ["cwd"],
        path,
      );
      return {
        kind: target.kind,
        script: boundedText(target.script, `${path}.script`, MAX_NODE_RUN_TASK_SCRIPT_BYTES, false),
        packageRootPath: nodePath(target.packageRootPath, `${path}.packageRootPath`),
        ...launchOptions(target, path),
      };
    }
    default:
      invalid(`${path}.kind`, "a supported Node run target");
  }
}

export function parseStartNodeRunTaskResult(value: unknown): StartNodeRunTaskResult {
  const result = record(value, "result");
  exactKeys(result, ["runId"], "result");
  return { runId: runId(result.runId, "result.runId") };
}

export function parseNodeRunTaskStatusEvent(value: unknown): NodeRunTaskStatusEvent {
  const event = record(value, "event");
  const status = taskStatus(event.status);
  exactKeys(
    event,
    [
      "status",
      "runId",
      "workspaceId",
      "terminalSessionId",
      ...(status === "exited" ? ["exitCode"] : status === "failed" ? ["message"] : []),
    ],
    "event",
  );
  const owner: NodeRunTaskOwner = {
    runId: runId(event.runId, "event.runId"),
    workspaceId: workspaceId(event.workspaceId, "event.workspaceId"),
    terminalSessionId: unsignedSafeInteger(event.terminalSessionId, "event.terminalSessionId"),
  };
  if (status === "exited") {
    return { ...owner, status, exitCode: signedExitCode(event.exitCode, "event.exitCode") };
  }
  if (status === "failed") {
    return {
      ...owner,
      status,
      message: boundedText(event.message, "event.message", MAX_NODE_RUN_TASK_FAILURE_BYTES, false),
    };
  }
  return { ...owner, status };
}

export function validateStartNodeRunTaskRequest(value: unknown): StartNodeRunTaskRequest {
  const request = record(value, "request");
  exactKeys(request, ["runId", "workspaceId", "terminalSessionId", "target"], "request");
  return {
    runId: runId(request.runId, "request.runId"),
    workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
    terminalSessionId: unsignedSafeInteger(request.terminalSessionId, "request.terminalSessionId"),
    target: parseNodeRunTarget(request.target, "request.target"),
  };
}

export function validateStopNodeRunTaskRequest(value: unknown): StopNodeRunTaskRequest {
  const request = record(value, "request");
  exactKeys(request, ["runId", "workspaceId"], "request");
  return {
    runId: runId(request.runId, "request.runId"),
    workspaceId: workspaceId(request.workspaceId, "request.workspaceId"),
  };
}

function launchOptions(target: Record<string, unknown>, path: string) {
  if (!Array.isArray(target.args) || target.args.length > MAX_NODE_RUN_TASK_ARGUMENTS) {
    invalid(`${path}.args`, `an array of at most ${MAX_NODE_RUN_TASK_ARGUMENTS} arguments`);
  }
  const args = target.args.map((argument, index) => {
    const validated = boundedText(
      argument,
      `${path}.args[${index}]`,
      MAX_NODE_RUN_TASK_ARGUMENT_BYTES,
      true,
    );
    if (validated.toLowerCase().startsWith("--inspect")) {
      invalid(`${path}.args[${index}]`, "an argument that does not enable the inspector");
    }
    return validated;
  });
  const rawEnv = record(target.env, `${path}.env`);
  if (Object.keys(rawEnv).length > MAX_NODE_RUN_TASK_ENV_ENTRIES) {
    invalid(`${path}.env`, `at most ${MAX_NODE_RUN_TASK_ENV_ENTRIES} entries`);
  }
  const envEntries: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(rawEnv)) {
    const normalizedKey = key.toUpperCase();
    if (
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ||
      ["PATH", "NODE_OPTIONS", "SHELL", "COMSPEC", "PATHEXT"].includes(normalizedKey) ||
      normalizedKey.startsWith("NPM_CONFIG_")
    ) {
      invalid(`${path}.env key`, "a safe, unprotected environment name");
    }
    const validatedKey = boundedText(
      key,
      `${path}.env key`,
      MAX_NODE_RUN_TASK_ENV_KEY_BYTES,
      false,
    );
    envEntries.push([
      validatedKey,
      boundedText(value, `${path}.env.${key}`, MAX_NODE_RUN_TASK_ENV_VALUE_BYTES, true),
    ]);
  }
  const env = Object.fromEntries(envEntries);
  return {
    args,
    ...(target.cwd === undefined ? {} : { cwd: nodePath(target.cwd, `${path}.cwd`) }),
    env,
  };
}

function runner(value: unknown, path: string): "vitest" | "jest" {
  if (value !== "vitest" && value !== "jest") invalid(path, "vitest or jest");
  return value;
}

function nodePath(value: unknown, path: string): string {
  const candidate = boundedText(value, path, MAX_NODE_RUN_TASK_PATH_BYTES, false);
  if (candidate.trim() === "") invalid(path, "a non-blank bounded path");
  return candidate;
}

function runId(value: unknown, path: string): string {
  return boundedText(value, path, MAX_NODE_RUN_TASK_RUN_ID_BYTES, false, true);
}

function workspaceId(value: unknown, path: string): string {
  return boundedText(value, path, MAX_NODE_RUN_TASK_WORKSPACE_ID_BYTES, false, true);
}

function boundedText(
  value: unknown,
  path: string,
  maxBytes: number,
  allowEmpty: boolean,
  rejectControls = false,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.includes("\0") ||
    (rejectControls && /\p{Cc}/u.test(value)) ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    invalid(path, `${allowEmpty ? "a" : "a non-empty"} bounded UTF-8 string`);
  }
  return value;
}

function unsignedSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function signedExitCode(value: unknown, path: string): number | null {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) ||
      (value as number) < -2_147_483_648 ||
      (value as number) > 2_147_483_647)
  ) {
    invalid(path, "null or a signed 32-bit integer");
  }
  return value as number | null;
}

function taskStatus(value: unknown): NodeRunTaskStatusEvent["status"] {
  if (value !== "running" && value !== "exited" && value !== "failed" && value !== "stopped") {
    invalid("event.status", "running, exited, failed, or stopped");
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function exactOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    actual.some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    invalid(path, `the required fields ${required.join(", ")} and optional ${optional.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid Node run task value at ${path}: expected ${expectation}.`);
}
