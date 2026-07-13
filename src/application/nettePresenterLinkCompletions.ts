import { nettePresenterLifecycleInfo } from "../domain/netteComponents";
import {
  componentClassCandidatePathsForTemplate,
  presenterCandidatePathsForTemplate,
} from "../domain/nettePathResolution";
import {
  loadNettePresenterLinkTargets,
  nettePresenterShortNameFromPath,
} from "./nettePresenterLinkDiscovery";
import type {
  NettePresenterDiscoveryContext,
  NettePresenterLinkDependencies,
} from "./nettePresenterLinkDiscovery";

export interface NettePresenterLinkCompletionItem {
  detail?: string;
  insertText: string;
  kind: "link";
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

const LATTE_MAX_COMPLETIONS = 100;

export async function lattePresenterLinkCompletions(
  context: NettePresenterDiscoveryContext,
  completion: { prefix: string; replaceEnd: number; replaceStart: number },
): Promise<NettePresenterLinkCompletionItem[]> {
  const [targets, currentComponentSignalTargets] = await Promise.all([
    loadNettePresenterLinkTargets(context),
    loadCurrentComponentSignalTargets(context),
  ]);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();
  const completionTargets = nettePresenterCompletionTargets(
    [...targets, ...currentComponentSignalTargets],
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

async function loadCurrentComponentSignalTargets(
  context: NettePresenterDiscoveryContext,
): Promise<string[]> {
  const targets = new Set<string>();

  for (const relativePath of componentClassCandidatePathsForTemplate(
    context.currentRelativePath,
  )) {
    if (!context.isRequestedRootActive()) {
      return [];
    }

    let source: string;

    try {
      source = await context.deps.readFileContent(
        context.deps.joinPath(context.requestedRoot, relativePath),
      );
    } catch {
      if (!context.isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!context.isRequestedRootActive()) {
      return [];
    }

    for (const entry of nettePresenterLifecycleInfo(source).lifecycle) {
      if (entry.kind === "handle" && entry.name) {
        targets.add(`${entry.name}!`);
      }
    }
  }

  return Array.from(targets);
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
