import { netteCreateComponentFactoryContexts } from "../domain/netteComponents";
import { netteComponentViewOwnerNameFromType } from "../domain/netteComponentViewOwners";
import type { NetteCreateComponentTypeResolver } from "./netteCreateComponentContracts";
import { componentOwnerCandidatePathsForTemplate } from "./netteTemplateOwnerCandidates";

export interface NetteFactoryCandidateViewNameContext {
  action: string;
  deps: NetteCreateComponentTypeResolver & {
    joinPath(rootPath: string, relativePath: string): string;
    readFileContent(path: string): Promise<string>;
  };
  isRequestedRootActive(): boolean;
  requestedRoot: string;
  templateRelativePath: string;
}

const LATTE_TEMPLATE_EXTENSION = ".latte";

/**
 * Some legacy Nette projects keep a component template under a presenter's
 * template tree instead of next to `SomethingControl.php`. PhpStorm follows the
 * `createComponentSomething(): SomethingControl` factory and still gives that
 * template the control's view-data. This resolver stays conservative: only
 * factories whose component name is named by the active template path and whose
 * control type looks like `*Control` contribute candidate owners.
 */
export async function factoryDerivedLatteCandidateViewNames(
  context: NetteFactoryCandidateViewNameContext,
): Promise<string[]> {
  const {
    action,
    deps,
    isRequestedRootActive,
    requestedRoot,
    templateRelativePath,
  } = context;
  const componentNames = componentNameCandidatesForTemplate(templateRelativePath);

  if (componentNames.size === 0) {
    return [];
  }

  const names = new Set<string>();

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

    for (const factory of netteCreateComponentFactoryContexts(content)) {
      if (!componentNames.has(factory.componentName)) {
        continue;
      }

      const owner = controlViewOwnerFromFactory(content, factory.controlClass, deps);

      if (!owner) {
        continue;
      }

      names.add(`${owner}:${action}`);
      names.add(`${owner}:*`);
      names.add(`${owner}:default`);
    }
  }

  return Array.from(names);
}

function controlViewOwnerFromFactory(
  source: string,
  typeHint: string | null,
  deps: NetteCreateComponentTypeResolver,
): string | null {
  const resolved = deps.resolveDeclaredType(source, typeHint) ?? typeHint;

  return netteComponentViewOwnerNameFromType(resolved);
}

function componentNameCandidatesForTemplate(
  templateRelativePath: string,
): Set<string> {
  const segments = templateRelativePath.split("/").filter(Boolean);
  const fileName = segments[segments.length - 1] ?? "";
  const baseName = fileName.endsWith(LATTE_TEMPLATE_EXTENSION)
    ? fileName.slice(0, -LATTE_TEMPLATE_EXTENSION.length)
    : fileName;
  const candidates = new Set<string>();

  addComponentNameCandidate(candidates, baseName);

  const parent = segments[segments.length - 2] ?? "";

  if (isGenericComponentTemplateName(baseName)) {
    addComponentNameCandidate(candidates, parent);
  }

  if (parent === "templates") {
    addComponentNameCandidate(candidates, segments[segments.length - 3] ?? "");
  }

  const componentsIndex = segments.findIndex((segment) => segment === "Components");

  if (componentsIndex >= 0) {
    addComponentNameCandidate(candidates, segments[componentsIndex + 1] ?? "");
  }

  return candidates;
}

function addComponentNameCandidate(
  candidates: Set<string>,
  segment: string,
): void {
  const name = componentNameFromTemplateSegment(segment);

  if (name) {
    candidates.add(name);
  }
}

function componentNameFromTemplateSegment(segment: string): string | null {
  const cleaned = segment.replace(/\.[^.]+$/, "").replace(/Control$/, "");

  if (cleaned.length === 0 || isGenericComponentTemplateName(cleaned)) {
    return null;
  }

  const normalized = cleaned
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join("");
  const candidate = normalized.charAt(0).toLowerCase() + normalized.slice(1);

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate) ? candidate : null;
}

function isGenericComponentTemplateName(name: string): boolean {
  return name === "default" || name === "template";
}
