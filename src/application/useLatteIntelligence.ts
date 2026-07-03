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
  detectLatteLinkAt,
  detectPhpPresenterLinkAt,
  nettePresenterActionMethodCandidates,
  nettePresenterClassCandidatePathsForLink,
  nettePresenterLinkCompletionContextAt,
  parseNetteLinkTarget,
} from "../domain/latteLinkNavigation";
import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import {
  detectLatteControlAt,
  detectLatteFormNameAt,
  detectNetteCreateComponentAt,
  netteComponentUsagesInLatte,
  netteCreateComponentMethodName,
  nettePresenterLifecycleInfo,
} from "../domain/netteComponents";
import {
  LATTE_BUILTIN_FILTERS,
  innermostLatteExpressionSpanAt,
  latteForeachLoopBindingsAt,
  latteVariableDeclarations,
  parseLatteForeachCollection,
} from "../domain/latteSyntax";
import {
  NETTE_VIEW_DATA_SEARCH_QUERIES,
  netteViewDataEntryFromSource,
} from "../domain/netteViewData";
import type {
  PhpFrameworkViewDataEntry,
  PhpFrameworkViewDataVariable,
} from "../domain/phpFrameworkProviders";
import {
  orderPhpMemberCompletionsByCategory,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  latteLayoutCandidatePaths,
  presenterCandidatePathsForTemplate,
  presenterTemplateCandidatePaths,
  resolveLatteTemplateCandidatePaths,
} from "../domain/nettePathResolution";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

/**
 * The Monaco icon bucket a Latte completion maps to: tag → keyword,
 * template → file, variable → `{$var}` template variable, member → `{$var->}`
 * property/method, filter → `|filter` name.
 */
export type LatteCompletionItemKind =
  | "tag"
  | "template"
  | "variable"
  | "member"
  | "filter"
  | "link"
  | "component";

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
  /**
   * Resolves a declared type hint (a short class name written in the presenter,
   * `Product`) against that source's namespace / use-statements to a
   * fully-qualified name. Pass-through of the controller's
   * `resolvePhpDeclaredType` - the same resolution the Blade view-data fallback
   * uses - so a raw short name is never mistaken for a root-namespace class.
   */
  resolveDeclaredType(source: string, typeHint: string | null): string | null;
  /**
   * Full PHP expression-type inference (the same engine the controller uses for
   * Blade view-data), resolving a `{var $x = new Product()}` value expression or
   * a presenter sighting's `valueExpression` to a class name. Injected as a thin
   * pass-through so the heavy semantic engine stays in the controller and this
   * flow can be exercised with plain fakes.
   */
  resolveExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  /**
   * Member completions for a receiver expression resolved against a PHP source
   * (typically the `synthesizeTypedReceiverSource` output). Pass-through of the
   * controller's engine-agnostic `resolvePhpReceiverMethodCompletions`, so
   * `{$invoice->}` completes exactly like Blade's `$invoice->`.
   */
  resolvePhpReceiverCompletions(
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ): Promise<PhpMethodCompletion[]>;
  /**
   * Text search anchoring the presenter/control sources that feed data into
   * templates. Pass-through of the controller's workspace text search, captured
   * per requested root. Returns the matching file paths.
   */
  searchText(
    rootPath: string,
    query: string,
    maxResults: number,
  ): Promise<{ path: string }[]>;
  /**
   * Builds a minimal PHP document that types `$variableName` as `typeName` (a
   * `@var` docblock) with the cursor positioned to resolve member access.
   * Pass-through of the controller's synthetic-source builder, kept injected so
   * the hook never hardcodes the docblock format.
   */
  synthesizeTypedReceiverSource(
    variableName: string,
    typeName: string,
  ): { position: EditorPosition; source: string };
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
  /**
   * Cmd+B on a PHP presenter link (`$this->link('Product:show')`,
   * `->redirect(...)`, `->forward(...)`, ...): resolves the target the same way
   * as the Latte `{link}` / `n:href` navigation and opens the presenter at its
   * action / render / handle method. Wired into the Monaco `php` definition
   * chain by the controller mount; inert outside a Nette semantic project.
   */
  provideNettePhpLinkDefinition(
    source: string,
    offset: number,
  ): Promise<boolean>;
}

interface LatteTemplateCacheEntry {
  expiresAt: number;
  relativePaths: string[];
}

/** Per-root cache of workspace `.latte` relative paths (keyed by requested root). */
export type LatteTemplateCache = Record<string, LatteTemplateCacheEntry>;

interface LatteViewDataCacheEntry {
  entries: PhpFrameworkViewDataEntry[];
  expiresAt: number;
}

/**
 * Per-root cache of the parsed Nette presenter/control view-data entries (keyed
 * by requested root). Hook-owned - the strangler mount stays thin - and subject
 * to the same TTL + cross-root eviction the template cache uses, so a single
 * active project holds at most one entry and switching projects never leaks a
 * previous root's presenter data.
 */
export type LatteViewDataCache = Record<string, LatteViewDataCacheEntry>;

/** In-flight view-data loads keyed by requested root (concurrent callers join). */
type LatteViewDataInFlight = Map<string, Promise<PhpFrameworkViewDataEntry[]>>;

interface LattePresenterCacheEntry {
  expiresAt: number;
  /** `Presenter:action` targets discovered under the workspace, sorted. */
  targets: string[];
}

/**
 * Per-root cache of the discovered `Presenter:action` link targets (keyed by
 * requested root). Hook-owned (the strangler mount stays thin) and subject to
 * the same TTL + cross-root eviction the template / view-data caches use, so a
 * single active project holds at most one entry and switching projects never
 * leaks a previous root's presenter list.
 */
export type LattePresenterCache = Record<string, LattePresenterCacheEntry>;

/** In-flight presenter scans keyed by requested root (concurrent callers join). */
type LattePresenterInFlight = Map<string, Promise<string[]>>;

interface LatteComponentCacheEntry {
  /** The `createComponent*` component names of `templateRelativePath`'s presenter. */
  componentNames: string[];
  expiresAt: number;
  /** The active template the entry was scanned for (single active editor). */
  templateRelativePath: string;
}

/**
 * Per-root cache of the CURRENT presenter's `createComponent*` component names,
 * feeding `{control <name>}` completion (spec §9 / Fáza 2). Hook-owned (the
 * strangler mount stays thin) and subject to the same TTL + cross-root eviction
 * the template / view-data / presenter caches use. A single entry per root is
 * keyed to the active template it was scanned for, so switching the active
 * template re-scans and switching projects never leaks a previous root's
 * component list.
 */
export type LatteComponentCache = Record<string, LatteComponentCacheEntry>;

/**
 * Everything one expression-completion request carries down the resolution
 * chain: the injected deps, the root captured up front, the live-root guard,
 * and the per-instance view-data cache + in-flight registry. Bundled so the
 * deep call chain (member completion → type priority chain → view-data load)
 * threads one value instead of five parallel parameters.
 */
