import {
  detectNetteLatteSnippetCompletionAt,
  netteLatteSnippetReferences,
  type NetteSnippetCompletionContext,
} from "../domain/netteAjaxSnippets";
import type { LatteCompletionItem } from "./latteCompletionItems";

export interface NetteSnippetCompletionTarget {
  name: string;
  relativePath: string;
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
