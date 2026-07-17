import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import {
  netteActionParameterPositionInSource,
  nettePersistentParameterPositionInSource,
} from "../domain/nettePersistentParameters";
import { netteAncestorComponentSources } from "./netteComponentAncestry";
import type { NetteControlDependencies } from "./netteControlContracts";
import { findNetteFactoryTemplateOwnerMethodSource } from "./netteFactoryTemplateOwnerHierarchy";
import type { NetteFactoryTemplateOwner } from "./netteFactoryTemplateOwners";
import type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";
import {
  resolveNettePresenterOwner,
  type NettePresenterResolutionContext,
  type NettePresenterResolvedOwner,
} from "./nettePresenterResolution";
import { phpMethodPositionInSource } from "./phpMethodPosition";

export type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";

export interface NettePresenterLinkDetection {
  parameterName?: string;
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

  const parsed = context.frameworkCapabilities.parsePresenterLinkTarget(
    detection.target,
  );

  if (detection.parameterName) {
    return resolveNetteLinkParameterDefinition(
      context,
      parsed,
      detection.parameterName,
    );
  }

  return resolveNettePresenterLink(context, parsed, detection.target);
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

export interface NetteLinkParameterSource {
  path: string;
  source: string;
}

export interface NetteLinkParameterSourceContext {
  deps: NettePresenterDiscoveryContext["deps"] &
    NettePresenterResolutionContext["deps"];
  isRequestedRootActive(): boolean;
}

/**
 * The PHP sources a named link parameter can be declared in: the resolved
 * owner first, then its ancestry (parents and traits) — persistent parameters
 * are inherited, so a parameter on the target presenter may live on any
 * ancestor. Factory-owned templates already carry their bounded hierarchy.
 */
export async function collectNetteLinkParameterSources(
  context: NetteLinkParameterSourceContext,
  owner: NettePresenterResolvedOwner,
): Promise<NetteLinkParameterSource[]> {
  if (owner.factoryHierarchy) {
    return owner.factoryHierarchy.sources.map((source) => ({
      path: source.path,
      source: source.source,
    }));
  }

  const ancestors = await netteAncestorComponentSources(
    ancestorDependencies(context.deps),
    context.isRequestedRootActive,
    owner.source,
  );

  if (!context.isRequestedRootActive()) {
    return [];
  }

  return [{ path: owner.path, source: owner.source }, ...ancestors];
}

export function netteLinkParameterMethodNames(
  capabilities: Pick<
    NettePresenterLinkDefinitionContext["frameworkCapabilities"],
    "presenterActionMethodCandidates"
  >,
  parsed: NetteLinkTarget,
): string[] {
  if (parsed.action === NETTE_THIS_ACTION) {
    return [];
  }

  return capabilities.presenterActionMethodCandidates(
    parsed.action,
    parsed.isSignal,
  );
}

async function resolveNetteLinkParameterDefinition(
  context: NettePresenterLinkDefinitionContext,
  parsed: NetteLinkTarget | null,
  parameterName: string,
): Promise<boolean> {
  if (!parsed) {
    return false;
  }

  const owner = await resolveNettePresenterOwner(context, parsed);

  if (!isLinkResolutionCurrent(context) || !owner) {
    return false;
  }

  const sources = await collectNetteLinkParameterSources(context, owner);

  if (!isLinkResolutionCurrent(context)) {
    return false;
  }

  const methodNames = netteLinkParameterMethodNames(
    context.frameworkCapabilities,
    parsed,
  );

  for (const source of sources) {
    const position = netteActionParameterPositionInSource(
      source.source,
      methodNames,
      parameterName,
    );

    if (position) {
      return context.deps.openTarget(source.path, position, parameterName);
    }
  }

  for (const source of sources) {
    const position = nettePersistentParameterPositionInSource(
      source.source,
      parameterName,
    );

    if (position) {
      return context.deps.openTarget(source.path, position, parameterName);
    }
  }

  return false;
}

function isLinkResolutionCurrent(
  context: NettePresenterLinkDefinitionContext,
): boolean {
  if (!context.isRequestedRootActive()) {
    return false;
  }

  return context.isPresenterMappingGenerationCurrent
    ? context.isPresenterMappingGenerationCurrent()
    : true;
}

function ancestorDependencies(
  deps: NetteLinkParameterSourceContext["deps"],
): NetteControlDependencies {
  return {
    joinPath: deps.joinPath,
    openPhpMethodTarget: async () => false,
    openTarget: deps.openTarget,
    readFileContent: deps.readFileContent,
    readPhpClassSource: deps.readPhpClassSource,
    resolveDeclaredType:
      deps.resolveDeclaredType ?? ((_source, typeHint) => typeHint),
  };
}
