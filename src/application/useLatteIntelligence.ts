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
import type { LatteReference } from "../domain/latteNavigation";
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
  netteCreateComponentFactoryContexts,
} from "../domain/netteComponents";
import {
  LATTE_BUILTIN_FILTERS,
  latteForeachLoopBindingsAt,
  latteVariableDeclarations,
  parseLatteForeachCollection,
  type LatteVariableDeclaration,
} from "../domain/latteSyntax";
import {
  phpFrameworkViewDataEntryFromSource,
  phpFrameworkViewDataSearchQueries,
  phpFrameworkSupportsLattePresenterLinkIntelligence,
  phpFrameworkSupportsLatteTemplateIntelligence,
  type PhpFrameworkViewDataEntry,
  type PhpFrameworkViewDataVariable,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  orderPhpMemberCompletionsByCategory,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import {
  componentClassCandidatePathsForTemplate,
  presenterCandidatePathsForTemplate,
} from "../domain/nettePathResolution";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  factoryDerivedLatteCandidateViewNames,
  phpTypeNamesEqual,
} from "./netteCreateComponentViewData";
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
  isLatteScanSkippedDirectory,
  latteTemplateCompletions,
  resolveLatteTemplateDefinition,
  type LatteDirectoryEntry,
  type LatteTemplateCache,
} from "./netteTemplates";
import {
  isLatteMemberReferenceAt,
  latteExpressionCompletionTargetAt,
  latteMemberReferenceAt,
  latteVariableNameAt,
  type LatteFilterCompletionContext,
  type LatteMemberAccess,
  type LatteVariableCompletionContext,
} from "./latteExpressionDetection";
import {
  hasNetteFrameworkProvider,
  loadNetteViewDataEntries,
  type NetteViewDataCache,
  type NetteViewDataEntry,
  type NetteViewDataInFlight,
} from "./netteViewDataEntries";
import {
  latteTemplateTypePropertySightings as netteTemplateTypePropertySightings,
  latteTemplateTypeVariableType as netteTemplateTypeVariableType,
  mergeLatteResolvedTypes,
  type LatteTemplateTypeCache,
  type LatteTemplateTypeInFlight,
  type LatteTemplateTypePropertySighting,
} from "./netteTemplateTypes";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

