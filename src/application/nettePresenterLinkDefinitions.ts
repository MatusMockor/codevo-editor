import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";
import { resolveNettePresenterOwner } from "./nettePresenterResolution";
import { phpMethodPositionInSource } from "./phpMethodPosition";

export type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";

export interface NettePresenterLinkDetection {
  target: string;
}

const NETTE_THIS_ACTION = "this";

export async function resolveNetteLinkDefinition(
  context: Omit<NettePresenterDiscoveryContext, "cache" | "inFlight" | "ttlMs">,
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
  context: Omit<NettePresenterDiscoveryContext, "cache" | "inFlight" | "ttlMs">,
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

  const position = phpMethodPositionInSource(owner.source, methodNames) ?? {
    column: 1,
    lineNumber: 1,
  };

  return deps.openTarget(owner.path, position, label);
}
