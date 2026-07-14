import {
  detectNetteLatteSnippetCompletionAt,
  detectNetteRedrawControlCompletionAt,
  netteLatteSnippetReferences,
  type NetteSnippetCompletionContext,
} from "../domain/netteAjaxSnippets";
import { componentTemplateCandidatePathsForClass } from "../domain/nettePathResolution";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { LatteCompletionItem } from "./latteCompletionItems";

export interface NetteSnippetCompletionTarget {
  name: string;
  relativePath: string;
}

export interface NetteRedrawControlSnippetCompletionTargetCollectorDependencies {
  joinPath(rootPath: string, relativePath: string): string;
  readFileContent(path: string): Promise<string>;
}

export interface NetteRedrawControlSnippetCompletionTargetCollectorContext {
  currentPhpRelativePath: string;
  deps: NetteRedrawControlSnippetCompletionTargetCollectorDependencies;
  isRequestedRootActive(): boolean;
  requestedRoot: string;
}

export interface NetteRedrawControlSnippetTargetCollectorWorkbenchDependencies {
  currentWorkspaceRootRef: {
    readonly current: string | null;
  };
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  joinWorkspacePath(rootPath: string, relativePath: string): string;
  readNavigationFileContent(path: string): Promise<string>;
  relativeWorkspacePath(workspaceRoot: string, path: string): string;
  workspaceRoot: string | null;
}

export function latteNetteSnippetNameCompletions(
  source: string,
  offset: number,
): LatteCompletionItem[] | null {
  const completion = detectNetteLatteSnippetCompletionAt(source, offset);

  if (!completion) {
    return null;
  }

  return snippetNameCompletions(
    netteLatteSnippetReferences(source).map((reference) => ({
      name: reference.name,
      relativePath: "Current template",
    })),
    completion,
  ).map((target) => ({
    detail: "Latte snippet",
    insertText: target.name,
    kind: "snippet",
    label: target.name,
    replaceEnd: completion.replaceEnd,
    replaceStart: completion.replaceStart,
  }));
}

export function phpNetteRedrawControlSnippetNameCompletions(
  source: string,
  offset: number,
  targets: readonly NetteSnippetCompletionTarget[],
): PhpMethodCompletion[] | null {
  const completion = detectNetteRedrawControlCompletionAt(source, offset);

  if (!completion) {
    return null;
  }

  return snippetNameCompletions(targets, completion).map((target) => ({
    declaringClassName: target.relativePath,
    detail: `Nette AJAX snippet - ${target.relativePath}`,
    documentation: `Nette AJAX snippet\n\n${target.name}`,
    insertText: target.name,
    kind: "nette.ajax-snippet",
    name: target.name,
    parameters: "",
    replaceEnd: completion.replaceEnd,
    replaceStart: completion.replaceStart,
    returnType: null,
  }));
}

export async function collectNetteRedrawControlSnippetCompletionTargets({
  currentPhpRelativePath,
  deps,
  isRequestedRootActive,
  requestedRoot,
}: NetteRedrawControlSnippetCompletionTargetCollectorContext): Promise<
  NetteSnippetCompletionTarget[]
> {
  const targets: NetteSnippetCompletionTarget[] = [];
  const candidatePaths =
    componentTemplateCandidatePathsForClass(currentPhpRelativePath);

  for (const relativePath of candidatePaths) {
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

    for (const reference of netteLatteSnippetReferences(content)) {
      targets.push({
        name: reference.name,
        relativePath,
      });
    }
  }

  return targets;
}

export function createNetteRedrawControlSnippetTargetCollector({
  currentWorkspaceRootRef,
  frameworkRuntime,
  joinWorkspacePath,
  readNavigationFileContent,
  relativeWorkspacePath,
  workspaceRoot,
}: NetteRedrawControlSnippetTargetCollectorWorkbenchDependencies): (
  currentPhpPath: string,
) => Promise<NetteSnippetCompletionTarget[]> {
  return async (currentPhpPath) => {
    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

    if (!requestedRoot || !frameworkRuntime.hasProvider("nette")) {
      return [];
    }

    return collectNetteRedrawControlSnippetCompletionTargets({
      currentPhpRelativePath: relativeWorkspacePath(
        requestedRoot,
        currentPhpPath,
      ),
      deps: {
        joinPath: joinWorkspacePath,
        readFileContent: readNavigationFileContent,
      },
      isRequestedRootActive,
      requestedRoot,
    });
  };
}

function snippetNameCompletions(
  targets: readonly NetteSnippetCompletionTarget[],
  completion: NetteSnippetCompletionContext,
): NetteSnippetCompletionTarget[] {
  const normalizedPrefix = completion.prefix.toLowerCase();
  const seen = new Set<string>();
  const completions: NetteSnippetCompletionTarget[] = [];

  for (const target of targets) {
    if (seen.has(target.name)) {
      continue;
    }

    seen.add(target.name);

    if (!target.name.toLowerCase().startsWith(normalizedPrefix)) {
      continue;
    }

    completions.push(target);
  }

  return completions.slice(0, 80);
}
