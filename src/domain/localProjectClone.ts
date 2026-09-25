import {
  isCloneBranchName,
  isCloneFolderName,
  parseRepositoryCloneUrl,
} from "./repositoryCloneUrl";

export const LOCAL_CLONE_PHASES = [
  "counting",
  "compressing",
  "receiving",
  "resolving",
  "checkingOut",
] as const;
export type LocalCloneProgressPhase = (typeof LOCAL_CLONE_PHASES)[number];
export type LocalCloneProgress = Readonly<{
  phase: LocalCloneProgressPhase;
  percent: number;
  receivedBytes: number | null;
  bytesPerSecond: number | null;
}>;
export const LOCAL_CLONE_FAILURES = [
  "authentication",
  "notFound",
  "branchNotFound",
  "network",
  "hostKey",
  "timeout",
  "destination",
  "other",
] as const;
export type LocalCloneFailure = (typeof LOCAL_CLONE_FAILURES)[number];

export type LocalProjectCloneRequest = Readonly<{
  idempotencyKey: string;
  url: string;
  name: string;
  parentPath: string;
  branch?: string;
  ensureParent?: true;
}>;
export type LocalProjectCloneJobRequest = Readonly<{ cloneId: string }>;
export type LocalProjectCloneSnapshot =
  | Readonly<{
      cloneId: string;
      status: "running";
      path: string;
      error: null;
      progress: LocalCloneProgress | null;
      failure: null;
    }>
  | Readonly<{
      cloneId: string;
      status: "completed";
      path: string;
      error: null;
      progress: null;
      failure: null;
    }>
  | Readonly<{
      cloneId: string;
      status: "failed";
      path: null;
      error: string;
      progress: null;
      failure: LocalCloneFailure;
    }>
  | Readonly<{
      cloneId: string;
      status: "cancelled";
      path: null;
      error: null;
      progress: null;
      failure: null;
    }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

export function parseLocalProjectCloneRequest(value: unknown): LocalProjectCloneRequest {
  const record = exactRecord(
    value,
    ["idempotencyKey", "url", "name", "parentPath"],
    ["branch", "ensureParent"],
  );
  const idempotencyKey = cloneId(record.idempotencyKey);
  const url = text(record.url, 2048);
  const name = text(record.name, 64);
  const parentPath = absolutePath(record.parentPath);
  if (parseRepositoryCloneUrl(url) === null || !isCloneFolderName(name)) invalid();
  const branch = optionalBranch(record);
  const hasEnsureParent = Object.prototype.hasOwnProperty.call(record, "ensureParent");
  if (hasEnsureParent && record.ensureParent !== true) invalid();
  return {
    idempotencyKey,
    url,
    name,
    parentPath,
    ...(branch === null ? {} : { branch }),
    ...(hasEnsureParent ? { ensureParent: true as const } : {}),
  };
}

export function parseLocalProjectCloneJobRequest(value: unknown): LocalProjectCloneJobRequest {
  const record = exactRecord(value, ["cloneId"]);
  return { cloneId: cloneId(record.cloneId) };
}

export function parseLocalProjectCloneSnapshot(value: unknown): LocalProjectCloneSnapshot {
  const record = exactRecord(value, ["cloneId", "status", "path", "error", "progress", "failure"]);
  const id = cloneId(record.cloneId);
  switch (record.status) {
    case "running":
      if (record.error !== null || record.failure !== null) invalid();
      return {
        cloneId: id,
        status: "running",
        path: absolutePath(record.path),
        error: null,
        progress: record.progress === null ? null : progress(record.progress),
        failure: null,
      };
    case "completed":
      if (record.error !== null || record.progress !== null || record.failure !== null) invalid();
      return {
        cloneId: id,
        status: "completed",
        path: absolutePath(record.path),
        error: null,
        progress: null,
        failure: null,
      };
    case "failed":
      if (record.path !== null || record.progress !== null) invalid();
      return {
        cloneId: id,
        status: "failed",
        path: null,
        error: text(record.error, 4096),
        progress: null,
        failure: failure(record.failure),
      };
    case "cancelled":
      if (
        record.path !== null ||
        record.error !== null ||
        record.progress !== null ||
        record.failure !== null
      )
        invalid();
      return {
        cloneId: id,
        status: "cancelled",
        path: null,
        error: null,
        progress: null,
        failure: null,
      };
    default:
      return invalid();
  }
}

function optionalBranch(record: Record<string, unknown>): string | null {
  if (!Object.prototype.hasOwnProperty.call(record, "branch")) return null;
  if (typeof record.branch !== "string" || !isCloneBranchName(record.branch)) invalid();
  return record.branch;
}

function progress(value: unknown): LocalCloneProgress {
  const record = exactRecord(value, ["phase", "percent", "receivedBytes", "bytesPerSecond"]);
  const phase = LOCAL_CLONE_PHASES.find((candidate) => candidate === record.phase);
  if (phase === undefined) invalid();
  if (
    typeof record.percent !== "number" ||
    !Number.isInteger(record.percent) ||
    record.percent < 0 ||
    record.percent > 100
  )
    invalid();
  return {
    phase,
    percent: record.percent,
    receivedBytes: byteCount(record.receivedBytes),
    bytesPerSecond: byteCount(record.bytesPerSecond),
  };
}

function byteCount(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

function failure(value: unknown): LocalCloneFailure {
  const known = LOCAL_CLONE_FAILURES.find((candidate) => candidate === value);
  if (known === undefined) invalid();
  return known;
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
