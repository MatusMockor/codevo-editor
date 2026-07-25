import { CONTROL_CHARACTER_PATTERN, shellQuoteFilter } from "./shellQuote";
import { validatedJsTestRunScope, type JsTestRunScope } from "./jsTestRunScope";

export type JsTestRunner = "vitest" | "jest";

export const MAX_JS_TEST_WATCH_ID_BYTES = 128;
export const MAX_JS_TEST_WATCH_WORKSPACE_ID_BYTES = 1_024;
export const MAX_JS_TEST_WATCH_PATH_BYTES = 4_096;
export const MAX_JS_TEST_WATCH_OUTPUT_BYTES = 65_536;
export const MAX_JS_TEST_WATCH_FAILURE_BYTES = 4_096;

export type JsTestWatchCommand =
  | {
      readonly kind: "vitest-watch";
      readonly packageRootRelativePath: string;
      readonly scope: JsTestRunScope;
    }
  | {
      readonly kind: "jest-watch";
      readonly packageRootRelativePath: string;
      readonly scope: JsTestRunScope;
    };

export interface JsTestWatchOwner {
  readonly watchId: string;
  readonly workspaceId: string;
  readonly epoch: number;
}

export interface StartJsTestWatchRequest extends JsTestWatchOwner {
  readonly command: JsTestWatchCommand;
}

export interface StartJsTestWatchResult {
  readonly owner: JsTestWatchOwner;
  readonly structuredResults: "unavailable-in-watch-mode";
}

export type JsTestWatchStatusEvent =
  | {
      readonly owner: JsTestWatchOwner;
      readonly status: "running";
    }
  | {
      readonly owner: JsTestWatchOwner;
      readonly status: "exited";
      readonly exitCode: number | null;
    }
  | {
      readonly owner: JsTestWatchOwner;
      readonly status: "failed";
      readonly message: string;
    }
  | {
      readonly owner: JsTestWatchOwner;
      readonly status: "stopped";
    };

export interface JsTestWatchOutputEvent {
  readonly owner: JsTestWatchOwner;
  readonly sequence: number;
  readonly stream: "stdout" | "stderr";
  readonly data: string;
  readonly truncated: boolean;
}

export interface JsTestWatchGateway {
  startWatch(request: StartJsTestWatchRequest): Promise<StartJsTestWatchResult>;
  acknowledgeWatchStart(owner: JsTestWatchOwner): Promise<void>;
  stopWatch(owner: JsTestWatchOwner): Promise<void>;
  subscribeWatchStatus(handler: (event: JsTestWatchStatusEvent) => void): Promise<() => void>;
  subscribeWatchOutput(handler: (event: JsTestWatchOutputEvent) => void): Promise<() => void>;
}

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
  return (
    !path.startsWith("/") &&
    path.split(/[\\/]/).every((segment) => segment && segment !== "." && segment !== "..")
  );
}

const UTF8_ENCODER = new TextEncoder();

export function validateJsTestWatchCommand(value: unknown): JsTestWatchCommand {
  const command = watchRecord(value, "command");
  watchExactKeys(command, ["kind", "packageRootRelativePath", "scope"], "command");
  if (command.kind !== "vitest-watch" && command.kind !== "jest-watch") {
    watchInvalid("command.kind", "vitest-watch or jest-watch");
  }
  return {
    kind: command.kind,
    packageRootRelativePath: watchPackageRoot(command.packageRootRelativePath),
    scope: strictWatchScope(command.scope),
  };
}

export function validateStartJsTestWatchRequest(value: unknown): StartJsTestWatchRequest {
  const request = watchRecord(value, "request");
  watchExactKeys(request, ["watchId", "workspaceId", "epoch", "command"], "request");
  return {
    ...validatedWatchOwnerFields(request, "request"),
    command: validateJsTestWatchCommand(request.command),
  };
}

export function validateJsTestWatchOwner(value: unknown, path = "owner"): JsTestWatchOwner {
  const owner = watchRecord(value, path);
  const keys = Object.keys(owner);
  if (
    keys.length !== 3 ||
    !keys.includes("watchId") ||
    !keys.includes("workspaceId") ||
    !keys.includes("epoch")
  ) {
    watchInvalid(path, "exactly the fields watchId, workspaceId, epoch");
  }
  return validatedWatchOwnerFields(owner, path);
}

function validatedWatchOwnerFields(owner: Record<string, unknown>, path: string): JsTestWatchOwner {
  return {
    watchId: watchOpaqueId(owner.watchId, `${path}.watchId`, MAX_JS_TEST_WATCH_ID_BYTES),
    workspaceId: watchOpaqueId(
      owner.workspaceId,
      `${path}.workspaceId`,
      MAX_JS_TEST_WATCH_WORKSPACE_ID_BYTES,
    ),
    epoch: watchPositiveInteger(owner.epoch, `${path}.epoch`),
  };
}

export function parseStartJsTestWatchResult(value: unknown): StartJsTestWatchResult {
  const result = watchRecord(value, "result");
  watchExactKeys(result, ["owner", "structuredResults"], "result");
  if (result.structuredResults !== "unavailable-in-watch-mode") {
    watchInvalid("result.structuredResults", "unavailable-in-watch-mode");
  }
  return {
    owner: validateJsTestWatchOwner(result.owner),
    structuredResults: result.structuredResults,
  };
}

