import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import { phpMethodPositionInSource } from "./phpMethodPosition";
import type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";

export {
  isNettePresenterDiscoverySourcePath,
  loadNettePresenterLinkTargets,
  nettePresenterLinkTargetsFromSource,
  scanNettePresenterLinkTargets,
} from "./nettePresenterLinkDiscovery";
export type {
  NettePresenterLinkCompletionItem,
} from "./nettePresenterLinkCompletions";
export {
  lattePresenterLinkCompletions,
} from "./nettePresenterLinkCompletions";
export type {
  NettePresenterCache,
  NettePresenterCacheEntry,
  NettePresenterDiscoveryContext,
  NettePresenterInFlight,
  NettePresenterLinkCapabilities,
  NettePresenterLinkDependencies,
} from "./nettePresenterLinkDiscovery";
export { phpMethodPositionInSource } from "./phpMethodPosition";

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
  const {
    currentRelativePath,
    deps,
    frameworkCapabilities,
    isRequestedRootActive,
    requestedRoot,
  } = context;

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

  const candidatePaths = frameworkCapabilities.presenterClassCandidatePathsForLink(
    parsed,
    currentRelativePath,
  );

  for (const relativePath of candidatePaths) {
    if (!isRequestedRootActive()) {
      return false;
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return false;
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return false;
    }

    const position = phpMethodPositionInSource(content, methodNames) ?? {
      column: 1,
      lineNumber: 1,
    };

    return deps.openTarget(path, position, label);
  }

  return false;
}
