export const MAX_NODE_PACKAGE_DISCOVERY_MANIFESTS = 2_000;
export const MAX_NODE_PACKAGE_DISCOVERY_SCRIPTS = 20_000;
export const MAX_NODE_PACKAGE_DISCOVERY_VISITED = 100_000;

const MAX_PACKAGE_NAME_BYTES = 1_024;
const MAX_RELATIVE_PATH_BYTES = 4_096;
export const MAX_NODE_PACKAGE_SCRIPT_NAME_BYTES = 214;
export const MAX_NODE_PACKAGE_TASK_RUN_ID_BYTES = 128;
export const MAX_NODE_PACKAGE_TASK_FAILURE_BYTES = 4_096;
const UTF8_ENCODER = new TextEncoder();

export interface NodePackageScript {
  readonly key: string;
  readonly manifestRelativePath: string;
  readonly packageName: string | null;
  readonly packageManager: "npm" | "pnpm" | "yarn" | "bun";
  /** Empty for the workspace-root package, otherwise a normalized descendant path. */
  readonly packageRootRelativePath: string;
  readonly scriptName: string;
}

export interface NodePackageScriptsResult {
  readonly scripts: readonly NodePackageScript[];
  readonly total: number;
  readonly truncated: boolean;
  readonly visited: number;
}

export interface NodePackageScriptsGateway {
  listNodePackageScripts(
    workspaceRoot: string,
    limits: {
      readonly maxManifests: number;
      readonly maxScripts: number;
      readonly maxVisited: number;
    },
  ): Promise<NodePackageScriptsResult>;
}

export interface NodePackageTaskOwner {
  readonly runId: string;
  readonly workspaceId: string;
  readonly sessionId: number;
  readonly manifestRelativePath: string;
  readonly scriptName: string;
}

export type StartNodePackageTaskRequest = NodePackageTaskOwner & {
  readonly problemMatcher?: import("./nodePackageTaskProblems").NodePackageProblemMatcher | null;
};

export interface StartNodePackageTaskResult {
  readonly runId: string;
}

export interface StopNodePackageTaskRequest {
  readonly runId: string;
  readonly workspaceId: string;
}

export interface NodePackageScriptRunGateway {
  startNodePackageTask(request: StartNodePackageTaskRequest): Promise<StartNodePackageTaskResult>;
  acknowledgeNodePackageTaskStart(request: StopNodePackageTaskRequest): Promise<void>;
  stopNodePackageTask(request: StopNodePackageTaskRequest): Promise<void>;
  subscribeNodePackageTaskEvents(
    handler: (event: NodePackageTaskEvent) => void,
  ): Promise<() => void>;
}

export type NodePackageTaskEvent =
  | (NodePackageTaskOwner & { readonly status: "running" })
  | (NodePackageTaskOwner & { readonly status: "exited"; readonly exitCode: number | null })
  | (NodePackageTaskOwner & { readonly status: "failed"; readonly message: string })
  | (NodePackageTaskOwner & { readonly status: "stopped" });

export function parseStartNodePackageTaskResult(value: unknown): StartNodePackageTaskResult {
  const result = record(value, "result");
  exactKeys(result, ["runId"], "result");
  return { runId: taskRunId(result.runId, "result.runId") };
}

