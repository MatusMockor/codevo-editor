const DEFAULT_MAX_EXTERNALLY_REMOVED_DOCUMENT_TOMBSTONES = 1_024;
const MAX_OVERFLOW_ROOTS = 16;
const overflowStateByTombstones = new WeakMap<
  Record<string, string>,
  { readonly roots: Set<string>; global: boolean }
>();
const eventStatesByTombstones = new WeakMap<
  Record<string, string>,
  Map<string, { generation: number; kind: "present" | "removed"; pendingRemovals: number }>
>();

export interface ExternallyRemovedDocumentEventToken {
  readonly admitted: boolean;
  readonly generation: number;
  readonly path: string;
}

interface WorkspaceFileTombstoneEvent {
  readonly kind: "created" | "deleted" | "modified" | "renamed" | "rescanRequired";
  readonly path: string;
  readonly previousPath?: string | null;
  readonly rootPath: string;
}

export function markExternallyRemovedDocumentTombstone(
  tombstones: Record<string, string>,
  rootPath: string,
  path: string,
  maxEntries = DEFAULT_MAX_EXTERNALLY_REMOVED_DOCUMENT_TOMBSTONES,
): void {
  delete tombstones[path];
  tombstones[path] = rootPath;

  const paths = Object.keys(tombstones);
  const overflow = paths.length - Math.max(1, maxEntries);
  for (let index = 0; index < overflow; index += 1) {
    const evictedPath = paths[index];
    const evictedRoot = tombstones[evictedPath];
    if (evictedRoot) markOverflowRoot(tombstones, evictedRoot);
    delete tombstones[evictedPath];
  }
}

export function clearExternallyRemovedDocumentTombstonesForRoot(
  tombstones: Record<string, string>,
  rootPath: string,
): void {
  for (const [path, ownerRoot] of Object.entries(tombstones)) {
    if (ownerRoot === rootPath) {
      delete tombstones[path];
    }
  }
  overflowStateByTombstones.get(tombstones)?.roots.delete(rootPath);
}

export function clearAllExternallyRemovedDocumentTombstones(
  tombstones: Record<string, string>,
): void {
  for (const path of Object.keys(tombstones)) {
    delete tombstones[path];
  }
  overflowStateByTombstones.delete(tombstones);
  eventStatesByTombstones.delete(tombstones);
}

export function hasExternallyRemovedDocumentTombstone(
  tombstones: Record<string, string>,
  path: string,
): boolean {
  if (Object.prototype.hasOwnProperty.call(tombstones, path)) {
    return true;
  }
  const overflow = overflowStateByTombstones.get(tombstones);
  return Boolean(
    overflow?.global ||
    [...(overflow?.roots ?? [])].some(
      (rootPath) => path === rootPath || path.startsWith(`${rootPath}/`),
    ),
  );
}

export function forgetExternallyRemovedDocumentTombstone(
  tombstones: Record<string, string>,
  path: string,
): void {
  delete tombstones[path];
}

export function beginExternallyRemovedDocumentEvent(
  tombstones: Record<string, string>,
  path: string,
  kind: "present" | "removed",
): ExternallyRemovedDocumentEventToken {
  const states = eventStates(tombstones);
  if (!states.has(path) && states.size >= DEFAULT_MAX_EXTERNALLY_REMOVED_DOCUMENT_TOMBSTONES) {
    return { admitted: false, generation: 0, path };
  }
  const current = states.get(path);
  const generation = (current?.generation ?? 0) + 1;
  const pendingRemovals = (current?.pendingRemovals ?? 0) + (kind === "removed" ? 1 : 0);
  states.delete(path);
  if (kind === "removed" || pendingRemovals > 0) {
    states.set(path, { generation, kind, pendingRemovals });
  }
  return { admitted: true, generation, path };
}

export function reconcileExternallyRemovedDocumentEvent(
  tombstones: Record<string, string>,
  token: ExternallyRemovedDocumentEventToken,
): boolean {
  if (!token.admitted) {
    return false;
  }
  const current = eventStates(tombstones).get(token.path);
  if (!current) {
    delete tombstones[token.path];
    return false;
  }
  const isCurrentRemoval = current.generation === token.generation && current.kind === "removed";
  const pendingRemovals = Math.max(0, current.pendingRemovals - 1);
  if (pendingRemovals === 0) {
    eventStates(tombstones).delete(token.path);
  } else {
    eventStates(tombstones).set(token.path, { ...current, pendingRemovals });
  }
  if (!isCurrentRemoval && current.kind === "present") {
    delete tombstones[token.path];
  }
  return isCurrentRemoval;
}

export function beginWorkspaceFileTombstoneEvent(
  tombstones: Record<string, string>,
  event: WorkspaceFileTombstoneEvent,
): ExternallyRemovedDocumentEventToken | null {
  if (event.kind === "rescanRequired") {
    overflowStateByTombstones.get(tombstones)?.roots.delete(event.rootPath);
  }
  const removedPath =
    event.kind === "renamed"
      ? (event.previousPath ?? null)
      : event.kind === "deleted"
        ? event.path
        : null;
  const presentPath =
    event.kind === "created" || event.kind === "renamed" ? event.path : null;
  const removedEventToken = removedPath
    ? beginExternallyRemovedDocumentEvent(tombstones, removedPath, "removed")
    : null;
  if (removedEventToken && !removedEventToken.admitted) {
    markOverflowRoot(tombstones, event.rootPath);
  }
  if (presentPath) {
    beginExternallyRemovedDocumentEvent(tombstones, presentPath, "present");
    forgetExternallyRemovedDocumentTombstone(tombstones, presentPath);
  }
  return removedEventToken;
}

export function beginReportedWorkspaceFileTombstoneEvent(
  tombstones: Record<string, string>,
  event: WorkspaceFileTombstoneEvent,
  reportOverflow: (message: string) => void,
): ExternallyRemovedDocumentEventToken | null {
  const token = beginWorkspaceFileTombstoneEvent(tombstones, event);
  if (token && !token.admitted) {
    reportOverflow("File change tracking reached its safety limit. Rescan the workspace.");
  }
  return token;
}

function eventStates(
  tombstones: Record<string, string>,
): Map<string, { generation: number; kind: "present" | "removed"; pendingRemovals: number }> {
  let states = eventStatesByTombstones.get(tombstones);
  if (!states) {
    states = new Map();
    eventStatesByTombstones.set(tombstones, states);
  }
  return states;
}

function markOverflowRoot(tombstones: Record<string, string>, rootPath: string): void {
  let overflow = overflowStateByTombstones.get(tombstones);
  if (!overflow) {
    overflow = { global: false, roots: new Set() };
    overflowStateByTombstones.set(tombstones, overflow);
  }
  if (overflow.global || overflow.roots.has(rootPath)) return;
  if (overflow.roots.size >= MAX_OVERFLOW_ROOTS) {
    overflow.roots.clear();
    overflow.global = true;
    return;
  }
  overflow.roots.add(rootPath);
}
