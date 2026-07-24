import type {
  BoundedWorkspaceTextRead,
  WorkspaceJsTestFileEnumeration,
} from "../domain/jsTestDiscovery";

export const WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS = {
  enumerate: "workspace_enumerate_js_test_files",
  readBounded: "workspace_read_text_file_bounded",
} as const;

interface WorkspaceTestDiscoveryIpcContract {
  readonly workspace_enumerate_js_test_files: {
    readonly args: {
      readonly workspaceId: string;
      readonly maxFiles: number;
      readonly maxVisited: number;
    };
    readonly result: WorkspaceJsTestFileEnumeration;
  };
  readonly workspace_read_text_file_bounded: {
    readonly args: {
      readonly workspaceId: string;
      readonly relativePath: string;
      readonly maxBytes: number;
    };
    readonly result: BoundedWorkspaceTextRead;
  };
}

export type WorkspaceTestDiscoveryIpcCommand = keyof WorkspaceTestDiscoveryIpcContract;
export type WorkspaceTestDiscoveryIpcArgs<Command extends WorkspaceTestDiscoveryIpcCommand> =
  WorkspaceTestDiscoveryIpcContract[Command]["args"];
export type WorkspaceTestDiscoveryIpcResult<Command extends WorkspaceTestDiscoveryIpcCommand> =
  WorkspaceTestDiscoveryIpcContract[Command]["result"];
export type InvokeWorkspaceTestDiscoveryCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function invokeWorkspaceTestDiscoveryIpc<
  Command extends WorkspaceTestDiscoveryIpcCommand,
>(
  invokeCommand: InvokeWorkspaceTestDiscoveryCommand,
  command: Command,
  args: WorkspaceTestDiscoveryIpcArgs<Command>,
): Promise<WorkspaceTestDiscoveryIpcResult<Command>> {
  validateArgs(command, args);
  return decodeResult(command, await invokeCommand(command, args));
}

function validateArgs(command: WorkspaceTestDiscoveryIpcCommand, value: unknown): void {
  const args = record(value, `${command} args`);
  string(args.workspaceId, `${command} args.workspaceId`);
  if (command === WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.enumerate) {
    unsignedInteger(args.maxFiles, `${command} args.maxFiles`);
    unsignedInteger(args.maxVisited, `${command} args.maxVisited`);
    return;
  }
  workspaceRelativePath(args.relativePath, `${command} args.relativePath`);
  unsignedInteger(args.maxBytes, `${command} args.maxBytes`);
}

function decodeResult<Command extends WorkspaceTestDiscoveryIpcCommand>(
  command: Command,
  value: unknown,
): WorkspaceTestDiscoveryIpcResult<Command> {
  if (command === WORKSPACE_TEST_DISCOVERY_IPC_COMMANDS.enumerate) {
    const result = record(value, `${command} result`);
    exactKeys(result, ["files", "truncated", "visited"], `${command} result`);
    if (!Array.isArray(result.files)) invalid(`${command} result.files`, "an array");
    const files = result.files.map((file, index) =>
      workspaceRelativePath(file, `${command} result.files[${index}]`),
    );
    if (typeof result.truncated !== "boolean") {
      invalid(`${command} result.truncated`, "a boolean");
    }
    return {
      files,
      truncated: result.truncated,
      visited: unsignedInteger(result.visited, `${command} result.visited`),
    } as WorkspaceTestDiscoveryIpcResult<Command>;
  }
  const result = record(value, `${command} result`);
  if (result.status === "ok") {
    exactKeys(result, ["status", "content"], `${command} result`);
    return {
      status: "ok",
      content: string(result.content, `${command} result.content`),
    } as WorkspaceTestDiscoveryIpcResult<Command>;
  }
  if (result.status === "tooLarge") {
    exactKeys(result, ["status"], `${command} result`);
    return { status: "tooLarge" } as WorkspaceTestDiscoveryIpcResult<Command>;
  }
  return invalid(`${command} result.status`, '"ok" or "tooLarge"');
}

function workspaceRelativePath(value: unknown, path: string): string {
  const candidate = string(value, path).split("\\").join("/");
  if (
    !candidate ||
    candidate.startsWith("/") ||
    /^[A-Za-z]:\//.test(candidate) ||
    candidate.split("/").some((part) => part === ".." || part === ".")
  ) {
    return invalid(path, "a workspace-relative descendant path");
  }
  return candidate;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string) {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(path, "an object");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "a string");
  return value;
}

function unsignedInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    return invalid(path, "a non-negative safe integer");
  }
  return value as number;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(
    `Invalid workspace test discovery IPC value at ${path}: expected ${expectation}.`,
  );
}
