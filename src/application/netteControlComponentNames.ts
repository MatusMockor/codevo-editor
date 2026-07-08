import { nettePresenterLifecycleInfo } from "../domain/netteComponents";
import type { NetteControlCompletionContext } from "./netteControlComponents";
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

    return netteComponentNamesFromPresenter(content);
  }

  return [];
}

function netteComponentNamesFromPresenter(source: string): string[] {
  const names: string[] = [];

  for (const entry of nettePresenterLifecycleInfo(source).lifecycle) {
    if (entry.kind === "createComponent" && entry.name) {
      names.push(entry.name);
    }
  }

  return Array.from(new Set(names)).sort((left, right) =>
    left.localeCompare(right),
  );
}
