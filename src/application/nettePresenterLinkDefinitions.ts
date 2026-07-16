import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import { findNetteFactoryTemplateOwnerMethodSource } from "./netteFactoryTemplateOwnerHierarchy";
import type { NetteFactoryTemplateOwner } from "./netteFactoryTemplateOwners";
import type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";
import {
  resolveNettePresenterOwner,
  type NettePresenterResolutionContext,
} from "./nettePresenterResolution";
import { phpMethodPositionInSource } from "./phpMethodPosition";

export type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";

export interface NettePresenterLinkDetection {
  target: string;
}

const NETTE_THIS_ACTION = "this";

export type NettePresenterLinkDefinitionContext = Omit<
  NettePresenterDiscoveryContext,
  "cache" | "deps" | "inFlight" | "ttlMs"
> & {
  deps: NettePresenterDiscoveryContext["deps"] &
    NettePresenterResolutionContext["deps"];
  loadFactoryTemplateOwner(
    templatePath: string,
  ): Promise<NetteFactoryTemplateOwner | null>;
};

export async function resolveNetteLinkDefinition(
  context: NettePresenterLinkDefinitionContext,
  detection: NettePresenterLinkDetection | null,
): Promise<boolean> {
  if (!detection) {
    return false;
  }

  return resolveNettePresenterLink(
    context,
    context.frameworkCapabilities.parsePresenterLinkTarget(detection.target),
    detection.target,
  );
}

export async function resolveNettePresenterLink(
  context: NettePresenterLinkDefinitionContext,
  parsed: NetteLinkTarget | null,
  label: string,
): Promise<boolean> {
  const { deps, frameworkCapabilities, isRequestedRootActive } = context;

  if (!parsed || parsed.action === NETTE_THIS_ACTION) {
    return false;
  }

  const methodNames = frameworkCapabilities.presenterActionMethodCandidates(
    parsed.action,
    parsed.isSignal,
  );

  if (methodNames.length === 0) {
    return false;
  }

  const owner = await resolveNettePresenterOwner(context, parsed);

  if (
    !isRequestedRootActive() ||
    (context.isPresenterMappingGenerationCurrent &&
      !context.isPresenterMappingGenerationCurrent()) ||
    !owner
  ) {
    return false;
  }

  const factoryHierarchy = owner.factoryHierarchy;
  const methodOwner = factoryHierarchy
    ? methodNames
        .map((methodName) =>
          findNetteFactoryTemplateOwnerMethodSource(
            factoryHierarchy,
            methodName,
          ),
        )
        .find((candidate) => candidate !== null)
    : null;
  const source = methodOwner?.source ?? owner;
  const position = phpMethodPositionInSource(source.source, methodNames) ?? {
    column: 1,
    lineNumber: 1,
  };

  return deps.openTarget(source.path, position, label);
}
