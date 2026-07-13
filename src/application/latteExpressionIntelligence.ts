import {
  currentNetteControlClassName as resolveCurrentNetteControlClassName,
  currentNettePresenterClassName as resolveCurrentNettePresenterClassName,
  resolveNetteControlVariableDefinition as resolveNetteCurrentControlVariableDefinition,
} from "./netteCurrentClasses";
import {
  resolveLatteMemberDefinition as resolveLatteExpressionMemberDefinition,
  resolveNettePresenterVariableDefinition as resolveLattePresenterVariableDefinition,
} from "./latteExpressionDefinitions";
import type { LatteExpressionNavigation } from "./latteExpressionDetection";
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
import {
  currentTemplatePath,
} from "./latteIntelligenceRuntime";
import type { LatteCompletionItem } from "./latteCompletionItems";
import type {
  LatteFrameworkCapabilities,
  LatteIntelligenceDependencies,
} from "./latteIntelligenceContracts";

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

export interface LatteExpressionResolutionContext {
  collectProjectFilterNames(): Promise<readonly string[]>;
  deps: LatteIntelligenceDependencies;
  frameworkCapabilities: LatteFrameworkCapabilities;
  isRequestedRootActive: () => boolean;
  maxCompletions: number;
  requestedRoot: string;
  templateTypeCache: LatteTemplateTypeCache;
  templateTypeInFlight: LatteTemplateTypeInFlight;
  viewDataCache: LatteViewDataCache;
  viewDataInFlight: LatteViewDataInFlight;
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
  return resolveLatteExpressionMemberDefinition(
    latteExpressionDefinitionContext(context),
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
  return resolveLatteExpressionCompletions(
    latteExpressionCompletionContext(context),
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
) {
  return {
    collectFilterNames: context.collectProjectFilterNames,
    collectVariableCandidates: (source: string, offset: number) =>
      collectLatteVariableCandidates(context, source, offset),
    deps: context.deps,
    isRequestedRootActive: context.isRequestedRootActive,
    maxCompletions: context.maxCompletions,
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
    requestedRoot,
    supportsComponentFactoryViewData:
      deps.frameworkIntelligence.capabilities.supports(
        "viewDataComponentFactories",
      ),
    templateRelativePath,
  };
}

function loadLatteViewDataEntries(
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
    supportsComponentFactoryViewData:
      deps.frameworkIntelligence.capabilities.supports(
        "viewDataComponentFactories",
      ),
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
