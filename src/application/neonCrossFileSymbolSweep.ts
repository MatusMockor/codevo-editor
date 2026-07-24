import { neonIncludesFromSource } from "../domain/neonConfig";
import {
  canRenameNeonSymbolTo,
  neonDocumentSymbolOccurrences,
  neonSymbolRenameText,
  neonSymbolTargetAt,
  type NeonSymbolIdentity,
  type NeonSymbolOccurrence,
  type NeonSymbolTarget,
} from "../domain/neonSymbolEdits";

export const NEON_CROSS_FILE_MAX_FILES = 200;

export interface NeonCrossFileRepository {
  readonly activePath: string;
  readonly openOverlays?: ReadonlyMap<string, string> | Readonly<Record<string, string>>;
  readonly rootPath: string;
  isCurrent?(): boolean;
  listNeonFiles(): Promise<readonly string[] | null>;
  readFile(path: string): Promise<string | null>;
}

export type NeonRepositoryIncompleteReason =
  | "fileLimit"
  | "includeOutsideRoot"
  | "listedPathOutsideRoot"
  | "repositoryUnavailable"
  | "staleRepository"
  | "unreadableFile";

export interface NeonRepositoryDocumentSnapshot {
  readonly includes: readonly string[];
  readonly path: string;
  readonly source: string;
}

export interface NeonCrossFileRepositorySnapshot {
  readonly activePath: string;
  readonly component: readonly NeonRepositoryDocumentSnapshot[];
  readonly documents: readonly NeonRepositoryDocumentSnapshot[];
  readonly incompleteReasons: readonly NeonRepositoryIncompleteReason[];
  readonly rootPath: string;
  readonly status: "complete" | "incomplete";
}

export interface NeonCrossFileSymbolOccurrence extends NeonSymbolOccurrence {
  readonly path: string;
}

export interface NeonCrossFileSymbolFacts {
  readonly declarationCount: number;
  readonly occurrences: readonly NeonCrossFileSymbolOccurrence[];
  readonly selectedSpan: NeonSymbolTarget["selectedSpan"];
  readonly status: "complete" | "incomplete";
  readonly symbol: NeonSymbolIdentity;
}

export interface NeonCrossFileRenameEdit extends NeonCrossFileSymbolOccurrence {
  readonly newText: string;
}

export type NeonCrossFileRenamePlan =
  | {
      readonly activePath: string;
      readonly documents: readonly NeonRepositoryDocumentSnapshot[];
      readonly edits: readonly NeonCrossFileRenameEdit[];
      readonly kind: "ready";
      readonly placeholder: string;
      readonly rootPath: string;
      readonly selectedSpan: NeonSymbolTarget["selectedSpan"];
      readonly symbol: NeonSymbolIdentity;
    }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "ambiguousDeclaration"
        | "destinationCollision"
        | "incompleteRepository"
        | "invalidName"
        | "symbolNotFound";
    };

/** Builds a fresh immutable repository snapshot; no cache or write side effects. */
export async function snapshotNeonCrossFileRepository(
  repository: NeonCrossFileRepository,
): Promise<NeonCrossFileRepositorySnapshot> {
  const rootPath = normalizeAbsolutePath(repository.rootPath);
  const activePath = normalizeAbsolutePath(repository.activePath);
  const reasons = new Set<NeonRepositoryIncompleteReason>();
  if (!rootPath || !activePath || !pathBelongsToRoot(activePath, rootPath)) {
    return frozenSnapshot(
      rootPath ?? repository.rootPath,
      activePath ?? repository.activePath,
      [],
      ["listedPathOutsideRoot"],
    );
  }

  const listed = await safeList(repository);
  if (listed === null) reasons.add("repositoryUnavailable");
  if (!repositoryCurrent(repository)) reasons.add("staleRepository");
  const paths = new Map<string, string>([[pathKey(activePath, rootPath), activePath]]);
  for (const candidate of [...(listed ?? [])].sort(compareText)) {
    const path = normalizeAbsolutePath(candidate);
    if (!path || !pathBelongsToRoot(path, rootPath)) {
      reasons.add("listedPathOutsideRoot");
      continue;
    }
    if (path.toLocaleLowerCase("en-US").endsWith(".neon")) {
      const key = pathKey(path, rootPath);
      if (!paths.has(key)) paths.set(key, path);
    }
  }

  const queue = [...paths.values()].sort(compareText);
  if (queue.length > NEON_CROSS_FILE_MAX_FILES) {
    queue.length = NEON_CROSS_FILE_MAX_FILES;
    reasons.add("fileLimit");
  }
  const queued = new Set(queue.map((path) => pathKey(path, rootPath)));
  const queuedPaths = new Map(queue.map((path) => [pathKey(path, rootPath), path]));
  const documents = new Map<string, NeonRepositoryDocumentSnapshot>();
  for (let index = 0; index < queue.length; index += 1) {
    if (!repositoryCurrent(repository)) {
      reasons.add("staleRepository");
      break;
    }
    const path = queue[index];
    if (!path) continue;
    const source =
      overlaySource(repository.openOverlays, path, rootPath) ?? (await safeRead(repository, path));
    if (source === null) {
      reasons.add("unreadableFile");
      continue;
    }
    if (!repositoryCurrent(repository)) {
      reasons.add("staleRepository");
      break;
    }
    const includes: string[] = [];
    for (const include of neonIncludesFromSource(source)) {
      const target = resolveIncludePath(rootPath, path, include.path);
      if (!target) {
        reasons.add("includeOutsideRoot");
        continue;
      }
      const targetKey = pathKey(target, rootPath);
      const canonicalTarget = queuedPaths.get(targetKey) ?? target;
      includes.push(canonicalTarget);
      if (queued.has(targetKey)) continue;
      if (queue.length >= NEON_CROSS_FILE_MAX_FILES) {
        reasons.add("fileLimit");
        continue;
      }
      queued.add(targetKey);
      queuedPaths.set(targetKey, target);
      queue.push(target);
    }
    includes.sort(compareText);
    documents.set(path, Object.freeze({ includes: Object.freeze(includes), path, source }));
  }

  const ordered = [...documents.values()].sort((left, right) => compareText(left.path, right.path));
  const component = weakComponent(ordered, activePath);
  return frozenSnapshot(rootPath, activePath, ordered, [...reasons].sort(compareText), component);
}

