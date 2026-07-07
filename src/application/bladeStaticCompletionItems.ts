import { BLADE_DIRECTIVES } from "../domain/bladeNavigation";
import type { BladeCompletionItem } from "./bladeIntelligenceContracts";

export function bladeDirectiveCompletionItems(
  directivePrefix: string,
  range: { replaceEnd: number; replaceStart: number },
): BladeCompletionItem[] {
  const normalizedPrefix = directivePrefix.toLowerCase();

  return BLADE_DIRECTIVES.filter((directive) =>
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