interface LatteExpressionResolutionContext {
  deps: LatteIntelligenceDependencies;
  isRequestedRootActive: () => boolean;
  requestedRoot: string;
  viewDataCache: LatteViewDataCache;
  viewDataInFlight: LatteViewDataInFlight;
}

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

/**
 * TTL for the per-root Nette view-data listing (spec §6b). Mirrors the template
 * cache: a short TTL bounds staleness after a presenter changes, while
 * `evictOtherRootCacheEntries` bounds cross-root growth. Precise file-change
 * invalidation is the same documented follow-up as the template cache.
 */
const LATTE_VIEW_DATA_CACHE_TTL_MS = 5_000;

/**
 * Result cap per view-data text search, matching the controller's Blade
 * view-data loader (`textSearch.searchText(root, query, 200)`), so a very large
 * workspace never streams an unbounded hit list into the lazy presenter scan.
 */
const LATTE_VIEW_DATA_SEARCH_LIMIT = 200;

/**
 * Bound on the recursion that resolves a `{foreach}` element type through nested
 * loops / relation chains, so a pathological or self-referential template never
 * recurses without end. Exceeding it yields `null` (no completions), never a
 * hang.
 */
const MAX_LATTE_TYPE_RESOLUTION_DEPTH = 8;
const PHP_EXTENSION = ".php";
const PRESENTER_SUFFIX = "Presenter.php";

/**
 * TTL for the per-root discovered `Presenter:action` link-target listing (spec
 * §6b). Mirrors the template / view-data caches: a short TTL bounds staleness
 * after a presenter is added / changed, while `evictOtherRootCacheEntries`
 * bounds cross-root growth. Precise file-change invalidation is the same
 * documented follow-up.
 */
const LATTE_PRESENTER_CACHE_TTL_MS = 5_000;

/**
 * TTL for the per-root current-presenter component-name listing (spec §9 / Fáza
 * 2). Mirrors the other caches: a short TTL bounds staleness after a
 * `createComponent*` factory is added / renamed, while `evictOtherRootCacheEntries`
 * bounds cross-root growth. Precise file-change invalidation is the same
 * documented follow-up as the sibling caches.
 */
const LATTE_COMPONENT_CACHE_TTL_MS = 5_000;

/**
 * Directory a Nette project keeps its presenters under - both the classic
 * (`app/Presenters`) and modern (`app/UI/<Name>`) conventions live below `app`,
 * so the link-target discovery scans it alone (never `vendor` / `templates`).
 */
const LATTE_PRESENTER_SCAN_DIRECTORIES: readonly string[] = ["app"];

/**
 * The Nette current-action marker (`{link this}`): a destination that reloads
 * the current presenter/action and so cannot be resolved to a named method
 * statically. Navigation is declined for it (spec §4.7).
 */
const NETTE_THIS_ACTION = "this";

/**
 * A presenter action / render / signal method declaration. The `[A-Z]` after
 * the prefix rejects a bare `render()` / `action()` (whose concrete action is
 * unknowable), so only named `renderShow` / `actionEdit` / `handleDelete`
 * methods become concrete link targets.
 */
