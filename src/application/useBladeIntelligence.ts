/**
 * Blade (Laravel) navigation + completion intelligence, extracted VERBATIM from
 * the workbench controller as a sibling strangler module (mirrors
 * `useLatteIntelligence` / `useNeonIntelligence`): the controller keeps only a
 * thin mount that injects the shared collaborators, while every Blade decision
 * lives here behind a small, injected dependency surface so the logic is
 * unit-testable WITHOUT the controller.
 *
 * Responsibilities (unchanged from the controller):
 *   - `provideBladeCompletions`: @directive names, view names, `<x-...>`
 *     component tags, `$variable` view-data / `@foreach` loop variables, typed
 *     `$var->member` completions, and `route()`/`config()`/`trans()`/`__()`
 *     helper literals.
 *   - `provideBladeCodeActions`: the "create missing view" quickfix.
 *   - `provideBladeDefinition` (Cmd+B): view / component navigation plus Laravel
 *     helper-literal and typed view-data member jumps.
 *   - the per-root view-data / component-name caches and their invalidation.
 *
 * ISOLATION (project rule): each async flow captures the requested workspace
 * root up front and re-checks the LIVE root after every await, dropping stale
 * results so nothing leaks across project tabs. The heavy PHP/Laravel resolvers,
 * target collectors and navigation primitives are injected (pass-through) so the
 * expensive engines are owned by the controller and merely wired here.
 */
import { useCallback, useRef } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  BLADE_DIRECTIVES,
  bladeComponentNavigationCandidateRelativePaths,
  bladeViewCandidateRelativePaths,
  detectBladeComponentCompletionAt,
  detectBladeDirectiveCompletionAt,
  detectBladeReferenceAt,
  isInsideBladeComment,
} from "../domain/bladeNavigation";
import {
  bladeLaravelHelperCompletionContextAt,
  bladeLaravelStringLiteralHelperAt,
} from "../domain/bladeLaravelHelperCompletions";
import {
  bladeForeachLoopBindingsAt,
  bladeViewVariableSightingsForView,
  bladeViewVariablesForViewFromEntries,
  mergeBladeViewVariableResolvedTypes,
  parseBladeForeachCollection,
  type BladeForeachLoopBinding,
  type BladeViewDataEntry,
  type BladeViewVariableSighting,
} from "../domain/bladeViewVariables";
import {
  resolveLaravelConfigTarget,
  resolveLaravelTransTarget,
  resolveLaravelViewTarget,
} from "../domain/laravelPathResolution";
import { phpLaravelCollectionModelTypeCandidate } from "../domain/phpFrameworkLaravel";
import { phpIdentifierContextAt } from "../domain/phpNavigation";
import { phpLaravelViewNameFromRelativePath } from "../domain/phpLaravelViews";
import { type PhpLaravelViewVariable } from "../domain/phpLaravelViewData";
import { orderPhpMemberCompletionsByCategory } from "../domain/phpMethodCompletions";
import { joinWorkspacePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  BladeCompletionItem,
  BladeIntelligence,
  BladeIntelligenceDependencies,
} from "./bladeIntelligenceContracts";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import {
  provideBladeCodeActions as provideBladeCodeActionsFromProvider,
} from "./bladeCodeActionProvider";
import {
  collectBladeComponentNames as collectBladeComponentNamesFromWorkspace,
  invalidateBladeComponentNamesForPath as invalidateBladeComponentNamesForCachePath,
} from "./bladeComponentDiscovery";
import {
  bladeMemberCompletionItem,
  bladeOffsetAtEditorPosition,
  bladePhpLikeCompletionAt,
  bladePhpMemberAccessCompletionAt,
  bladeShortTypeName,
  editorPositionAtOffset,
} from "./bladePhpCompletionContext";
import {
  bladeLaravelHelperNameCompletions,
  provideBladeLaravelHelperCompletionItems,
} from "./bladeLaravelHelperCompletionItems";
import {
  ensureBladeViewDataEntriesLoaded as loadBladeViewDataEntries,
  invalidateBladeViewDataEntriesForPath as invalidateBladeViewDataEntriesForCachePath,
} from "./bladeViewDataCache";
import {
  synthesizePhpTypedReceiverSource as bladeSyntheticPhpMemberAccessSource,
} from "./phpTypedReceiverSource";

export type {
  BladeCompletionItem,
  BladeIntelligence,
  BladeIntelligenceDependencies,
} from "./bladeIntelligenceContracts";

