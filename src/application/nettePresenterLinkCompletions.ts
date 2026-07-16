import { nettePresenterLifecycleInfo } from "../domain/netteComponents";
import {
  componentClassCandidatePathsForTemplate,
  presenterCandidatePathsForTemplate,
} from "../domain/nettePathResolution";
import {
  nettePresenterNameFromClass,
  type NettePresenterMapping,
} from "../domain/nettePresenterMapping";
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
  const [targets, currentComponentSignalTargets, mappings] = await Promise.all([
    loadNettePresenterLinkTargets(context),
    loadCurrentComponentSignalTargets(context),
    context.loadPresenterMappings?.() ?? Promise.resolve([]),
  ]);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const normalizedPrefix = completion.prefix.toLowerCase();
  const currentCanonicalNames = await currentPresenterCanonicalNames(
    context,
    mappings,
  );

  if (
    !context.isRequestedRootActive() ||
    (context.isPresenterMappingGenerationCurrent &&
      !context.isPresenterMappingGenerationCurrent())
  ) {
    return [];
  }

  const completionTargets = nettePresenterCompletionTargets(
    [...targets, ...currentComponentSignalTargets],
    currentPresenterShortNames(
      context.deps,
      context.requestedRoot,
      context.currentRelativePath,
    ),
    currentCanonicalNames,
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
  currentCanonicalNames: readonly string[],
): string[] {
  const withRelativeTargets = new Set<string>(targets);
  const current = new Set(currentPresenterNames);

  if (current.size === 0) {
    return Array.from(withRelativeTargets);
  }

  for (const target of targets) {
    for (const relative of mappedRelativePresenterTargets(
      target,
      currentCanonicalNames,
    )) {
      withRelativeTargets.add(relative);
    }

    const relative = relativePresenterTarget(target, current);

    if (relative) {
      withRelativeTargets.add(relative);
    }
  }

  return Array.from(withRelativeTargets).sort((left, right) =>
    left.localeCompare(right),
  );
}

function mappedRelativePresenterTargets(
  target: string,
  currentCanonicalNames: readonly string[],
): string[] {
  if (!target.startsWith(":")) {
    return [];
  }

  const targetSegments = target.slice(1).split(":");
  const action = targetSegments.pop();

  if (!action || targetSegments.length === 0) {
    return [];
  }

  const relative = new Set<string>();

  for (const currentName of currentCanonicalNames) {
    const currentSegments = currentName.split(":");
    const currentModule = currentSegments.slice(0, -1);

    if (!startsWithSegments(targetSegments, currentModule)) {
      continue;
    }

    const moduleRelativePresenter = targetSegments.slice(currentModule.length);

    if (moduleRelativePresenter.length > 0) {
      relative.add([...moduleRelativePresenter, action].join(":"));
    }

    if (targetSegments.join(":") === currentName) {
      relative.add(action);
    }
  }

  return Array.from(relative);
}

async function currentPresenterCanonicalNames(
  context: NettePresenterDiscoveryContext,
  mappings: readonly NettePresenterMapping[],
): Promise<string[]> {
  if (mappings.length === 0) {
    return [];
  }

  const paths = new Set(
    nettePresenterShortNameFromPath(context.currentRelativePath)
      ? [context.currentRelativePath]
      : presenterCandidatePathsForTemplate(context.currentRelativePath),
  );
  const activeDocument = context.deps.getActiveDocument();

  if (activeDocument) {
    const activePath = context.deps.toRelativePath(
      context.requestedRoot,
      activeDocument.path,
    );

    if (nettePresenterShortNameFromPath(activePath)) {
      paths.add(activePath);
    }
  }

  const names = new Set<string>();

  for (const relativePath of paths) {
    if (!context.isRequestedRootActive()) {
      return [];
    }

    try {
      const source = await context.deps.readFileContent(
        context.deps.joinPath(context.requestedRoot, relativePath),
      );
      const className = phpPrimaryQualifiedClassName(source);

      if (!className) {
        continue;
      }

      for (const mapping of mappings) {
        const name = nettePresenterNameFromClass(className, [mapping]);

        if (name) {
          names.add(name);
        }
      }
    } catch {
      if (!context.isRequestedRootActive()) {
        return [];
      }
    }
  }

  return Array.from(names);
}

function startsWithSegments(
  value: readonly string[],
  prefix: readonly string[],
): boolean {
  return prefix.every((segment, index) => value[index] === segment);
}

function phpPrimaryQualifiedClassName(source: string): string | null {
  const className = /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(source)?.[1];

  if (!className) {
    return null;
  }

  const namespace = /\bnamespace\s+([^;{]+)\s*[;{]/.exec(source)?.[1]?.trim();

  return namespace ? `${namespace}\\${className}` : className;
}

function relativePresenterTarget(
  target: string,
  currentPresenterNames: ReadonlySet<string>,
): string | null {
  if (target.startsWith(":")) {
    return null;
  }

  const segments = target.split(":");

  if (segments.length < 2) {
    return null;
  }

  const action = segments[segments.length - 1];
  const presenter = segments[segments.length - 2];

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

  return names.size === 1 ? Array.from(names) : [];
}
