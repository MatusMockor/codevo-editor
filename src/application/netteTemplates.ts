import type { EditorPosition } from "../domain/languageServerFeatures";
import type { LatteReference } from "../domain/latteNavigation";
import {
  latteLayoutCandidatePaths,
  moduleTemplatesRootOf,
  resolveLatteTemplateCandidatePaths,
} from "../domain/nettePathResolution";

export interface LatteDirectoryEntry {
  kind: "directory" | "file";
  path: string;
}

export interface NetteTemplateDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  toRelativePath(rootPath: string, path: string): string;
}

export interface NetteTemplateCacheEntry {
  expiresAt: number;
  relativePaths: string[];
}

export type LatteTemplateCache = Record<string, NetteTemplateCacheEntry>;

export interface NetteTemplateCompletionItem {
  detail?: string;
  insertText: string;
  kind: "template";
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export interface NetteTemplateResolutionContext {
  currentTemplateRelativePath: string;
  deps: NetteTemplateDependencies;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
}

export interface NetteTemplateCompletionContext
  extends NetteTemplateResolutionContext {
  cache: LatteTemplateCache;
  maxCompletions: number;
  maxDepth: number;
  maxTemplates: number;
  scanDirectories: readonly string[];
  ttlMs: number;
}

interface TemplateScanState {
  templatesFound: number;
  visitedDirectories: Set<string>;
}

const LATTE_TEMPLATE_EXTENSION = ".latte";
const LAYOUT_NAVIGATION_LABEL = "@layout";
const MAX_BARE_LAYOUT_SCAN = 2_000;
const LATTE_SCAN_SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set([
  ".git",
  ".idea",
  ".vscode",
  "assets",
  "log",
  "node_modules",
  "temp",
  "vendor",
]);

export async function resolveLatteTemplateDefinition(
  context: NetteTemplateResolutionContext,
  reference: LatteReference | null,
  source: string,
  offset: number,
): Promise<boolean> {
  const { currentTemplateRelativePath, deps, isRequestedRootActive, requestedRoot } =
    context;
  const candidatePaths = reference
    ? resolveLatteTemplateCandidatePaths(
        reference.name,
        currentTemplateRelativePath,
      )
    : bareLayoutTagAt(source, offset)
      ? latteLayoutCandidatePaths(currentTemplateRelativePath)
      : [];
  const label = reference ? reference.name : LAYOUT_NAVIGATION_LABEL;

  for (const relativePath of candidatePaths) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    const exists = await fileExists(deps, path);

    if (!isRequestedRootActive()) {
      return false;
    }

    if (!exists) {
      continue;
    }

    return deps.openTarget(path, { column: 1, lineNumber: 1 }, label);
  }

  return false;
}

export async function latteTemplateCompletions(
  context: NetteTemplateCompletionContext,
  includeCompletion: { prefix: string; replaceEnd: number; replaceStart: number },
): Promise<NetteTemplateCompletionItem[]> {
  const relativePaths = await listLatteTemplateRelativePaths(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const names = latteIncludeCandidateNames(
    relativePaths,
    context.currentTemplateRelativePath,
  );
  const normalizedPrefix = includeCompletion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, context.maxCompletions)
    .map((name) => ({
      detail: "Latte template",
      insertText: name,
      kind: "template" as const,
      label: name,
      replaceEnd: includeCompletion.replaceEnd,
      replaceStart: includeCompletion.replaceStart,
    }));
}

export function isLatteScanSkippedDirectory(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";

  return LATTE_SCAN_SKIPPED_DIRECTORIES.has(basename);
}

async function listLatteTemplateRelativePaths(
  context: NetteTemplateCompletionContext,
): Promise<string[]> {
  const {
    cache,
    deps,
    isRequestedRootActive,
    maxTemplates,
    requestedRoot,
    scanDirectories,
    ttlMs,
  } = context;
  const cached = cache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.relativePaths;
  }

  const relativePaths = new Set<string>();
  const scanState: TemplateScanState = {
    templatesFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of scanDirectories) {
    await collectLatteTemplates(
      context,
      deps.joinPath(requestedRoot, directory),
      relativePaths,
      0,
      scanState,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (scanState.templatesFound >= maxTemplates) {
      break;
    }
  }

  const sorted = Array.from(relativePaths).sort((left, right) =>
    left.localeCompare(right),
  );
  cache[requestedRoot] = {
    expiresAt: Date.now() + ttlMs,
    relativePaths: sorted,
  };

  return sorted;
}