/** Collects deterministic facts even when the selected reference is declared in another file. */
export function neonCrossFileSymbolFactsAt(
  snapshot: NeonCrossFileRepositorySnapshot,
  offset: number,
  includeDeclaration = true,
): NeonCrossFileSymbolFacts | null {
  const active = snapshot.documents.find(({ path }) => path === snapshot.activePath);
  const target = active ? neonSymbolTargetAt(active.source, offset) : null;
  if (!target) return null;
  const allOccurrences = snapshot.component.flatMap((document) =>
    neonDocumentSymbolOccurrences(document.source, target, true).map((occurrence) =>
      Object.freeze({
        ...occurrence,
        path: document.path,
        span: Object.freeze({ ...occurrence.span }),
      }),
    ),
  );
  const declarationCount = allOccurrences.filter(({ declaration }) => declaration).length;
  const occurrences = (
    includeDeclaration ? allOccurrences : allOccurrences.filter(({ declaration }) => !declaration)
  ).sort(compareOccurrence);
  return Object.freeze({
    declarationCount,
    occurrences: Object.freeze(occurrences),
    selectedSpan: Object.freeze({ ...target.selectedSpan }),
    status: snapshot.status,
    symbol: Object.freeze({ kind: target.kind, name: target.name }),
  });
}

/** Plans, but never applies, one exact cross-file rename transaction. */
export function planNeonCrossFileSymbolRename(
  snapshot: NeonCrossFileRepositorySnapshot,
  offset: number,
  newName: string,
): NeonCrossFileRenamePlan {
  if (snapshot.status !== "complete") return rejected("incompleteRepository");
  const facts = neonCrossFileSymbolFactsAt(snapshot, offset, true);
  if (!facts) return rejected("symbolNotFound");
  if (facts.declarationCount !== 1) return rejected("ambiguousDeclaration");
  if (!canRenameNeonSymbolTo(facts.symbol, newName)) return rejected("invalidName");
  if (newName !== facts.symbol.name) {
    const destination = { kind: facts.symbol.kind, name: newName } satisfies NeonSymbolIdentity;
    const collision = snapshot.component.some((document) =>
      neonDocumentSymbolOccurrences(document.source, destination, true).some(
        ({ declaration }) => declaration,
      ),
    );
    if (collision) return rejected("destinationCollision");
  }
  const edits = facts.occurrences.map((occurrence) =>
    Object.freeze({
      ...occurrence,
      newText: neonSymbolRenameText(facts.symbol, occurrence, newName),
    }),
  );
  return Object.freeze({
    activePath: snapshot.activePath,
    documents: snapshot.component,
    edits: Object.freeze(edits),
    kind: "ready",
    placeholder: facts.symbol.name,
    rootPath: snapshot.rootPath,
    selectedSpan: facts.selectedSpan,
    symbol: facts.symbol,
  });
}

function rejected(
  reason: Extract<NeonCrossFileRenamePlan, { kind: "rejected" }>["reason"],
): NeonCrossFileRenamePlan {
  return Object.freeze({ kind: "rejected", reason });
}

function frozenSnapshot(
  rootPath: string,
  activePath: string,
  documents: readonly NeonRepositoryDocumentSnapshot[],
  reasons: readonly NeonRepositoryIncompleteReason[],
  component: readonly NeonRepositoryDocumentSnapshot[] = [],
): NeonCrossFileRepositorySnapshot {
  return Object.freeze({
    activePath,
    component: Object.freeze([...component]),
    documents: Object.freeze([...documents]),
    incompleteReasons: Object.freeze([...reasons]),
    rootPath,
    status: reasons.length === 0 ? "complete" : "incomplete",
  });
}

