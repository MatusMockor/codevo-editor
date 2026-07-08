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

export async function provideNettePhpLinkDefinition(
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

export async function provideNettePhpLinkCompletions(
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