async function collectLatteTemplates(
  context: NetteTemplateCompletionContext,
  directory: string,
  into: Set<string>,
  depth: number,
  scanState: TemplateScanState,
): Promise<void> {
  const {
    deps,
    isRequestedRootActive,
    maxDepth,
    maxTemplates,
    requestedRoot,
  } = context;

  if (depth > maxDepth) {
    return;
  }

  if (scanState.templatesFound >= maxTemplates) {
    return;
  }

  if (scanState.visitedDirectories.has(directory)) {
    return;
  }

  scanState.visitedDirectories.add(directory);

  let entries: LatteDirectoryEntry[];

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

    if (scanState.templatesFound >= maxTemplates) {
      return;
    }

    if (entry.kind === "directory") {
      if (isLatteScanSkippedDirectory(entry.path)) {
        continue;
      }

      await collectLatteTemplates(context, entry.path, into, depth + 1, scanState);
      continue;
    }

    if (!entry.path.endsWith(LATTE_TEMPLATE_EXTENSION)) {
      continue;
    }

    into.add(deps.toRelativePath(requestedRoot, entry.path));
    scanState.templatesFound += 1;
  }
}

async function fileExists(
  deps: NetteTemplateDependencies,
  path: string,
): Promise<boolean> {
  try {
    await deps.readFileContent(path);
    return true;
  } catch {
    return false;
  }
}

function latteIncludeCandidateNames(
  relativePaths: string[],
  currentTemplateRelativePath: string,
): string[] {
  const currentDirectory = dirnameOf(currentTemplateRelativePath);
  const moduleTemplatesRoot = moduleTemplatesRootOf(currentTemplateRelativePath);
  const names = new Set<string>();

  for (const relativePath of relativePaths) {
    if (relativePath === currentTemplateRelativePath) {
      continue;
    }

    names.add(relativeReference(currentDirectory, relativePath));

    const moduleRootReference = moduleTemplatesRootReference(
      moduleTemplatesRoot,
      relativePath,
    );

    if (moduleRootReference) {
      names.add(moduleRootReference);
    }
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function moduleTemplatesRootReference(
  moduleTemplatesRoot: string | null,
  targetPath: string,
): string | null {
  if (!moduleTemplatesRoot) {
    return null;
  }

  if (!targetPath.startsWith(`${moduleTemplatesRoot}/`)) {
    return null;
  }

  return targetPath.slice(moduleTemplatesRoot.length + 1);
}

function bareLayoutTagAt(source: string, offset: number): boolean {
  if (offset < 0 || offset > source.length) {
    return false;
  }

  const braceStart = macroOpenBefore(source, offset);

  if (braceStart === null || source[braceStart + 1] === "/") {
    return false;
  }

  let index = braceStart + 1;

  while (index < source.length && isTagNameChar(source[index] ?? "")) {
    index += 1;
  }

  if (source.slice(braceStart + 1, index) !== "layout") {
    return false;
  }

  const limit = Math.min(source.length, braceStart + MAX_BARE_LAYOUT_SCAN);

  for (let scan = index; scan < limit; scan += 1) {
    const character = source[scan];

    if (character === "\n") {
      return false;
    }

    if (character === "}") {
      return offset <= scan;
    }

    if (character !== " " && character !== "\t") {
      return false;
    }
  }

  return false;
}

function macroOpenBefore(source: string, offset: number): number | null {
  const min = Math.max(0, offset - MAX_BARE_LAYOUT_SCAN);

  for (let index = offset - 1; index >= min; index -= 1) {
    const character = source[index];

    if (character === "\n" || character === "}") {
      return null;
    }

    if (character === "{") {
      return index;
    }
  }

  return null;
}

function relativeReference(fromDirectory: string, targetPath: string): string {
  const fromSegments = fromDirectory.length > 0 ? fromDirectory.split("/") : [];
  const targetSegments = targetPath.split("/");
  let common = 0;

  while (
    common < fromSegments.length &&
    common < targetSegments.length - 1 &&
    fromSegments[common] === targetSegments[common]
  ) {
    common += 1;
  }

  const ups = fromSegments.length - common;
  const downs = targetSegments.slice(common);
  const parts = [...Array.from({ length: ups }, () => ".."), ...downs];

  return parts.join("/");
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");

  if (index < 0) {
    return "";
  }

  return path.slice(0, index);
}

function isTagNameChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}
