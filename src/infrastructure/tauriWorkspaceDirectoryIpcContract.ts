export const WORKSPACE_DIRECTORY_MAX_ENTRIES = 50_000;
export const WORKSPACE_DIRECTORY_MAX_NAME_UTF8_BYTES = 1_024;
export const WORKSPACE_DIRECTORY_MAX_RELATIVE_PATH_UTF8_BYTES = 32_768;
export const WORKSPACE_DIRECTORY_MAX_TOTAL_UTF8_BYTES = 4 * 1024 * 1024;
export const WORKSPACE_DIRECTORY_MAX_WORKSPACE_ID_UTF8_BYTES = 1_024;
const utf8Encoder = new TextEncoder();

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
  boundedString(
    input.workspaceId,
    "workspace_read_directory_bounded args.workspaceId",
    WORKSPACE_DIRECTORY_MAX_WORKSPACE_ID_UTF8_BYTES,
    false,
  );
  boundedString(
    input.relativePath,
    "workspace_read_directory_bounded args.relativePath",
    WORKSPACE_DIRECTORY_MAX_RELATIVE_PATH_UTF8_BYTES,
    true,
  );
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
  let totalUtf8Bytes = 0;
  const entries = output.entries.map((value, index) => {
    const path = `workspace_read_directory_bounded result.entries[${index}]`;
    const entry = record(value, path);
    exactKeys(entry, ["name", "relativePath", "kind"], path);
    if (entry.kind !== "directory" && entry.kind !== "file")
      invalid(`${path}.kind`, '"directory" or "file"');
    const kind: "directory" | "file" = entry.kind;
    const name = boundedString(
      entry.name,
      `${path}.name`,
      WORKSPACE_DIRECTORY_MAX_NAME_UTF8_BYTES,
      false,
    );
    const entryRelativePath = boundedString(
      entry.relativePath,
      `${path}.relativePath`,
      WORKSPACE_DIRECTORY_MAX_RELATIVE_PATH_UTF8_BYTES,
      false,
    );
    totalUtf8Bytes +=
      utf8Encoder.encode(name).byteLength + utf8Encoder.encode(entryRelativePath).byteLength;
    if (totalUtf8Bytes > WORKSPACE_DIRECTORY_MAX_TOTAL_UTF8_BYTES) {
      invalid(
        "workspace_read_directory_bounded result.entries",
        `at most ${WORKSPACE_DIRECTORY_MAX_TOTAL_UTF8_BYTES} aggregate UTF-8 bytes`,
      );
    }
    return {
      name,
      relativePath: relativePath(entryRelativePath, `${path}.relativePath`, false),
      kind,
    };
  });
  return { entries, truncated: output.truncated };
}

function boundedString(
  value: unknown,
  path: string,
  maxUtf8Bytes: number,
  allowEmpty: boolean,
): string {
  const candidate = string(value, path);
  if (
    (!allowEmpty && candidate.length === 0) ||
    candidate.length > maxUtf8Bytes ||
    candidate.includes("\0") ||
    utf8Encoder.encode(candidate).byteLength > maxUtf8Bytes
  ) {
    return invalid(path, `a UTF-8 string of at most ${maxUtf8Bytes} bytes`);
  }
  return candidate;
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

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0)
    return invalid(path, "a positive safe integer");
  return value as number;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid workspace directory IPC value at ${path}: expected ${expectation}.`);
}