export type { LatteDirectoryEntry, LatteTemplateCache } from "./netteTemplates";

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
const LATTE_CREATE_COMPONENT_CONTEXT_SEARCH_QUERY = "createComponent";

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

    if (!isLatteSemanticActive(deps, frameworkCapabilities)) {
      return false;
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return false;
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
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

    if (!isLatteSemanticActive(deps, frameworkCapabilities)) {
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
      return latteTagCompletions(tagCompletion.prefix, tagCompletion.start, offset);
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

    if (!isLatteSemanticActive(deps, frameworkCapabilities)) {
      return false;
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
      return false;
    }

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);
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

    if (
      !isLatteSemanticActive(deps, frameworkCapabilities) ||
      !isLattePresenterLinkIntelligenceActive(deps, frameworkCapabilities)
    ) {
      return null;
    }

    const requestedRoot = deps.workspaceRoot;

    if (!requestedRoot) {
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

    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(deps.currentWorkspaceRootRef.current, requestedRoot);

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

function isLatteSemanticActive(
  deps: LatteIntelligenceDependencies,
  frameworkCapabilities: LatteFrameworkCapabilities,
): boolean {
  return (
    deps.isSemanticIntelligenceActive &&
    frameworkCapabilities.supportsLatteTemplateIntelligence(
      deps.frameworkIntelligence.providers,
    )
  );
}

function isLattePresenterLinkIntelligenceActive(
  deps: LatteIntelligenceDependencies,
  frameworkCapabilities: LatteFrameworkCapabilities,
): boolean {
  return frameworkCapabilities.supportsLattePresenterLinkIntelligence(
    deps.frameworkIntelligence.providers,
  );
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
  const variableName = latteVariableNameAt(source, offset);

  if (!variableName) {
    return false;
  }

  if (variableName === "control") {
    return resolveNetteControlVariableDefinition(context);
  }

  const { deps, isRequestedRootActive } = context;
  const entries = await loadLatteViewDataEntries(context);

  if (!isRequestedRootActive() || entries.length === 0) {
    return false;
  }

  const target = `$${variableName}`;
  const viewNames = await latteCandidateViewNames(context);

  if (!isRequestedRootActive()) {
    return false;
  }

  for (const entry of entries) {
    if (!entry.sourcePath) {
      continue;
    }

    for (const binding of entry.bindings) {
      if (!matchesLatteViewName(binding.viewName, viewNames)) {
        continue;
      }

      for (const variable of binding.variables) {
        if (variable.name !== target) {
          continue;
        }

        const position = editorPositionAtOffset(
          entry.source,
          variable.valueOffset ?? 0,
        );

        return deps.openTarget(entry.sourcePath, position, variable.name);
      }
    }
  }

  return false;
}

async function resolveNetteControlVariableDefinition(
  context: LatteExpressionResolutionContext,
): Promise<boolean> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const templateRelativePath = currentTemplatePath(deps, requestedRoot);

  if (!templateRelativePath) {
    return false;
  }

  for (const relativePath of componentClassCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let source: string;

    try {
      source = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return false;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    const className = phpPrimaryClassName(source);
    const position = className
      ? phpClassPositionInSource(source, className)
      : null;

    return deps.openTarget(
      path,
      position ?? { column: 1, lineNumber: 1 },
      "$control",
    );
  }

  return false;
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
  const member = latteMemberReferenceAt(source, offset);

  if (!member) {
    return false;
  }

  const { deps, isRequestedRootActive } = context;
  const receiverType = await resolveLatteVariableType(
    context,
    source,
    offset,
    member.variableName,
    0,
  );

  if (!isRequestedRootActive() || !receiverType) {
    return false;
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
    return false;
  }

  const resolved = orderPhpMemberCompletionsByCategory(members).find(
    (entry) => entry.name === member.memberName,
  );

  if (!resolved) {
    return false;
  }

  if (resolved.kind === "property") {
    return deps.openPhpPropertyTarget(
      resolved.declaringClassName || receiverType,
      member.memberName,
    );
  }

  const methodOpened = await deps.openPhpMethodTarget(
    resolved.declaringClassName || receiverType,
    member.memberName,
  );

  if (!isRequestedRootActive() || methodOpened) {
    return methodOpened;
  }

  if (resolved.kind === "relation") {
    return deps.openPhpPropertyTarget(
      resolved.declaringClassName || receiverType,
      member.memberName,
    );
  }

  return false;
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
  const target = latteExpressionCompletionTargetAt(source, offset);

  if (!target) {
    return [];
  }

  if (target.kind === "member") {
    return latteMemberCompletions(context, source, offset, target.member);
  }

  if (target.kind === "filter") {
    return latteFilterCompletions(target.filter);
  }

  return latteVariableCompletions(context, source, offset, target.variable);
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

const NETTE_TEMPLATE_IMPLICIT_CONTROL_TYPE = "Nette\\Application\\UI\\Control";

const NETTE_TEMPLATE_IMPLICIT_VARIABLES = [
  {
    detail: "Nette template context",
    name: "$presenter",
    typeHint: "Presenter",
  },
  {
    detail: "Nette template context",
    name: "$control",
    typeHint: "Control",
  },
] satisfies LatteVariableCandidate[];

/**
 * Gathers the in-scope template variables for the `{$}` list, first sighting of
 * a name wins (inline declarations > template type > loop bindings > presenter
 * data), matching the resolution precedence used for member completion.
 */
async function collectLatteVariableCandidates(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
): Promise<LatteVariableCandidate[]> {
  const { isRequestedRootActive } = context;
  const byName = new Map<string, LatteVariableCandidate>();
  const add = (name: string, detail: string, typeHint: string | null) => {
    if (byName.has(name)) {
      return;
    }

    byName.set(name, { detail, name, typeHint });
  };

  for (const declaration of latteVariableDeclarations(source)) {
    if (
      !declaration.variableName ||
      !isLatteDeclarationVisibleAt(declaration, offset)
    ) {
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

  for (const sighting of await loadLatteTemplateTypePropertySightings(
    context,
    source,
  )) {
    if (!isRequestedRootActive()) {
      return [];
    }

    add(
      sighting.property.name,
      "template type",
      shortTypeName(sighting.property.type),
    );
  }

  for (const binding of latteForeachLoopBindingsAt(source, offset)) {
    add(`$${binding.loopVariableName}`, "foreach item", null);

    if (binding.keyVariableName) {
      add(`$${binding.keyVariableName}`, "foreach key", null);
    }
  }

  for (const variable of NETTE_TEMPLATE_IMPLICIT_VARIABLES) {
    add(variable.name, variable.detail, variable.typeHint);
  }

  const entries = await loadLatteViewDataEntries(context);

  if (!isRequestedRootActive()) {
    return [];
  }

  const viewNames = await latteCandidateViewNames(context);

  if (!isRequestedRootActive()) {
    return [];
  }

  for (const variable of netteViewDataVariablesForViews(entries, viewNames)) {
    add(variable.name, "presenter data", shortTypeName(variable.typeHint));
  }

  return Array.from(byName.values());
}

/**
 * Resolves the receiver type of a Latte variable through the §4.4 priority
 * chain: (1) `{varType}` / `{parameters}` inline type, (2) typed properties on
 * an explicit `{templateType FooTemplate}` class, (3) `{var}` / `{default}`
 * local expression, (4) presenter view-data, (5) enclosing `{foreach}` element
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

  const templateType = await resolveLatteTemplateTypeVariableType(
    context,
    source,
    variableName,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (templateType) {
    return templateType;
  }

  const localType = await latteLocalVariableType(
    context,
    source,
    offset,
    variableName,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (localType) {
    return localType;
  }

  const implicitType = await latteImplicitVariableType(context, variableName);

  if (!isRequestedRootActive()) {
    return null;
  }

  if (implicitType) {
    return implicitType;
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

async function latteImplicitVariableType(
  context: LatteExpressionResolutionContext,
  variableName: string,
): Promise<string | null> {
  if (variableName === "control") {
    return (
      (await currentNetteControlClassName(context)) ??
      NETTE_TEMPLATE_IMPLICIT_CONTROL_TYPE
    );
  }

  if (variableName !== "presenter") {
    return null;
  }

  return currentNettePresenterClassName(context);
}

async function currentNetteControlClassName(
  context: LatteExpressionResolutionContext,
): Promise<string | null> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const templateRelativePath = currentTemplatePath(deps, requestedRoot);

  if (!templateRelativePath) {
    return null;
  }

  for (const relativePath of componentClassCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return null;
    }

    let source: string;

    try {
      source = await deps.readFileContent(
        deps.joinPath(requestedRoot, relativePath),
      );
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return null;
    }

    const className = phpPrimaryClassName(source);

    if (!className) {
      continue;
    }

    const namespace = phpNamespaceName(source);

    return namespace ? `${namespace}\\${className}` : className;
  }

  return null;
}

async function currentNettePresenterClassName(
  context: LatteExpressionResolutionContext,
): Promise<string | null> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const templateRelativePath = currentTemplatePath(deps, requestedRoot);

  if (!templateRelativePath) {
    return null;
  }

  for (const relativePath of presenterCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return null;
    }

    let source: string;

    try {
      source = await deps.readFileContent(
        deps.joinPath(requestedRoot, relativePath),
      );
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return null;
    }

    const className = phpPrimaryClassName(source);

    if (!className) {
      continue;
    }

    const namespace = phpNamespaceName(source);

    return namespace ? `${namespace}\\${className}` : className;
  }

  return currentNetteFactoryPresenterClassName(context);
}

async function currentNetteFactoryPresenterClassName(
  context: LatteExpressionResolutionContext,
): Promise<string | null> {
  const { deps, isRequestedRootActive, requestedRoot } = context;

  if (!hasNetteFrameworkProvider(deps.frameworkIntelligence.providers)) {
    return null;
  }

  const controlClassName = await currentNetteControlClassName(context);

  if (!isRequestedRootActive() || !controlClassName) {
    return null;
  }

  const results = await deps.searchText(
    requestedRoot,
    LATTE_CREATE_COMPONENT_CONTEXT_SEARCH_QUERY,
    LATTE_VIEW_DATA_SEARCH_LIMIT,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  const visitedPaths = new Set<string>();

  for (const result of results) {
    if (!isRequestedRootActive()) {
      return null;
    }

    if (visitedPaths.has(result.path) || !result.path.endsWith(PHP_EXTENSION)) {
      continue;
    }

    visitedPaths.add(result.path);

    let source: string;

    try {
      source = await deps.readFileContent(result.path);
    } catch {
      if (!isRequestedRootActive()) {
        return null;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return null;
    }

    const presenterClassName = phpPrimaryClassName(source);

    if (!presenterClassName?.endsWith("Presenter")) {
      continue;
    }

    const matchedFactory = netteCreateComponentFactoryContexts(source).some(
      (factory) => {
        if (!factory.controlClass) {
          return false;
        }

        const resolved =
          deps.resolveDeclaredType(source, factory.controlClass) ??
          factory.controlClass;

        return phpTypeNamesEqual(resolved, controlClassName);
      },
    );

    if (!matchedFactory) {
      continue;
    }

    const namespace = phpNamespaceName(source);

    return namespace ? `${namespace}\\${presenterClassName}` : presenterClassName;
  }

  return null;
}

/** Priority 2: typed properties on an explicit `{templateType FooTemplate}` class. */
async function resolveLatteTemplateTypeVariableType(
  context: LatteExpressionResolutionContext,
  source: string,
  variableName: string,
): Promise<string | null> {
  return netteTemplateTypeVariableType(
    latteTemplateTypeContext(context),
    source,
    variableName,
  );
}

function loadLatteTemplateTypePropertySightings(
  context: LatteExpressionResolutionContext,
  source: string,
): Promise<LatteTemplateTypePropertySighting[]> {
  return netteTemplateTypePropertySightings(
    latteTemplateTypeContext(context),
    source,
  );
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

/** Priority 3: the resolved type of a `{var}` / `{default}` value expression. */
async function latteLocalVariableType(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  variableName: string,
): Promise<string | null> {
  const { deps, isRequestedRootActive } = context;

  for (const declaration of latteVariableDeclarations(source)) {
    if (declaration.kind !== "var" && declaration.kind !== "default") {
      continue;
    }

    if (!isLatteDeclarationVisibleAt(declaration, offset)) {
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

function isLatteDeclarationVisibleAt(
  declaration: LatteVariableDeclaration,
  offset: number,
): boolean {
  if (declaration.kind !== "var" && declaration.kind !== "default") {
    return true;
  }

  return declaration.offset < offset;
}

/** Priority 4: the merged type across the presenter sightings for the variable. */
async function lattePresenterVariableType(
  context: LatteExpressionResolutionContext,
  variableName: string,
): Promise<string | null> {
  const { deps, isRequestedRootActive } = context;
  const entries = await loadLatteViewDataEntries(context);

  if (!isRequestedRootActive() || entries.length === 0) {
    return null;
  }

  const viewNames = await latteCandidateViewNames(context);

  if (!isRequestedRootActive()) {
    return null;
  }

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

/** Priority 5: the element type of the innermost `{foreach}` binding the variable belongs to. */
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

/**
 * The `"<Presenter>:<action>"` view names that could render the active template,
 * plus the `"<Presenter>:*"` wildcard the extractor emits for helper methods
 * (`beforeRender`, bare `render()`), so a variable shared across every action is
 * matched too. Derived from the template path via the inverse presenter mapping.
 *
 * Component/control templates are included through the colocated
 * `SomethingControl.php` inverse mapping, so view data assigned by a control's
 * `render*` / lifecycle methods feeds both `$variable` completion and
 * `{$variable->}` member completion in `something.latte`.
 */
async function latteCandidateViewNames(
  context: LatteExpressionResolutionContext,
): Promise<string[]> {
  const { deps, isRequestedRootActive, requestedRoot } = context;
  const templateRelativePath = currentTemplatePath(deps, requestedRoot);

  if (!templateRelativePath) {
    return [];
  }

  const action = latteActionFromTemplatePath(templateRelativePath);
  const names = new Set<string>();

  for (const presenterPath of [
    ...presenterCandidatePathsForTemplate(templateRelativePath),
    ...componentClassCandidatePathsForTemplate(templateRelativePath),
  ]) {
    const fileName = presenterPath.split("/").pop() ?? "";
    const isControl = fileName.endsWith(CONTROL_SUFFIX);
    const suffix = fileName.endsWith(PRESENTER_SUFFIX)
      ? PRESENTER_SUFFIX
      : isControl
        ? CONTROL_SUFFIX
        : null;

    if (!suffix) {
      continue;
    }

    const shortName = fileName.slice(0, -suffix.length);

    names.add(`${shortName}:${action}`);
    names.add(`${shortName}:*`);

    if (isControl) {
      names.add(`${shortName}:default`);
    }
  }

  for (const name of await factoryDerivedLatteCandidateViewNames({
    action,
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
  })) {
    if (!isRequestedRootActive()) {
      return [];
    }

    names.add(name);
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

function phpPrimaryClassName(source: string): string | null {
  const match = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(source);
  const className = match?.[1]?.trim() ?? "";

  return className.length > 0 ? className : null;
}

function phpClassPositionInSource(
  source: string,
  className: string,
): EditorPosition | null {
  const pattern = new RegExp(`\\bclass\\s+${escapeRegExp(className)}\\b`);
  const match = pattern.exec(source);

  if (!match) {
    return null;
  }

  return editorPositionAtOffset(
    source,
    match.index + match[0].length - className.length,
  );
}

function phpNamespaceName(source: string): string | null {
  const match = /\bnamespace\s+([^;{]+)\s*[;{]/.exec(source);
  const namespace = match?.[1]?.trim() ?? "";

  return namespace.length > 0 ? namespace : null;
}

function endPositionOf(source: string): EditorPosition {
  return editorPositionAtOffset(source, source.length);
}

function resolveLatteBlockDefinition(
  deps: LatteIntelligenceDependencies,
  source: string,
  reference: LatteReference,
  currentTemplateRelativePath: string | null,
): Promise<boolean> {
  if (!currentTemplateRelativePath) {
    return Promise.resolve(false);
  }

  const definitionOffset = latteBlockDefinitionOffset(source, reference);

  if (definitionOffset === null) {
    return Promise.resolve(false);
  }

  const activeDocumentPath = deps.getActiveDocument()?.path ?? null;

  if (!activeDocumentPath) {
    return Promise.resolve(false);
  }

  return deps.openTarget(
    activeDocumentPath,
    editorPositionAtOffset(source, definitionOffset),
    reference.name,
  );
}

function latteBlockDefinitionOffset(
  source: string,
  reference: LatteReference,
): number | null {
  const blockReference = new RegExp(
    String.raw`\{(?:block|define)\s+#?${escapeRegExp(reference.name)}(?=[\s,}/])`,
    "g",
  );

  for (const match of source.matchAll(blockReference)) {
    const start = match.index ?? 0;
    const nameStart = start + match[0].lastIndexOf(reference.name);

    if (reference.tag !== "include" && nameStart === reference.nameStart) {
      return nameStart;
    }

    if (reference.tag === "include") {
      return nameStart;
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  const before = source.slice(0, clamped);
  const lineStart = before.lastIndexOf("\n") + 1;

  return { column: clamped - lineStart + 1, lineNumber: before.split("\n").length };
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
