import {
  latteTranslationReferenceAt,
  type LatteTranslationReference,
} from "../domain/latteTranslations";
import type { LatteCompletionItem } from "./latteCompletionItems";
import { LATTE_MAX_COMPLETIONS } from "./latteProviderFlowContext";
import type { LatteProviderRequestContext } from "./latteProviderRequestContext";

export function latteTranslationCompletionAt(
  source: string,
  offset: number,
): LatteTranslationReference | null {
  return latteTranslationReferenceAt(source, offset);
}

export async function latteTranslationCompletions(
  request: LatteProviderRequestContext,
  reference: LatteTranslationReference,
): Promise<LatteCompletionItem[]> {
  const normalizedPrefix = reference.prefix.toLowerCase();
  const targets = await request.deps.collectTranslationTargets();

  if (!request.isRequestedRootActive()) {
    return [];
  }

  return targets
    .filter((target) => target.key.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, LATTE_MAX_COMPLETIONS)
    .map((target) => ({
      detail: target.relativePath,
      insertText: target.key,
      kind: "translation" as const,
      label: target.key,
      replaceEnd: reference.replaceEnd,
      replaceStart: reference.replaceStart,
    }));
}

export async function resolveLatteTranslationDefinition(
  request: LatteProviderRequestContext,
  source: string,
  offset: number,
): Promise<boolean> {
  const reference = latteTranslationReferenceAt(source, offset);

  if (!reference) {
    return false;
  }

  const target = await request.deps.findTranslationTarget(reference.key);

  if (!request.isRequestedRootActive() || !target) {
    return false;
  }

  return request.deps.openTarget(target.path, target.position, target.key);
}
