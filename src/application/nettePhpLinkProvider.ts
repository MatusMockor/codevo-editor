import { detectNetteCreateComponentAt } from "../domain/netteComponents";
import type { LatteCompletionItem } from "./latteCompletionItems";
import {
  activeLatteWorkspaceContext,
  currentTemplatePath,
  isLattePresenterLinkIntelligenceActive,
} from "./latteIntelligenceRuntime";
import { resolveNetteCreateComponentReverse } from "./netteControlComponents";
import {
  lattePresenterLinkCompletions,
  resolveNettePresenterLink,
} from "./nettePresenterLinks";
import { isLatteScanSkippedDirectory } from "./netteTemplates";
import {
  evictLatteProviderCaches,
  LATTE_PRESENTER_CACHE_TTL_MS,
  MAX_LATTE_SCAN_DEPTH,
  MAX_LATTE_TEMPLATE_FILES,
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";

export async function provideNettePhpLinkDefinition(
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
  const detection = options.frameworkCapabilities.detectPhpPresenterLinkAt(
    source,
    offset,
  );

  if (detection) {
    if (!isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
      return false;
    }

    return resolveNettePresenterLink(
      {
        currentRelativePath: currentTemplatePath(deps, requestedRoot),
        deps,
        frameworkCapabilities: options.frameworkCapabilities,
        isDirectorySkipped: isLatteScanSkippedDirectory,
        isRequestedRootActive,
        maxDepth: MAX_LATTE_SCAN_DEPTH,
        maxPresenters: MAX_LATTE_TEMPLATE_FILES,
        requestedRoot,
      },
      options.frameworkCapabilities.parsePresenterLinkTarget(detection.target),
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
}

export async function provideNettePhpLinkCompletions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
): Promise<LatteCompletionItem[] | null> {
  const deps = options.getDependencies();
  evictLatteProviderCaches(options.caches, deps.workspaceRoot);

  const workspaceContext = activeLatteWorkspaceContext(
    deps,
    options.frameworkCapabilities,
  );

  if (!workspaceContext) {
    return null;
  }

  if (!isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
    return null;
  }

  const linkCompletion =
    options.frameworkCapabilities.presenterLinkCompletionContextAt(
      source,
      offset,
      "php",
    );

  if (!linkCompletion) {
    return null;
  }

  const { isRequestedRootActive, requestedRoot } = workspaceContext;

  return lattePresenterLinkCompletions(
    {
      cache: options.caches.presenterCache,
      currentRelativePath: currentTemplatePath(deps, requestedRoot),
      deps,
      frameworkCapabilities: options.frameworkCapabilities,
      inFlight: options.inFlight.presenterInFlight,
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