export function parseNodePackageTaskEvent(value: unknown): NodePackageTaskEvent {
  const event = record(value, "event");
  const status = taskStatus(event.status);
  const statusFields = status === "exited" ? ["exitCode"] : status === "failed" ? ["message"] : [];
  exactKeys(
    event,
    [
      "status",
      "runId",
      "workspaceId",
      "sessionId",
      "manifestRelativePath",
      "scriptName",
      ...statusFields,
    ],
    "event",
  );
  const owner: NodePackageTaskOwner = {
    runId: taskRunId(event.runId, "event.runId"),
    workspaceId: boundedString(event.workspaceId, "event.workspaceId", 1_024, false),
    sessionId: nonNegativeSafeInteger(event.sessionId, "event.sessionId"),
    manifestRelativePath: workspaceRelativeFile(
      event.manifestRelativePath,
      "event.manifestRelativePath",
    ),
    scriptName: packageScriptName(event.scriptName, "event.scriptName"),
  };
  const manifestParts = owner.manifestRelativePath.split("/");
  if (manifestParts[manifestParts.length - 1] !== "package.json") {
    invalid("event.manifestRelativePath", "a workspace-relative package.json path");
  }
  if (status === "exited") {
    return { ...owner, status, exitCode: signedExitCode(event.exitCode, "event.exitCode") };
  }
  if (status === "failed") {
    return {
      ...owner,
      status,
      message: boundedString(
        event.message,
        "event.message",
        MAX_NODE_PACKAGE_TASK_FAILURE_BYTES,
        false,
      ),
    };
  }
  return { ...owner, status };
}

export function isNodePackageTaskRunId(value: string): boolean {
  return (
    value.length > 0 &&
    !value.includes("\0") &&
    !/\p{Cc}/u.test(value) &&
    UTF8_ENCODER.encode(value).byteLength <= MAX_NODE_PACKAGE_TASK_RUN_ID_BYTES
  );
}

export function nodePackageScriptIdentity(
  script: Pick<NodePackageScript, "manifestRelativePath" | "scriptName">,
): string {
  return `node-package-script:${encodeURIComponent(script.manifestRelativePath)}:${encodeURIComponent(script.scriptName)}`;
}

export function compareNodePackageScripts(
  left: Pick<NodePackageScript, "manifestRelativePath" | "scriptName">,
  right: Pick<NodePackageScript, "manifestRelativePath" | "scriptName">,
): number {
  return (
    compareText(left.manifestRelativePath, right.manifestRelativePath) ||
    compareText(left.scriptName, right.scriptName)
  );
}

export interface NodePackageDiscoveryLimits {
  readonly maxManifests: number;
  readonly maxScripts: number;
  readonly maxVisited: number;
}

export function parseNodePackageScriptsResult(
  value: unknown,
  limits: NodePackageDiscoveryLimits,
): NodePackageScriptsResult {
  const result = record(value, "result");
  exactKeys(result, ["scripts", "total", "truncated", "visited"], "result");
  if (!Array.isArray(result.scripts)) invalid("result.scripts", "an array");
  if (result.scripts.length > limits.maxScripts) {
    invalid("result.scripts", `at most the requested ${limits.maxScripts} entries`);
  }

  const identities = new Set<string>();
  const manifests = new Set<string>();
  const scripts = result.scripts.map((value, index) => {
    const path = `result.scripts[${index}]`;
    const script = record(value, path);
    exactKeys(
      script,
      [
        "manifestRelativePath",
        "packageRootRelativePath",
        "packageName",
        "packageManager",
        "scriptName",
      ],
      path,
    );
    const scriptName = packageScriptName(script.scriptName, `${path}.scriptName`);
    const packageRootRelativePath = workspaceRelativeDirectory(
      script.packageRootRelativePath,
      `${path}.packageRootRelativePath`,
    );
    const manifestRelativePath = workspaceRelativeFile(
      script.manifestRelativePath,
      `${path}.manifestRelativePath`,
    );
    const expectedManifestPath = packageRootRelativePath
      ? `${packageRootRelativePath}/package.json`
      : "package.json";
    if (manifestRelativePath !== expectedManifestPath) {
      invalid(`${path}.manifestRelativePath`, `exactly ${JSON.stringify(expectedManifestPath)}`);
    }
    const parsed: NodePackageScript = {
      key: nodePackageScriptIdentity({ manifestRelativePath, scriptName }),
      manifestRelativePath,
      packageName:
        script.packageName === null
          ? null
          : boundedString(script.packageName, `${path}.packageName`, MAX_PACKAGE_NAME_BYTES, false),
      packageManager: packageManager(script.packageManager, `${path}.packageManager`),
      packageRootRelativePath,
      scriptName,
    };
    if (identities.has(parsed.key)) invalid(path, "a unique package-path and script-name pair");
    identities.add(parsed.key);
    manifests.add(manifestRelativePath);
    return parsed;
  });
  if (manifests.size > limits.maxManifests) {
    invalid(
      "result.scripts",
      `scripts from at most the requested ${limits.maxManifests} manifests`,
    );
  }

  const truncated = boolean(result.truncated, "result.truncated");
  const total = nonNegativeSafeInteger(result.total, "result.total");
  const visited = nonNegativeSafeInteger(result.visited, "result.visited");
  if (visited > limits.maxVisited) {
    invalid("result.visited", `at most the requested ${limits.maxVisited}`);
  }
  if (total < scripts.length || (!truncated && total !== scripts.length)) {
    invalid(
      "result.total",
      truncated
        ? "a count at least as large as the returned script count"
        : "the returned script count when the result is not truncated",
    );
  }

  return {
    scripts: scripts.sort(compareNodePackageScripts),
    total,
    truncated,
    visited,
  };
}

