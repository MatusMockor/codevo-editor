/**
 * Latte (Nette) navigation + completion intelligence, extracted from the
 * workbench controller as the FIRST strangler-pattern module: the 32k-line
 * `useWorkbenchController` receives only a thin mount (see `useLatteIntelligence`
 * consumed there), while every decision lives here behind a small, injected
 * dependency surface so the logic is unit-testable WITHOUT the controller.
 *
 * Responsibilities (spec §4.4 / §4.9, Slice 4):
 *   - `provideLatteDefinition` (Cmd+B): a `{include '...'}` / `{layout '...'}` /
 *     `{extends '...'}` / `{import}` / `{embed}` / `{sandbox}` template literal
 *     resolves through `nettePathResolution` to candidate paths; the first that
 *     exists on disk (verified via the injected reader) is opened. A bare
 *     `{layout}` (no argument) falls back to the `@layout.latte` auto-lookup.
 *     Block / control references are intentionally NOT navigated yet (a later
 *     slice owns them) and resolve to `false`.
 *   - `provideLatteCompletions`: Latte tag names after `{` (pure, from the domain
 *     allowlist) and template names inside an `{include '...'}` literal (from a
 *     per-root, TTL-cached workspace listing), each offered as a directory-
 *     relative reference so the inserted path resolves the way Nette resolves
 *     includes (relative to the including template).
 *
 * GATING (spec §4.9): every entry point is inert unless BOTH the Nette framework
 * profile is active AND the semantic tier (`fullSmart`) is on. The highlighting
 * tier runs independently, so a `.latte` file in a Laravel / generic project (or
 * in `basic` mode) gets nothing from here.
 *
 * ISOLATION (project rule): each async flow captures the requested workspace root
 * up front and re-checks the LIVE root after every `await` (file read, directory
 * scan), dropping stale results so nothing leaks across project tabs. This
 * mirrors the Blade flows verbatim.
 */

import { useRef } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  LATTE_TAGS,
  detectLatteIncludeCompletionAt,
  detectLatteReferenceAt,
  detectLatteTagCompletionAt,
} from "../domain/latteNavigation";
import {
  latteLayoutCandidatePaths,
  resolveLatteTemplateCandidatePaths,
} from "../domain/nettePathResolution";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/** The Monaco icon bucket a Latte completion maps to (tag → keyword, template → file). */
export type LatteCompletionItemKind = "tag" | "template";

/**
 * A Latte completion the hook hands to the Monaco "latte" provider. Structurally
 * compatible with the provider's `LatteCompletion`; kept local so the application
 * layer does not depend on the components layer (mirrors `BladeCompletionItem`).
 */
