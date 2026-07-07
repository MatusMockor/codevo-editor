import type { NetteLinkTarget } from "../domain/latteLinkNavigation";
import { presenterCandidatePathsForTemplate } from "../domain/nettePathResolution";
import {
  loadNettePresenterLinkTargets,
  nettePresenterShortNameFromPath,
} from "./nettePresenterLinkDiscovery";
import { phpMethodPositionInSource } from "./phpMethodPosition";
import type {
  NettePresenterDiscoveryContext,
  NettePresenterLinkDependencies,
} from "./nettePresenterLinkDiscovery";

export {
  isNettePresenterDiscoverySourcePath,
  loadNettePresenterLinkTargets,
  nettePresenterLinkTargetsFromSource,
  scanNettePresenterLinkTargets,
} from "./nettePresenterLinkDiscovery";
export type {
  NettePresenterCache,
  NettePresenterCacheEntry,
  NettePresenterDiscoveryContext,
  NettePresenterInFlight,
  NettePresenterLinkCapabilities,
  NettePresenterLinkDependencies,
} from "./nettePresenterLinkDiscovery";
export { phpMethodPositionInSource } from "./phpMethodPosition";

export interface NettePresenterLinkCompletionItem {
  detail?: string;
  insertText: string;
  kind: "link";
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export interface NettePresenterLinkDetection {
  target: string;
}

const NETTE_THIS_ACTION = "this";
const LATTE_MAX_COMPLETIONS = 100;

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

export async function lattePresenterLinkCompletions(
  context: NettePresenterDiscoveryContext,
  completion: { prefix: string; replaceEnd: number; replaceStart: number },
): Promise<NettePresenterLinkCompletionItem[]> {
  const targets = await loadNettePresenterLinkTargets(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();
  const completionTargets = nettePresenterCompletionTargets(
    targets,
    currentPresenterShortNames(
      context.deps,
      context.requestedRoot,
      context.currentRelativePath,
    ),
  );

  return completionTargets
    .filter((target) => target.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((target) => ({
      detail: "Nette presenter action",
      insertText: target,
      kind: "link" as const,
      label: target,
      replaceEnd: completion.replaceEnd,
      replaceStart: completion.replaceStart,
    }));
}

function nettePresenterCompletionTargets(
  targets: readonly string[],
  currentPresenterNames: readonly string[],
): string[] {
  const withRelativeTargets = new Set<string>(targets);
  const current = new Set(currentPresenterNames);

  if (current.size === 0) {
    return Array.from(withRelativeTargets);
  }

  for (const target of targets) {
    const relative = relativePresenterTarget(target, current);

    if (relative) {
      withRelativeTargets.add(relative);
    }
  }

  return Array.from(withRelativeTargets).sort((left, right) =>
    left.localeCompare(right),
  );
}

function relativePresenterTarget(
  target: string,
  currentPresenterNames: ReadonlySet<string>,
): string | null {
  const segments = target.split(":");

  if (segments.length !== 2) {
    return null;
  }

  const [presenter, action] = segments;

  if (!presenter || !action || !currentPresenterNames.has(presenter)) {
    return null;
  }

  return action;
}

function currentPresenterShortNames(
  deps: NettePresenterLinkDependencies,
  requestedRoot: string,
  currentRelativePath: string,
): string[] {
  const names = new Set<string>();
  const candidatePaths = nettePresenterShortNameFromPath(currentRelativePath)
    ? [currentRelativePath]
    : presenterCandidatePathsForTemplate(currentRelativePath);

  for (const path of candidatePaths) {
    const shortName = nettePresenterShortNameFromPath(path);

    if (shortName) {
      names.add(shortName);
    }
  }

  const activeDocument = deps.getActiveDocument();

  if (activeDocument) {
    const relativePath = deps.toRelativePath(requestedRoot, activeDocument.path);
    const shortName = nettePresenterShortNameFromPath(relativePath);

    if (shortName) {
      names.add(shortName);
    }
  }

  return Array.from(names);
}
