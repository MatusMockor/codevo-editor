import type { EditorPosition } from "./languageServerFeatures";
import type {
  PhpFrameworkValidationRuleCompletion,
  PhpFrameworkValidationRuleReference,
} from "./phpFrameworkProviders";
import type { PhpFrameworkValidationCapabilityPort } from "./phpFrameworkDispatchPorts";

export function phpFrameworkValidationRuleReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkValidationCapabilityPort[],
): PhpFrameworkValidationRuleReference | null {
  for (const provider of providers) {
    const reference = provider.validation?.ruleReferenceAt?.({
      position,
      source,
    });

    if (reference) {
      return reference;
    }
  }

  return null;
}

export function phpFrameworkValidationRuleCompletions(
  prefix: string,
  providers: readonly PhpFrameworkValidationCapabilityPort[],
): PhpFrameworkValidationRuleCompletion[] {
  return providers.flatMap(
    (provider) => provider.validation?.ruleCompletions?.({ prefix }) ?? [],
  );
}
