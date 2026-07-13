import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { BladeCompletionItem } from "./bladeIntelligenceContracts";

export function bladeFrameworkHelperNameCompletions(
  prefix: string,
  range: { replaceEnd: number; replaceStart: number },
  providers: readonly PhpFrameworkProvider[],
): BladeCompletionItem[] {
  const normalizedPrefix = prefix.toLowerCase();
  const seenLabels = new Set<string>();

  return providers.flatMap((provider) =>
    (provider.stringLiterals?.helperNameCompletions?.() ?? [])
      .filter((helper) => {
        const normalizedLabel = helper.label.toLowerCase();

        if (!normalizedLabel.startsWith(normalizedPrefix)) {
          return false;
        }

        if (seenLabels.has(normalizedLabel)) {
          return false;
        }

        seenLabels.add(normalizedLabel);

        return true;
      })
      .map((helper) => ({
        detail: helper.detail,
        insertText: helper.insertText,
        kind: "helper" as const,
        label: helper.label,
        replaceEnd: range.replaceEnd,
        replaceStart: range.replaceStart,
      })),
  );
}

export function bladeFrameworkLiteralCompletionItems(
  completions: readonly PhpMethodCompletion[],
  offset: number,
  prefix: string,
): BladeCompletionItem[] {
  const replaceStart = offset - prefix.length;
  const replaceEnd = offset;

  return completions.map((completion) => ({
    detail: completion.declaringClassName,
    insertText: completion.insertText ?? completion.name,
    kind: "helper" as const,
    label: completion.name,
    replaceEnd,
    replaceStart,
  }));
}
