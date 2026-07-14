import {
  netteAddComponentRegistrations,
  nettePresenterLifecycleInfo,
} from "../domain/netteComponents";
import { netteAncestorComponentSources } from "./netteComponentAncestry";
import type { NetteControlCompletionContext } from "./netteControlContracts";
import {
  componentOwnerCandidatePathsForTemplate,
} from "./netteTemplateOwnerCandidates";

export async function loadNettePresenterComponentNames(
  context: NetteControlCompletionContext,
): Promise<string[]> {
  const {
    componentCache,
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
    ttlMs,
  } = context;
  const cached = componentCache[requestedRoot];

  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.templateRelativePath === templateRelativePath
  ) {
    return cached.componentNames;
  }

  const componentNames = await scanNettePresenterComponentNames(
    deps,
    requestedRoot,
    isRequestedRootActive,
    templateRelativePath,
  );

  if (!isRequestedRootActive()) {
    return [];
  }

  componentCache[requestedRoot] = {
    componentNames,
    expiresAt: Date.now() + ttlMs,
    templateRelativePath,
  };

  return componentNames;
}

async function scanNettePresenterComponentNames(
  deps: NetteControlCompletionContext["deps"],
  requestedRoot: string,
  isRequestedRootActive: () => boolean,
  templateRelativePath: string,
): Promise<string[]> {
  for (const relativePath of componentOwnerCandidatePathsForTemplate(
    templateRelativePath,
  )) {
    if (!isRequestedRootActive()) {
      return [];
    }

    const path = deps.joinPath(requestedRoot, relativePath);
    let content: string;

    try {
      content = await deps.readFileContent(path);
    } catch {
      if (!isRequestedRootActive()) {
        return [];
      }

      continue;
    }

    if (!isRequestedRootActive()) {
      return [];
    }

    const ancestorSources = await netteAncestorComponentSources(
      deps,
      isRequestedRootActive,
      content,
    );

    if (!isRequestedRootActive()) {
      return [];
    }

    return netteComponentNamesFromSources([
      content,
      ...ancestorSources.map((ancestor) => ancestor.source),
    ]);
  }

  return [];
}

function netteComponentNamesFromSources(sources: readonly string[]): string[] {
  const names = new Set<string>();

  for (const source of sources) {
    for (const entry of nettePresenterLifecycleInfo(source).lifecycle) {
      if (entry.kind === "createComponent" && entry.name) {
        names.add(entry.name);
      }
    }

    for (const registration of netteAddComponentRegistrations(source)) {
      names.add(registration.name);
    }
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}
