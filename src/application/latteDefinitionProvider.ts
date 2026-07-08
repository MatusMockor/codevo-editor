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
  latteExpressionResolutionContext,
  nettePresenterLinkDefinitionContext,
} from "./netteLatteProviderOptions";
import {
  type LatteProviderFlowFactoryOptions,
} from "./latteProviderFlowContext";
import {
  latteProviderRequestContext,
} from "./latteProviderRequestContext";

export async function provideLatteDefinition(
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

  const variableHandled = await resolveNettePresenterVariableDefinition(
    latteExpressionResolutionContext(options, request),
    source,
    offset,
  );

  if (variableHandled) {
    return true;
  }

  const memberHandled = await resolveLatteMemberDefinition(
    latteExpressionResolutionContext(options, request),
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