const PRESENTER_LINK_METHOD =
  /\bfunction\s+&?(action|render|handle)([A-Z][A-Za-z0-9_]*)\s*\(/g;

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
  viewDataCache: LatteViewDataCache = {},
  presenterCache: LattePresenterCache = {},
  componentCache: LatteComponentCache = {},
): LatteIntelligence {
  /**
   * Per-instance in-flight registry for the view-data loads, so concurrent
   * completion requests (Monaco fires one per keystroke) share ONE scan per
   * root instead of launching parallel full text searches. Entries self-delete
   * on settle; a lingering cross-root entry is harmless (keyed by root, joined
   * only by requests for that same root) so no eviction pass is needed.
   */
  const viewDataInFlight: LatteViewDataInFlight = new Map();
  /**
   * Per-instance in-flight registry for the presenter link-target discovery,
   * collapsing the completion-per-keystroke storm into one scan per root
   * (mirrors `viewDataInFlight`).
   */
  const presenterInFlight: LattePresenterInFlight = new Map();

  const provideLatteDefinition = async (
    source: string,
    offset: number,
  ): Promise<boolean> => {
    const deps = getDependencies();
    evictOtherRootCacheEntries(templateCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(viewDataCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(presenterCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(componentCache, deps.workspaceRoot);

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

    const linkHandled = await resolveNetteLinkDefinition(
      deps,
      requestedRoot,
      isRequestedRootActive,
      detectLatteLinkAt(source, offset),
      currentTemplateRelativePath,
    );

    if (linkHandled) {
      return true;
    }

    const controlHandled = await resolveNetteControlDefinition(
      deps,
      requestedRoot,
      isRequestedRootActive,
      netteControlComponentNameAt(source, offset),
      currentTemplateRelativePath,
    );

    if (controlHandled) {
      return true;
    }

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
    evictOtherRootCacheEntries(templateCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(viewDataCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(presenterCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(componentCache, deps.workspaceRoot);

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

    const linkCompletion = nettePresenterLinkCompletionContextAt(
      source,
      offset,
      "latte",
    );

    if (linkCompletion) {
      return lattePresenterLinkCompletions(
        {
          cache: presenterCache,
          deps,
          inFlight: presenterInFlight,
          isRequestedRootActive,
          requestedRoot,
        },
        linkCompletion,
      );
    }

    const controlCompletion = latteControlCompletionAt(source, offset);

    if (controlCompletion) {
      return latteControlCompletions(
        {
          componentCache,
          deps,
          isRequestedRootActive,
          requestedRoot,
        },
        controlCompletion,
      );
    }

    return latteExpressionCompletions(
      {
        deps,
        isRequestedRootActive,
        requestedRoot,
        viewDataCache,
        viewDataInFlight,
      },
      source,
      offset,
    );
  };

  const provideNettePhpLinkDefinition = async (
    source: string,
    offset: number,
  ): Promise<boolean> => {
    const deps = getDependencies();
    evictOtherRootCacheEntries(templateCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(viewDataCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(presenterCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(componentCache, deps.workspaceRoot);

    if (!isLatteSemanticActive(deps)) {
      return false;
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return false;
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
    const detection = detectPhpPresenterLinkAt(source, offset);

    if (detection) {
      return resolveNettePresenterLink(
        deps,
        requestedRoot,
        isRequestedRootActive,
        parseNetteLinkTarget(detection.target),
        currentTemplatePath(deps, requestedRoot),
        detection.target,
      );
    }

    return resolveNetteCreateComponentReverse(
      deps,
      requestedRoot,
      isRequestedRootActive,
      detectNetteCreateComponentAt(source, offset),
      source,
      currentTemplatePath(deps, requestedRoot),
    );
  };

  return {
    provideLatteCompletions,
    provideLatteDefinition,
    provideNettePhpLinkDefinition,
  };
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
  const viewDataCacheRef = useRef<LatteViewDataCache>({});
  const presenterCacheRef = useRef<LattePresenterCache>({});
  const componentCacheRef = useRef<LatteComponentCache>({});
  const apiRef = useRef<LatteIntelligence | null>(null);

  if (!apiRef.current) {
    apiRef.current = createLatteIntelligence(
      () => dependenciesRef.current,
      templateCacheRef.current,
      viewDataCacheRef.current,
      presenterCacheRef.current,
      componentCacheRef.current,
    );
  }

  return apiRef.current;
}

function isLatteSemanticActive(deps: LatteIntelligenceDependencies): boolean {
  return deps.isNetteFrameworkActive && deps.isSemanticIntelligenceActive;
}

/**
 * Evicts every cached root except `requestedRoot` (spec §6b cache lifecycle):
 * with a single active project tab a per-root map holds at most one entry, so
 * switching projects - or closing the active one, `requestedRoot === null` -
 * no longer leaves a previous root's data cached forever. Called synchronously
 * at the very top of every async flow, before that flow's first `await`, so it
 * always runs against a guaranteed-fresh `requestedRoot` (no stale-await risk);
 * the per-cache TTL then bounds the staleness of whatever one entry remains.
 * Generic over the entry type so the template listing and the presenter
 * view-data cache share one eviction rule.
 */
function evictOtherRootCacheEntries<Entry>(
  cache: Record<string, Entry>,
  requestedRoot: string | null,
): void {
  for (const cachedRoot of Object.keys(cache)) {
    if (workspaceRootKeysEqual(cachedRoot, requestedRoot)) {
      continue;
    }

    delete cache[cachedRoot];
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

// --- presenter link navigation + completion (S7) ---------------------------

/** Everything one presenter link-target discovery pass threads down its chain. */
interface LattePresenterDiscoveryContext {
  cache: LattePresenterCache;
  deps: LatteIntelligenceDependencies;
  inFlight: LattePresenterInFlight;
  isRequestedRootActive: () => boolean;
  requestedRoot: string;
}

/**
 * Resolves a detected Latte `{link}` / `{plink}` / `n:href` target to its
 * presenter action / render / handle method and opens it. Returns `false` (so
 * the caller can fall through to template navigation) when the cursor is not on
 * a link target or the target is dynamic / `this` / unresolvable.
 */
async function resolveNetteLinkDefinition(
  deps: LatteIntelligenceDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  detection: ReturnType<typeof detectLatteLinkAt>,
  currentRelativePath: string,
): Promise<boolean> {
  if (!detection) {
    return false;
  }

  return resolveNettePresenterLink(
    deps,
    requestedRoot,
    isRequestedRootActive,
    parseNetteLinkTarget(detection.target),
    currentRelativePath,
    detection.target,
  );
}

/**
 * Shared resolution behind BOTH the Latte-link and PHP-link definition: maps a
 * parsed link target to its presenter class candidates (module-aware, both Nette
 * conventions), opens the FIRST that exists, and lands the cursor on the
 * matching `action*` / `render*` / `handle*` method (falling back to line 1 when
 * the presenter exists but the method is absent). Conservative: a dynamic /
 * `this` / method-less target opens nothing. Every await is followed by a
 * live-root re-check so a tab switch drops the result.
 */
async function resolveNettePresenterLink(
  deps: LatteIntelligenceDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  parsed: NetteLinkTarget | null,
  currentRelativePath: string,
  label: string,
): Promise<boolean> {
  if (!parsed || parsed.action === NETTE_THIS_ACTION) {
    return false;
  }

  const methodNames = nettePresenterActionMethodCandidates(
    parsed.action,
    parsed.isSignal,
  );

  if (methodNames.length === 0) {
    return false;
  }

  const candidatePaths = nettePresenterClassCandidatePathsForLink(
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

/**
 * The editor position of the FIRST of `methodNames` declared in `source`
 * (candidates arrive in Nette lifecycle order - `action*` before `render*`), or
 * `null` when none is present. A single non-backtracking regex per name; the
 * cursor lands on the method name itself.
 */
function phpMethodPositionInSource(
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

/**
 * `Presenter:action` link-target completions from the per-root presenter
 * discovery, filtered by the typed prefix. The discovery is lazy + cached +
 * in-flight-collapsed (spec §6b), and the post-await live-root re-check drops a
 * switched project's result.
 */
async function lattePresenterLinkCompletions(
  context: LattePresenterDiscoveryContext,
  completion: { prefix: string; replaceEnd: number; replaceStart: number },
): Promise<LatteCompletionItem[]> {
  const targets = await loadNettePresenterLinkTargets(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return targets
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

/**
 * Loads (and per-root caches) the discovered `Presenter:action` targets.
 * Concurrent callers for the same root share one in-flight scan (Monaco fires a
 * completion per keystroke), mirroring the view-data loader.
 */
async function loadNettePresenterLinkTargets(
  context: LattePresenterDiscoveryContext,
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

/**
 * The presenter discovery scan: a bounded walk of `app` collecting
 * `*Presenter.php` files (reusing the template scan's depth / count / skip-list
 * bounds), then a cheap per-file regex extracting each presenter's
 * `Presenter:action` targets. Per-project isolation: `requestedRoot` was
 * captured by the caller and is re-checked after EVERY await; a stale root drops
 * the result without writing the cache.
 */
async function scanNettePresenterLinkTargets(
  context: LattePresenterDiscoveryContext,
): Promise<string[]> {
  const { cache, deps, isRequestedRootActive, requestedRoot } = context;
  const presenterPaths = new Set<string>();
  const scanState: LatteTemplateScanState = {
    templatesFound: 0,
    visitedDirectories: new Set<string>(),
  };

  for (const directory of LATTE_PRESENTER_SCAN_DIRECTORIES) {
    await collectNettePresenterPaths(
      deps,
      deps.joinPath(requestedRoot, directory),
      presenterPaths,
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

    for (const target of nettePresenterLinkTargetsFromSource(path, content)) {
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
    expiresAt: Date.now() + LATTE_PRESENTER_CACHE_TTL_MS,
    targets: sorted,
  };

  return sorted;
}

/**
 * Recursively walks one scan-root directory collecting `*Presenter.php` file
 * paths, bounded on the same three axes as the template scan (spec §6b): depth,
 * total count, and a visited-directory set. Deterministic: exceeding a bound
 * stops that branch and returns whatever was already collected.
 */
async function collectNettePresenterPaths(
  deps: LatteIntelligenceDependencies,
  directory: string,
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

      await collectNettePresenterPaths(
        deps,
        entry.path,
        into,
        isRequestedRootActive,
        depth + 1,
        scanState,
      );
      continue;
    }

    if (!entry.path.endsWith(PRESENTER_SUFFIX)) {
      continue;
    }

    into.add(entry.path);
    scanState.templatesFound += 1;
  }
}

/**
 * The concrete `Presenter:action` link targets declared by one presenter source:
 * `render*` / `action*` yield `<Short>:<action>`, `handle*` yields the signal
 * form `<Short>:<action>!`. Bare `render()` / `action()` are skipped (their
 * action is unknowable). `<Short>` is the file's presenter short name.
 */
function nettePresenterLinkTargetsFromSource(
  presenterPath: string,
  source: string,
): string[] {
  const shortName = nettePresenterShortNameFromPath(presenterPath);

  if (!shortName) {
    return [];
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

  return targets;
}

function nettePresenterShortNameFromPath(presenterPath: string): string | null {
  const fileName = presenterPath.split("/").pop() ?? "";

  if (!fileName.endsWith(PRESENTER_SUFFIX)) {
    return null;
  }

  const shortName = fileName.slice(0, -PRESENTER_SUFFIX.length);

  return shortName.length > 0 ? shortName : null;
}

// --- {control} component navigation + completion (Fáza 2) ------------------

/** Everything one `{control}` completion request threads down its chain. */
interface LatteComponentCompletionContext {
  componentCache: LatteComponentCache;
  deps: LatteIntelligenceDependencies;
  isRequestedRootActive: () => boolean;
  requestedRoot: string;
}

/** A `{control <name>}` completion cursor: the partial name + its replace span. */
interface LatteControlCompletion {
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

/**
 * The Nette component name the cursor names, from either a `{control <name>}`
 * macro or a `<form n:name="<name>">` attribute, or `null`. A form's `n:name`
 * names a COMPONENT (resolves to `createComponent<Name>`); an input / select /
 * button field's `n:name` names a form FIELD, not a factory, so only `form`
 * elements are treated as component references here. A dynamic / masked / non-form
 * position yields `null` (both detectors are conservative and quote-aware).
 */
function netteControlComponentNameAt(
  source: string,
  offset: number,
): string | null {
  const control = detectLatteControlAt(source, offset);

  if (control) {
    return control.name;
  }

  const formName = detectLatteFormNameAt(source, offset);

  if (formName && formName.elementTag === "form") {
    return formName.name;
  }

  return null;
}

/**
 * Navigates a `{control <name>}` / `<form n:name="<name>">` reference to the
 * backing `createComponent<Name>` factory method in the current template's
 * presenter, and opens it at the method name. Conservative: the factory is
 * resolved ONLY when it is declared DIRECTLY in a candidate presenter file - a
 * component whose factory lives in a trait or a parent class is intentionally
 * NOT resolved (a later slice can widen this) and falls through to `false`, so a
 * missing direct factory never produces a misleading line-1 jump. Every await is
 * followed by a live-root re-check so a tab switch drops the result.
 */
async function resolveNetteControlDefinition(
  deps: LatteIntelligenceDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  componentName: string | null,
  currentRelativePath: string,
): Promise<boolean> {
  if (!componentName) {
    return false;
  }

  const methodName = netteCreateComponentMethodName(componentName);
  const candidatePaths = presenterCandidatePathsForTemplate(currentRelativePath);

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

    const position = phpMethodPositionInSource(content, [methodName]);

    if (!position) {
      // Presenter exists but the factory is not declared directly here (it may
      // live in a trait / parent - conservatively unresolved). Try the next
      // candidate rather than jumping to a misleading line 1.
      continue;
    }

    return deps.openTarget(path, position, componentName);
  }

  return false;
}

/**
 * Detects a `{control <prefix>}` completion cursor: the cursor sits inside a
 * `{control ...}` tag's FIRST (name) argument while a static identifier is being
 * typed. Returns `null` for the render-variant part (`{control x:<here>}`), a
 * dynamic `{control $x}`, or any non-`control` tag - so the component list is
 * only offered where a component name belongs.
 */
function latteControlCompletionAt(
  source: string,
  offset: number,
): LatteControlCompletion | null {
  const span = innermostLatteExpressionSpanAt(source, offset);

  if (!span || span.tagName !== "control" || offset < span.expressionStart) {
    return null;
  }

  const typed = source.slice(span.expressionStart, offset);

  // Only while typing the bare name: identifier characters (or nothing yet). A
  // `:` (render part), `$` (dynamic), space, or filter pipe disqualifies it.
  if (!/^[A-Za-z_][A-Za-z0-9_]*$|^$/.test(typed)) {
    return null;
  }

  return { prefix: typed, replaceEnd: offset, replaceStart: span.expressionStart };
}

/**
 * `{control <name>}` completion: the current presenter's `createComponent*`
 * component names, filtered by the typed prefix. The presenter scan is lazy +
 * per-root cached (keyed to the active template), and the post-await live-root
 * re-check drops a switched project's result.
 */
async function latteControlCompletions(
  context: LatteComponentCompletionContext,
  completion: LatteControlCompletion,
): Promise<LatteCompletionItem[]> {
  const names = await loadNettePresenterComponentNames(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((name) => ({
      detail: "Nette component",
      insertText: name,
      kind: "component" as const,
      label: name,
      replaceEnd: completion.replaceEnd,
      replaceStart: completion.replaceStart,
    }));
}

/**
 * Loads (and per-root caches) the CURRENT presenter's component names for
 * `{control}` completion. The cache holds one entry per root, keyed to the
 * active template it was scanned for, so re-typing in the same template reuses
 * the scan while switching template re-scans. A missing / factory-less presenter
 * yields `[]` (cached, so the miss is not re-scanned per keystroke).
 */
async function loadNettePresenterComponentNames(
  context: LatteComponentCompletionContext,
): Promise<string[]> {
  const { componentCache, deps, isRequestedRootActive, requestedRoot } = context;
  const templateRelativePath = currentTemplatePath(deps, requestedRoot);
  const cached = componentCache[requestedRoot];

  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.templateRelativePath === templateRelativePath
  ) {
    return cached.componentNames;
  }

  const componentNames = await scanNettePresenterComponentNames(
    deps,
    requestedRoot,
    isRequestedRootActive,
    templateRelativePath,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  componentCache[requestedRoot] = {
    componentNames,
    expiresAt: Date.now() + LATTE_COMPONENT_CACHE_TTL_MS,
    templateRelativePath,
  };

  return componentNames;
}

/**
 * Scans the current template's presenter (first candidate that exists) for its
 * `createComponent*` factories, returning the component names (lower-camel).
 * Per-project isolation: `requestedRoot` was captured up front and is re-checked
 * after every await; a stale root drops the result.
 */
async function scanNettePresenterComponentNames(
  deps: LatteIntelligenceDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  templateRelativePath: string,
): Promise<string[]> {
  for (const relativePath of presenterCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return [];
    }

    const path = deps.joinPath(requestedRoot, relativePath);
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

    return netteComponentNamesFromPresenter(content);
  }

  return [];
}

/** The lower-camel component names of every `createComponent*` factory in a presenter. */
function netteComponentNamesFromPresenter(source: string): string[] {
  const names: string[] = [];

  for (const entry of nettePresenterLifecycleInfo(source).lifecycle) {
    if (entry.kind === "createComponent" && entry.name) {
      names.push(entry.name);
    }
  }

  return Array.from(new Set(names)).sort((left, right) =>
    left.localeCompare(right),
  );
}

/**
 * Reverse of `{control}` navigation (spec §9 / Fáza 2): a cursor on a
 * `createComponent<Name>` method in a presenter jumps to the FIRST `{control}` /
 * `n:name` / `$this['name']` usage of that component across the presenter's
 * templates. Conservative: no usage anywhere resolves to `false`. Templates are
 * the candidate paths for each of the presenter's views (`render*` / `action*`
 * plus the default view). Every await is followed by a live-root re-check.
 */
async function resolveNetteCreateComponentReverse(
  deps: LatteIntelligenceDependencies,
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  detection: ReturnType<typeof detectNetteCreateComponentAt>,
  presenterSource: string,
  presenterRelativePath: string,
): Promise<boolean> {
  if (!detection || presenterRelativePath.length === 0) {
    return false;
  }

  for (const relativePath of presenterTemplateCandidatesForViews(
    presenterRelativePath,
    presenterViewNames(presenterSource),
  )) {
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

    const usages = netteComponentUsagesInLatte(content, detection.componentName);
    const firstUsage = usages[0];

    if (!firstUsage) {
      continue;
    }

    return deps.openTarget(
      path,
      editorPositionAtOffset(content, firstUsage.start),
      detection.componentName,
    );
  }

  return false;
}

/**
 * The view names a presenter renders - each `render*` / `action*` method's view,
 * plus the Nette default view - so the reverse `{control}` search covers every
 * template the presenter can render a component into. Derived from the presenter
 * source's lifecycle classification (bare `render()` / `action()` carry no view
 * and are already omitted by the classifier).
 */
function presenterViewNames(presenterSource: string): string[] {
  const views = new Set<string>(["default"]);

  for (const entry of nettePresenterLifecycleInfo(presenterSource).lifecycle) {
    if ((entry.kind === "render" || entry.kind === "action") && entry.name) {
      views.add(entry.name);
    }
  }

  return Array.from(views);
}

/**
 * The candidate template relative paths a component usage could live in: for each
 * of the presenter's `views`, the modern-sibling / classic template candidates,
 * flattened and de-duplicated in deterministic order.
 */
function presenterTemplateCandidatesForViews(
  presenterRelativePath: string,
  views: readonly string[],
): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];

  for (const view of views) {
    for (const candidate of presenterTemplateCandidatePaths(
      presenterRelativePath,
      view,
    )) {
      if (seen.has(candidate)) {
        continue;
      }

      seen.add(candidate);
      paths.push(candidate);
    }
  }

  return paths;
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

// --- expression completions (member / filter / variable) -------------------

/**
 * Completions inside a Latte PHP-like expression (`{$...}`, `{if ...}`,
 * `{foreach ...}`, `{= ...}`): `{$var->}` member access, a `|filter` name, or
 * the `{$var}` template-variable list - in that precedence order. Inert unless
 * the cursor sits inside a real expression tag (guarded by
 * `innermostLatteExpressionSpanAt`, which already masks comments,
 * `{syntax off}`, `{l}`/`{r}` and JS/CSS braces), so plain markup and the tag
 * body of a `{* comment *}` yield nothing.
 */
async function latteExpressionCompletions(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
): Promise<LatteCompletionItem[]> {
  const span = innermostLatteExpressionSpanAt(source, offset);

  if (!span) {
    return [];
  }

  const before = source.slice(span.contentStart, offset);

  // A `$` / `->` / `|` inside a string literal within the expression is data,
  // not syntax - no completion popup inside `{var $a = 'x|'}`'s quotes.
  if (hasUnclosedStringLiteral(before)) {
    return [];
  }

  const member = latteMemberAccessAt(before, offset);

  if (member) {
    return latteMemberCompletions(context, source, offset, member);
  }

  const filter = latteFilterAt(before, offset);

  if (filter) {
    return latteFilterCompletions(filter);
  }

  const variable = latteVariableCompletionAt(before, offset);

  if (variable) {
    return latteVariableCompletions(context, source, offset, variable);
  }

  return [];
}

/**
 * True when `before` (an expression-tag slice ending at the cursor) has an
 * unterminated `'...'` / `"..."` literal, i.e. the cursor sits inside a string.
 * Single bounded pass with escape handling, mirroring the quote tracking the
 * domain's `stripLatteFilterChain` uses.
 */
function hasUnclosedStringLiteral(before: string): boolean {
  let quote: string | null = null;
  let index = 0;

  while (index < before.length) {
    const char = before[index];

    if (quote) {
      if (char === "\\") {
        index += 2;
        continue;
      }

      if (char === quote) {
        quote = null;
      }

      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
    }

    index += 1;
  }

  return quote !== null;
}

interface LatteMemberAccess {
  end: number;
  prefix: string;
  receiverExpression: string;
  start: number;
  variableName: string;
}

const LATTE_MEMBER_ACCESS =
  /(\$([A-Za-z_][A-Za-z0-9_]*)(?:\s*\??->\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*\??->\s*([A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Detects a `{$var->}` / `{$var->rel->prop}` member access ending at `offset`
 * from `before` (the expression-tag slice up to the cursor, already confirmed
 * to sit outside string literals). `receiverExpression` is the chain up to the
 * last `->` (whitespace / nullsafe `?->` normalized to `->`), so the injected
 * PHP engine resolves it exactly like Blade's `$var->`; `prefix` is the partial
 * member being typed.
 */
function latteMemberAccessAt(
  before: string,
  offset: number,
): LatteMemberAccess | null {
  const match = LATTE_MEMBER_ACCESS.exec(before);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  const prefix = match[3] ?? "";

  return {
    end: offset,
    prefix,
    receiverExpression: match[1].replace(/\s*\??->\s*/g, "->"),
    start: offset - prefix.length,
    variableName: match[2],
  };
}

interface LatteFilterCompletionContext {
  end: number;
  prefix: string;
  start: number;
}

const LATTE_FILTER_TAIL = /\|\s*([A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Detects a `|filter` name being typed at `offset` from `before` (the
 * expression-tag slice up to the cursor, already confirmed outside string
 * literals). Rejects a `||` logical-or so it never offers filters after a
 * boolean expression.
 */
function latteFilterAt(
  before: string,
  offset: number,
): LatteFilterCompletionContext | null {
  const match = LATTE_FILTER_TAIL.exec(before);

  if (!match) {
    return null;
  }

  if (before[match.index - 1] === "|") {
    return null;
  }

  const prefix = match[1] ?? "";

  return { end: offset, prefix, start: offset - prefix.length };
}

interface LatteVariableCompletionContext {
  end: number;
  prefix: string;
  start: number;
}

const LATTE_VARIABLE_TAIL = /(?<![A-Za-z0-9_>])\$([A-Za-z_][A-Za-z0-9_]*)?$/;

/**
 * Detects a `$var` reference being typed at `offset` from `before` (the
 * expression-tag slice up to the cursor, already confirmed outside string
 * literals; not part of a `->` member chain - the lookbehind rejects a `$`
 * preceded by a word char or `>`).
 */
function latteVariableCompletionAt(
  before: string,
  offset: number,
): LatteVariableCompletionContext | null {
  const match = LATTE_VARIABLE_TAIL.exec(before);

  if (!match) {
    return null;
  }

  const prefix = match[1] ?? "";

  return { end: offset, prefix, start: offset - prefix.length - 1 };
}

/**
 * `{$var->}` member completion: resolve the receiver variable's type through the
 * priority sources (§4.4), synthesize a typed PHP document, then dispatch to the
 * injected PHP member-completion engine - identical to the Blade path. Every
 * `await` is followed by a live-root re-check so a tab switch drops the result.
 */
async function latteMemberCompletions(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  member: LatteMemberAccess,
): Promise<LatteCompletionItem[]> {
  const { deps, isRequestedRootActive } = context;
  const receiverType = await resolveLatteVariableType(
    context,
    source,
    offset,
    member.variableName,
    0,
  );

  if (!isRequestedRootActive() || !receiverType) {
    return [];
  }

  const synthetic = deps.synthesizeTypedReceiverSource(
    member.variableName,
    receiverType,
  );
  const members = await deps.resolvePhpReceiverCompletions(
    synthetic.source,
    synthetic.position,
    member.receiverExpression,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = member.prefix.toLowerCase();

  return orderPhpMemberCompletionsByCategory(members)
    .filter((entry) => entry.name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((entry) => latteMemberCompletionItem(entry, member.start, member.end));
}

/** `|filter` completion from the static Latte 3 built-in filter list. */
function latteFilterCompletions(
  filter: LatteFilterCompletionContext,
): LatteCompletionItem[] {
  const normalizedPrefix = filter.prefix.toLowerCase();

  return LATTE_BUILTIN_FILTERS.filter((name) =>
    name.toLowerCase().startsWith(normalizedPrefix),
  )
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((name) => ({
      detail: "Latte filter",
      insertText: name,
      kind: "filter" as const,
      label: name,
      replaceEnd: filter.end,
      replaceStart: filter.start,
    }));
}

/**
 * `{$var}` variable list: every template variable in scope (inline declarations,
 * enclosing `{foreach}` loop bindings, presenter view-data) with a cheap display
 * type. Full expression-type inference is intentionally NOT run per name here
 * (spec §6b lazy) - it runs only on member completion for the ONE variable the
 * user drills into.
 */
async function latteVariableCompletions(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  variable: LatteVariableCompletionContext,
): Promise<LatteCompletionItem[]> {
  const candidates = await collectLatteVariableCandidates(context, source, offset);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = `$${variable.prefix.toLowerCase()}`;

  return candidates
    .filter((candidate) =>
      candidate.name.toLowerCase().startsWith(normalizedPrefix),
    )
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((candidate) => ({
      detail: candidate.typeHint
        ? `${candidate.detail} · ${candidate.typeHint}`
        : candidate.detail,
      insertText: candidate.name,
      kind: "variable" as const,
      label: candidate.name,
      replaceEnd: variable.end,
      replaceStart: variable.start,
    }));
}

interface LatteVariableCandidate {
  detail: string;
  name: string;
  typeHint: string | null;
}

/**
 * Gathers the in-scope template variables for the `{$}` list, first sighting of
 * a name wins (declarations > loop bindings > presenter data), matching the
 * resolution precedence used for member completion.
 */
async function collectLatteVariableCandidates(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
): Promise<LatteVariableCandidate[]> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const byName = new Map<string, LatteVariableCandidate>();
  const add = (name: string, detail: string, typeHint: string | null) => {
    if (byName.has(name)) {
      return;
    }

    byName.set(name, { detail, name, typeHint });
  };

  for (const declaration of latteVariableDeclarations(source)) {
    if (!declaration.variableName) {
      continue;
    }

    const declaredType =
      declaration.kind === "varType" || declaration.kind === "parameters"
        ? declaration.typeName
        : null;

    add(
      `$${declaration.variableName}`,
      `template ${declaration.kind}`,
      shortTypeName(declaredType),
    );
  }

  for (const binding of latteForeachLoopBindingsAt(source, offset)) {
    add(`$${binding.loopVariableName}`, "foreach item", null);

    if (binding.keyVariableName) {
      add(`$${binding.keyVariableName}`, "foreach key", null);
    }
  }

  const entries = await loadNetteViewDataEntries(context);

  if (!isRequestedRootActive()) {
    return [];
  }

  const viewNames = latteCandidateViewNames(deps, requestedRoot);

  for (const variable of netteViewDataVariablesForViews(entries, viewNames)) {
    add(variable.name, "presenter data", shortTypeName(variable.typeHint));
  }

  return Array.from(byName.values());
}

/**
 * Resolves the receiver type of a Latte variable through the §4.4 priority
 * chain: (1) `{varType}` / `{parameters}` inline type, (2) `{var}` / `{default}`
 * local expression, (3) presenter view-data, (4) enclosing `{foreach}` element
 * type. Bounded by `MAX_LATTE_TYPE_RESOLUTION_DEPTH` (foreach root variables
 * recurse). Conservative: an unresolved variable yields `null`, never a guess.
 */
async function resolveLatteVariableType(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  variableName: string,
  depth: number,
): Promise<string | null> {
  const { isRequestedRootActive } = context;

  if (depth > MAX_LATTE_TYPE_RESOLUTION_DEPTH) {
    return null;
  }

  const declaredType = latteDeclaredVariableType(source, variableName);

  if (declaredType) {
    return declaredType;
  }

  const localType = await latteLocalVariableType(context, source, variableName);

  if (!isRequestedRootActive()) {
    return null;
  }

  if (localType) {
    return localType;
  }

  const presenterType = await lattePresenterVariableType(context, variableName);

  if (!isRequestedRootActive()) {
    return null;
  }

  if (presenterType) {
    return presenterType;
  }

  return latteForeachVariableType(context, source, offset, variableName, depth);
}

/** Priority 1: the first `{varType}` / `{parameters}` type for the variable. */
function latteDeclaredVariableType(
  source: string,
  variableName: string,
): string | null {
  for (const declaration of latteVariableDeclarations(source)) {
    if (declaration.kind !== "varType" && declaration.kind !== "parameters") {
      continue;
    }

    if (declaration.variableName === variableName && declaration.typeName) {
      return declaration.typeName;
    }
  }

  return null;
}

/** Priority 2: the resolved type of a `{var}` / `{default}` value expression. */
async function latteLocalVariableType(
  context: LatteExpressionResolutionContext,
  source: string,
  variableName: string,
): Promise<string | null> {
  const { deps, isRequestedRootActive } = context;

  for (const declaration of latteVariableDeclarations(source)) {
    if (declaration.kind !== "var" && declaration.kind !== "default") {
      continue;
    }

    if (declaration.variableName !== variableName || !declaration.expression) {
      continue;
    }

    const document = `<?php\n${declaration.expression};\n`;
    const type = await deps.resolveExpressionType(
      document,
      endPositionOf(document),
      declaration.expression,
    );

    // Live-root re-check after the engine await: a switched root stops the
    // per-declaration loop from burning further engine calls.
    if (!isRequestedRootActive()) {
      return null;
    }

    if (type) {
      return type;
    }
  }

  return null;
}

/** Priority 3: the merged type across the presenter sightings for the variable. */
async function lattePresenterVariableType(
  context: LatteExpressionResolutionContext,
  variableName: string,
): Promise<string | null> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const entries = await loadNetteViewDataEntries(context);

  if (!isRequestedRootActive() || entries.length === 0) {
    return null;
  }

  const viewNames = latteCandidateViewNames(deps, requestedRoot);
  const target = `$${variableName}`;
  const sightings: Array<{
    source: string;
    variable: PhpFrameworkViewDataVariable;
  }> = [];

  for (const entry of entries) {
    for (const binding of entry.bindings) {
      if (!matchesLatteViewName(binding.viewName, viewNames)) {
        continue;
      }

      for (const variable of binding.variables) {
        if (variable.name === target) {
          sightings.push({ source: entry.source, variable });
        }
      }
    }
  }

  if (sightings.length === 0) {
    return null;
  }

  const resolved: (string | null)[] = [];

  for (const sighting of sightings) {
    resolved.push(await resolveNetteSightingType(deps, sighting));

    if (!isRequestedRootActive()) {
      return null;
    }
  }

  return mergeLatteResolvedTypes(resolved);
}

/** Priority 4: the element type of the innermost `{foreach}` binding the variable belongs to. */
async function latteForeachVariableType(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  variableName: string,
  depth: number,
): Promise<string | null> {
  const { deps, isRequestedRootActive } = context;
  let collectionExpression: string | null = null;

  // Bindings arrive outermost-first, so the LAST match is the innermost loop.
  for (const binding of latteForeachLoopBindingsAt(source, offset)) {
    if (binding.loopVariableName === variableName) {
      collectionExpression = binding.collectionExpression;
    }
  }

  if (collectionExpression === null) {
    return null;
  }

  const collection = parseLatteForeachCollection(collectionExpression);

  if (!collection || collection.rootVariableName === variableName) {
    return null;
  }

  const rootType = await resolveLatteVariableType(
    context,
    source,
    offset,
    collection.rootVariableName,
    depth + 1,
  );

  if (!isRequestedRootActive() || !rootType) {
    return null;
  }

  if (collection.relationNames.length === 0) {
    return extractLatteElementType(rootType);
  }

  const chainExpression = `$${collection.rootVariableName}${collection.relationNames
    .map((relation) => `->${relation}`)
    .join("")}`;
  const document = `<?php\n/** @var \\${rootType.replace(/^\\+/, "")} $${
    collection.rootVariableName
  } */\n${chainExpression};\n`;
  const chainType = await deps.resolveExpressionType(
    document,
    endPositionOf(document),
    chainExpression,
  );

  if (!isRequestedRootActive() || !chainType) {
    return null;
  }

  return extractLatteElementType(chainType);
}

/**
 * Loads (and per-root caches) the Nette presenter/control view-data entries.
 * Concurrent callers for the same root share one in-flight scan (Monaco fires a
 * completion per keystroke - without the registry each keystroke would launch
 * its own full text search + file-read sweep, mirroring the controller's Blade
 * `bladeViewDataEntriesLoadInFlightRef` pattern).
 */
async function loadNetteViewDataEntries(
  context: LatteExpressionResolutionContext,
): Promise<PhpFrameworkViewDataEntry[]> {
  const { requestedRoot, viewDataCache, viewDataInFlight } = context;
  const cached = viewDataCache[requestedRoot];

  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries;
  }

  const inFlight = viewDataInFlight.get(requestedRoot);

  if (inFlight) {
    return inFlight;
  }

  const load = scanNetteViewDataEntries(context).finally(() => {
    if (viewDataInFlight.get(requestedRoot) === load) {
      viewDataInFlight.delete(requestedRoot);
    }
  });

  viewDataInFlight.set(requestedRoot, load);

  return load;
}

/**
 * The actual view-data scan: one text search per anchor, each unique PHP hit
 * parsed once. Per-project isolation: `requestedRoot` was captured by the
 * caller and is re-checked after EVERY await; a stale root drops the result
 * without writing the cache.
 */
async function scanNetteViewDataEntries(
  context: LatteExpressionResolutionContext,
): Promise<PhpFrameworkViewDataEntry[]> {
  const { deps, isRequestedRootActive, requestedRoot, viewDataCache } = context;

  const searchResults = await Promise.all(
    NETTE_VIEW_DATA_SEARCH_QUERIES.map((query) =>
      deps.searchText(requestedRoot, query, LATTE_VIEW_DATA_SEARCH_LIMIT),
    ),
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  const visitedPaths = new Set<string>();
  const entries: PhpFrameworkViewDataEntry[] = [];

  for (const result of searchResults.flat()) {
    if (!isRequestedRootActive()) {
      return [];
    }

    if (visitedPaths.has(result.path) || !result.path.endsWith(PHP_EXTENSION)) {
      continue;
    }

    visitedPaths.add(result.path);

    let content: string;

    try {
      content = await deps.readFileContent(result.path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    const entry = netteViewDataEntryFromSource(content);

    if (entry.bindings.length > 0) {
      entries.push(entry);
    }
  }

  if (!isRequestedRootActive()) {
    return [];
  }

  viewDataCache[requestedRoot] = {
    entries,
    expiresAt: Date.now() + LATTE_VIEW_DATA_CACHE_TTL_MS,
  };

  return entries;
}

/**
 * The `"<Presenter>:<action>"` view names that could render the active template,
 * plus the `"<Presenter>:*"` wildcard the extractor emits for helper methods
 * (`beforeRender`, bare `render()`), so a variable shared across every action is
 * matched too. Derived from the template path via the inverse presenter mapping.
 *
 * SCOPE: presenters only. The extractor also emits bindings for `*Control`
 * classes, but a component's template lives beside its `SomethingControl.php`
 * with no path-mapping convention this inverse lookup covers yet, so control
 * templates get no presenter data in this slice - component/control template
 * intelligence is the spec's Phase 2 (`createComponent*` factories, §9).
 */
function latteCandidateViewNames(
  deps: LatteIntelligenceDependencies,
  requestedRoot: string,
): string[] {
  const templateRelativePath = currentTemplatePath(deps, requestedRoot);

  if (!templateRelativePath) {
    return [];
  }

  const action = latteActionFromTemplatePath(templateRelativePath);
  const names = new Set<string>();

  for (const presenterPath of presenterCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    const fileName = presenterPath.split("/").pop() ?? "";

    if (!fileName.endsWith(PRESENTER_SUFFIX)) {
      continue;
    }

    const shortName = fileName.slice(0, -PRESENTER_SUFFIX.length);

    names.add(`${shortName}:${action}`);
    names.add(`${shortName}:*`);
  }

  return Array.from(names);
}

/**
 * The view/action name a template file renders: the base name without the
 * `.latte` extension, and for the classic dotted `Product.show.latte` form the
 * segment after the final dot (`show`).
 */
function latteActionFromTemplatePath(templateRelativePath: string): string {
  const fileName = templateRelativePath.split("/").pop() ?? "";
  const base = fileName.endsWith(LATTE_TEMPLATE_EXTENSION)
    ? fileName.slice(0, -LATTE_TEMPLATE_EXTENSION.length)
    : fileName;
  const dotIndex = base.lastIndexOf(".");

  return dotIndex >= 0 ? base.slice(dotIndex + 1) : base;
}

function matchesLatteViewName(
  bindingViewName: string,
  candidateViewNames: readonly string[],
): boolean {
  return candidateViewNames.includes(bindingViewName);
}

function netteViewDataVariablesForViews(
  entries: readonly PhpFrameworkViewDataEntry[],
  viewNames: readonly string[],
): PhpFrameworkViewDataVariable[] {
  const variables: PhpFrameworkViewDataVariable[] = [];

  for (const entry of entries) {
    for (const binding of entry.bindings) {
      if (!matchesLatteViewName(binding.viewName, viewNames)) {
        continue;
      }

      variables.push(...binding.variables);
    }
  }

  return variables;
}

/**
 * The type of one presenter sighting: full expression inference on its
 * `valueExpression` (resolved in the presenter source at the value offset), then
 * the cheap declared `typeHint` as a fallback - mirroring the Blade view-data
 * resolver. The fallback hint is a SHORT name as written in the presenter, so it
 * is resolved through `resolveDeclaredType` against that source's namespace /
 * use-statements before use - a raw `Product` must never be treated as a
 * root-namespace `\Product` (wrong-class completions) nor mismatch an
 * engine-resolved FQN from another sighting in the conservative merge.
 */
async function resolveNetteSightingType(
  deps: LatteIntelligenceDependencies,
  sighting: { source: string; variable: PhpFrameworkViewDataVariable },
): Promise<string | null> {
  const { source, variable } = sighting;

  if (variable.valueExpression) {
    const expressionType = await deps.resolveExpressionType(
      source,
      editorPositionAtOffset(
        source,
        variable.valueOffset ?? source.length,
      ),
      variable.valueExpression,
    );

    if (expressionType) {
      return expressionType;
    }
  }

  return deps.resolveDeclaredType(source, variable.typeHint);
}

/**
 * Conservative merge of the types a variable resolved to across its presenter
 * sightings: unresolved sightings are ignored, but two DIFFERENT resolved types
 * conflict and yield `null` (no completions, no guessing).
 */
function mergeLatteResolvedTypes(types: readonly (string | null)[]): string | null {
  const resolved = types.filter((type): type is string => Boolean(type));

  if (resolved.length === 0) {
    return null;
  }

  const first = resolved[0] ?? "";
  const normalize = (type: string) =>
    type.trim().replace(/^\\+/, "").toLowerCase();

  return resolved.every((type) => normalize(type) === normalize(first))
    ? first
    : null;
}

/**
 * The element type of a collection type: `X[]` → `X`, a generic
 * `iterable<X>` / `Collection<int, X>` → its last type argument. A type with no
 * recognisable element shape yields `null` (conservative - no member completion
 * rather than a wrong one).
 */
function extractLatteElementType(collectionType: string): string | null {
  const trimmed = collectionType.trim();

  if (trimmed.endsWith("[]")) {
    const element = trimmed.slice(0, -2).trim();

    return element.length > 0 ? element : null;
  }

  const angleStart = trimmed.indexOf("<");

  if (angleStart < 0 || !trimmed.endsWith(">")) {
    return null;
  }

  const args = splitTopLevelTypeArguments(trimmed.slice(angleStart + 1, -1));
  const last = args[args.length - 1]?.trim() ?? "";

  return last.length > 0 ? last : null;
}

/** Splits generic type arguments on top-level commas, tracking nested `<>`. */
function splitTopLevelTypeArguments(inner: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < inner.length; index += 1) {
    const character = inner[index];

    if (character === "<") {
      depth += 1;
      continue;
    }

    if (character === ">") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      parts.push(inner.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(inner.slice(start));

  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function latteMemberCompletionItem(
  member: PhpMethodCompletion,
  start: number,
  end: number,
): LatteCompletionItem {
  return {
    detail: latteMemberCompletionDetail(member),
    insertText: latteMemberCompletionInsertText(member),
    kind: "member",
    label: member.name,
    replaceEnd: end,
    replaceStart: start,
  };
}

function latteMemberCompletionInsertText(member: PhpMethodCompletion): string {
  if (member.insertText) {
    return member.insertText;
  }

  if (member.kind === "property" || member.kind === "relation") {
    return member.name;
  }

  return `${member.name}()`;
}

function latteMemberCompletionDetail(member: PhpMethodCompletion): string {
  const returnType = member.returnType ? `: ${member.returnType}` : "";

  if (member.kind === "property" || member.kind === "relation") {
    return `${member.declaringClassName}::${member.name}${returnType}`;
  }

  const parameters = member.parameters ? `(${member.parameters})` : "()";

  return `${member.declaringClassName}::${member.name}${parameters}${returnType}`;
}

/** Short display name for a (possibly namespaced / generic) PHP type. */
function shortTypeName(typeName: string | null): string | null {
  if (!typeName) {
    return null;
  }

  const baseType = typeName.split("<")[0] ?? typeName;
  const segments = baseType.replace(/^\\+/, "").split("\\");
  const shortName = segments[segments.length - 1]?.trim() ?? "";

  return shortName.length > 0 ? shortName : null;
}

function endPositionOf(source: string): EditorPosition {
  return editorPositionAtOffset(source, source.length);
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
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
