import type {
  AgentLocalFileOpenOutcome,
  AgentOutsideFileRefusal,
} from "../domain/agentMarkdown/agentLocalFileLinkFailure";
import { workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { classifyUnopenedLinkedFile, type LinkedFileDirectoryReader } from "./agentLinkedFileProbe";
import type { ReadOnlySnapshotReader } from "./useWorkbenchDocumentTabs";

export const OUTSIDE_LINKED_FILE_READ_TIMEOUT_MS = 10_000;

export type AgentOutsideTextFileRefusal =
  Exclude<AgentOutsideFileRefusal, "otherProject"> | "unreadable" | "unavailable";

export type AgentOutsideTextFile =
  | { readonly kind: "file"; readonly canonicalPath: string; readonly content: string }
  | { readonly kind: AgentOutsideTextFileRefusal };

export interface AgentOutsideTextFilePort {
  readOutsideTextFile(path: string): Promise<AgentOutsideTextFile>;
}

export interface AgentLinkedFileWorkspace {
  readonly root: string | null;
  readonly tabs: ReadonlyArray<string>;
}

export interface AgentOutsideLinkedFileOpening {
  readonly outsideFiles: AgentOutsideTextFilePort;
  readonly directories: LinkedFileDirectoryReader;
  workspace(): AgentLinkedFileWorkspace;
  isCurrent(): boolean;
  open(path: string): Promise<boolean>;
  openSnapshot(path: string, read: ReadOnlySnapshotReader): Promise<boolean>;
}

type SnapshotRead =
  | { readonly kind: "notRead" }
  | { readonly kind: "delivered" }
  | { readonly kind: "refused"; readonly outcome: AgentLocalFileOpenOutcome }
  | { readonly kind: "inWorkspace"; readonly path: string };

const NOT_READ: SnapshotRead = { kind: "notRead" };
const DELIVERED: SnapshotRead = { kind: "delivered" };

export async function openOutsideLinkedFile(
  path: string,
  opening: AgentOutsideLinkedFileOpening,
): Promise<AgentLocalFileOpenOutcome> {
  const requested = opening.workspace();
  if (isOwnedByInactiveWorkspaceTab(path, requested)) return "otherProject";
  if (requested.root !== null && isInsideRoot(path, requested.root)) {
    return openWorkspaceFile(path, requested.root, opening);
  }
  const attempt = { read: NOT_READ };
  const opened = await opening.openSnapshot(path, async () => {
    const result = await readWithinTimeout(opening.outsideFiles, path);
    if (!opening.isCurrent()) return null;
    attempt.read = snapshotRead(result, path, opening.workspace());
    return result?.kind === "file" && attempt.read.kind === "delivered" ? result.content : null;
  });
  if (opened) return "opened";
  if (!opening.isCurrent()) return "superseded";
  return unopenedOutcome(attempt.read, opening);
}

function unopenedOutcome(
  read: SnapshotRead,
  opening: AgentOutsideLinkedFileOpening,
): AgentLocalFileOpenOutcome | Promise<AgentLocalFileOpenOutcome> {
  switch (read.kind) {
    case "notRead":
      return "failed";
    case "delivered":
      return "superseded";
    case "refused":
      return read.outcome;
    case "inWorkspace":
      return openAliasedWorkspaceFile(read.path, opening);
    default:
      return unsupportedRead(read);
  }
}

function snapshotRead(
  result: AgentOutsideTextFile | null,
  path: string,
  workspace: AgentLinkedFileWorkspace,
): SnapshotRead {
  if (result === null) return { kind: "refused", outcome: "failed" };
  if (result.kind !== "file") return { kind: "refused", outcome: refusalOutcome(result.kind) };
  const canonicalPath = result.canonicalPath;
  const foreign = [path, canonicalPath].some((candidate) =>
    isOwnedByInactiveWorkspaceTab(candidate, workspace),
  );
  if (foreign) return { kind: "refused", outcome: "otherProject" };
  if (workspace.root !== null && isInsideRoot(canonicalPath, workspace.root)) {
    return { kind: "inWorkspace", path: canonicalPath };
  }
  return DELIVERED;
}

function refusalOutcome(kind: AgentOutsideTextFileRefusal): AgentLocalFileOpenOutcome {
  return kind === "unavailable" ? "failed" : kind;
}

async function openAliasedWorkspaceFile(
  path: string,
  opening: AgentOutsideLinkedFileOpening,
): Promise<AgentLocalFileOpenOutcome> {
  const root = opening.workspace().root;
  if (root === null || !opening.isCurrent()) return "superseded";
  return openWorkspaceFile(path, root, opening);
}

async function openWorkspaceFile(
  path: string,
  root: string,
  opening: AgentOutsideLinkedFileOpening,
): Promise<AgentLocalFileOpenOutcome> {
  if (await opening.open(path)) return "opened";
  if (!opening.isCurrent()) return "superseded";
  const outcome = await classifyUnopenedLinkedFile(path, root, opening.directories);
  if (!opening.isCurrent()) return "superseded";
  return outcome === "notFound" ? "doesNotExist" : outcome;
}

async function readWithinTimeout(
  files: AgentOutsideTextFilePort,
  path: string,
): Promise<AgentOutsideTextFile | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), OUTSIDE_LINKED_FILE_READ_TIMEOUT_MS);
  });
  try {
    return await Promise.race([files.readOutsideTextFile(path).catch(() => null), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

function isInsideRoot(path: string, root: string): boolean {
  return workspaceRelativePath(root, path) !== null;
}

function isOwnedByInactiveWorkspaceTab(path: string, workspace: AgentLinkedFileWorkspace): boolean {
  const { root, tabs } = workspace;
  if (root !== null && isInsideRoot(path, root)) return false;
  return tabs.some((tab) => !workspaceRootKeysEqual(tab, root) && isInsideRoot(path, tab));
}

function unsupportedRead(read: never): never {
  throw new Error(`Unsupported outside file read: ${String(read)}`);
}
