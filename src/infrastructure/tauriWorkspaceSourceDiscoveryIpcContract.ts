import type { InvokeArgs } from "@tauri-apps/api/core";
import type {
  BoundedWorkspaceSourceRead,
  WorkspaceJavaScriptSourceFileEnumeration,
  WorkspacePackageJsonFileEnumeration,
} from "../domain/workspaceSourceDiscovery";

export const WORKSPACE_SOURCE_DISCOVERY_IPC_COMMANDS = {
  enumerate: "workspace_enumerate_js_source_files",
  enumeratePackageJson: "workspace_enumerate_package_json_files",
  readBounded: "workspace_read_source_text_bounded",
} as const;

export type EnumerateWorkspaceJavaScriptSourcesArgs = InvokeArgs & {
  readonly workspaceId: string;
  readonly maxFiles: number;
  readonly maxVisited: number;
};

export type ReadWorkspaceSourceTextBoundedArgs = InvokeArgs & {
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly maxBytes: number;
};

export type EnumerateWorkspacePackageJsonFilesArgs = InvokeArgs & {
  readonly workspaceId: string;
  readonly maxFiles: number;
  readonly maxVisited: number;
};

export type InvokeWorkspaceSourceDiscoveryCommand = (
  command: string,
  args?: InvokeArgs,
) => Promise<unknown>;

export async function invokeWorkspaceSourceEnumerationIpc(
  invokeCommand: InvokeWorkspaceSourceDiscoveryCommand,
  args: EnumerateWorkspaceJavaScriptSourcesArgs,
): Promise<WorkspaceJavaScriptSourceFileEnumeration> {
  validateWorkspaceId(args.workspaceId, "enumeration args.workspaceId");
  positiveInteger(args.maxFiles, "enumeration args.maxFiles");
  positiveInteger(args.maxVisited, "enumeration args.maxVisited");
  const result = decodeEnumeration(
    await invokeCommand(WORKSPACE_SOURCE_DISCOVERY_IPC_COMMANDS.enumerate, args),
  );
  if (result.files.length > args.maxFiles) {
    return invalid("enumeration result.files", `at most ${args.maxFiles} entries`);
  }
  if (result.visited > args.maxVisited) {
    return invalid("enumeration result.visited", `at most ${args.maxVisited}`);
  }
  return result;
}

export async function invokeWorkspacePackageJsonEnumerationIpc(
  invokeCommand: InvokeWorkspaceSourceDiscoveryCommand,
  args: EnumerateWorkspacePackageJsonFilesArgs,
): Promise<WorkspacePackageJsonFileEnumeration> {
  validateWorkspaceId(args.workspaceId, "package enumeration args.workspaceId");
  positiveInteger(args.maxFiles, "package enumeration args.maxFiles");
  positiveInteger(args.maxVisited, "package enumeration args.maxVisited");
  const result = decodePackageJsonEnumeration(
    await invokeCommand(WORKSPACE_SOURCE_DISCOVERY_IPC_COMMANDS.enumeratePackageJson, args),
  );
  if (result.files.length > args.maxFiles) {
    return invalid("package enumeration result.files", `at most ${args.maxFiles} entries`);
  }
  if (result.visited > args.maxVisited) {
    return invalid("package enumeration result.visited", `at most ${args.maxVisited}`);
  }
  return result;
}

export async function invokeWorkspaceSourceBoundedReadIpc(
  invokeCommand: InvokeWorkspaceSourceDiscoveryCommand,
  args: ReadWorkspaceSourceTextBoundedArgs,
): Promise<BoundedWorkspaceSourceRead> {
  validateWorkspaceId(args.workspaceId, "bounded read args.workspaceId");
  workspaceRelativePath(args.relativePath, "bounded read args.relativePath");
  positiveInteger(args.maxBytes, "bounded read args.maxBytes");
  const result = decodeBoundedRead(
    await invokeCommand(WORKSPACE_SOURCE_DISCOVERY_IPC_COMMANDS.readBounded, args),
  );
  if (
    result.status === "ok" &&
    new TextEncoder().encode(result.content).byteLength > args.maxBytes
  ) {
    return invalid("bounded read result.content", `at most ${args.maxBytes} UTF-8 bytes`);
  }
  return result;
}

export function decodeWorkspaceSourceEnumeration(
  value: unknown,
): WorkspaceJavaScriptSourceFileEnumeration {
  return decodeEnumeration(value);
}

export function decodeWorkspacePackageJsonEnumeration(
  value: unknown,
): WorkspacePackageJsonFileEnumeration {
  return decodePackageJsonEnumeration(value);
}

export function decodeBoundedWorkspaceSourceRead(value: unknown): BoundedWorkspaceSourceRead {
  return decodeBoundedRead(value);
}

function decodeEnumeration(value: unknown): WorkspaceJavaScriptSourceFileEnumeration {
  const result = record(value, "enumeration result");
  exactKeys(result, ["files", "truncated", "visited"], "enumeration result");
  if (!Array.isArray(result.files)) invalid("enumeration result.files", "an array");
  const files = result.files.map((file, index) =>
    workspaceRelativePath(file, `enumeration result.files[${index}]`),
  );
  if (typeof result.truncated !== "boolean") {
    return invalid("enumeration result.truncated", "a boolean");
  }
  return {
    files,
    truncated: result.truncated,
    visited: unsignedInteger(result.visited, "enumeration result.visited"),
  };
}

function decodePackageJsonEnumeration(value: unknown): WorkspacePackageJsonFileEnumeration {
  const result = decodeEnumeration(value);
  for (const [index, file] of result.files.entries()) {
    packageJsonRelativePath(file, `package enumeration result.files[${index}]`);
  }
  return result;
}

function packageJsonRelativePath(value: string, path: string): string {
  if (value === "package.json" || value.endsWith("/package.json")) return value;
  return invalid(path, "a package.json workspace-relative path");
}

function decodeBoundedRead(value: unknown): BoundedWorkspaceSourceRead {
  const result = record(value, "bounded read result");
  if (result.status === "ok") {
    exactKeys(result, ["status", "content"], "bounded read result");
    return { status: "ok", content: string(result.content, "bounded read result.content") };
  }
  if (result.status === "tooLarge") {
    exactKeys(result, ["status"], "bounded read result");
    return { status: "tooLarge" };
  }
  if (result.status === "changed") {
    exactKeys(result, ["status"], "bounded read result");
    return { status: "changed" };
  }
  return invalid("bounded read result.status", '"ok", "tooLarge", or "changed"');
}

function validateWorkspaceId(value: unknown, path: string): string {
  const workspaceId = string(value, path);
  if (!workspaceId.trim()) return invalid(path, "a non-empty string");
  return workspaceId;
}

function workspaceRelativePath(value: unknown, path: string): string {
  const candidate = string(value, path).split("\\").join("/");
  if (
    !candidate ||
    candidate.startsWith("/") ||
    /^[A-Za-z]:\//.test(candidate) ||
    candidate.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    return invalid(path, "a workspace-relative descendant path");
  }
  return candidate;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
  const missing = allowed.find((key) => !(key in value));
  if (missing) invalid(`${path}.${missing}`, "a required field");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) return invalid(path, "an object");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "a string");
  return value;
}

function unsignedInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    return invalid(path, "a non-negative safe integer");
  }
  return Number(value);
}

function positiveInteger(value: unknown, path: string): number {
  const integer = unsignedInteger(value, path);
  if (integer === 0) return invalid(path, "a positive safe integer");
  return integer;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `Invalid workspace source discovery IPC value at ${path}: expected ${expectation}.`,
  );
}
