export const WORKSPACE_DIRECTORY_MAX_ENTRIES = 50_000;

export const WORKSPACE_DIRECTORY_IPC_COMMANDS = {
  readBounded: "workspace_read_directory_bounded",
} as const;

export interface WorkspaceDirectoryDescriptorEntry {
  readonly name: string;
  readonly relativePath: string;
  readonly kind: "directory" | "file";
}

export interface BoundedWorkspaceDirectoryRead {
  readonly entries: readonly WorkspaceDirectoryDescriptorEntry[];
  readonly truncated: boolean;
}

export type InvokeWorkspaceDirectoryCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function invokeWorkspaceDirectoryIpc(
  invokeCommand: InvokeWorkspaceDirectoryCommand,
  args: {
    readonly workspaceId: string;
    readonly relativePath: string;
    readonly maxEntries: number;
  },
): Promise<BoundedWorkspaceDirectoryRead> {
  const input = record(args, "workspace_read_directory_bounded args");
  exactKeys(
    input,
    ["workspaceId", "relativePath", "maxEntries"],
    "workspace_read_directory_bounded args",
  );
  nonEmptyString(input.workspaceId, "workspace_read_directory_bounded args.workspaceId");
  relativePath(input.relativePath, "workspace_read_directory_bounded args.relativePath", true);
  const maxEntries = positiveInteger(
    input.maxEntries,
    "workspace_read_directory_bounded args.maxEntries",
  );
  if (maxEntries > WORKSPACE_DIRECTORY_MAX_ENTRIES) {
    invalid(
      "workspace_read_directory_bounded args.maxEntries",
      `an integer no greater than ${WORKSPACE_DIRECTORY_MAX_ENTRIES}`,
    );
  }

  const output = record(
    await invokeCommand(WORKSPACE_DIRECTORY_IPC_COMMANDS.readBounded, args),
    "workspace_read_directory_bounded result",
  );
  exactKeys(output, ["entries", "truncated"], "workspace_read_directory_bounded result");
  if (!Array.isArray(output.entries))
    invalid("workspace_read_directory_bounded result.entries", "an array");
  if (output.entries.length > maxEntries)
    invalid("workspace_read_directory_bounded result.entries", `at most ${maxEntries} entries`);
  if (typeof output.truncated !== "boolean")
    invalid("workspace_read_directory_bounded result.truncated", "a boolean");
  const entries = output.entries.map((value, index) => {
    const path = `workspace_read_directory_bounded result.entries[${index}]`;
    const entry = record(value, path);
    exactKeys(entry, ["name", "relativePath", "kind"], path);
    if (entry.kind !== "directory" && entry.kind !== "file")
      invalid(`${path}.kind`, '"directory" or "file"');
    const kind: "directory" | "file" = entry.kind;
    return {
      name: nonEmptyString(entry.name, `${path}.name`),
      relativePath: relativePath(entry.relativePath, `${path}.relativePath`, false),
      kind,
    };
  });
  return { entries, truncated: output.truncated };
}

function relativePath(value: unknown, path: string, allowEmpty: boolean): string {
  const candidate = string(value, path).split("\\").join("/");
  if (
    (!allowEmpty && !candidate) ||
    candidate.startsWith("/") ||
    /^[A-Za-z]:\//.test(candidate) ||
    candidate.split("/").some((part) => part === "." || part === "..")
  ) {
    return invalid(
      path,
      allowEmpty ? "a workspace-relative path" : "a workspace-relative descendant path",
    );
  }
  return candidate;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    invalid(path, "an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "a string");
  return value;
}

function nonEmptyString(value: unknown, path: string): string {
  const candidate = string(value, path);
  if (!candidate) return invalid(path, "a non-empty string");
  return candidate;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    return invalid(path, "a positive safe integer");
  return value as number;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid workspace directory IPC value at ${path}: expected ${expectation}.`);
}