export function useBladeIntelligence(
  deps: BladeIntelligenceDependencies,
): BladeIntelligence {
  const {
    activeDocument,
    collectPhpLaravelConfigTargets,
    collectPhpLaravelNamedRouteTargets,
    collectPhpLaravelTranslationTargets,
    collectPhpLaravelViewTargets,
    createMissingBladeViewCodeAction,
    currentWorkspaceRootRef,
    ensurePhpLaravelMigrationSourcesLoaded,
    ensurePhpLaravelProviderSourcesLoaded,
    findPhpLaravelConfigTarget,
    findPhpLaravelTranslationTarget,
    findPhpLaravelViewTarget,
    frameworkIntelligence,
    openDirectPhpMethodTarget,
    openDirectPhpPropertyTarget,
    openNavigationTarget,
    openPhpLaravelModelAttributeTarget,
    readNavigationFileContent,
    relativeWorkspacePath,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpDeclaredType,
    resolvePhpExpressionType,
    resolvePhpReceiverMethodCompletions,
    textSearch,
    workspaceFiles,
    workspaceRoot,
  } = deps;
  const activePhpFrameworkProviders = frameworkIntelligence.providers;
  const isLaravelFrameworkActive = frameworkIntelligence.isLaravel;

  // Per-root cache of controller view-data entries (`view('x', [...])`,
  // `View::make`, `->with(...)`, `compact(...)` sources) feeding Blade variable
  // and member completions. Keyed by workspace root and reset on workspace
  // switch / reindex like the migration/provider caches, and invalidated when
  // any PHP file in the root changes, so the blade completion hot path never
  // re-runs the workspace text search. The in-flight map dedupes concurrent
  // loads; a load only writes the cache while it is still the registered load
  // for its root (mid-load invalidation drops the result).
  const bladeViewDataEntriesByRootRef = useRef<
    Record<string, BladeViewDataEntry[]>
  >({});
  const bladeViewDataEntriesLoadInFlightRef = useRef<
    Map<string, Promise<BladeViewDataEntry[] | null>>
  >(new Map());
  // Per-root cache of Blade component tag names (anonymous blade views under
  // resources/views/components plus class-based components under
  // app/View/Components) fed into `<x-` completion. Keyed by workspace root,
  // reset on workspace switch / reindex and invalidated when a file under
  // either component directory changes, so names never leak across project
  // tabs and never go stale after a component is added/removed.
  const bladeComponentNamesByRootRef = useRef<Record<string, string[]>>({});

  // Loads (and caches per root) the controller sources that pass data to Blade
  // views: one workspace text search per query, each hit parsed once into its
  // view-data bindings. The hot completion path then works from the in-memory
  // entries. Per-project isolation: the requested root is captured up front and
  // re-checked after EVERY await; a stale root drops the result and never
  // writes the cache. Concurrent callers share the same in-flight promise.
  const ensureBladeViewDataEntriesLoaded = useCallback(
    async (requestedRoot: string): Promise<BladeViewDataEntry[] | null> => {
      return loadBladeViewDataEntries(requestedRoot, {
        currentWorkspaceRootRef,
        entriesByRootRef: bladeViewDataEntriesByRootRef,
        frameworkProviders: activePhpFrameworkProviders,
        loadInFlightRef: bladeViewDataEntriesLoadInFlightRef,
        readNavigationFileContent,
        textSearch,
      });
    },
    [
      activePhpFrameworkProviders,
      currentWorkspaceRootRef,
      readNavigationFileContent,
      textSearch,
    ],
  );

  // Drops the cached view-data entries for `root` when any PHP file changes
  // (controllers can live anywhere - app/, routes/, modules/ - so the
  // invalidation is deliberately broad). The next Blade completion reloads
  // lazily; deleting the in-flight entry also prevents a racing load from
  // caching pre-change sources.
  const invalidateBladeViewDataEntriesForPath = useCallback(
    (root: string, path: string): void => {
      invalidateBladeViewDataEntriesForCachePath(
        bladeViewDataEntriesByRootRef,
        bladeViewDataEntriesLoadInFlightRef,
        root,
        path,
      );
    },
    [],
  );

  // Resolves the receiver type of ONE view-data sighting: FIRST the full PHP
  // expression engine on the value expression at its source position - the
  // same engine `providePhpMethodCompletions` uses - so route-model-bound
  // parameters, typed properties, `@var` docs and Eloquent chains all infer
  // like PhpStorm (including `->get()` resolving to a Collection rather than
  // the model). Only when no expression is known (or the engine declines)
  // does the cheap declared-type hint from the view-data extraction apply.
  const resolveBladeViewVariableSightingType = useCallback(
    async (sighting: BladeViewVariableSighting): Promise<string | null> => {
      if (sighting.variable.valueExpression) {
        const expressionType = await resolvePhpExpressionType(
          sighting.source,
          editorPositionAtOffset(
            sighting.source,
            sighting.variable.valueOffset ?? sighting.source.length,
          ),
          sighting.variable.valueExpression,
        );

        if (expressionType) {
          return expressionType;
        }
      }

      return resolvePhpDeclaredType(sighting.source, sighting.variable.typeHint);
    },
    [resolvePhpDeclaredType, resolvePhpExpressionType],
  );

  // CONSERVATIVE view-variable receiver type: every sighting of the variable
  // (across all controllers passing data to the view) is resolved and the
  // types must agree - a conflict yields `null` (no member completions, no
  // guessing). Unresolvable sightings do not veto a resolved type.
  const resolveBladeViewVariableTypeForView = useCallback(
    async (viewName: string, variableName: string): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return null;
      }

      const entries = await ensureBladeViewDataEntriesLoaded(requestedRoot);

      if (!entries || !isRequestedRootActive()) {
        return null;
      }

      const resolvedTypes: (string | null)[] = [];

      for (const sighting of bladeViewVariableSightingsForView(
        entries,
        viewName,
        variableName,
      )) {
        resolvedTypes.push(await resolveBladeViewVariableSightingType(sighting));

        if (!isRequestedRootActive()) {
          return null;
        }
      }

      return mergeBladeViewVariableResolvedTypes(resolvedTypes);
    },
    [
      ensureBladeViewDataEntriesLoaded,
      resolveBladeViewVariableSightingType,
      workspaceRoot,
    ],
  );

  // Resolves the type of a `@foreach` collection expression's ROOT variable:
  // first an ENCLOSING loop that already bound that variable (passed in
  // `outerLoopVariableTypes`, keyed by lowercased name), then - for a root
  // that is not itself a loop variable - the reverse `view -> controllers`
  // mapping (a view variable). The closer binding must win: PHP/Blade scoping
  // means a loop variable shadows a same-named outer view variable, and
  // `resolveBladeViewVariableTypeForView` merges sightings across EVERY
  // controller that renders the view, so a generic loop name (`$item`,
  // `$row`) reused by an unrelated controller must never override the
  // enclosing loop's own element type. CONSERVATIVE: an unknown root yields
  // `null`, never a guess.
  const resolveBladeForeachRootVariableType = useCallback(
    async (
      viewName: string,
      rootVariableName: string,
      outerLoopVariableTypes: ReadonlyMap<string, string>,
    ): Promise<string | null> => {
      const outerLoopVariableType = outerLoopVariableTypes.get(
        rootVariableName.toLowerCase(),
      );

      if (outerLoopVariableType) {
        return outerLoopVariableType;
      }

      return resolveBladeViewVariableTypeForView(viewName, `$${rootVariableName}`);
    },
    [resolveBladeViewVariableTypeForView],
  );

  // Resolves the ELEMENT type of one `@foreach` collection expression. Bare
  // collection variables (`$invoices`) resolve through the root-variable mapping
  // and must be collection-like. A conservative Laravel relation chain
  // (`$businessEntity->invoices`, or `$invoice->lines` where `$invoice` is an
  // enclosing loop element) resolves each relation/property from the previous
  // owner and returns the final related model type, which lets real-world Blade
  // loops - including NESTED ones - complete `$item->...` without guessing from
  // variable names. `source` is the real Blade document text (not the bare
  // collection-expression fragment) so `phpLaravelCollectionModelTypeCandidate`
  // can resolve carrier-type aliases (`use X as Y`) declared in the document.
  const resolveBladeForeachCollectionType = useCallback(
    async (
      viewName: string,
      source: string,
      binding: BladeForeachLoopBinding,
      outerLoopVariableTypes: ReadonlyMap<string, string>,
    ): Promise<string | null> => {
      const collection = parseBladeForeachCollection(binding.collectionExpression);

      if (!collection) {
        return null;
      }

      const rootType = await resolveBladeForeachRootVariableType(
        viewName,
        collection.rootVariableName,
        outerLoopVariableTypes,
      );

      if (!rootType) {
        return null;
      }

      if (collection.relationNames.length === 0) {
        return phpLaravelCollectionModelTypeCandidate(source, rootType);
      }

      if (collection.relationNames.length > BLADE_FOREACH_MAX_RELATION_CHAIN_LENGTH) {
        return null;
      }

      let ownerType: string | null = rootType;

      for (let index = 0; index < collection.relationNames.length; index += 1) {
        const isFinalRelation = index === collection.relationNames.length - 1;
        ownerType = await resolvePhpClassPropertyOrRelationType(
          ownerType,
          collection.relationNames[index],
          isFinalRelation,
        );

        if (!ownerType) {
          return null;
        }
      }

      return ownerType;
    },
    [resolveBladeForeachRootVariableType, resolvePhpClassPropertyOrRelationType],
  );

  // Element types of EVERY `@foreach`/`@forelse` still enclosing `offset`, keyed
  // by lowercased loop-variable name. Loops resolve outermost-first so an inner
  // loop iterating a relation of an outer loop's element
  // (`@foreach($businessEntity->invoices as $invoice)` then
  // `@foreach($invoice->lines as $line)`) resolves against the already-known
  // outer element type. Bounded by loop-nesting depth (no recursion); the active
  // root is re-checked after each await so a tab switch drops stale results.
  const resolveBladeForeachLoopVariableTypes = useCallback(
    async (
      viewName: string,
      source: string,
      offset: number,
    ): Promise<Map<string, string>> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const resolvedTypes = new Map<string, string>();

      for (const binding of bladeForeachLoopBindingsAt(source, offset)) {
        const elementType = await resolveBladeForeachCollectionType(
          viewName,
          source,
          binding,
          resolvedTypes,
        );

        if (!isRequestedRootActive()) {
          return new Map();
        }

        if (elementType) {
          resolvedTypes.set(binding.loopVariableName.toLowerCase(), elementType);
        }
      }

      return resolvedTypes;
    },
    [resolveBladeForeachCollectionType, workspaceRoot],
  );

  // CONSERVATIVE element type behind a `@foreach ($collection as $item)` loop
  // variable at `offset`. Returns `null` when the offset is not inside a loop
  // binding for `variableName`, or the expression cannot be resolved - never a
  // guessed element type.
  const resolveBladeForeachElementTypeForVariable = useCallback(
    async (
      viewName: string,
      source: string,
      offset: number,
      variableName: string,
    ): Promise<string | null> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const normalizedName = variableName.replace(/^\$/, "").toLowerCase();
      const loopVariableTypes = await resolveBladeForeachLoopVariableTypes(
        viewName,
        source,
        offset,
      );

      if (!isRequestedRootActive()) {
        return null;
      }

      return loopVariableTypes.get(normalizedName) ?? null;
    },
    [resolveBladeForeachLoopVariableTypes, workspaceRoot],
  );

  // Returns the workspace's Blade component tag names for `<x-` completion:
  // anonymous blade views under resources/views/components (dotted names
  // without the `.blade.php` / `/index.blade.php` suffix) merged with
  // class-based components under app/View/Components (PascalCase segments
  // kebab-cased, Laravel convention). The scan result is cached per workspace
  // root (see bladeComponentNamesByRootRef) so the completion hot path stays
  // off the file system; the walk re-checks the active workspace after each
  // readDirectory await and before the cache write, so a tab switch drops
  // in-flight results (per-project isolation).
  const collectBladeComponentNames = useCallback(async (): Promise<string[]> => {
    return collectBladeComponentNamesFromWorkspace({
      cacheRef: bladeComponentNamesByRootRef,
      currentWorkspaceRootRef,
      relativeWorkspacePath,
      workspaceFiles,
      workspaceRoot,
    });
  }, [
    currentWorkspaceRootRef,
    relativeWorkspacePath,
    workspaceFiles,
    workspaceRoot,
  ]);

  // Drops the cached component names for `root` when a file under either Blade
  // component directory changes so the next `<x-` completion re-scans. Mirrors
  // invalidatePhpLaravelMigrationSourcesForPath.
  const invalidateBladeComponentNamesForPath = useCallback(
    (root: string, path: string): void => {
      invalidateBladeComponentNamesForCachePath(
        bladeComponentNamesByRootRef,
        root,
        path,
      );
    },
    [],
  );

  // The variables every controller passes to `viewName`, served from the
  // per-root view-data cache (no workspace scan on the hot path). Display
  // type hints are merged conservatively in the domain layer: hinted sightings
  // must agree or the hint is dropped.
  const collectBladeViewVariables = useCallback(
    async (viewName: string): Promise<PhpLaravelViewVariable[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const entries = await ensureBladeViewDataEntriesLoaded(requestedRoot);

      if (!entries || !isRequestedRootActive()) {
        return [];
      }

      return bladeViewVariablesForViewFromEntries(entries, viewName);
    },
    [ensureBladeViewDataEntriesLoaded, workspaceRoot],
  );

  // The loop variables of every `@foreach`/`@forelse` still enclosing `offset`,
  // each shaped as a view variable so the `$` list renders it uniformly. The
  // display type is the enclosing loop's element type when it resolves
  // (CONSERVATIVE: unknown collection type -> no type hint, never a guess).
  // `alreadyListed` view variables are skipped so a name shadowing a view
  // variable is not duplicated.
  const collectBladeForeachLoopVariables = useCallback(
    async (
      viewName: string,
      source: string,
      offset: number,
      alreadyListed: readonly PhpLaravelViewVariable[],
    ): Promise<PhpLaravelViewVariable[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const bindings = bladeForeachLoopBindingsAt(source, offset);
      const listedNames = new Set(
        alreadyListed.map((variable) => variable.name.toLowerCase()),
      );
      const loopVariables: PhpLaravelViewVariable[] = [];
      const seenNames = new Set<string>();

      for (const binding of bindings) {
        const name = `$${binding.loopVariableName}`;
        const key = name.toLowerCase();

        if (listedNames.has(key) || seenNames.has(key)) {
          continue;
        }

        seenNames.add(key);

        const elementType = await resolveBladeForeachElementTypeForVariable(
          viewName,
          source,
          offset,
          binding.loopVariableName,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        loopVariables.push({
          detail: "foreach item",
          name,
          typeHint: bladeShortTypeName(elementType),
          valueExpression: null,
          valueOffset: null,
        });
      }

      return loopVariables;
    },
    [resolveBladeForeachElementTypeForVariable, workspaceRoot],
  );

  // Fills a view variable's display type from the full reverse-mapping resolver
  // when the cheap declared hint is absent (e.g. a route-model-bound parameter
  // typed only in the controller signature), so `$` shows the concrete type.
  // CONSERVATIVE: an unresolved type leaves the hint untouched.
  const collectBladeViewVariablesWithDisplayTypes = useCallback(
    async (viewName: string): Promise<PhpLaravelViewVariable[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
      const variables = await collectBladeViewVariables(viewName);

      if (!isRequestedRootActive()) {
        return [];
      }

      const enriched: PhpLaravelViewVariable[] = [];

      for (const variable of variables) {
        if (variable.typeHint) {
          enriched.push(variable);
          continue;
        }

        const resolvedType = await resolveBladeViewVariableTypeForView(
          viewName,
          variable.name,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        enriched.push({
          ...variable,
          typeHint: bladeShortTypeName(resolvedType) ?? variable.typeHint,
        });
      }

      return enriched;
    },
    [
      collectBladeViewVariables,
      resolveBladeViewVariableTypeForView,
      workspaceRoot,
    ],
  );

  // Completion for `.blade.php` documents: `@directive` names (pure filter of
  // BLADE_DIRECTIVES), view names for @include/@extends/… literals (reusing the
  // resources/views scan), and `<x-...>` component names (components scan).
  // Per-project isolation: capture the requested root and re-check after the
  // directory scans before returning, so stale results drop on tab switch.
  const provideBladeCompletions = useCallback(
    async (
      source: string,
      position: EditorPosition,
    ): Promise<BladeCompletionItem[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const offset = bladeOffsetAtEditorPosition(source, position);
      const directiveCompletion = detectBladeDirectiveCompletionAt(source, offset);
      const memberCompletion = bladePhpMemberAccessCompletionAt(source, offset);
      const phpLikeCompletion = bladePhpLikeCompletionAt(source, offset);

      if (directiveCompletion) {
        const normalizedPrefix = directiveCompletion.directivePrefix.toLowerCase();

        return BLADE_DIRECTIVES.filter((directive) =>
          directive.toLowerCase().startsWith(normalizedPrefix),
        )
          .slice(0, 100)
          .map((directive) => ({
            detail: "Blade directive",
            insertText: directive,
            kind: "directive",
            label: `@${directive}`,
            replaceEnd: offset,
            replaceStart: directiveCompletion.start + 1,
          }));
      }

      if (memberCompletion) {
        const activePath = activeDocument?.path ?? "";
        const relativePath = activePath
          ? relativeWorkspacePath(requestedRoot, activePath)
          : "";
        const viewName = phpLaravelViewNameFromRelativePath(relativePath);

        if (!viewName) {
          return [];
        }

        if (isLaravelFrameworkActive) {
          void ensurePhpLaravelMigrationSourcesLoaded(requestedRoot);
          void ensurePhpLaravelProviderSourcesLoaded(requestedRoot);
        }

        // The receiver type comes from the reverse `view -> controllers`
        // mapping: every controller sighting of this variable is resolved
        // (declared hint first, full expression engine second) and the types
        // must agree - a conflict or an unknown type yields NO completions
        // rather than guessed ones. A `@foreach` loop variable is not a view
        // variable, so it falls back to the enclosing loop's element type.
        const viewVariableType = await resolveBladeViewVariableTypeForView(
          viewName,
          `$${memberCompletion.variableName}`,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        const resolvedType =
          viewVariableType ??
          (await resolveBladeForeachElementTypeForVariable(
            viewName,
            source,
            offset,
            memberCompletion.variableName,
          ));

        if (!isRequestedRootActive()) {
          return [];
        }

        if (!resolvedType) {
          return [];
        }

        const synthetic = bladeSyntheticPhpMemberAccessSource(
          memberCompletion.variableName,
          resolvedType,
        );
        const members = await resolvePhpReceiverMethodCompletions(
          synthetic.source,
          synthetic.position,
          memberCompletion.receiverExpression,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        const normalizedPrefix = memberCompletion.prefix.toLowerCase();

        return orderPhpMemberCompletionsByCategory(members)
          .filter((member) =>
            member.name.toLowerCase().startsWith(normalizedPrefix),
          )
          .slice(0, 80)
          .map((member) =>
            bladeMemberCompletionItem(member, {
              replaceEnd: memberCompletion.end,
              replaceStart: memberCompletion.start,
            }),
          );
      }

      if (phpLikeCompletion?.kind === "variable") {
        const activePath = activeDocument?.path ?? "";
        const relativePath = activePath
          ? relativeWorkspacePath(requestedRoot, activePath)
          : "";
        const viewName = phpLaravelViewNameFromRelativePath(relativePath);
        const variables = viewName
          ? await collectBladeViewVariablesWithDisplayTypes(viewName)
          : [];

        if (!isRequestedRootActive()) {
          return [];
        }

        // `@foreach` loop variables are locals, not view data, so they are
        // surfaced separately (with the enclosing loop's element type when it
        // resolves) ahead of the view variables and built-ins - so the moment
        // `$` is typed the user sees every in-scope name and its type.
        const foreachVariables = viewName
          ? await collectBladeForeachLoopVariables(
              viewName,
              source,
              offset,
              variables,
            )
          : [];

        if (!isRequestedRootActive()) {
          return [];
        }

        // `collectBladeForeachLoopVariables` already excludes any name present
        // in `variables`, so the three lists never overlap and a plain
        // concatenation keeps each name once (loop vars first for visibility).
        const candidates = [
          ...foreachVariables,
          ...variables,
          ...BLADE_BUILT_IN_VARIABLES,
        ];

        return candidates
          .filter((variable) =>
            variable.name
              .toLowerCase()
              .startsWith(`$${phpLikeCompletion.prefix.toLowerCase()}`),
          )
          .slice(0, 100)
          .map((variable) => ({
            detail: variable.typeHint
              ? `${variable.detail} · ${variable.typeHint}`
              : variable.detail,
            insertText: variable.name,
            kind: "variable",
            label: variable.name,
            replaceEnd: phpLikeCompletion.end,
            replaceStart: phpLikeCompletion.start,
          }));
      }

      if (phpLikeCompletion?.kind === "helper") {
        return bladeLaravelHelperNameCompletions(phpLikeCompletion.prefix, {
          replaceEnd: phpLikeCompletion.end,
          replaceStart: phpLikeCompletion.start,
        });
      }

      if (isLaravelFrameworkActive) {
        const helperCompletion = bladeLaravelHelperCompletionContextAt(
          source,
          position,
        );

        if (helperCompletion) {
          return provideBladeLaravelHelperCompletionItems(
            helperCompletion,
            offset,
            {
              collectPhpLaravelConfigTargets,
              collectPhpLaravelNamedRouteTargets,
              collectPhpLaravelTranslationTargets,
              currentDocumentContent: source,
              currentDocumentPath: activeDocument?.path ?? "",
              isRequestedRootActive,
            },
          );
        }
      }

      const reference = detectBladeReferenceAt(source, offset);

      if (reference?.kind === "view") {
        const targets = await collectPhpLaravelViewTargets();

        if (!isRequestedRootActive()) {
          return [];
        }

        const normalizedPrefix = reference.name.toLowerCase();

        return targets
          .filter((target) => target.name.toLowerCase().startsWith(normalizedPrefix))
          .slice(0, 100)
          .map((target) => ({
            detail: target.relativePath,
            insertText: target.name,
            kind: "view",
            label: target.name,
            replaceEnd: reference.nameEnd,
            replaceStart: reference.nameStart,
          }));
      }

      // Component tags use a dedicated completion detector so the list appears
      // the moment `<x-` is typed (empty prefix) and keeps appearing after a
      // trailing segment dot (`<x-forms.`), unlike the conservative navigation
      // reference detector.
      const componentCompletion = detectBladeComponentCompletionAt(
        source,
        offset,
      );

      if (componentCompletion) {
        const componentNames = await collectBladeComponentNames();

        if (!isRequestedRootActive()) {
          return [];
        }

        const normalizedPrefix = componentCompletion.prefix.toLowerCase();

        return componentNames
          .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
          .slice(0, 100)
          .map((name) => ({
            detail: "Blade component",
            insertText: name,
            kind: "component",
            label: name,
            replaceEnd: componentCompletion.replaceEnd,
            replaceStart: componentCompletion.replaceStart,
          }));
      }

      return [];
    },
    [
      activeDocument,
      collectBladeComponentNames,
      collectBladeForeachLoopVariables,
      collectBladeViewVariablesWithDisplayTypes,
      collectPhpLaravelConfigTargets,
      collectPhpLaravelNamedRouteTargets,
      collectPhpLaravelTranslationTargets,
      collectPhpLaravelViewTargets,
      ensurePhpLaravelMigrationSourcesLoaded,
      ensurePhpLaravelProviderSourcesLoaded,
      isLaravelFrameworkActive,
      resolveBladeForeachElementTypeForVariable,
      resolveBladeViewVariableTypeForView,
      resolvePhpReceiverMethodCompletions,
      workspaceRoot,
    ],
  );

  const provideBladeCodeActions = useCallback(
    async (
      source: string,
      range: PhpCodeActionRange = { end: 0, start: 0 },
    ): Promise<PhpCodeActionDescriptor[]> => {
      return provideBladeCodeActionsFromProvider(source, range, {
        createMissingBladeViewCodeAction,
        currentWorkspaceRootRef,
        workspaceRoot,
      });
    },
    [createMissingBladeViewCodeAction, currentWorkspaceRootRef, workspaceRoot],
  );

  // Cmd+Click navigation for `.blade.php` documents. detectBladeReferenceAt
  // (pure) classifies Blade view/component offsets; Laravel helper literals and
  // typed view-data member access reuse the existing PHP/Laravel resolvers.
  // Conservative: an unresolvable or non-existent reference returns false (no
  // phpactor fallback for blade). Per-project isolation: capture the requested
  // root up front and re-check after every await so a tab switch mid-resolution
  // can never navigate into a stale-workspace file.
  const provideBladeDefinition = useCallback(
    async (source: string, offset: number): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return false;
      }

      if (isInsideBladeComment(source, offset)) {
        return false;
      }

      if (isLaravelFrameworkActive) {
        const helper = bladeLaravelStringLiteralHelperAt(source, offset);

        if (helper?.helper === "view") {
          if (!resolveLaravelViewTarget(helper.literal)) {
            return false;
          }

          const target = await findPhpLaravelViewTarget(helper.literal);

          if (!isRequestedRootActive()) {
            return false;
          }

          return target
            ? openNavigationTarget(target.path, target.position, target.name)
            : false;
        }

        if (helper?.helper === "route") {
          if (!activeDocument) {
            return false;
          }

          const routes = await collectPhpLaravelNamedRouteTargets(
            activeDocument.content,
            activeDocument.path,
          );

          if (!isRequestedRootActive()) {
            return false;
          }

          const target = routes.find(
            (route) =>
              route.name.toLowerCase() === helper.literal.toLowerCase(),
          );

          return target
            ? openNavigationTarget(target.path, target.position, target.name)
            : false;
        }

        if (helper?.helper === "config") {
          if (!resolveLaravelConfigTarget(helper.literal)) {
            return false;
          }

          const target = await findPhpLaravelConfigTarget(helper.literal);

          if (!isRequestedRootActive()) {
            return false;
          }

          return target
            ? openNavigationTarget(target.path, target.position, target.key)
            : false;
        }

        if (helper?.helper === "trans") {
          if (!resolveLaravelTransTarget(helper.literal)) {
            return false;
          }

          const target = await findPhpLaravelTranslationTarget(helper.literal);

          if (!isRequestedRootActive()) {
            return false;
          }

          return target
            ? openNavigationTarget(target.path, target.position, target.key)
            : false;
        }

        const memberContext = phpIdentifierContextAt(
          source,
          editorPositionAtOffset(source, offset),
        );

        if (
          memberContext?.kind === "methodCall" ||
          memberContext?.kind === "memberPropertyAccess"
        ) {
          const activePath = activeDocument?.path ?? "";
          const relativePath = activePath
            ? relativeWorkspacePath(requestedRoot, activePath)
            : "";
          const viewName = phpLaravelViewNameFromRelativePath(relativePath);
          const variableName = memberContext.variableName
            ? `$${memberContext.variableName}`
            : "";
          const memberName =
            memberContext.kind === "methodCall"
              ? memberContext.methodName
              : memberContext.propertyName;

          if (viewName && variableName && memberName) {
            const className = await resolveBladeViewVariableTypeForView(
              viewName,
              variableName,
            );

            if (!isRequestedRootActive()) {
              return false;
            }

            if (className) {
              const openedMethod = await openDirectPhpMethodTarget(
                className,
                memberName,
              );

              if (!isRequestedRootActive()) {
                return false;
              }

              if (openedMethod) {
                return true;
              }

              if (memberContext.kind === "memberPropertyAccess") {
                const openedAttribute = await openPhpLaravelModelAttributeTarget(
                  className,
                  memberName,
                );

                if (!isRequestedRootActive()) {
                  return false;
                }

                if (openedAttribute) {
                  return true;
                }

                return openDirectPhpPropertyTarget(className, memberName);
              }
            }
          }
        }
      }

      const reference = detectBladeReferenceAt(source, offset);

      if (!reference) {
        return false;
      }

      // Components probe the class-based PHP file before the anonymous blade
      // view (PhpStorm parity — Laravel resolves a class component first too).
      const candidateRelativePaths =
        reference.kind === "component"
          ? bladeComponentNavigationCandidateRelativePaths(reference.name)
          : reference.kind === "view"
            ? bladeViewCandidateRelativePaths(reference.name)
            : [];

      if (candidateRelativePaths.length === 0) {
        return false;
      }

      for (const relativePath of candidateRelativePaths) {
        if (!isRequestedRootActive()) {
          return false;
        }

        const path = joinWorkspacePath(requestedRoot, relativePath);

        try {
          await readNavigationFileContent(path);
        } catch {
          if (!isRequestedRootActive()) {
            return false;
          }

          continue;
        }

        if (!isRequestedRootActive()) {
          return false;
        }

        return openNavigationTarget(
          path,
          { column: 1, lineNumber: 1 },
          reference.name,
        );
      }

      return false;
    },
    [
      activeDocument,
      collectPhpLaravelNamedRouteTargets,
      findPhpLaravelConfigTarget,
      findPhpLaravelTranslationTarget,
      findPhpLaravelViewTarget,
      isLaravelFrameworkActive,
      openDirectPhpMethodTarget,
      openDirectPhpPropertyTarget,
      openNavigationTarget,
      openPhpLaravelModelAttributeTarget,
      readNavigationFileContent,
      resolveBladeViewVariableTypeForView,
      workspaceRoot,
    ],
  );

  const resetBladeIntelligenceCaches = useCallback((): void => {
    bladeViewDataEntriesByRootRef.current = {};
    bladeViewDataEntriesLoadInFlightRef.current = new Map();
    bladeComponentNamesByRootRef.current = {};
  }, []);

  return {
    provideBladeCodeActions,
    provideBladeCompletions,
    provideBladeDefinition,
    invalidateBladeComponentNamesForPath,
    invalidateBladeViewDataEntriesForPath,
    resetBladeIntelligenceCaches,
  };
}

// Relation-chain hops resolved per `@foreach` collection expression, e.g.
// `$node->children->children->...`. Consistent with the other chain
// resolvers in this file (`resolvePhpExpressionType`'s `depth > 8`), a chain
// past the cap is rejected outright rather than partially walked, so an
// adversarial/self-referencing relation chain in Blade source cannot trigger
// an unbounded run of sequential file-read awaits.
const BLADE_FOREACH_MAX_RELATION_CHAIN_LENGTH = 8;

const BLADE_BUILT_IN_VARIABLES: PhpLaravelViewVariable[] = [
  {
    detail: "Laravel Blade variable",
    name: "$errors",
    typeHint: "ViewErrorBag",
    valueExpression: null,
    valueOffset: null,
  },
  {
    detail: "Laravel Blade variable",
    name: "$loop",
    typeHint: "Loop",
    valueExpression: null,
    valueOffset: null,
  },
];
