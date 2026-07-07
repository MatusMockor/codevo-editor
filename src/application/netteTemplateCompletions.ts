import { moduleTemplatesRootOf } from "../domain/nettePathResolution";
import {
  listLatteTemplateRelativePaths,
  type LatteTemplateCache,
  type NetteTemplateDiscoveryDependencies,
} from "./netteTemplateDiscovery";

export interface NetteTemplateCompletionItem {
  detail?: string;
  insertText: string;
  kind: "template";
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export interface NetteTemplateCompletionContext {
  cache: LatteTemplateCache;
  currentTemplateRelativePath: string;
  deps: NetteTemplateDiscoveryDependencies;
  isRequestedRootActive(): boolean;
  maxCompletions: number;
  maxDepth: number;
  maxTemplates: number;
  requestedRoot: string;
  scanDirectories: readonly string[];
  ttlMs: number;
}

export async function latteTemplateCompletions(
  context: NetteTemplateCompletionContext,
  includeCompletion: { prefix: string; replaceEnd: number; replaceStart: number },
): Promise<NetteTemplateCompletionItem[]> {
  const relativePaths = await listLatteTemplateRelativePaths(context);

  if (!context.isRequestedRootActive()) {
    return [];
  }

  const names = latteIncludeCandidateNames(
    relativePaths,
    context.currentTemplateRelativePath,
  );
  const normalizedPrefix = includeCompletion.prefix.toLowerCase();

  return names
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, context.maxCompletions)
    .map((name) => ({
      detail: "Latte template",
      insertText: name,
      kind: "template" as const,
      label: name,
      replaceEnd: includeCompletion.replaceEnd,
      replaceStart: includeCompletion.replaceStart,
    }));
}

function latteIncludeCandidateNames(
  relativePaths: string[],
  currentTemplateRelativePath: string,
): string[] {
  const currentDirectory = dirnameOf(currentTemplateRelativePath);
  const moduleTemplatesRoot = moduleTemplatesRootOf(currentTemplateRelativePath);
  const names = new Set<string>();

  for (const relativePath of relativePaths) {
    if (relativePath === currentTemplateRelativePath) {
      continue;
    }

    names.add(relativeReference(currentDirectory, relativePath));

    const moduleRootReference = moduleTemplatesRootReference(
      moduleTemplatesRoot,
      relativePath,
    );

    if (moduleRootReference) {
      names.add(moduleRootReference);
    }
  }

  return Array.from(names).sort((left, right) => left.localeCompare(right));
}

function moduleTemplatesRootReference(
  moduleTemplatesRoot: string | null,
  targetPath: string,
): string | null {
  if (!moduleTemplatesRoot) {
    return null;
  }

  if (!targetPath.startsWith(`${moduleTemplatesRoot}/`)) {
    return null;
  }

  return targetPath.slice(moduleTemplatesRoot.length + 1);
}

function relativeReference(fromDirectory: string, targetPath: string): string {
  const fromSegments = fromDirectory.length > 0 ? fromDirectory.split("/") : [];
  const targetSegments = targetPath.split("/");
  let common = 0;

  while (
    common < fromSegments.length &&
    common < targetSegments.length - 1 &&
    fromSegments[common] === targetSegments[common]
  ) {
    common += 1;
  }

  const ups = fromSegments.length - common;
  const downs = targetSegments.slice(common);
  const parts = [...Array.from({ length: ups }, () => ".."), ...downs];

  return parts.join("/");
}

function dirnameOf(path: string): string {
  const index = path.lastIndexOf("/");

  if (index < 0) {
    return "";
  }

  return path.slice(0, index);
}
