import {
  currentNetteControlClassName as resolveCurrentNetteControlClassName,
  currentNettePresenterClassName as resolveCurrentNettePresenterClassName,
  resolveNetteControlVariableDefinition as resolveNetteCurrentControlVariableDefinition,
} from "./netteCurrentClasses";
import {
  resolveLatteMemberDefinition as resolveLatteExpressionMemberDefinition,
  resolveNettePresenterVariableDefinition as resolveLattePresenterVariableDefinition,
} from "./latteExpressionDefinitions";
import {
  latteExpressionCompletionTargetAt,
  latteMemberReferenceAt,
  type LatteExpressionNavigation,
} from "./latteExpressionDetection";
import {
  latteExpressionCompletions as resolveLatteExpressionCompletions,
} from "./latteExpressionCompletions";
import {
  latteCandidateViewNames as resolveLatteCandidateViewNames,
} from "./netteLatteCandidateViewNames";
import {
  loadNetteViewDataEntries,
  type NetteViewDataCache,
  type NetteViewDataEntry,
  type NetteViewDataInFlight,
} from "./netteViewDataEntries";
import {
  loadNetteInheritedPresenterViewData,
  type NetteInheritedPresenterViewDataCache,
  type NetteInheritedPresenterViewDataInFlight,
} from "./netteInheritedPresenterViewData";
import {
  latteTemplateTypePropertySightings as netteTemplateTypePropertySightings,
  type LatteTemplateTypeCache,
  type LatteTemplateTypeInFlight,
} from "./netteTemplateTypes";
import {
  collectLatteVariableCandidates as collectNetteLatteVariableCandidates,
  type LatteVariableCandidate,
} from "./latteVariableCandidates";
import {
  resolveLatteVariableType as resolveNetteLatteVariableType,
} from "./latteVariableTypeResolver";
import type { LatteCompletionItem } from "./latteCompletionItems";
import type { NetteIncludedTemplateArgument } from "./netteIncludedTemplateArguments";
import type {
  LatteFrameworkCapabilities,
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { ResolvedLatteProjectFilter } from "./latteFilterCallableResolution";
import { parseLatteForeachCollection } from "../domain/latteSyntax";
import type { EditorPosition } from "../domain/languageServerFeatures";
import { resolveNetteLatteComponentReceiverType } from "./netteLatteComponentReceiverTypes";
import type { NetteFactoryTemplateOwner } from "./netteFactoryTemplateOwners";

const LATTE_VIEW_DATA_CACHE_TTL_MS = 5_000;
const LATTE_VIEW_DATA_SEARCH_LIMIT = 200;
const LATTE_TEMPLATE_TYPE_SEARCH_LIMIT = 50;
const LATTE_TEMPLATE_TYPE_CACHE_TTL_MS = 5_000;
const MAX_LATTE_TYPE_RESOLUTION_DEPTH = 8;
const PHP_EXTENSION = ".php";
const PRESENTER_SUFFIX = "Presenter.php";
const CONTROL_SUFFIX = "Control.php";

export type LatteViewDataCache = NetteViewDataCache;
export type LatteViewDataInFlight = NetteViewDataInFlight;

interface LatteInheritedViewDataState {
  cache: NetteInheritedPresenterViewDataCache;
  inFlight: NetteInheritedPresenterViewDataInFlight;
}

const inheritedViewDataStateByCache = new WeakMap<
  LatteViewDataCache,
  LatteInheritedViewDataState
>();

export interface LatteExpressionResolutionContext {
  collectProjectFilters(
    prefix: string,
  ): Promise<readonly ResolvedLatteProjectFilter[]>;
  readonly currentTemplateRelativePath: string;
  deps: LatteIntelligenceDependencies;
  forTemplate(relativePath: string): LatteExpressionResolutionContext;
  frameworkCapabilities: LatteFrameworkCapabilities;
  isRequestedRootActive: () => boolean;
  loadFactoryTemplateOwner(
    templatePath: string,
  ): Promise<NetteFactoryTemplateOwner | null>;
  loadIncludedTemplateArguments(
    targetRelativePath: string,
  ): Promise<readonly NetteIncludedTemplateArgument[]>;
  maxCompletions: number;
  requestedRoot: string;
  templateTypeCache: LatteTemplateTypeCache;
  templateTypeInFlight: LatteTemplateTypeInFlight;
  viewDataCache: LatteViewDataCache;
  viewDataInFlight: LatteViewDataInFlight;
}

interface LatteReceiverTypeOverride {
  receiverExpression: string;
  typeName: string;
}

export async function resolveNettePresenterVariableDefinition(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  navigation?: LatteExpressionNavigation,
): Promise<boolean> {
  return resolveLattePresenterVariableDefinition(
    latteExpressionDefinitionContext(context),
    source,
    offset,
    navigation,
  );
}

export async function resolveLatteMemberDefinition(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  navigation?: LatteExpressionNavigation,
): Promise<boolean> {
  const member = navigation
    ? navigation.memberReference
    : latteMemberReferenceAt(source, offset);
  const receiverOverride = member
    ? await netteReceiverTypeOverride(context, member.receiverExpression)
    : null;

  if (!context.isRequestedRootActive()) {
    return false;
  }

  return resolveLatteExpressionMemberDefinition(
    latteExpressionDefinitionContext(context, receiverOverride),
    source,
    offset,
    navigation,
  );
}

export async function latteExpressionCompletions(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
): Promise<LatteCompletionItem[]> {
  const target = latteExpressionCompletionTargetAt(source, offset);
  const receiverOverride = target?.kind === "member"
    ? await netteReceiverTypeOverride(context, target.member.receiverExpression)
    : null;

  if (!context.isRequestedRootActive()) {
    return [];
  }

  return resolveLatteExpressionCompletions(
    latteExpressionCompletionContext(context, receiverOverride),
    source,
    offset,
  );
}

function latteExpressionDefinitionContext(
  context: LatteExpressionResolutionContext,
  receiverOverride: LatteReceiverTypeOverride | null = null,
) {
  return {
    currentTemplateRelativePath: context.currentTemplateRelativePath,
    deps: receiverOverrideDependencies(context, receiverOverride),
    isRequestedRootActive: context.isRequestedRootActive,
    loadIncludedTemplateArguments: context.loadIncludedTemplateArguments,
    loadViewDataEntries: () => loadLatteViewDataEntries(context),
    requestedRoot: context.requestedRoot,
    resolveControlVariableDefinition: () =>
      resolveNetteControlVariableDefinition(context),
    resolveVariableType: (
      source: string,
      offset: number,
      variableName: string,
      depth: number,
    ) => {
      if (receiverOverride && variableName === "control") {
        return Promise.resolve(receiverOverride.typeName);
      }

      return resolveLatteExpressionVariableType(
        context,
        source,
        offset,
        variableName,
        depth,
      );
    },
    viewNames: () => latteCandidateViewNames(context),
  };
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

function latteExpressionCompletionContext(
  context: LatteExpressionResolutionContext,
  receiverOverride: LatteReceiverTypeOverride | null = null,
) {
  return {
    collectFilters: context.collectProjectFilters,
    collectVariableCandidates: (source: string, offset: number) =>
      collectLatteVariableCandidates(context, source, offset),
    deps: receiverOverrideDependencies(context, receiverOverride),
    isRequestedRootActive: context.isRequestedRootActive,
    maxCompletions: context.maxCompletions,
    resolveVariableType: (
      source: string,
      offset: number,
      variableName: string,
      depth: number,
    ) => {
      if (receiverOverride && variableName === "control") {
        return Promise.resolve(receiverOverride.typeName);
      }

      return resolveLatteExpressionVariableType(
        context,
        source,
        offset,
        variableName,
        depth,
      );
    },
  };
}

function receiverOverrideDependencies(
  context: LatteExpressionResolutionContext,
  receiverOverride: LatteReceiverTypeOverride | null,
): LatteIntelligenceDependencies {
  if (!receiverOverride) {
    return context.deps;
  }

  return {
    ...context.deps,
    resolvePhpReceiverCompletions: (source, position, receiverExpression) => {
      if (receiverExpression === receiverOverride.receiverExpression) {
        return context.deps.resolvePhpReceiverCompletions(
          source,
          position,
          "$control",
        );
      }

      return context.deps.resolvePhpReceiverCompletions(
        source,
        position,
        receiverExpression,
      );
    },
  };
}

async function netteReceiverTypeOverride(
  context: LatteExpressionResolutionContext,
  receiverExpression: string,
): Promise<LatteReceiverTypeOverride | null> {
  if (!hasNetteProvider(context)) {
    return null;
  }

  const typeName = await resolveNetteLatteComponentReceiverType(
    {
      deps: context.deps,
      isRequestedRootActive: context.isRequestedRootActive,
      requestedRoot: context.requestedRoot,
      templateRelativePath: context.currentTemplateRelativePath,
    },
    receiverExpression,
  );

  if (!context.isRequestedRootActive() || !typeName) {
    return null;
  }

  return { receiverExpression, typeName };
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

export async function resolveLatteExpressionVariableType(
  context: LatteExpressionResolutionContext,
  source: string,
  offset: number,
  variableName: string,
  depth = 0,
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
    currentTemplateRelativePath: context.currentTemplateRelativePath,
    deps: context.deps,
    isRequestedRootActive: context.isRequestedRootActive,
    loadIncludedTemplateArguments: context.loadIncludedTemplateArguments,
    loadTemplateTypePropertySightings: (source: string) =>
      netteTemplateTypePropertySightings(
        latteTemplateTypeContext(context),
        source,
      ),
    loadViewDataEntries: () => loadLatteViewDataEntries(context),
    maxTypeResolutionDepth: MAX_LATTE_TYPE_RESOLUTION_DEPTH,
    resolveExpressionTypeAt: (
      source: string,
      expression: string,
      offset: number,
      depth: number,
    ) => resolveLatteExpressionTypeAt(context, source, expression, offset, depth),
    supportsNetteImplicitUser: hasNetteProvider(context),
    viewNames: () => latteCandidateViewNames(context),
  };
}

async function resolveLatteExpressionTypeAt(
  context: LatteExpressionResolutionContext,
  source: string,
  expression: string,
  offset: number,
  depth: number,
): Promise<string | null> {
  if (depth > MAX_LATTE_TYPE_RESOLUTION_DEPTH) {
    return null;
  }

  const parsed = parseLatteForeachCollection(expression);

  if (!parsed) {
    const document = `<?php\n${expression};\n`;
    const type = await context.deps.resolveExpressionType(
      document,
      editorPositionAtOffset(document, document.length),
      expression,
    );

    if (!context.isRequestedRootActive()) {
      return null;
    }

    return type;
  }

  const rootType = await resolveLatteExpressionVariableType(
    context,
    source,
    offset,
    parsed.rootVariableName,
    depth,
  );

  if (!context.isRequestedRootActive() || !rootType) {
    return null;
  }

  if (parsed.expression === `$${parsed.rootVariableName}`) {
    return rootType;
  }

  const document = `<?php\n/** @var \\${rootType.replace(/^\\+/, "")} $${
    parsed.rootVariableName
  } */\n${parsed.expression};\n`;
  const type = await context.deps.resolveExpressionType(
    document,
    editorPositionAtOffset(document, document.length),
    parsed.expression,
  );

  if (!context.isRequestedRootActive()) {
    return null;
  }

  return type;
}

function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
  const prefix = source.slice(0, Math.max(0, Math.min(offset, source.length)));
  const lines = prefix.split("\n");

  return {
    column: (lines[lines.length - 1]?.length ?? 0) + 1,
    lineNumber: lines.length,
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
  const {
    currentTemplateRelativePath: templateRelativePath,
    deps,
    isRequestedRootActive,
    loadFactoryTemplateOwner,
    requestedRoot,
  } = context;

  if (!templateRelativePath) {
    return null;
  }

  return {
    createComponentSearchLimit: LATTE_VIEW_DATA_SEARCH_LIMIT,
    deps,
    isRequestedRootActive,
    loadFactoryTemplateOwner,
    phpExtension: PHP_EXTENSION,
    requestedRoot,
    supportsComponentFactoryViewData:
      deps.frameworkIntelligence.capabilities.supports(
        "viewDataComponentFactories",
      ),
    templateRelativePath,
  };
}

async function loadLatteViewDataEntries(
  context: LatteExpressionResolutionContext,
): Promise<NetteViewDataEntry[]> {
  const {
    viewDataCache,
    deps,
    frameworkCapabilities,
    isRequestedRootActive,
    requestedRoot,
    viewDataInFlight,
  } = context;

  const existingEntriesLoad = loadNetteViewDataEntries({
    cache: viewDataCache,
    deps,
    frameworkCapabilities,
    inFlight: viewDataInFlight,
    isRequestedRootActive,
    phpExtension: PHP_EXTENSION,
    providers: deps.frameworkIntelligence.providers,
    requestedRoot,
    searchLimit: LATTE_VIEW_DATA_SEARCH_LIMIT,
    supportsComponentFactoryViewData:
      deps.frameworkIntelligence.capabilities.supports(
        "viewDataComponentFactories",
      ),
    ttlMs: LATTE_VIEW_DATA_CACHE_TTL_MS,
  });
  const templateRelativePath = context.currentTemplateRelativePath;

  if (!templateRelativePath || !hasNetteProvider(context)) {
    return existingEntriesLoad;
  }

  const inheritedState = inheritedViewDataState(viewDataCache);
  const inheritedEntriesLoad = loadNetteInheritedPresenterViewData({
    cache: inheritedState.cache,
    deps,
    inFlight: inheritedState.inFlight,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
    ttlMs: LATTE_VIEW_DATA_CACHE_TTL_MS,
  });
  const [inheritedEntries, existingEntries] = await Promise.all([
    inheritedEntriesLoad,
    existingEntriesLoad,
  ]);

  return [...inheritedEntries, ...existingEntries];
}

export function evictLatteInheritedViewDataCaches(
  viewDataCache: LatteViewDataCache,
  requestedRoot: string | null,
): void {
  const state = inheritedViewDataStateByCache.get(viewDataCache);

  if (!state) {
    return;
  }

  const retainedCache: NetteInheritedPresenterViewDataCache = {};
  let hasStaleState = false;

  for (const key of Object.keys(state.cache)) {
    if (inheritedCacheKeyMatchesRoot(key, requestedRoot)) {
      retainedCache[key] = state.cache[key]!;
      continue;
    }

    hasStaleState = true;
  }

  for (const key of state.inFlight.keys()) {
    if (inheritedCacheKeyMatchesRoot(key, requestedRoot)) {
      continue;
    }

    hasStaleState = true;
  }

  if (!hasStaleState) {
    return;
  }

  state.cache = retainedCache;
  state.inFlight = new Map();
}

export function invalidateLatteInheritedViewDataForRoot(
  viewDataCache: LatteViewDataCache,
  requestedRoot: string,
): void {
  const state = inheritedViewDataStateByCache.get(viewDataCache);

  if (!state) {
    return;
  }

  for (const key of Object.keys(state.cache)) {
    if (inheritedCacheKeyMatchesRoot(key, requestedRoot)) {
      delete state.cache[key];
    }
  }

  for (const key of state.inFlight.keys()) {
    if (inheritedCacheKeyMatchesRoot(key, requestedRoot)) {
      state.inFlight.delete(key);
    }
  }
}

function inheritedViewDataState(
  viewDataCache: LatteViewDataCache,
): LatteInheritedViewDataState {
  const existing = inheritedViewDataStateByCache.get(viewDataCache);

  if (existing) {
    return existing;
  }

  const created = {
    cache: {},
    inFlight: new Map(),
  };
  inheritedViewDataStateByCache.set(viewDataCache, created);
  return created;
}

function inheritedCacheKeyMatchesRoot(
  key: string,
  requestedRoot: string | null,
): boolean {
  const separator = key.indexOf("\u0000");
  const cachedRoot = separator >= 0 ? key.slice(0, separator) : key;

  return workspaceRootKeysEqual(cachedRoot, requestedRoot);
}

function hasNetteProvider(
  context: LatteExpressionResolutionContext,
): boolean {
  return context.deps.frameworkIntelligence.hasProvider("nette");
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
  const {
    currentTemplateRelativePath: templateRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = context;

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
