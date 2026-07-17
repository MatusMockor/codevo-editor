import {
  detectLatteReferenceAt,
} from "../domain/latteNavigation";
import {
  detectNetteLatteSnippetAt,
} from "../domain/netteAjaxSnippets";
import {
  resolveNetteAjaxSnippetDefinition,
} from "./netteAjaxSnippetDefinitions";
import {
  resolveLatteBlockDefinition,
} from "./latteBlockDefinitions";
import {
  latteExpressionNavigationAt,
} from "./latteExpressionDetection";
import {
  resolveLatteFilterDefinition,
} from "./latteFilterDefinitions";
import {
  latteFunctionDefinitionContext,
  resolveLatteFunctionDefinition,
} from "./latteFunctionDefinitions";
import {
  resolveLatteMemberDefinition,
  resolveNettePresenterVariableDefinition,
} from "./latteExpressionIntelligence";
import {
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
  resolveLatteTemplateDefinition,
} from "./netteTemplateDefinitions";
import {
  resolveLatteTranslationDefinition,
} from "./latteTranslationTargets";
import {
  latteFilterDefinitionContext,
  latteExpressionResolutionContext,
  netteControlCompletionContext,
  nettePresenterLinkDefinitionContext,
} from "./netteLatteProviderOptions";
import {
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import {
  guardedLatteProviderRequestContext,
  latteProviderRequestContext,
} from "./latteProviderRequestContext";
import type { LatteDefinitionOutcome } from "./latteIntelligenceContracts";
import type { NavigationRequest } from "./navigationRequest";

export async function provideLatteDefinition(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
  navigationRequest?: NavigationRequest,
): Promise<boolean> {
  const outcome = await provideLatteDefinitionOutcome(
    options,
    source,
    offset,
    navigationRequest,
  );

  return outcome.handled;
}

export async function provideLatteDefinitionOutcome(
  options: LatteProviderFlowFactoryOptions,
  source: string,
  offset: number,
  navigationRequest?: NavigationRequest,
): Promise<LatteDefinitionOutcome> {
  const request = guardedLatteProviderRequestContext(
    latteProviderRequestContext(options),
    navigationRequest,
  );

  if (!request) {
    return latteDefinitionOutcome(false, false);
  }

  const {
    currentTemplateRelativePath,
    deps,
    isRequestedRootActive,
    requestedRoot,
  } = request;

  if (isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
    const linkHandled = await resolveNetteLinkDefinition(
      nettePresenterLinkDefinitionContext(options, request),
      options.frameworkCapabilities.detectLattePresenterLinkAt(source, offset),
    );

    if (linkHandled) {
      return latteDefinitionOutcome(true, false);
    }
  }

  const controlHandled = await resolveNetteControlDefinition(
    deps,
    requestedRoot,
    isRequestedRootActive,
    netteControlReferenceAt(source, offset),
    currentTemplateRelativePath,
    netteControlCompletionContext(options, request),
  );

  if (controlHandled) {
    return latteDefinitionOutcome(true, false);
  }

  const ajaxSnippetHandled = await resolveNetteAjaxSnippetDefinition(
    {
      currentTemplateRelativePath,
      deps,
      isRequestedRootActive,
      requestedRoot,
    },
    detectNetteLatteSnippetAt(source, offset),
  );

  if (ajaxSnippetHandled) {
    return latteDefinitionOutcome(true, false);
  }

  const translationHandled = await resolveLatteTranslationDefinition(
    request,
    source,
    offset,
  );

  if (translationHandled) {
    return latteDefinitionOutcome(true, false);
  }

  const expressionNavigation = latteExpressionNavigationAt(source, offset);
  const shouldBlockFallback = expressionNavigation.memberReference !== null;

  const variableHandled = await resolveNettePresenterVariableDefinition(
    latteExpressionResolutionContext(options, request),
    source,
    offset,
    expressionNavigation,
  );

  if (variableHandled) {
    return latteDefinitionOutcome(true, shouldBlockFallback);
  }

  const memberHandled = await resolveLatteMemberDefinition(
    latteExpressionResolutionContext(options, request),
    source,
    offset,
    expressionNavigation,
  );

  if (memberHandled) {
    return latteDefinitionOutcome(true, shouldBlockFallback);
  }

  const filterHandled = await resolveLatteFilterDefinition(
    latteFilterDefinitionContext(options, request),
    source,
    offset,
  );

  if (filterHandled) {
    return latteDefinitionOutcome(true, shouldBlockFallback);
  }

  const functionHandled = await resolveLatteFunctionDefinition(
    latteFunctionDefinitionContext(options, request),
    source,
    offset,
  );

  if (functionHandled) {
    return latteDefinitionOutcome(true, shouldBlockFallback);
  }

  const reference = detectLatteReferenceAt(source, offset);

  if (reference?.kind === "control") {
    const handled = await resolveNetteControlDefinition(
      deps,
      requestedRoot,
      isRequestedRootActive,
      { name: reference.name },
      currentTemplateRelativePath,
      netteControlCompletionContext(options, request),
    );

    return latteDefinitionOutcome(handled, shouldBlockFallback);
  }

  if (reference?.kind === "block") {
    const handled = await resolveLatteBlockDefinition(
      deps,
      source,
      reference,
      currentTemplateRelativePath,
    );

    return latteDefinitionOutcome(handled, shouldBlockFallback);
  }

  if (reference && reference.kind !== "template") {
    return latteDefinitionOutcome(false, shouldBlockFallback);
  }

  const handled = await resolveLatteTemplateDefinition(
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

  return latteDefinitionOutcome(handled, shouldBlockFallback);
}

function latteDefinitionOutcome(
  handled: boolean,
  shouldBlockFallback: boolean,
): LatteDefinitionOutcome {
  return { handled, shouldBlockFallback };
}