function weakComponent(
  documents: readonly NeonRepositoryDocumentSnapshot[],
  activePath: string,
): NeonRepositoryDocumentSnapshot[] {
  const byPath = new Map(documents.map((document) => [document.path, document]));
  if (!byPath.has(activePath)) return [];
  const neighbors = new Map<string, Set<string>>();
  for (const document of documents) {
    const own = neighbors.get(document.path) ?? new Set<string>();
    neighbors.set(document.path, own);
    for (const target of document.includes) {
      if (!byPath.has(target)) continue;
      own.add(target);
      const reverse = neighbors.get(target) ?? new Set<string>();
      reverse.add(document.path);
      neighbors.set(target, reverse);
    }
  }
  const visited = new Set<string>();
  const queue = [activePath];
  while (queue.length > 0) {
    const path = queue.shift();
    if (!path || visited.has(path)) continue;
    visited.add(path);
    queue.push(...[...(neighbors.get(path) ?? [])].sort(compareText));
  }
  return [...visited].sort(compareText).flatMap((path) => {
    const document = byPath.get(path);
    return document ? [document] : [];
  });
}

function resolveIncludePath(
  rootPath: string,
  currentPath: string,
  includePath: string,
): string | null {
  const reference = includePath.split("\\").join("/").trim();
  if (!reference) return null;
  const base = reference.startsWith("/") ? rootPath : dirname(currentPath);
  const body = reference.startsWith("/") ? reference.replace(/^\/+/, "") : reference;
  const resolved = normalizeAbsolutePath(`${base}/${body}`);
  if (!resolved || !pathBelongsToRoot(resolved, rootPath)) return null;
  const leaf = resolved.split("/").pop() ?? "";
  return leaf.includes(".") ? resolved : `${resolved}.neon`;
}

function normalizeAbsolutePath(path: string): string | null {
  const unc = path.startsWith("\\\\") || /^\/\/[^/]/.test(path);
  const normalized = path.split("\\").join("/");
  const drive = /^([A-Za-z]:)(?:\/|$)/.exec(normalized)?.[1] ?? null;
  const absolute = unc || normalized.startsWith("/") || drive !== null;
  if (!absolute) return null;
  const prefix = drive ?? "";
  const body = drive ? normalized.slice(drive.length) : normalized;
  const segments: string[] = [];
  const protectedSegments = unc ? 2 : 0;
  for (const segment of body.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length <= protectedSegments) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  if (unc && segments.length < 2) return null;
  const root = unc ? "//" : `${prefix}/`;
  return `${root}${segments.join("/")}`.replace(/\/$/, segments.length === 0 ? "/" : "");
}

function pathBelongsToRoot(path: string, rootPath: string): boolean {
  const windows = /^[A-Za-z]:\//.test(rootPath) || rootPath.startsWith("//");
  const candidate = windows ? path.toLocaleLowerCase("en-US") : path;
  const root = windows ? rootPath.toLocaleLowerCase("en-US") : rootPath;
  return candidate === root || candidate.startsWith(`${root.replace(/\/+$/, "")}/`);
}

function pathKey(path: string, rootPath: string): string {
  return /^[A-Za-z]:\//.test(rootPath) || rootPath.startsWith("//")
    ? path.toLocaleLowerCase("en-US")
    : path;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? path.slice(0, Math.max(1, index)) : path.slice(0, index);
}

function overlaySource(
  overlays: NeonCrossFileRepository["openOverlays"],
  path: string,
  rootPath: string,
): string | null {
  if (!overlays) return null;
  if (typeof (overlays as ReadonlyMap<string, string>).get === "function") {
    const entries = overlays as ReadonlyMap<string, string>;
    const direct = entries.get(path);
    if (direct !== undefined) return direct;
    for (const [candidate, source] of [...entries].sort(([left], [right]) =>
      compareText(left, right),
    )) {
      const normalized = normalizeAbsolutePath(candidate);
      if (normalized && pathKey(normalized, rootPath) === pathKey(path, rootPath)) return source;
    }
    return null;
  }
  const entries = overlays as Readonly<Record<string, string>>;
  if (entries[path] !== undefined) return entries[path] ?? null;
  for (const [candidate, source] of Object.entries(entries).sort(([left], [right]) =>
    compareText(left, right),
  )) {
    const normalized = normalizeAbsolutePath(candidate);
    if (normalized && pathKey(normalized, rootPath) === pathKey(path, rootPath)) return source;
  }
  return null;
}

async function safeList(repository: NeonCrossFileRepository): Promise<readonly string[] | null> {
  try {
    return await repository.listNeonFiles();
  } catch {
    return null;
  }
}

async function safeRead(repository: NeonCrossFileRepository, path: string): Promise<string | null> {
  try {
    return await repository.readFile(path);
  } catch {
    return null;
  }
}

function repositoryCurrent(repository: NeonCrossFileRepository): boolean {
  try {
    return repository.isCurrent?.() ?? true;
  } catch {
    return false;
  }
}

function compareOccurrence(
  left: NeonCrossFileSymbolOccurrence,
  right: NeonCrossFileSymbolOccurrence,
): number {
  return (
    compareText(left.path, right.path) ||
    left.span.start - right.span.start ||
    left.span.end - right.span.end
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
