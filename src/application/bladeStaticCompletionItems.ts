import { BLADE_DIRECTIVES } from "../domain/bladeNavigation";
import type { BladeCompletionItem } from "./bladeIntelligenceContracts";

export function bladeDirectiveCompletionItems(
  directivePrefix: string,
  range: { replaceEnd: number; replaceStart: number },
  directiveNames: readonly string[] = BLADE_DIRECTIVES,
): BladeCompletionItem[] {
  const normalizedPrefix = directivePrefix.toLowerCase();

  return directiveNames.filter((directive) =>
    directive.toLowerCase().startsWith(normalizedPrefix),
  )
    .slice(0, 100)
    .map((directive) => ({
      detail: "Blade directive",
      insertText: directive,
      kind: "directive",
      label: `@${directive}`,
      replaceEnd: range.replaceEnd,
      replaceStart: range.replaceStart,
    }));
}

export function bladeComponentAttributeCompletionItems(
  attributeNames: readonly string[],
  completion: {
    existingAttributeNames: readonly string[];
    prefix: string;
    replaceStart: number;
    replaceEnd: number;
  },
): BladeCompletionItem[] {
  const existingNames = new Set(completion.existingAttributeNames);
  const normalizedPrefix = completion.prefix.toLowerCase();
  const items: BladeCompletionItem[] = [];

  for (const attributeName of attributeNames) {
    if (existingNames.has(attributeName)) {
      continue;
    }

    for (const candidate of [attributeName, `:${attributeName}`]) {
      if (!candidate.toLowerCase().startsWith(normalizedPrefix)) {
        continue;
      }

      items.push({
        detail: "Component attribute",
        insertText: candidate,
        kind: "member",
        label: candidate,
        replaceEnd: completion.replaceEnd,
        replaceStart: completion.replaceStart,
      });
    }
  }

  return items.slice(0, 100);
}

export function bladeComponentCompletionItems(
  componentNames: readonly string[],
  prefix: string,
  range: { replaceEnd: number; replaceStart: number },
): BladeCompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();

  return componentNames
    .filter((name) => name.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, 100)
    .map((name) => ({
      detail: "Blade component",
      insertText: name,
      kind: "component",
      label: name,
      replaceEnd: range.replaceEnd,
      replaceStart: range.replaceStart,
    }));
}
