import type { EditorPosition } from "../domain/languageServerFeatures";
import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import { netteRoutePresenterTargetsFromSource } from "../domain/latteLinkNavigation";
import { presenterCandidatePathsForTemplate } from "../domain/nettePathResolution";

export interface NettePresenterLinkCompletionItem {
  detail?: string;
  insertText: string;
  kind: "link";
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export interface NettePresenterLinkDependencies {
  getActiveDocument(): { path: string } | null;
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<{ kind: "directory" | "file"; path: string }[]>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  toRelativePath(rootPath: string, path: string): string;
}

export interface NettePresenterLinkCapabilities {
  isPresenterSourcePath(path: string): boolean;
  parsePresenterLinkTarget(target: string): NetteLinkTarget | null;
  presenterActionMethodCandidates(action: string, isSignal: boolean): string[];
  presenterClassCandidatePathsForLink(
    target: NetteLinkTarget,
    currentRelativePath: string,
  ): string[];
  presenterLinkTargetsFromSource(path: string, source: string): string[];
  presenterScanDirectories: readonly string[];
}

export interface NettePresenterCacheEntry {
  expiresAt: number;
  targets: string[];
}

export type NettePresenterCache = Record<string, NettePresenterCacheEntry>;
export type NettePresenterInFlight = Map<string, Promise<string[]>>;

export interface NettePresenterDiscoveryContext {
  cache: NettePresenterCache;
  currentRelativePath: string;
  deps: NettePresenterLinkDependencies;
  frameworkCapabilities: NettePresenterLinkCapabilities;
  inFlight: NettePresenterInFlight;
  isDirectorySkipped(path: string): boolean;
  isRequestedRootActive(): boolean;
  maxDepth: number;
  maxPresenters: number;
  requestedRoot: string;
  ttlMs: number;
}

export interface NettePresenterLinkDetection {
  target: string;
}

interface PresenterScanState {
  presentersFound: number;
  visitedDirectories: Set<string>;
}

const NETTE_THIS_ACTION = "this";
const PHP_EXTENSION = ".php";
const PRESENTER_SUFFIX = "Presenter.php";
const PRESENTER_LINK_METHOD =
  /\bfunction\s+&?(action|render|handle)([A-Z][A-Za-z0-9_]*)\s*\(/g;
const LATTE_MAX_COMPLETIONS = 100;

export async function resolveNetteLinkDefinition(
  context: Omit<NettePresenterDiscoveryContext, "cache" | "inFlight" | "ttlMs">,
  detection: NettePresenterLinkDetection | null,
): Promise<boolean> {
  if (!detection) {
    return false;
  }

  return resolveNettePresenterLink(
    context,
    context.frameworkCapabilities.parsePresenterLinkTarget(detection.target),
    detection.target,
  );
}

export async function resolveNettePresenterLink(
  context: Omit<NettePresenterDiscoveryContext, "cache" | "inFlight" | "ttlMs">,
  parsed: NetteLinkTarget | null,
  label: string,
): Promise<boolean> {
  const {
    currentRelativePath,
    deps,
    frameworkCapabilities,
    isRequestedRootActive,
    requestedRoot,
  } = context;

  if (!parsed || parsed.action === NETTE_THIS_ACTION) {
    return false;
  }

  const methodNames = frameworkCapabilities.presenterActionMethodCandidates(
    parsed.action,
    parsed.isSignal,
  );

  if (methodNames.length === 0) {
    return false;
  }

  const candidatePaths = frameworkCapabilities.presenterClassCandidatePathsForLink(
    parsed,
    currentRelativePath,
  );

  for (const relativePath of candidatePaths) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return false;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    const position = phpMethodPositionInSource(content, methodNames) ?? {
      column: 1,
      lineNumber: 1,
    };

    return deps.openTarget(path, position, label);
  }

  return false;
}

export async function lattePresenterLinkCompletions(
  context: NettePresenterDiscoveryContext,
  completion: { prefix: string; replaceEnd: number; replaceStart: number },
): Promise<NettePresenterLinkCompletionItem[]> {
  const targets = await loadNettePresenterLinkTargets(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();
  const completionTargets = nettePresenterCompletionTargets(
    targets,
    currentPresenterShortNames(
      context.deps,
      context.requestedRoot,
      context.currentRelativePath,
    ),
  );

  return completionTargets
    .filter((target) => target.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((target) => ({
      detail: "Nette presenter action",
      insertText: target,
      kind: "link" as const,
      label: target,
      replaceEnd: completion.replaceEnd,
      replaceStart: completion.replaceStart,
    }));
}

export async function loadNettePresenterLinkTargets(
  context: NettePresenterDiscoveryContext,
): Promise<string[]> {
  const { cache, inFlight, requestedRoot } = context;
  const cached = cache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.targets;
  }

  const existing = inFlight.get(requestedRoot);

  if (existing) {
    return existing;
  }

  const load = scanNettePresenterLinkTargets(context).finally(() => {
    if (inFlight.get(requestedRoot) === load) {
      inFlight.delete(requestedRoot);
    }
  });

  inFlight.set(requestedRoot, load);

  return load;
}

export async function scanNettePresenterLinkTargets(
  context: NettePresenterDiscoveryContext,
): Promise<string[]> {
  const {
    cache,
    deps,
    frameworkCapabilities,
    isRequestedRootActive,
    maxPresenters,
    requestedRoot,
    ttlMs,
  } = context;
  const presenterPaths = new Set<string>();
  const scanState: PresenterScanState = {
    presentersFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of frameworkCapabilities.presenterScanDirectories) {
    await collectNettePresenterPaths(
      context,
      deps.joinPath(requestedRoot, directory),
      presenterPaths,
      0,
      scanState,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (scanState.presentersFound >= maxPresenters) {
      break;
    }
  }

  const targets = new Set<string>();

  for (const path of presenterPaths) {
    if (!isRequestedRootActive()) {
      return [];
    }

    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    for (const target of frameworkCapabilities.presenterLinkTargetsFromSource(
      path,
      content,
    )) {
      targets.add(target);
    }
  }

  if (!isRequestedRootActive()) {
    return [];
  }

  const sorted = Array.from(targets).sort((left, right) =>
    left.localeCompare(right),
  );
  cache[requestedRoot] = {
    expiresAt: Date.now() + ttlMs,
    targets: sorted,
  };

  return sorted;
}

export function phpMethodPositionInSource(
  source: string,
  methodNames: readonly string[],
): EditorPosition | null {
  for (const name of methodNames) {
    const pattern = new RegExp(`\\bfunction\\s+&?${name}\\b`);
    const match = pattern.exec(source);

    if (match) {
      const nameOffset = match.index + match[0].length - name.length;
      return editorPositionAtOffset(source, nameOffset);
    }
  }

  return null;
}

export function nettePresenterLinkTargetsFromSource(
  presenterPath: string,
  source: string,
): string[] {
  const shortName = nettePresenterShortNameFromPath(presenterPath);
  const routeTargets = netteRoutePresenterTargetsFromSource(source).map(
    (target) => target.target,
  );

  if (!shortName) {
    return routeTargets;
  }

  const targets: string[] = [];

  for (const match of source.matchAll(PRESENTER_LINK_METHOD)) {
    const kind = match[1] ?? "";
    const rest = match[2] ?? "";
    const action = rest.charAt(0).toLowerCase() + rest.slice(1);

    targets.push(
      kind === "handle"
        ? `${shortName}:${action}!`
        : `${shortName}:${action}`,
    );
  }

  return [...targets, ...routeTargets];
}

export function isNettePresenterDiscoverySourcePath(path: string): boolean {
  const fileName = path.split("/").pop() ?? "";

  return (
    path.endsWith(PRESENTER_SUFFIX) ||
    (/router/i.test(fileName) && fileName.endsWith(PHP_EXTENSION))
  );
}

async function collectNettePresenterPaths(
  context: NettePresenterDiscoveryContext,
  directory: string,
  into: Set<string>,
  depth: number,
  scanState: PresenterScanState,
): Promise<void> {
  const {
    deps,
    frameworkCapabilities,
    isDirectorySkipped,
    isRequestedRootActive,
    maxDepth,
    maxPresenters,
  } = context;

  if (depth > maxDepth) {
    return;
  }

  if (scanState.presentersFound >= maxPresenters) {
    return;
  }

  if (scanState.visitedDirectories.has(directory)) {
    return;
  }

  scanState.visitedDirectories.add(directory);

  let entries: { kind: "directory" | "file"; path: string }[];

  try {
    entries = await deps.listDirectory(directory);
  } catch {
    return;
  }

  if (!isRequestedRootActive()) {
    return;
  }

  for (const entry of entries) {
    if (!isRequestedRootActive()) {
      return;
    }

    if (scanState.presentersFound >= maxPresenters) {
      return;
    }

    if (entry.kind === "directory") {
      if (isDirectorySkipped(entry.path)) {
        continue;
      }

      await collectNettePresenterPaths(
        context,
        entry.path,
        into,
        depth + 1,
        scanState,
      );
      continue;
    }

    if (!frameworkCapabilities.isPresenterSourcePath(entry.path)) {
      continue;
    }

    into.add(entry.path);
    scanState.presentersFound += 1;
  }
}

function nettePresenterShortNameFromPath(presenterPath: string): string | null {
  const fileName = presenterPath.split("/").pop() ?? "";

  if (!fileName.endsWith(PRESENTER_SUFFIX)) {
    return null;
  }

  const shortName = fileName.slice(0, -PRESENTER_SUFFIX.length);

  return shortName.length > 0 ? shortName : null;
}

function nettePresenterCompletionTargets(
  targets: readonly string[],
  currentPresenterNames: readonly string[],
): string[] {
  const withRelativeTargets = new Set<string>(targets);
  const current = new Set(currentPresenterNames);

  if (current.size === 0) {
    return Array.from(withRelativeTargets);
  }

  for (const target of targets) {
    const relative = relativePresenterTarget(target, current);

    if (relative) {
      withRelativeTargets.add(relative);
    }
  }

  return Array.from(withRelativeTargets).sort((left, right) =>
    left.localeCompare(right),
  );
}

function relativePresenterTarget(
  target: string,
  currentPresenterNames: ReadonlySet<string>,
): string | null {
  const segments = target.split(":");

  if (segments.length !== 2) {
    return null;
  }

  const [presenter, action] = segments;

  if (!presenter || !action || !currentPresenterNames.has(presenter)) {
    return null;
  }

  return action;
}

function currentPresenterShortNames(
  deps: NettePresenterLinkDependencies,
  requestedRoot: string,
  currentRelativePath: string,
): string[] {
  const names = new Set<string>();
  const candidatePaths = currentRelativePath.endsWith(PRESENTER_SUFFIX)
    ? [currentRelativePath]
    : presenterCandidatePathsForTemplate(currentRelativePath);

  for (const path of candidatePaths) {
    const shortName = nettePresenterShortNameFromPath(path);

    if (shortName) {
      names.add(shortName);
    }
  }

  const activeDocument = deps.getActiveDocument();

  if (activeDocument) {
    const relativePath = deps.toRelativePath(requestedRoot, activeDocument.path);
    const shortName = nettePresenterShortNameFromPath(relativePath);

    if (shortName) {
      names.add(shortName);
    }
  }

  return Array.from(names);
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, Math.max(0, offset));
  const lines = before.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
  };
}
