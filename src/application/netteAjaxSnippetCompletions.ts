import {
  detectNetteLatteSnippetCompletionAt,
  detectNetteRedrawControlCompletionAt,
  netteLatteSnippetReferences,
  type NetteSnippetCompletionContext,
} from "../domain/netteAjaxSnippets";
import { componentTemplateCandidatePathsForClass } from "../domain/nettePathResolution";
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
