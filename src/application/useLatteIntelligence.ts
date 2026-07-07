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
  detectNetteCreateComponentAt,
} from "../domain/netteComponents";
import {
  phpFrameworkViewDataEntryFromSource,
  phpFrameworkViewDataSearchQueries,
  phpFrameworkSupportsLattePresenterLinkIntelligence,
  phpFrameworkSupportsLatteTemplateIntelligence,
  type PhpFrameworkViewDataEntry,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  latteControlCompletionAt,
  latteControlCompletions,
  latteFormNameCompletionAt,
  netteControlReferenceAt,
  resolveNetteControlDefinition,
  resolveNetteCreateComponentReverse,
  type NetteControlCache,
} from "./netteControlComponents";
import {
  isNettePresenterDiscoverySourcePath,
  lattePresenterLinkCompletions,
  nettePresenterLinkTargetsFromSource,
  resolveNetteLinkDefinition,
  resolveNettePresenterLink,
  type NettePresenterCache,
  type NettePresenterInFlight,
} from "./nettePresenterLinks";
import {
  currentNetteControlClassName as resolveCurrentNetteControlClassName,
  currentNettePresenterClassName as resolveCurrentNettePresenterClassName,
  resolveNetteControlVariableDefinition as resolveNetteCurrentControlVariableDefinition,
} from "./netteCurrentClasses";
import {
  isLatteScanSkippedDirectory,
  latteTemplateCompletions,
  resolveLatteTemplateDefinition,
  type LatteDirectoryEntry,
  type LatteTemplateCache,
} from "./netteTemplates";
import {
  isLatteMemberReferenceAt,
} from "./latteExpressionDetection";
import {
  latteTagCompletions as buildLatteTagCompletions,
  type LatteCompletionItem,
} from "./latteCompletionItems";
import {
  resolveLatteBlockDefinition,
} from "./latteBlockDefinitions";
import {
  resolveLatteMemberDefinition as resolveLatteExpressionMemberDefinition,
  resolveNettePresenterVariableDefinition as resolveLattePresenterVariableDefinition,
} from "./latteExpressionDefinitions";
import {
  latteExpressionCompletions as resolveLatteExpressionCompletions,
} from "./latteExpressionCompletions";
import {
  latteCandidateViewNames as resolveLatteCandidateViewNames,
  loadNetteViewDataEntries,
  type NetteViewDataCache,
  type NetteViewDataEntry,
  type NetteViewDataInFlight,
} from "./netteViewDataEntries";
import {
  latteTemplateTypePropertySightings as netteTemplateTypePropertySightings,
  type LatteTemplateTypeCache,
  type LatteTemplateTypeInFlight,
} from "./netteTemplateTypes";
import {
  collectLatteVariableCandidates as collectNetteLatteVariableCandidates,
  resolveLatteVariableType as resolveNetteLatteVariableType,
  type LatteVariableCandidate,
} from "./latteVariableTypes";
import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
  evictOtherRootCacheEntries,
  isLattePresenterLinkIntelligenceActive,
  offsetAtEditorPosition,
} from "./latteIntelligenceRuntime";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

export type { LatteDirectoryEntry, LatteTemplateCache } from "./netteTemplates";
export type {
  LatteCompletionItem,
  LatteCompletionItemKind,
} from "./latteCompletionItems";

