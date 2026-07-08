import { detectNetteCreateComponentAt } from "../domain/netteComponents";
import type { LatteCompletionItem } from "./latteCompletionItems";
import {
  isLattePresenterLinkIntelligenceActive,
} from "./latteIntelligenceRuntime";
import { resolveNetteCreateComponentReverse } from "./netteControlComponents";
import {
  lattePresenterLinkCompletions,
} from "./nettePresenterLinkCompletions";
import { resolveNettePresenterLink } from "./nettePresenterLinkDefinitions";
import { isLatteScanSkippedDirectory } from "./netteTemplateDiscovery";
import {
  activeLatteProviderRequest,
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
  const request = activeLatteProviderRequest(options);

  if (!request) {
    return false;
  }

  const {
    currentTemplateRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = request;
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
        currentRelativePath: currentTemplateRelativePath,
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
    currentTemplateRelativePath,
  );
}

export async function provideNettePhpLinkCompletions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
): Promise<LatteCompletionItem[] | null> {
  const request = activeLatteProviderRequest(options);

  if (!request) {
    return null;
  }

  const {
    currentTemplateRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = request;

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

  return lattePresenterLinkCompletions(
    {
      cache: options.caches.presenterCache,
      currentRelativePath: currentTemplateRelativePath,
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
