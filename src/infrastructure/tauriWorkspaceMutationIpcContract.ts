import type { WorkspaceFileRevision, WorkspaceWriteResult } from "../domain/workspace";

export const WORKSPACE_MUTATION_IPC_COMMANDS = {
  createTextWithContent: "workspace_create_text_file_with_content",
} as const;

export interface CreateWorkspaceTextWithContentArgs {
  readonly workspaceId: string;
  readonly relativePath: string;
  readonly content: string;
}

export type InvokeWorkspaceMutationCommand = (
  command: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export async function invokeCreateWorkspaceTextWithContent(
  invokeCommand: InvokeWorkspaceMutationCommand,
  args: CreateWorkspaceTextWithContentArgs,
): Promise<WorkspaceWriteResult> {
  const command = WORKSPACE_MUTATION_IPC_COMMANDS.createTextWithContent;
  validateArgs(args, `${command} args`);
  return decodeWriteResult(await invokeCommand(command, { ...args }), `${command} result`);
}

function validateArgs(value: unknown, path: string): void {
  const args = record(value, path);
  exactKeys(args, ["workspaceId", "relativePath", "content"], path);
  const workspaceId = string(args.workspaceId, `${path}.workspaceId`);
  if (!workspaceId.trim() || workspaceId.includes("\0"))
    invalid(`${path}.workspaceId`, "a non-empty string without NUL bytes");
  workspaceRelativePath(args.relativePath, `${path}.relativePath`);
  string(args.content, `${path}.content`);
}

function decodeWriteResult(value: unknown, path: string): WorkspaceWriteResult {
  const result = record(value, path);
  switch (result.status) {
    case "success":
      exactKeys(result, ["status", "revision"], path);
      return { status: "success", revision: revision(result.revision, `${path}.revision`) };
    case "conflict":
    case "error":
      exactKeys(result, ["status", "message"], path);
      return { status: result.status, message: string(result.message, `${path}.message`) };
    case "partial":
      exactKeys(result, ["status", "message", "revision"], path);
      return {
        status: "partial",
        message: string(result.message, `${path}.message`),
        revision: result.revision === null ? null : revision(result.revision, `${path}.revision`),
      };
    default:
      return invalid(`${path}.status`, '"success", "conflict", "partial", or "error"');
  }
}

function revision(value: unknown, path: string): WorkspaceFileRevision {
  const candidate = record(value, path);
  exactKeys(
    candidate,
    ["device", "inode", "size", "modifiedSeconds", "modifiedNanoseconds", "contentHash"],
    path,
  );
  return {
    device: decimal(candidate.device, `${path}.device`),
    inode: decimal(candidate.inode, `${path}.inode`),
    size: integer(candidate.size, `${path}.size`),
    modifiedSeconds: integer(candidate.modifiedSeconds, `${path}.modifiedSeconds`),
    modifiedNanoseconds: integer(candidate.modifiedNanoseconds, `${path}.modifiedNanoseconds`),
    contentHash: decimal(candidate.contentHash, `${path}.contentHash`),
  };
}

function workspaceRelativePath(value: unknown, path: string): string {
  const candidate = string(value, path).split("\\").join("/");
  if (
    !candidate ||
    candidate.startsWith("/") ||
    /^[A-Za-z]:\//.test(candidate) ||
    candidate.split("/").some((part) => part === ".." || part === "." || part === "")
  ) {
    return invalid(path, "a workspace-relative descendant path");
  }
  return candidate;
}

function decimal(value: unknown, path: string): string {
  const candidate = string(value, path);
  if (!/^(0|[1-9][0-9]*)$/.test(candidate)) return invalid(path, "an unsigned decimal string");
  return candidate;
}

function integer(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value)) return invalid(path, "a safe integer");
  return value as number;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key));
  if (unexpected) invalid(`${path}.${unexpected}`, "no unknown field");
  const missing = allowed.find((key) => !Object.prototype.hasOwnProperty.call(value, key));
  if (missing) invalid(`${path}.${missing}`, "a required field");
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return invalid(path, "an object");
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string") return invalid(path, "a string");
  return value;
}

function invalid(path: string, expectation: string): never {
  throw new TypeError(`Invalid workspace mutation IPC value at ${path}: expected ${expectation}.`);
}
