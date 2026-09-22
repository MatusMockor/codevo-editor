import type { GitChangeStatus } from "./git";

export const MAX_TURN_CHANGED_FILES = 500;
export const MAX_TURN_DIFF_BYTES = 128 * 1024;
export const MAX_TURN_CHANGE_PATH_BYTES = 4096;
export const MAX_TURN_CHANGE_PATH_DEPTH = 64;

export interface AgentTurnChangedFile {
  readonly relativePath: string;
  readonly oldRelativePath: string | null;
  readonly status: GitChangeStatus;
  readonly addedLines: number | null;
  readonly deletedLines: number | null;
}

export interface AgentTurnChangeSummary {
  readonly turnId: string;
  readonly state: "ready" | "unavailable";
  readonly files: ReadonlyArray<AgentTurnChangedFile>;
  readonly truncated: boolean;
  readonly reason: string | null;
}

export interface AgentTurnFileDiff {
  readonly relativePath: string;
  readonly original: { readonly text: string; readonly truncated: boolean };
  readonly modified: { readonly text: string; readonly truncated: boolean };
  readonly unavailableReason: "binary" | "large" | null;
}

export interface AgentTurnChangesGateway {
  getSummary(rootPath: string, turnId: string): Promise<AgentTurnChangeSummary>;
  getFileDiff(rootPath: string, turnId: string, relativePath: string): Promise<AgentTurnFileDiff>;
}

const encoder = new TextEncoder();
const statuses: ReadonlySet<string> = new Set([
  "added",
  "modified",
  "deleted",
  "renamed",
  "untracked",
  "conflicted",
]);

export function isAgentTurnChangePath(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !value ||
    encoder.encode(value).length > MAX_TURN_CHANGE_PATH_BYTES ||
    /[\\\u0000-\u001f\u007f:]/u.test(value)
  )
    return false;
  const parts = value.split("/");
  return (
    parts.length <= MAX_TURN_CHANGE_PATH_DEPTH &&
    parts.every(
      (part) => part !== "" && part !== "." && part !== ".." && part.toLowerCase() !== ".git",
    )
  );
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid turn changes response.");
  const result = value as Record<string, unknown>;
  if (
    Object.keys(result).length !== keys.length ||
    !keys.every((key) => Object.prototype.hasOwnProperty.call(result, key))
  )
    throw new Error("Invalid turn changes fields.");
  return result;
}

function count(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
}

export function parseAgentTurnChangeSummary(value: unknown): AgentTurnChangeSummary {
  const data = record(value, ["turnId", "state", "files", "truncated", "reason"]);
  if (
    typeof data.turnId !== "string" ||
    !data.turnId ||
    encoder.encode(data.turnId).length > 256 ||
    /[\u0000-\u001f\u007f]/u.test(data.turnId) ||
    (data.state !== "ready" && data.state !== "unavailable") ||
    typeof data.truncated !== "boolean" ||
    !(
      data.reason === null ||
      (typeof data.reason === "string" && encoder.encode(data.reason).length <= 1024)
    ) ||
    !Array.isArray(data.files) ||
    data.files.length > MAX_TURN_CHANGED_FILES
  )
    throw new Error("Invalid turn changes summary.");
  const seen = new Set<string>();
  let totalAdded = 0;
  let totalDeleted = 0;
  const files = data.files.map((value): AgentTurnChangedFile => {
    const file = record(value, [
      "relativePath",
      "oldRelativePath",
      "status",
      "addedLines",
      "deletedLines",
    ]);
    if (
      !isAgentTurnChangePath(file.relativePath) ||
      !(file.oldRelativePath === null || isAgentTurnChangePath(file.oldRelativePath)) ||
      typeof file.status !== "string" ||
      !statuses.has(file.status) ||
      !count(file.addedLines) ||
      !count(file.deletedLines) ||
      (file.addedLines === null) !== (file.deletedLines === null) ||
      seen.has(file.relativePath)
    )
      throw new Error("Invalid changed file.");
    seen.add(file.relativePath);
    totalAdded += file.addedLines ?? 0;
    totalDeleted += file.deletedLines ?? 0;
    if (!Number.isSafeInteger(totalAdded) || !Number.isSafeInteger(totalDeleted))
      throw new Error("Changed line totals exceed the supported range.");
    return {
      relativePath: file.relativePath,
      oldRelativePath: file.oldRelativePath,
      status: file.status as GitChangeStatus,
      addedLines: file.addedLines,
      deletedLines: file.deletedLines,
    };
  });
  if (data.state === "unavailable" && files.length !== 0)
    throw new Error("Unavailable changes must not include files.");
  return {
    turnId: data.turnId,
    state: data.state,
    files,
    truncated: data.truncated,
    reason: data.reason,
  };
}

export function parseAgentTurnFileDiff(value: unknown): AgentTurnFileDiff {
  const data = record(value, ["relativePath", "original", "modified", "unavailableReason"]);
  if (
    !isAgentTurnChangePath(data.relativePath) ||
    !(
      data.unavailableReason === null ||
      data.unavailableReason === "binary" ||
      data.unavailableReason === "large"
    )
  )
    throw new Error("Invalid turn file diff.");
  const side = (value: unknown) => {
    const result = record(value, ["text", "truncated"]);
    if (
      typeof result.text !== "string" ||
      encoder.encode(result.text).length > MAX_TURN_DIFF_BYTES ||
      typeof result.truncated !== "boolean"
    )
      throw new Error("Invalid turn diff content.");
    return { text: result.text, truncated: result.truncated };
  };
  return {
    relativePath: data.relativePath,
    original: side(data.original),
    modified: side(data.modified),
    unavailableReason: data.unavailableReason,
  };
}
