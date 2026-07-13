import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import {
  componentClassCandidatePathsForTemplate,
} from "../domain/nettePathResolution";
import type {
  NettePresenterDiscoveryContext,
} from "./nettePresenterLinkDiscovery";
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

  const candidatePaths = linkOwnerCandidatePaths(
    context,
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

function linkOwnerCandidatePaths(
  context: Omit<NettePresenterDiscoveryContext, "cache" | "inFlight" | "ttlMs">,
  parsed: NetteLinkTarget,
  currentRelativePath: string,
): string[] {
  const presenterPaths =
    context.frameworkCapabilities.presenterClassCandidatePathsForLink(
      parsed,
      currentRelativePath,
    );

  if (!parsed.isSignal || parsed.presenter !== null) {
    return presenterPaths;
  }

  return dedupe([
    ...componentClassCandidatePathsForTemplate(currentRelativePath),
    ...presenterPaths,
  ]);
}

function dedupe(paths: readonly string[]): string[] {
  return Array.from(new Set(paths));
}