function workspaceRelativeFile(value: unknown, path: string): string {
  const candidate = boundedString(value, path, MAX_RELATIVE_PATH_BYTES, false);
  if (
    candidate.startsWith("/") ||
    candidate.endsWith("/") ||
    candidate.includes("\\") ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    invalid(path, "a normalized workspace-relative descendant file path");
  }
  return candidate;
}

function workspaceRelativeDirectory(value: unknown, path: string): string {
  const candidate = boundedString(value, path, MAX_RELATIVE_PATH_BYTES, true);
  if (candidate === "") return candidate;
  if (
    candidate.startsWith("/") ||
    candidate.endsWith("/") ||
    candidate.includes("\\") ||
    /^[A-Za-z]:/.test(candidate) ||
    candidate.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    invalid(path, "an empty root path or a normalized workspace-relative descendant directory");
  }
  return candidate;
}

function packageScriptName(value: unknown, path: string): string {
  if (typeof value !== "string" || !isNodePackageScriptName(value)) {
    invalid(path, "a non-option package script name without control characters");
  }
  return value;
}

export function isNodePackageScriptName(value: string): boolean {
  return (
    value.length > 0 &&
    !value.startsWith("-") &&
    !/\p{Cc}/u.test(value) &&
    UTF8_ENCODER.encode(value).byteLength <= MAX_NODE_PACKAGE_SCRIPT_NAME_BYTES
  );
}

function packageManager(value: unknown, path: string): NodePackageScript["packageManager"] {
  if (value !== "npm" && value !== "pnpm" && value !== "yarn" && value !== "bun") {
    invalid(path, '"npm", "pnpm", "yarn", or "bun"');
  }
  return value;
}

function boundedString(
  value: unknown,
  path: string,
  maxBytes: number,
  allowEmpty: boolean,
): string {
  if (
    typeof value !== "string" ||
    (!allowEmpty && value.length === 0) ||
    value.includes("\0") ||
    UTF8_ENCODER.encode(value).byteLength > maxBytes
  ) {
    invalid(
      path,
      `${allowEmpty ? "a" : "a non-empty"} UTF-8 string of at most ${maxBytes} bytes without NUL bytes`,
    );
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    invalid(path, `exactly the fields ${expected.join(", ")}`);
  }
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") invalid(path, "a boolean");
  return value;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function taskRunId(value: unknown, path: string): string {
  if (typeof value !== "string" || !isNodePackageTaskRunId(value)) {
    invalid(path, `a task run id of at most ${MAX_NODE_PACKAGE_TASK_RUN_ID_BYTES} bytes`);
  }
  return value;
}

function taskStatus(value: unknown): NodePackageTaskEvent["status"] {
  if (value !== "running" && value !== "exited" && value !== "failed" && value !== "stopped") {
    invalid("event.status", '"running", "exited", "failed", or "stopped"');
  }
  return value;
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

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid Node package scripts value at ${path}: expected ${expectation}.`);
}
