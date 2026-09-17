import type { RemoteSurfaceRequests } from "./remoteRunnerSurfaces";
type Check = (value: unknown) => boolean;
const text =
  (max: number): Check =>
  (v) =>
    typeof v === "string" && new TextEncoder().encode(v).length <= max && !v.includes("\0");
const terminalData =
  (max: number): Check =>
  (v) =>
    typeof v === "string" && new TextEncoder().encode(v).length <= max;
const number =
  (min = 0, max = Number.MAX_SAFE_INTEGER): Check =>
  (v) =>
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max;
const choice =
  (...items: readonly unknown[]): Check =>
  (v) =>
    items.includes(v);
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const optional =
  (check: Check): Check =>
  (v) =>
    v === undefined || check(v);
const array =
  (check: Check, max: number): Check =>
  (v) =>
    Array.isArray(v) && v.length <= max && v.every(check);
const object =
  (fields: Readonly<Record<string, Check>>): Check =>
  (v) =>
    !!v &&
    typeof v === "object" &&
    !Array.isArray(v) &&
    Object.keys(v).every((k) => Object.prototype.hasOwnProperty.call(fields, k)) &&
    Object.entries(fields).every(([k, c]) => c((v as Record<string, unknown>)[k]));
const id: Check = (v) => typeof v === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const uuid: Check = (v) =>
  typeof v === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v);
const hash: Check = (v) => typeof v === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(v);
const path: Check = (v) =>
  text(4096)(v) &&
  typeof v === "string" &&
  !!v &&
  !/[\\\x00-\x1f:]/.test(v) &&
  v.split("/").every((p) => !!p && p !== "." && p !== ".." && p.toLowerCase() !== ".git");
const bool: Check = (v) => typeof v === "boolean";
const scope = { serverId: id, runnerId: uuid, projectId: id, taskId: optional(uuid) };
const dimensions = { cols: number(2, 500), rows: number(1, 300) };
const request: Record<keyof RemoteSurfaceRequests, Check> = {
  capabilities: object(scope),
  listDirectory: object({ ...scope, path: (v) => v === "" || path(v), offset: number() }),
  readFile: object({ ...scope, path }),
  writeFile: object({ ...scope, path, text: text(65536), expectedVersion: hash }),
  history: object({ ...scope, offset: number() }),
  commitFiles: object({ ...scope, commit: hash }),
  commitDiff: object({ ...scope, commit: hash, path }),
  openTerminal: object({ ...scope, ...dimensions }),
  pollTerminal: object({ ...scope, terminalId: uuid, after: number() }),
  writeTerminal: object({ ...scope, terminalId: uuid, data: terminalData(65536) }),
  resizeTerminal: object({ ...scope, terminalId: uuid, ...dimensions }),
  closeTerminal: object({ ...scope, terminalId: uuid }),
};
const file = object({
  path,
  text: text(65536),
  version: nullable(hash),
  unavailableReason: choice(null, "binary", "large"),
});
const snapshot = {
  id: uuid,
  projectId: id,
  taskId: nullable(uuid),
  ...dimensions,
  status: choice("running", "exited"),
  exitCode: nullable(number(-2147483648, 2147483647)),
  sequence: number(),
};
const response: Record<keyof RemoteSurfaceRequests, Check> = {
  capabilities: object({ files: bool, history: bool, terminal: bool }),
  listDirectory: object({
    entries: array(
      object({ name: text(4096), path, kind: choice("file", "directory", "symlink") }),
      200,
    ),
    nextOffset: nullable(number()),
    truncated: bool,
  }),
  readFile: file,
  writeFile: file,
  history: object({
    commits: array(
      object({
        id: hash,
        parents: array(hash, 100),
        subject: text(65536),
        authorName: text(4096),
        authoredAt: text(128),
      }),
      50,
    ),
    nextOffset: nullable(number()),
    truncated: bool,
  }),
  commitFiles: object({
    files: array(
      object({
        path,
        status: choice("added", "modified", "deleted", "renamed"),
        oldPath: optional(path),
      }),
      10000,
    ),
    truncated: bool,
  }),
  commitDiff: object({
    path,
    original: object({ text: text(1048576), truncated: bool }),
    modified: object({ text: text(1048576), truncated: bool }),
    unavailableReason: choice(null, "binary", "large"),
  }),
  openTerminal: object(snapshot),
  resizeTerminal: object(snapshot),
  pollTerminal: object({
    ...snapshot,
    chunks: array(object({ sequence: number(), data: terminalData(1048576) }), 10000),
    truncated: bool,
  }),
  writeTerminal: object({ accepted: choice(true) }),
  closeTerminal: object({ closed: choice(true) }),
};
export function validateRemoteSurface(
  operation: keyof RemoteSurfaceRequests,
  direction: "request" | "response",
  value: unknown,
): void {
  if (!(direction === "request" ? request : response)[operation](value))
    throw new Error(`Invalid remote surface ${operation} ${direction}.`);
}
