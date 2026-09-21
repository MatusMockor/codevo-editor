import {
  isCloneBranchName,
  isCloneFolderName,
  parseRepositoryCloneUrl,
} from "./repositoryCloneUrl";

export type LocalProjectCloneRequest = Readonly<{
  idempotencyKey: string;
  url: string;
  name: string;
  parentPath: string;
  branch?: string;
}>;
export type LocalProjectCloneJobRequest = Readonly<{ cloneId: string }>;
export type LocalProjectCloneSnapshot =
  | Readonly<{ cloneId: string; status: "running" | "completed"; path: string; error: null }>
  | Readonly<{ cloneId: string; status: "failed"; path: null; error: string }>
  | Readonly<{ cloneId: string; status: "cancelled"; path: null; error: null }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

export function parseLocalProjectCloneRequest(value: unknown): LocalProjectCloneRequest {
  const record = exactRecord(value, ["idempotencyKey", "url", "name", "parentPath"], ["branch"]);
  const idempotencyKey = cloneId(record.idempotencyKey);
  const url = text(record.url, 2048);
  const name = text(record.name, 64);
  const parentPath = absolutePath(record.parentPath);
  if (parseRepositoryCloneUrl(url) === null || !isCloneFolderName(name)) invalid();
  if (Object.prototype.hasOwnProperty.call(record, "branch")) {
    if (typeof record.branch !== "string" || !isCloneBranchName(record.branch)) invalid();
    return { idempotencyKey, url, name, parentPath, branch: record.branch };
  }
  return { idempotencyKey, url, name, parentPath };
}

export function parseLocalProjectCloneJobRequest(value: unknown): LocalProjectCloneJobRequest {
  const record = exactRecord(value, ["cloneId"]);
  return { cloneId: cloneId(record.cloneId) };
}

export function parseLocalProjectCloneSnapshot(value: unknown): LocalProjectCloneSnapshot {
  const record = exactRecord(value, ["cloneId", "status", "path", "error"]);
  const id = cloneId(record.cloneId);
  switch (record.status) {
    case "running":
    case "completed":
      if (record.error !== null) invalid();
      return { cloneId: id, status: record.status, path: absolutePath(record.path), error: null };
    case "failed":
      if (record.path !== null) invalid();
      return { cloneId: id, status: "failed", path: null, error: text(record.error, 4096) };
    case "cancelled":
      if (record.path !== null || record.error !== null) invalid();
      return { cloneId: id, status: "cancelled", path: null, error: null };
    default:
      return invalid();
  }
}

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  if (
    !required.every((key) => Object.prototype.hasOwnProperty.call(record, key)) ||
    Object.keys(record).some((key) => !required.includes(key) && !optional.includes(key))
  )
    invalid();
  return record;
}

function text(value: unknown, limit: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > limit ||
    value.includes("\0") ||
    encoder.encode(value).byteLength > limit
  )
    invalid();
  return value;
}

function cloneId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value)) invalid();
  return value;
}

function absolutePath(value: unknown): string {
  const path = text(value, 4096);
  if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) invalid();
  return path;
}

function invalid(): never {
  throw new Error("Invalid local project clone contract.");
}
