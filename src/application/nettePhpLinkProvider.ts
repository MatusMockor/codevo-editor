import { detectNetteCreateComponentAt } from "../domain/netteComponents";
import {
  phpFrameworkPhpPresenterLinkAt,
  phpFrameworkPhpPresenterLinkCompletionAt,
} from "../domain/phpFrameworkTemplateDispatch";
import type { LatteCompletionItem } from "./latteCompletionItems";
import {
  isLattePresenterLinkIntelligenceActive,
  isLatteSemanticActive,
} from "./latteIntelligenceRuntime";
import { resolveNetteCreateComponentReverse } from "./netteControlComponents";
import {
  lattePresenterLinkCompletions,
} from "./nettePresenterLinkCompletions";
import { resolveNettePresenterLink } from "./nettePresenterLinkDefinitions";
import {
  nettePresenterLinkCompletionContext,
  nettePresenterLinkDefinitionContext,
} from "./netteLatteProviderOptions";
import {
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import {
  guardedLatteProviderRequestContext,
  latteProviderRequestContext,
} from "./latteProviderRequestContext";
import type { NavigationRequest } from "./navigationRequest";

export async function providePhpPresenterLinkDefinition(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
  navigationRequest?: NavigationRequest,
): Promise<boolean> {
  const request = guardedLatteProviderRequestContext(
    latteProviderRequestContext(options),
    navigationRequest,
  );

  if (!request) {
    return false;
  }

  const {
    currentTemplateRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = request;
  const detection = phpFrameworkPhpPresenterLinkAt(
    source,
    offset,
    deps.frameworkIntelligence.providers,
  );

  if (detection) {
    if (!isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
      return false;
    }

    return resolveNettePresenterLink(
      nettePresenterLinkDefinitionContext(options, request),
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

export function isPhpPresenterLinkCompletionContext(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
): boolean {
  const deps = options.getDependencies();

  if (!isLatteSemanticActive(deps, options.frameworkCapabilities)) {
    return false;
  }

  if (!isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
    return false;
  }

  return Boolean(
    phpFrameworkPhpPresenterLinkCompletionAt(
      source,
      offset,
      deps.frameworkIntelligence.providers,
    ),
  );
}

/**
 * @deprecated Use {@link providePhpPresenterLinkDefinition}.
 */
export async function provideNettePhpLinkDefinition(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
  request?: NavigationRequest,
): Promise<boolean> {
  return providePhpPresenterLinkDefinition(options, source, offset, request);
}

export async function providePhpPresenterLinkCompletions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
): Promise<LatteCompletionItem[] | null> {
  const request = latteProviderRequestContext(options);

  if (!request) {
    return null;
  }

  const { deps } = request;

  if (!isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
    return null;
  }

  const linkCompletion = phpFrameworkPhpPresenterLinkCompletionAt(
    source,
    offset,
    deps.frameworkIntelligence.providers,
  );

  if (!linkCompletion) {
    return null;
  }

  return lattePresenterLinkCompletions(
    nettePresenterLinkCompletionContext(options, request),
    linkCompletion,
  );
}

/**
 * @deprecated Use {@link providePhpPresenterLinkCompletions}.
 */
export async function provideNettePhpLinkCompletions(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
): Promise<LatteCompletionItem[] | null> {
  return providePhpPresenterLinkCompletions(options, source, offset);
}
