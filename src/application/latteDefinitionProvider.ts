import {
  detectLatteReferenceAt,
} from "../domain/latteNavigation";
import {
  resolveLatteBlockDefinition,
} from "./latteBlockDefinitions";
import {
  resolveLatteMemberDefinition,
  resolveNettePresenterVariableDefinition,
} from "./latteExpressionIntelligence";
import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
  isLattePresenterLinkIntelligenceActive,
} from "./latteIntelligenceRuntime";
import {
  netteControlReferenceAt,
  resolveNetteControlDefinition,
} from "./netteControlComponents";
import {
  resolveNetteLinkDefinition,
} from "./nettePresenterLinkDefinitions";
import {
  isLatteScanSkippedDirectory,
  resolveLatteTemplateDefinition,
} from "./netteTemplates";
import {
  evictLatteProviderCaches,
  LATTE_MAX_COMPLETIONS,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";

export async function provideLatteDefinition(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
): Promise<boolean> {
  const deps = options.getDependencies();
  evictLatteProviderCaches(options.caches, deps.workspaceRoot);

  const workspaceContext = activeLatteWorkspaceContext(
    deps,
    options.frameworkCapabilities,
  );

  if (!workspaceContext) {
    return false;
  }

  const { isRequestedRootActive, requestedRoot } = workspaceContext;
  const currentTemplateRelativePath = currentTemplatePath(deps, requestedRoot);

  if (isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
    const linkHandled = await resolveNetteLinkDefinition(
      {
        currentRelativePath: currentTemplateRelativePath,
        deps,
        frameworkCapabilities: options.frameworkCapabilities,
        isDirectorySkipped: isLatteScanSkippedDirectory,
        isRequestedRootActive,
        maxDepth: MAX_LATTE_SCAN_DEPTH,
        maxPresenters: MAX_LATTE_TEMPLATE_FILES,
        requestedRoot,
      },
      options.frameworkCapabilities.detectLattePresenterLinkAt(source, offset),
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
      frameworkCapabilities: options.frameworkCapabilities,
      isRequestedRootActive,
      maxCompletions: LATTE_MAX_COMPLETIONS,
      requestedRoot,
      templateTypeCache: options.caches.templateTypeCache,
      templateTypeInFlight: options.inFlight.templateTypeInFlight,
      viewDataCache: options.caches.viewDataCache,
      viewDataInFlight: options.inFlight.viewDataInFlight,
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
      frameworkCapabilities: options.frameworkCapabilities,
      isRequestedRootActive,
      maxCompletions: LATTE_MAX_COMPLETIONS,
      requestedRoot,
      templateTypeCache: options.caches.templateTypeCache,
      templateTypeInFlight: options.inFlight.templateTypeInFlight,
      viewDataCache: options.caches.viewDataCache,
      viewDataInFlight: options.inFlight.viewDataInFlight,
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
}
