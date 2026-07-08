import { detectNetteCreateComponentAt } from "../domain/netteComponents";
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
  latteProviderRequestContext,
} from "./latteProviderRequestContext";

export async function providePhpPresenterLinkDefinition(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
): Promise<boolean> {
  const request = latteProviderRequestContext(options);

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
    options.frameworkCapabilities.presenterLinkCompletionContextAt(
      source,
      offset,
      "php",
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
): Promise<boolean> {
  return providePhpPresenterLinkDefinition(options, source, offset);
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