export interface LatteCompletionItem {
  detail?: string;
  insertText: string;
  kind: LatteCompletionItemKind;
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

/** The minimal shape of the active editor document the hook reads (its path). */
export interface LatteIntelligenceActiveDocument {
  path: string;
}

/** A workspace directory entry, narrowed to what the template scan needs. */
export interface LatteDirectoryEntry {
  kind: "directory" | "file";
  path: string;
}

/**
 * The injected surface the hook needs. Every member is a value or a tiny
 * function so the logic can be exercised with plain fakes - no controller, no
 * Monaco, no React. The controller mount supplies the real collaborators
 * (workspace files gateway, navigation opener, path helpers, framework/tier
 * flags) and the live workspace-root ref used for the post-await isolation
 * re-checks.
 */
export interface LatteIntelligenceDependencies {
  /** Live workspace root, read AFTER each await to drop stale results. */
  currentWorkspaceRootRef: { readonly current: string | null };
  getActiveDocument(): LatteIntelligenceActiveDocument | null;
  isNetteFrameworkActive: boolean;
  isSemanticIntelligenceActive: boolean;
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  readFileContent(path: string): Promise<string>;
  toRelativePath(rootPath: string, path: string): string;
  /** The requested workspace root, captured up front by each async flow. */
  workspaceRoot: string | null;
}

export interface LatteIntelligence {
  provideLatteCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletionItem[]>;
  provideLatteDefinition(source: string, offset: number): Promise<boolean>;
}

interface LatteTemplateCacheEntry {
  expiresAt: number;
  relativePaths: string[];
}

/** Per-root cache of workspace `.latte` relative paths (keyed by requested root). */
export type LatteTemplateCache = Record<string, LatteTemplateCacheEntry>;

/** Mutable bookkeeping threaded through one recursive scan (spec §6b bounds). */
interface LatteTemplateScanState {
  templatesFound: number;
  visitedDirectories: Set<string>;
}

/**
 * Directories a Nette project keeps its templates under, covering both the
 * classic (`app/Presenters/templates`, top-level `templates`) and modern
 * (`app/UI/<Name>`) conventions without walking `vendor` / `node_modules`.
 */
const LATTE_TEMPLATE_SCAN_DIRECTORIES: readonly string[] = ["app", "templates"];
const LATTE_TEMPLATE_EXTENSION = ".latte";

/**
 * Time-to-live for the per-root template listing. Invalidation stays simple
 * and self-contained (no controller file-watch wiring, so the thin mount
 * stays thin): a short TTL bounds staleness to a few seconds after a `.latte`
 * file is added / removed. `evictStaleTemplateCacheEntries` below handles the
 * other half (cross-root growth / stale-after-reopen), so together they bound
 * both the cache's size (single active project → at most one entry) and its
 * staleness. Precise file-change invalidation is a documented follow-up
 * (spec §5, Slice 6/7 per-root cache + invalidation).
 */
const LATTE_TEMPLATE_CACHE_TTL_MS = 5_000;
const LATTE_MAX_COMPLETIONS = 100;
const LAYOUT_NAVIGATION_LABEL = "@layout";

/** Bound for the backward scan that finds a bare `{layout}` macro before a cursor. */
const MAX_BARE_LAYOUT_SCAN = 2_000;

/**
 * Bound for the recursive `.latte` scan (spec §6b): protects against a
 * pathologically deep tree - or, since the `listDirectory` contract exposes
 * no symlink / realpath metadata, a self-referencing symlink - turning into a
 * runaway walk. `visitedDirectories` (below) additionally short-circuits an
 * exact repeated directory path within one scan, but a genuine symlink cycle
 * can produce ever-growing distinct path strings the visited-set cannot
 * catch; this depth cap (together with `MAX_LATTE_TEMPLATE_FILES`) is the
 * real bound in that case. Deterministic: a tree deeper than the cap simply
 * stops descending and the scan returns whatever it already collected.
 */
const MAX_LATTE_SCAN_DEPTH = 12;

/**
 * Hard cap on `.latte` files collected in one scan (spec §6b), matching
 * `WORKSPACE_TODO_MAX_FILES` (`useWorkbenchController.ts`) in both value and
 * pattern: once reached, the scan stops early and returns a deterministic
 * partial result rather than growing unbounded on a very wide tree.
 */
const MAX_LATTE_TEMPLATE_FILES = 2_000;

/**
 * Directory basenames a Latte scan never descends into, wherever they are
 * nested under `app` / `templates` - dependency, VCS and generated-asset
 * directories a Nette project keeps around but never stores templates under.
 */
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

/**
 * Builds the Latte intelligence API from an accessor to the current
 * dependencies (read fresh on every call so gating flags and the workspace root
 * are always current) and a mutable per-root template cache. Exported for direct
 * unit testing; the React hook is a thin, stable wrapper around it.
 */
export function createLatteIntelligence(
  getDependencies: () => LatteIntelligenceDependencies,
  templateCache: LatteTemplateCache = {},
): LatteIntelligence {
  const provideLatteDefinition = async (
    source: string,
    offset: number,
  ): Promise<boolean> => {
    const deps = getDependencies();
    evictStaleTemplateCacheEntries(templateCache, deps.workspaceRoot);

    if (!isLatteSemanticActive(deps)) {
      return false;
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return false;
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
    const currentTemplateRelativePath = currentTemplatePath(deps, requestedRoot);
    const reference = detectLatteReferenceAt(source, offset);

    if (reference && reference.kind !== "template") {
      // Block / control navigation is owned by a later slice.
      return false;
    }

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
  };

  const provideLatteCompletions = async (
    source: string,
    position: EditorPosition,
  ): Promise<LatteCompletionItem[]> => {
    const deps = getDependencies();
    evictStaleTemplateCacheEntries(templateCache, deps.workspaceRoot);

    if (!isLatteSemanticActive(deps)) {
      return [];
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return [];
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
    const offset = offsetAtEditorPosition(source, position);
    const includeCompletion = detectLatteIncludeCompletionAt(source, offset);

    if (includeCompletion) {
      return latteTemplateCompletions(
        deps,
        templateCache,
        requestedRoot,
        includeCompletion,
        isRequestedRootActive,
      );
    }

    const tagCompletion = detectLatteTagCompletionAt(source, offset);

    if (tagCompletion) {
      return latteTagCompletions(tagCompletion.prefix, tagCompletion.start, offset);
    }

    return [];
  };

  return { provideLatteCompletions, provideLatteDefinition };
}

/**
 * Thin React wrapper: keeps a live dependency ref (so the stable API always sees
 * the latest gating flags / root) and a persistent per-root template cache, then
 * builds the intelligence API exactly once so its callback identities never
 * churn across renders.
 */
export function useLatteIntelligence(
  dependencies: LatteIntelligenceDependencies,
): LatteIntelligence {
  const dependenciesRef = useRef(dependencies);
  dependenciesRef.current = dependencies;
  const templateCacheRef = useRef<LatteTemplateCache>({});
  const apiRef = useRef<LatteIntelligence | null>(null);

  if (!apiRef.current) {
    apiRef.current = createLatteIntelligence(
      () => dependenciesRef.current,
      templateCacheRef.current,
    );
  }

  return apiRef.current;
}

function isLatteSemanticActive(deps: LatteIntelligenceDependencies): boolean {
  return deps.isNetteFrameworkActive && deps.isSemanticIntelligenceActive;
}

/**
 * Evicts every cached root except `requestedRoot` (spec §6b cache lifecycle):
 * with a single active project tab the map holds at most one entry, so
 * switching projects - or closing the active one, `requestedRoot === null` -
 * no longer leaves a previous root's listing cached forever. Called
 * synchronously at the very top of every async flow, before that flow's
 * first `await`, so it always runs against a guaranteed-fresh
 * `requestedRoot` (no stale-await risk); the TTL above then bounds the
 * staleness of whatever one entry remains.
 */
function evictStaleTemplateCacheEntries(
  templateCache: LatteTemplateCache,
  requestedRoot: string | null,
): void {
  for (const cachedRoot of Object.keys(templateCache)) {
    if (workspaceRootKeysEqual(cachedRoot, requestedRoot)) {
      continue;
    }

    delete templateCache[cachedRoot];
  }
}

async function fileExists(
  deps: LatteIntelligenceDependencies,
  path: string,
): Promise<boolean> {
  try {
    await deps.readFileContent(path);
    return true;
  } catch {
    return false;
  }
}

function latteTagCompletions(
  prefix: string,
  braceStart: number,
  offset: number,
): LatteCompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  return LATTE_TAGS.filter((tag) =>
    tag.toLowerCase().startsWith(normalizedPrefix),
  )
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((tag) => ({
      detail: "Latte tag",
      insertText: tag,
      kind: "tag" as const,
      label: tag,
      replaceEnd: offset,
      replaceStart: braceStart + 1,
    }));
}

async function latteTemplateCompletions(
  deps: LatteIntelligenceDependencies,
  templateCache: LatteTemplateCache,
  requestedRoot: string,
  includeCompletion: { prefix: string; replaceEnd: number; replaceStart: number },
  isRequestedRootActive: () => boolean,
): Promise<LatteCompletionItem[]> {
  const relativePaths = await listLatteTemplateRelativePaths(
    deps,
    templateCache,
    requestedRoot,
    isRequestedRootActive,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const currentTemplateRelativePath = currentTemplatePath(deps, requestedRoot);
  const names = latteIncludeCandidateNames(
    relativePaths,
    currentTemplateRelativePath,
  );
  const normalizedPrefix = includeCompletion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((name) => ({
      detail: "Latte template",
      insertText: name,
      kind: "template" as const,
      label: name,
      replaceEnd: includeCompletion.replaceEnd,
      replaceStart: includeCompletion.replaceStart,
    }));
}

async function listLatteTemplateRelativePaths(
  deps: LatteIntelligenceDependencies,
  templateCache: LatteTemplateCache,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
): Promise<string[]> {
  const cached = templateCache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.relativePaths;
  }

  const relativePaths = new Set<string>();
  const scanState: LatteTemplateScanState = {
    templatesFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of LATTE_TEMPLATE_SCAN_DIRECTORIES) {
    await collectLatteTemplates(
      deps,
      deps.joinPath(requestedRoot, directory),
      requestedRoot,
      relativePaths,
      isRequestedRootActive,
      0,
      scanState,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    if (scanState.templatesFound >= MAX_LATTE_TEMPLATE_FILES) {
      break;
    }
  }

  const sorted = Array.from(relativePaths).sort((left, right) =>
    left.localeCompare(right),
  );
  templateCache[requestedRoot] = {
    expiresAt: Date.now() + LATTE_TEMPLATE_CACHE_TTL_MS,
    relativePaths: sorted,
  };

  return sorted;
}

/**
 * Recursively walks one scan-root directory, bounded on three independent
 * axes (spec §6b): `depth` stops a pathologically deep - or symlink-cyclic -
 * tree, `scanState.templatesFound` caps the total work on a very wide tree,
 * and `scanState.visitedDirectories` skips an exact repeated directory path
 * within the same scan. All three are deterministic (no throwing): exceeding
 * a bound simply stops that branch and the scan returns whatever it already
 * collected.
 */
async function collectLatteTemplates(
  deps: LatteIntelligenceDependencies,
  directory: string,
  requestedRoot: string,
  into: Set<string>,
  isRequestedRootActive: () => boolean,
  depth: number,
  scanState: LatteTemplateScanState,
): Promise<void> {
  if (depth > MAX_LATTE_SCAN_DEPTH) {
    return;
  }

  if (scanState.templatesFound >= MAX_LATTE_TEMPLATE_FILES) {
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

    if (scanState.templatesFound >= MAX_LATTE_TEMPLATE_FILES) {
      return;
    }

    if (entry.kind === "directory") {
      if (isLatteScanSkippedDirectory(entry.path)) {
        continue;
      }

      await collectLatteTemplates(
        deps,
        entry.path,
        requestedRoot,
        into,
        isRequestedRootActive,
        depth + 1,
        scanState,
      );
      continue;
    }

    if (!entry.path.endsWith(LATTE_TEMPLATE_EXTENSION)) {
      continue;
    }

    into.add(deps.toRelativePath(requestedRoot, entry.path));
    scanState.templatesFound += 1;
  }
}

/** True when `path`'s basename is a directory the `.latte` scan never descends into. */
function isLatteScanSkippedDirectory(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";

  return LATTE_SCAN_SKIPPED_DIRECTORIES.has(basename);
}

function currentTemplatePath(
  deps: LatteIntelligenceDependencies,
  requestedRoot: string,
): string {
  const document = deps.getActiveDocument();

  if (!document) {
    return "";
  }

  return deps.toRelativePath(requestedRoot, document.path);
}

/**
 * Turns workspace-relative `.latte` paths into include references relative to
 * the current template's directory (how Nette resolves includes). The current
 * template excludes itself. Sorted, de-duplicated.
 */
function latteIncludeCandidateNames(
  relativePaths: string[],
  currentTemplateRelativePath: string,
): string[] {
  const currentDirectory = dirnameOf(currentTemplateRelativePath);
  const names = new Set<string>();

  for (const relativePath of relativePaths) {
    if (relativePath === currentTemplateRelativePath) {
      continue;
    }

    names.add(relativeReference(currentDirectory, relativePath));
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

/**
 * Returns true when `offset` sits inside a truly bare `{layout}` macro (a
 * `{layout}` with NO argument at all), so navigation can fall back to the
 * `@layout.latte` auto-lookup. Any argument - a quoted file (handled by the
 * template-reference path), `{layout none}`, or an expression - disqualifies it,
 * staying conservative. Bounded, single-line, hang-safe: the backward scan stops
 * at the enclosing `{` (or a `}` / newline) and the forward scan stops at the
 * tag's `}` or the end of the line.
 */
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
      // Any argument (quoted file, `none`, an expression) is not a bare layout.
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

/**
 * Builds a path from `fromDirectory` to `targetPath` using `../` for each level
 * that must be climbed, so an include inserted from the completion resolves the
 * way Nette resolves a relative include.
 */
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

function offsetAtEditorPosition(source: string, position: EditorPosition): number {
  const lines = source.split("\n");
  const targetLine = Math.max(0, position.lineNumber - 1);

  if (targetLine >= lines.length) {
    return source.length;
  }

  let offset = 0;

  for (let line = 0; line < targetLine; line += 1) {
    offset += (lines[line]?.length ?? 0) + 1;
  }

  const column = Math.max(0, position.column - 1);

  return offset + Math.min(column, lines[targetLine]?.length ?? 0);
}

function isTagNameChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}
