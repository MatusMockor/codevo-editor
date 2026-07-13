import {
  detectLatteReferenceAt,
} from "../domain/latteNavigation";
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
  latteFilterDefinitionContext,
  latteExpressionResolutionContext,
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

export async function provideLatteDefinition(
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

  if (isLattePresenterLinkIntelligenceActive(deps, options.frameworkCapabilities)) {
    const linkHandled = await resolveNetteLinkDefinition(
      nettePresenterLinkDefinitionContext(options, request),
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

  const expressionNavigation = latteExpressionNavigationAt(source, offset);

  const variableHandled = await resolveNettePresenterVariableDefinition(
    latteExpressionResolutionContext(options, request),
    source,
    offset,
    expressionNavigation,
  );

  if (variableHandled) {
    return true;
  }

  const memberHandled = await resolveLatteMemberDefinition(
    latteExpressionResolutionContext(options, request),
    source,
    offset,
    expressionNavigation,
  );

  if (memberHandled) {
    return true;
  }

  const filterHandled = await resolveLatteFilterDefinition(
    latteFilterDefinitionContext(options, request),
    source,
    offset,
  );

  if (filterHandled) {
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