/** The minimal shape of the active editor document the hook reads (its path). */
export interface LatteIntelligenceActiveDocument {
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
  frameworkIntelligence: PhpFrameworkIntelligence;
  getActiveDocument(): LatteIntelligenceActiveDocument | null;
  isSemanticIntelligenceActive: boolean;
  joinPath(rootPath: string, relativePath: string): string;
  listDirectory(path: string): Promise<LatteDirectoryEntry[]>;
  openTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  openPhpMethodTarget(className: string, methodName: string): Promise<boolean>;
  openPhpPropertyTarget(
    className: string,
    propertyName: string,
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
  shouldBlockLatteDefinitionFallback(source: string, offset: number): boolean;
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
  /**
   * `Presenter:action` completion while typing a PHP presenter link
   * (`$this->link('...')`, `->redirect(...)`, `->forward(...)`, ...): the SAME
   * discovered target list `{link}` / `n:href` completion offers (shared cache,
   * see `lattePresenterLinkCompletions`), filtered by the typed prefix. Wired
   * into the Monaco `php` completion provider by the controller mount (a
   * dedicated context callback, mirroring `provideNettePhpLinkDefinition`);
   * inert outside a Nette semantic project.
   */
  provideNettePhpLinkCompletions(
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null>;
}

export interface LatteFrameworkCapabilities {
  detectLattePresenterLinkAt(
    source: string,
    offset: number,
  ): ReturnType<typeof detectLatteLinkAt>;
  detectPhpPresenterLinkAt(
    source: string,
    offset: number,
  ): ReturnType<typeof detectPhpPresenterLinkAt>;
  presenterLinkCompletionContextAt(
    source: string,
    offset: number,
    language: "latte" | "php",
  ): ReturnType<typeof nettePresenterLinkCompletionContextAt>;
  parsePresenterLinkTarget(target: string): NetteLinkTarget | null;
  presenterActionMethodCandidates(
    action: string,
    isSignal: boolean,
  ): string[];
  presenterClassCandidatePathsForLink(
    target: NetteLinkTarget,
    currentRelativePath: string,
  ): string[];
  presenterLinkTargetsFromSource(path: string, source: string): string[];
  presenterScanDirectories: readonly string[];
  isPresenterSourcePath(path: string): boolean;
  supportsLattePresenterLinkIntelligence(
    providers: readonly PhpFrameworkProvider[],
  ): boolean;
  supportsLatteTemplateIntelligence(
    providers: readonly PhpFrameworkProvider[],
  ): boolean;
  viewDataEntryFromSource(
    source: string,
    providers: readonly PhpFrameworkProvider[],
  ): PhpFrameworkViewDataEntry | null;
  viewDataSearchQueries(
    providers: readonly PhpFrameworkProvider[],
  ): readonly string[];
}

export const netteLatteFrameworkCapabilities: LatteFrameworkCapabilities = {
  detectLattePresenterLinkAt: detectLatteLinkAt,
  detectPhpPresenterLinkAt,
  parsePresenterLinkTarget: parseNetteLinkTarget,
  presenterActionMethodCandidates: nettePresenterActionMethodCandidates,
  presenterClassCandidatePathsForLink: nettePresenterClassCandidatePathsForLink,
  presenterLinkTargetsFromSource: nettePresenterLinkTargetsFromSource,
  presenterScanDirectories: ["app"],
  isPresenterSourcePath: isNettePresenterDiscoverySourcePath,
  presenterLinkCompletionContextAt: nettePresenterLinkCompletionContextAt,
  supportsLattePresenterLinkIntelligence:
    phpFrameworkSupportsLattePresenterLinkIntelligence,
  supportsLatteTemplateIntelligence:
    phpFrameworkSupportsLatteTemplateIntelligence,
  viewDataEntryFromSource: phpFrameworkViewDataEntryFromSource,
  viewDataSearchQueries: phpFrameworkViewDataSearchQueries,
};

export type LatteViewDataCache = NetteViewDataCache;
type LatteViewDataInFlight = NetteViewDataInFlight;
type LatteNetteViewDataEntry = NetteViewDataEntry;

/**
 * Everything one expression-completion request carries down the resolution
 * chain: the injected deps, the root captured up front, the live-root guard,
 * and the per-instance view-data cache + in-flight registry. Bundled so the
 * deep call chain (member completion → type priority chain → view-data load)
 * threads one value instead of five parallel parameters.
 */
interface LatteExpressionResolutionContext {
  deps: LatteIntelligenceDependencies;
  frameworkCapabilities: LatteFrameworkCapabilities;
  isRequestedRootActive: () => boolean;
  requestedRoot: string;
  templateTypeCache: LatteTemplateTypeCache;
  templateTypeInFlight: LatteTemplateTypeInFlight;
  viewDataCache: LatteViewDataCache;
  viewDataInFlight: LatteViewDataInFlight;
}

/**
 * Directories a Nette project keeps its templates under, covering both the
 * classic (`app/Presenters/templates`, top-level `templates`) and modern
 * (`app/UI/<Name>`) conventions without walking `vendor` / `node_modules`.
 */
const LATTE_TEMPLATE_SCAN_DIRECTORIES: readonly string[] = ["app", "templates"];

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
const LATTE_TEMPLATE_TYPE_SEARCH_LIMIT = 50;
const LATTE_TEMPLATE_TYPE_CACHE_TTL_MS = 5_000;

/**
 * Bound on the recursion that resolves a `{foreach}` element type through nested
 * loops / relation chains, so a pathological or self-referential template never
 * recurses without end. Exceeding it yields `null` (no completions), never a
 * hang.
 */
const MAX_LATTE_TYPE_RESOLUTION_DEPTH = 8;
const PHP_EXTENSION = ".php";
const PRESENTER_SUFFIX = "Presenter.php";
const CONTROL_SUFFIX = "Control.php";

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
 * Builds the Latte intelligence API from an accessor to the current
 * dependencies (read fresh on every call so gating flags and the workspace root
 * are always current) and a mutable per-root template cache. Exported for direct
 * unit testing; the React hook is a thin, stable wrapper around it.
 */
export function createLatteIntelligence(
  getDependencies: () => LatteIntelligenceDependencies,
  templateCache: LatteTemplateCache = {},
  viewDataCache: LatteViewDataCache = {},
  presenterCache: NettePresenterCache = {},
  componentCache: NetteControlCache = {},
  templateTypeCache: LatteTemplateTypeCache = {},
  frameworkCapabilities: LatteFrameworkCapabilities = netteLatteFrameworkCapabilities,
): LatteIntelligence {
  /**
   * Per-instance in-flight registry for the view-data loads, so concurrent
   * completion requests (Monaco fires one per keystroke) share ONE scan per
   * root instead of launching parallel full text searches. Entries self-delete
   * on settle; a lingering cross-root entry is harmless (keyed by root, joined
   * only by requests for that same root) so no eviction pass is needed.
   */
  const viewDataInFlight: LatteViewDataInFlight = new Map();
  const templateTypeInFlight: LatteTemplateTypeInFlight = new Map();
  /**
   * Per-instance in-flight registry for the presenter link-target discovery,
   * collapsing the completion-per-keystroke storm into one scan per root
   * (mirrors `viewDataInFlight`).
   */
  const presenterInFlight: NettePresenterInFlight = new Map();

  const provideLatteDefinition = async (
    source: string,
    offset: number,
  ): Promise<boolean> => {
    const deps = getDependencies();
    evictOtherRootCacheEntries(templateCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(viewDataCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(presenterCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(componentCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(templateTypeCache, deps.workspaceRoot);

    const workspaceContext = activeLatteWorkspaceContext(
      deps,
      frameworkCapabilities,
    );

    if (!workspaceContext) {
      return false;
    }

    const { isRequestedRootActive, requestedRoot } = workspaceContext;
    const currentTemplateRelativePath = currentTemplatePath(deps, requestedRoot);

    if (isLattePresenterLinkIntelligenceActive(deps, frameworkCapabilities)) {
      const linkHandled = await resolveNetteLinkDefinition(
        {
          currentRelativePath: currentTemplateRelativePath,
          deps,
          frameworkCapabilities,
          isDirectorySkipped: isLatteScanSkippedDirectory,
          isRequestedRootActive,
          maxDepth: MAX_LATTE_SCAN_DEPTH,
          maxPresenters: MAX_LATTE_TEMPLATE_FILES,
          requestedRoot,
        },
        frameworkCapabilities.detectLattePresenterLinkAt(source, offset),
      );

      if (linkHandled) {
        return true;
      }
    }

    const controlHandled = await resolveNetteControlDefinition(
      deps,
      requestedRoot,
      isRequestedRootActive,
      netteControlReferenceAt(source, offset),
      currentTemplateRelativePath,
    );

    if (controlHandled) {
      return true;
    }

    const variableHandled = await resolveNettePresenterVariableDefinition(
      {
        deps,
        frameworkCapabilities,
        isRequestedRootActive,
        requestedRoot,
        templateTypeCache,
        templateTypeInFlight,
        viewDataCache,
        viewDataInFlight,
      },
      source,
      offset,
    );

    if (variableHandled) {
      return true;
    }

    const memberHandled = await resolveLatteMemberDefinition(
      {
        deps,
        frameworkCapabilities,
        isRequestedRootActive,
        requestedRoot,
        templateTypeCache,
        templateTypeInFlight,
        viewDataCache,
        viewDataInFlight,
      },
      source,
      offset,
    );

    if (memberHandled) {
      return true;
    }

    const reference = detectLatteReferenceAt(source, offset);

    if (reference?.kind === "control") {
      return resolveNetteControlDefinition(
        deps,
        requestedRoot,
        isRequestedRootActive,
        { name: reference.name },
        currentTemplateRelativePath,
      );
    }

    if (reference?.kind === "block") {
      return resolveLatteBlockDefinition(
        deps,
        source,
        reference,
        currentTemplateRelativePath,
      );
    }

    if (reference && reference.kind !== "template") {
      return false;
    }

    return resolveLatteTemplateDefinition(
      {
        currentTemplateRelativePath,
        deps,
        isRequestedRootActive,
        requestedRoot,
      },
      reference,
      source,
      offset,
    );
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
    evictOtherRootCacheEntries(templateTypeCache, deps.workspaceRoot);

    const workspaceContext = activeLatteWorkspaceContext(
      deps,
      frameworkCapabilities,
    );

    if (!workspaceContext) {
      return [];
    }

    const { isRequestedRootActive, requestedRoot } = workspaceContext;
    const offset = offsetAtEditorPosition(source, position);
    const includeCompletion = detectLatteIncludeCompletionAt(source, offset);

    if (includeCompletion) {
      return latteTemplateCompletions(
        {
          cache: templateCache,
          currentTemplateRelativePath: currentTemplatePath(deps, requestedRoot),
          deps,
          isRequestedRootActive,
          maxCompletions: LATTE_MAX_COMPLETIONS,
          maxDepth: MAX_LATTE_SCAN_DEPTH,
          maxTemplates: MAX_LATTE_TEMPLATE_FILES,
          requestedRoot,
          scanDirectories: LATTE_TEMPLATE_SCAN_DIRECTORIES,
          ttlMs: LATTE_TEMPLATE_CACHE_TTL_MS,
        },
        includeCompletion,
      );
    }

    const tagCompletion = detectLatteTagCompletionAt(source, offset);

    if (tagCompletion) {
      return buildLatteTagCompletions(
        tagCompletion.prefix,
        tagCompletion.start,
        offset,
        LATTE_MAX_COMPLETIONS,
      );
    }

    if (isLattePresenterLinkIntelligenceActive(deps, frameworkCapabilities)) {
      const linkCompletion = frameworkCapabilities.presenterLinkCompletionContextAt(
        source,
        offset,
        "latte",
      );

      if (linkCompletion) {
        return lattePresenterLinkCompletions(
          {
            cache: presenterCache,
            currentRelativePath: currentTemplatePath(deps, requestedRoot),
            deps,
            frameworkCapabilities,
            inFlight: presenterInFlight,
            isDirectorySkipped: isLatteScanSkippedDirectory,
            isRequestedRootActive,
            maxDepth: MAX_LATTE_SCAN_DEPTH,
            maxPresenters: MAX_LATTE_TEMPLATE_FILES,
            requestedRoot,
            ttlMs: LATTE_PRESENTER_CACHE_TTL_MS,
          },
          linkCompletion,
        );
      }
    }

    const controlCompletion = latteControlCompletionAt(source, offset);

    if (controlCompletion) {
      return latteControlCompletions(
        {
          componentCache,
          deps,
          isRequestedRootActive,
          maxCompletions: LATTE_MAX_COMPLETIONS,
          requestedRoot,
          templateRelativePath: currentTemplatePath(deps, requestedRoot),
          ttlMs: LATTE_COMPONENT_CACHE_TTL_MS,
        },
        controlCompletion,
      );
    }

    const formNameCompletion = latteFormNameCompletionAt(source, offset);

    if (formNameCompletion) {
      return latteControlCompletions(
        {
          componentCache,
          deps,
          isRequestedRootActive,
          maxCompletions: LATTE_MAX_COMPLETIONS,
          requestedRoot,
          templateRelativePath: currentTemplatePath(deps, requestedRoot),
          ttlMs: LATTE_COMPONENT_CACHE_TTL_MS,
        },
        formNameCompletion,
      );
    }

    return latteExpressionCompletions(
      {
        deps,
        frameworkCapabilities,
        isRequestedRootActive,
        requestedRoot,
        templateTypeCache,
        templateTypeInFlight,
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
    evictOtherRootCacheEntries(templateTypeCache, deps.workspaceRoot);

    const workspaceContext = activeLatteWorkspaceContext(
      deps,
      frameworkCapabilities,
    );

    if (!workspaceContext) {
      return false;
    }

    const { isRequestedRootActive, requestedRoot } = workspaceContext;
    const detection = frameworkCapabilities.detectPhpPresenterLinkAt(source, offset);

    if (detection) {
      if (!isLattePresenterLinkIntelligenceActive(deps, frameworkCapabilities)) {
        return false;
      }

      return resolveNettePresenterLink(
        {
          currentRelativePath: currentTemplatePath(deps, requestedRoot),
          deps,
          frameworkCapabilities,
          isDirectorySkipped: isLatteScanSkippedDirectory,
          isRequestedRootActive,
          maxDepth: MAX_LATTE_SCAN_DEPTH,
          maxPresenters: MAX_LATTE_TEMPLATE_FILES,
          requestedRoot,
        },
        frameworkCapabilities.parsePresenterLinkTarget(detection.target),
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

  const provideNettePhpLinkCompletions = async (
    source: string,
    offset: number,
  ): Promise<LatteCompletionItem[] | null> => {
    const deps = getDependencies();
    evictOtherRootCacheEntries(templateCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(viewDataCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(presenterCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(componentCache, deps.workspaceRoot);
    evictOtherRootCacheEntries(templateTypeCache, deps.workspaceRoot);

    const workspaceContext = activeLatteWorkspaceContext(
      deps,
      frameworkCapabilities,
    );

    if (!workspaceContext) {
      return null;
    }

    if (!isLattePresenterLinkIntelligenceActive(deps, frameworkCapabilities)) {
      return null;
    }

    const linkCompletion = frameworkCapabilities.presenterLinkCompletionContextAt(
      source,
      offset,
      "php",
    );

    if (!linkCompletion) {
      return null;
    }

    const { isRequestedRootActive, requestedRoot } = workspaceContext;

    // Reuses the SAME per-root discovery + cache the Latte-side `{link}` /
    // `n:href` completion uses (`presenterCache` / `presenterInFlight`), so a
    // PHP-file request never re-scans `app` when the Latte side already warmed
    // the cache for this root, and vice versa.
    return lattePresenterLinkCompletions(
      {
        cache: presenterCache,
        currentRelativePath: currentTemplatePath(deps, requestedRoot),
        deps,
        frameworkCapabilities,
        inFlight: presenterInFlight,
        isDirectorySkipped: isLatteScanSkippedDirectory,
        isRequestedRootActive,
        maxDepth: MAX_LATTE_SCAN_DEPTH,
        maxPresenters: MAX_LATTE_TEMPLATE_FILES,
        requestedRoot,
        ttlMs: LATTE_PRESENTER_CACHE_TTL_MS,
      },
      linkCompletion,
    );
  };

  return {
    provideLatteCompletions,
    provideLatteDefinition,
    provideNettePhpLinkCompletions,
    provideNettePhpLinkDefinition,
    shouldBlockLatteDefinitionFallback: isLatteMemberReferenceAt,
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
  const presenterCacheRef = useRef<NettePresenterCache>({});
  const componentCacheRef = useRef<NetteControlCache>({});
  const templateTypeCacheRef = useRef<LatteTemplateTypeCache>({});
  const apiRef = useRef<LatteIntelligence | null>(null);

  if (!apiRef.current) {
    apiRef.current = createLatteIntelligence(
      () => dependenciesRef.current,
      templateCacheRef.current,
      viewDataCacheRef.current,
      presenterCacheRef.current,
      componentCacheRef.current,
      templateTypeCacheRef.current,
    );
  }

  return apiRef.current;
}

// --- expression completions (member / filter / variable) -------------------

/**
 * Cmd+B on a Latte template variable (`{$invoice}`, `{if $invoice}`) opens the
 * presenter/control sighting that fed that variable into the active template.
 * This intentionally reuses the same conservative presenter-data cache and
 * template-path matching used by `{$invoice->}` member completion.
 */
async function resolveNettePresenterVariableDefinition(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
): Promise<boolean> {
  return resolveLattePresenterVariableDefinition(
    latteExpressionDefinitionContext(context),
    source,
    offset,
  );
}

async function resolveNetteControlVariableDefinition(
  context: LatteExpressionResolutionContext,
): Promise<boolean> {
  const currentClassContext = netteCurrentClassContext(context);

  if (!currentClassContext) {
    return false;
  }

  return resolveNetteCurrentControlVariableDefinition(currentClassContext);
}

/**
 * Cmd+B on a Latte member/property expression (`{$consent->name}`) uses the same
 * Nette/PHP receiver typing path as member completion. A resolved member opens
 * the PHP declaration; an unresolved member returns false, with
 * `shouldBlockLatteDefinitionFallback` stopping generic symbol fallback from
 * jumping to unrelated JS/PHP symbols with the same short name.
 */
async function resolveLatteMemberDefinition(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
): Promise<boolean> {
  return resolveLatteExpressionMemberDefinition(
    latteExpressionDefinitionContext(context),
    source,
    offset,
  );
}

function latteExpressionDefinitionContext(
  context: LatteExpressionResolutionContext,
) {
  return {
    deps: context.deps,
    isRequestedRootActive: context.isRequestedRootActive,
    loadViewDataEntries: () => loadLatteViewDataEntries(context),
    resolveControlVariableDefinition: () =>
      resolveNetteControlVariableDefinition(context),
    resolveVariableType: (
      source: string,
      offset: number,
      variableName: string,
      depth: number,
    ) => resolveLatteVariableType(context, source, offset, variableName, depth),
    viewNames: () => latteCandidateViewNames(context),
  };
}

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
  return resolveLatteExpressionCompletions(
    latteExpressionCompletionContext(context),
    source,
    offset,
  );
}

function latteExpressionCompletionContext(
  context: LatteExpressionResolutionContext,
) {
  return {
    collectVariableCandidates: (source: string, offset: number) =>
      collectLatteVariableCandidates(context, source, offset),
    deps: context.deps,
    isRequestedRootActive: context.isRequestedRootActive,
    maxCompletions: LATTE_MAX_COMPLETIONS,
    resolveVariableType: (
      source: string,
      offset: number,
      variableName: string,
      depth: number,
    ) => resolveLatteVariableType(context, source, offset, variableName, depth),
  };
}

async function collectLatteVariableCandidates(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
): Promise<LatteVariableCandidate[]> {
  return collectNetteLatteVariableCandidates(
    latteVariableTypeContext(context),
    source,
    offset,
  );
}

async function resolveLatteVariableType(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  variableName: string,
  depth: number,
): Promise<string | null> {
  return resolveNetteLatteVariableType(
    latteVariableTypeContext(context),
    source,
    offset,
    variableName,
    depth,
  );
}

function latteVariableTypeContext(context: LatteExpressionResolutionContext) {
  return {
    currentControlClassName: () => currentNetteControlClassName(context),
    currentPresenterClassName: () => currentNettePresenterClassName(context),
    deps: context.deps,
    isRequestedRootActive: context.isRequestedRootActive,
    loadTemplateTypePropertySightings: (source: string) =>
      netteTemplateTypePropertySightings(
        latteTemplateTypeContext(context),
        source,
      ),
    loadViewDataEntries: () => loadLatteViewDataEntries(context),
    maxTypeResolutionDepth: MAX_LATTE_TYPE_RESOLUTION_DEPTH,
    viewNames: () => latteCandidateViewNames(context),
  };
}

async function currentNetteControlClassName(
  context: LatteExpressionResolutionContext,
): Promise<string | null> {
  const currentClassContext = netteCurrentClassContext(context);

  if (!currentClassContext) {
    return null;
  }

  return resolveCurrentNetteControlClassName(currentClassContext);
}

async function currentNettePresenterClassName(
  context: LatteExpressionResolutionContext,
): Promise<string | null> {
  const currentClassContext = netteCurrentClassContext(context);

  if (!currentClassContext) {
    return null;
  }

  return resolveCurrentNettePresenterClassName(currentClassContext);
}

function netteCurrentClassContext(context: LatteExpressionResolutionContext) {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const templateRelativePath = currentTemplatePath(deps, requestedRoot);

  if (!templateRelativePath) {
    return null;
  }

  return {
    createComponentSearchLimit: LATTE_VIEW_DATA_SEARCH_LIMIT,
    deps,
    isRequestedRootActive,
    phpExtension: PHP_EXTENSION,
    providers: deps.frameworkIntelligence.providers,
    requestedRoot,
    templateRelativePath,
  };
}

function loadLatteViewDataEntries(
  context: LatteExpressionResolutionContext,
): Promise<LatteNetteViewDataEntry[]> {
  const {
    viewDataCache,
    deps,
    frameworkCapabilities,
    isRequestedRootActive,
    requestedRoot,
    viewDataInFlight,
  } = context;

  return loadNetteViewDataEntries({
    cache: viewDataCache,
    deps,
    frameworkCapabilities,
    inFlight: viewDataInFlight,
    isRequestedRootActive,
    phpExtension: PHP_EXTENSION,
    providers: deps.frameworkIntelligence.providers,
    requestedRoot,
    searchLimit: LATTE_VIEW_DATA_SEARCH_LIMIT,
    ttlMs: LATTE_VIEW_DATA_CACHE_TTL_MS,
  });
}

function latteTemplateTypeContext(context: LatteExpressionResolutionContext) {
  const {
    templateTypeCache,
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateTypeInFlight,
  } = context;

  return {
    cache: templateTypeCache,
    deps,
    inFlight: templateTypeInFlight,
    isRequestedRootActive,
    phpExtension: PHP_EXTENSION,
    requestedRoot,
    searchLimit: LATTE_TEMPLATE_TYPE_SEARCH_LIMIT,
    ttlMs: LATTE_TEMPLATE_TYPE_CACHE_TTL_MS,
  };
}

async function latteCandidateViewNames(
  context: LatteExpressionResolutionContext,
): Promise<string[]> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const templateRelativePath = currentTemplatePath(deps, requestedRoot);

  if (!templateRelativePath) {
    return [];
  }

  return resolveLatteCandidateViewNames({
    deps,
    isRequestedRootActive,
    presenterSuffix: PRESENTER_SUFFIX,
    controlSuffix: CONTROL_SUFFIX,
    requestedRoot,
    templateRelativePath,
  });
}