export function parseJsTestWatchStatusEvent(value: unknown): JsTestWatchStatusEvent {
  const event = watchRecord(value, "event");
  if (
    event.status !== "running" &&
    event.status !== "exited" &&
    event.status !== "failed" &&
    event.status !== "stopped"
  ) {
    watchInvalid("event.status", "running, exited, failed, or stopped");
  }
  watchExactKeys(
    event,
    [
      "owner",
      "status",
      ...(event.status === "exited" ? ["exitCode"] : event.status === "failed" ? ["message"] : []),
    ],
    "event",
  );
  const owner = validateJsTestWatchOwner(event.owner);
  if (event.status === "exited") {
    return {
      owner,
      status: event.status,
      exitCode: watchExitCode(event.exitCode),
    };
  }
  if (event.status === "failed") {
    return {
      owner,
      status: event.status,
      message: watchBoundedText(
        event.message,
        "event.message",
        MAX_JS_TEST_WATCH_FAILURE_BYTES,
        false,
      ),
    };
  }
  return { owner, status: event.status };
}

export function parseJsTestWatchOutputEvent(value: unknown): JsTestWatchOutputEvent {
  const event = watchRecord(value, "event");
  watchExactKeys(event, ["owner", "sequence", "stream", "data", "truncated"], "event");
  if (event.stream !== "stdout" && event.stream !== "stderr") {
    watchInvalid("event.stream", "stdout or stderr");
  }
  if (typeof event.truncated !== "boolean") {
    watchInvalid("event.truncated", "a boolean");
  }
  const data = watchBoundedText(event.data, "event.data", MAX_JS_TEST_WATCH_OUTPUT_BYTES, true);
  if (event.truncated && data !== "") {
    watchInvalid("event.data", "an empty truncation marker");
  }
  return {
    owner: validateJsTestWatchOwner(event.owner),
    sequence: watchUnsignedInteger(event.sequence, "event.sequence"),
    stream: event.stream,
    data,
    truncated: event.truncated,
  };
}

function strictWatchScope(value: unknown): JsTestRunScope {
  const scope = watchRecord(value, "command.scope");
  if (scope.kind === "all") {
    watchExactKeys(scope, ["kind"], "command.scope");
  } else if (scope.kind === "file") {
    watchExactKeys(scope, ["kind", "relativeFilePath"], "command.scope");
  } else if (scope.kind === "suite") {
    watchExactKeys(scope, ["kind", "relativeFilePath", "fullName"], "command.scope");
  } else if (scope.kind === "test") {
    const expected =
      scope.nameMatch === undefined
        ? ["kind", "relativeFilePath", "fullName"]
        : ["kind", "relativeFilePath", "fullName", "nameMatch"];
    watchExactKeys(scope, expected, "command.scope");
  } else {
    watchInvalid("command.scope.kind", "all, file, suite, or test");
  }
  try {
    return validatedJsTestRunScope(scope as JsTestRunScope);
  } catch {
    watchInvalid("command.scope", "a valid JavaScript test scope");
  }
}

function watchPackageRoot(value: unknown): string {
  const path = watchBoundedText(
    value,
    "command.packageRootRelativePath",
    MAX_JS_TEST_WATCH_PATH_BYTES,
    true,
  )
    .trim()
    .split("\\")
    .join("/");
  if (
    path.startsWith("/") ||
    /^[A-Za-z]:\//.test(path) ||
    path.split("/").some((segment) => segment === "." || segment === "..") ||
    (path !== "" && path.split("/").some((segment) => segment === ""))
  ) {
    watchInvalid("command.packageRootRelativePath", "a workspace-confined relative package root");
  }
  return path;
}

function watchOpaqueId(value: unknown, path: string, maxBytes: number): string {
  const id = watchBoundedText(value, path, maxBytes, false);
  if (id.trim() === "" || /\p{Cc}/u.test(id)) {
    watchInvalid(path, "a non-blank control-free opaque ID");
  }
  return id;
}

function watchBoundedText(
  value: unknown,
  path: string,
  maxBytes: number,
  allowEmpty: boolean,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    !watchWellFormedUnicode(value) ||
    value.includes("\0") ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    watchInvalid(path, `a bounded UTF-8 string of at most ${maxBytes} bytes`);
  }
  return value;
}

function watchUnsignedInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    watchInvalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function watchPositiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    watchInvalid(path, "a positive safe integer");
  }
  return value as number;
}

function watchExitCode(value: unknown): number | null {
  if (
    value !== null &&
    (!Number.isSafeInteger(value) ||
      (value as number) < -2_147_483_648 ||
      (value as number) > 2_147_483_647)
  ) {
    watchInvalid("event.exitCode", "null or a signed 32-bit integer");
  }
  return value as number | null;
}

function watchRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    watchInvalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function watchExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    watchInvalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function watchWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function watchInvalid(path: string, expected: string): never {
  throw new TypeError(`Invalid JavaScript test watch value at ${path}: expected ${expected}.`);
}
