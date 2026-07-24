import type {
  PackageOperationPreview,
  PackageOperationRequest,
  PackageOperationRunResult,
} from "../domain/packageOperations";
import { PACKAGE_OPERATIONS } from "../domain/packageOperations";

export const PACKAGE_OPERATIONS_IPC_COMMANDS = {
  preview: "preview_workspace_package_operation",
  run: "run_workspace_package_operation",
} as const;

interface PackageOperationsIpcContract {
  readonly preview_workspace_package_operation: {
    readonly args: PackageOperationRequest;
    readonly result: PackageOperationPreview;
  };
  readonly run_workspace_package_operation: {
    readonly args: PackageOperationRequest;
    readonly result: PackageOperationRunResult;
  };
}

export type PackageOperationsIpcCommand = keyof PackageOperationsIpcContract;
export type PackageOperationsIpcArgs<Command extends PackageOperationsIpcCommand> =
  PackageOperationsIpcContract[Command]["args"];
export type PackageOperationsIpcResult<Command extends PackageOperationsIpcCommand> =
  PackageOperationsIpcContract[Command]["result"];

export type InvokePackageOperationsCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

const MAX_WORKSPACE_ID_LENGTH = 1_024;
const MAX_PACKAGE_NAME_LENGTH = 214;
const MAX_ARGUMENT_COUNT = 64;
const MAX_ARGUMENT_LENGTH = 2_048;
const MAX_DESCRIPTION_LENGTH = 4_096;
const MAX_MESSAGE_LENGTH = 64 * 1_024;
const OPERATIONS = new Set<string>(PACKAGE_OPERATIONS);
const MANAGERS = new Set(["npm", "pnpm", "yarn", "bun"]);
const UTF8_ENCODER = new TextEncoder();

export async function invokePackageOperationsIpc<Command extends PackageOperationsIpcCommand>(
  invokeCommand: InvokePackageOperationsCommand,
  command: Command,
  args: PackageOperationsIpcArgs<Command>,
): Promise<PackageOperationsIpcResult<Command>> {
  const wireArgs = validatePackageOperationRequest(args, `${command} args`);
  const result = await invokeCommand(command, { ...wireArgs });
  return decodePackageOperationsIpcResult(command, result);
}

export function validatePackageOperationRequest(
  value: unknown,
  path = "package operation request",
): PackageOperationRequest {
  const request = record(value, path);
  exactKeys(request, ["workspaceId", "operation"], ["packageName", "development"], path);

  const workspaceId = boundedString(
    request.workspaceId,
    `${path}.workspaceId`,
    MAX_WORKSPACE_ID_LENGTH,
  );
  if (!workspaceId.trim() || workspaceId.includes("\0")) {
    invalid(`${path}.workspaceId`, "a non-empty string without NUL bytes");
  }
  if (typeof request.operation !== "string" || !OPERATIONS.has(request.operation)) {
    invalid(`${path}.operation`, '"install", "update", "remove", or "outdated"');
  }

  const packageName = Object.prototype.hasOwnProperty.call(request, "packageName")
    ? npmPackageName(request.packageName, `${path}.packageName`)
    : undefined;
  const development = Object.prototype.hasOwnProperty.call(request, "development")
    ? boolean(request.development, `${path}.development`)
    : undefined;

  if (request.operation === "outdated" && packageName !== undefined) {
    invalid(`${path}.packageName`, "no package name for an outdated operation");
  }
  if (request.operation !== "outdated" && packageName === undefined) {
    invalid(`${path}.packageName`, `a package name for a ${request.operation} operation`);
  }
  if (request.operation !== "install" && development !== undefined) {
    invalid(`${path}.development`, "a development flag only for an install operation");
  }

  return {
    workspaceId,
    operation: request.operation as PackageOperationRequest["operation"],
    ...(packageName === undefined ? {} : { packageName }),
    ...(development === undefined ? {} : { development }),
  };
}

export function decodePackageOperationsIpcResult<Command extends PackageOperationsIpcCommand>(
  command: Command,
  value: unknown,
): PackageOperationsIpcResult<Command> {
  const path = `${command} result`;
  const result =
    command === PACKAGE_OPERATIONS_IPC_COMMANDS.preview
      ? decodePreview(value, path)
      : decodeRunResult(value, path);
  return result as PackageOperationsIpcResult<Command>;
}

function decodePreview(value: unknown, path: string): PackageOperationPreview {
  const preview = record(value, path);
  exactKeys(preview, ["manager", "arguments", "description", "mutatesManifest"], [], path);
  const args = array(preview.arguments, `${path}.arguments`, MAX_ARGUMENT_COUNT).map(
    (argument, index) =>
      boundedString(argument, `${path}.arguments[${index}]`, MAX_ARGUMENT_LENGTH),
  );
  return {
    manager: packageManager(preview.manager, `${path}.manager`),
    arguments: args,
    description: boundedString(preview.description, `${path}.description`, MAX_DESCRIPTION_LENGTH),
    mutatesManifest: boolean(preview.mutatesManifest, `${path}.mutatesManifest`),
  };
}

function packageManager(value: unknown, path: string): PackageOperationPreview["manager"] {
  if (typeof value !== "string" || !MANAGERS.has(value)) {
    return invalid(path, '"npm", "pnpm", "yarn", or "bun"');
  }
  return value as PackageOperationPreview["manager"];
}

function decodeRunResult(value: unknown, path: string): PackageOperationRunResult {
  const result = record(value, path);
  if (result.status === "ok") {
    exactKeys(result, ["status", "message", "manifestChanged"], [], path);
    return {
      status: "ok",
      message: boundedString(result.message, `${path}.message`, MAX_MESSAGE_LENGTH),
      manifestChanged: boolean(result.manifestChanged, `${path}.manifestChanged`),
    };
  }
  if (result.status === "unavailable" || result.status === "error") {
    exactKeys(result, ["status", "message"], [], path);
    return {
      status: result.status,
      message: boundedString(result.message, `${path}.message`, MAX_MESSAGE_LENGTH),
    };
  }
  return invalid(`${path}.status`, '"ok", "unavailable", or "error"');
}

function npmPackageName(value: unknown, path: string): string {
  const candidate = nonEmptyBoundedString(value, path, MAX_PACKAGE_NAME_LENGTH);
  if (
    candidate !== candidate.toLowerCase() ||
    candidate.includes("\0") ||
    !/^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/.test(candidate)
  ) {
    return invalid(path, "a valid lowercase npm package name");
  }
  return candidate;
}

function exactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
): void {
  const allowed = [...required, ...optional];
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
  const missing = required.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) invalid(`${path}.${missing}`, "a required field");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string, maxLength: number): unknown[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    return invalid(path, `an array with at most ${maxLength} entries`);
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return invalid(path, "a boolean");
  return value;
}

function boundedString(value: unknown, path: string, maxLength: number): string {
  if (
    typeof value !== "string" ||
    value.length > maxLength ||
    UTF8_ENCODER.encode(value).byteLength > maxLength ||
    value.includes("\0")
  ) {
    return invalid(path, `a UTF-8 string of at most ${maxLength} bytes without NUL bytes`);
  }
  return value;
}

function nonEmptyBoundedString(value: unknown, path: string, maxLength: number): string {
  const candidate = boundedString(value, path, maxLength);
  if (!candidate.trim()) return invalid(path, "a non-empty bounded string");
  return candidate;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid package operations IPC value at ${path}: expected ${expectation}.`);
}
