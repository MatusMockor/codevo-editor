import type { EditorPosition } from "../domain/languageServerFeatures";
import { phpLaravelIdentifierContextAt } from "../domain/phpLaravelIdentifierNavigation";
import {
  phpIdentifierContextAt,
  type PhpIdentifierContext,
} from "../domain/phpNavigation";
import {
  isPhpFrameworkProviderActive,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";

export type PhpFrameworkIdentifierContextClassifier = (
  source: string,
  position: EditorPosition,
) => PhpIdentifierContext | null;

export interface PhpFrameworkIdentifierContextContribution {
  readonly classify: PhpFrameworkIdentifierContextClassifier;
  readonly providerId: string;
}

const PHP_FRAMEWORK_IDENTIFIER_CONTEXT_CONTRIBUTIONS: readonly PhpFrameworkIdentifierContextContribution[] =
  [
    {
      classify: phpLaravelIdentifierContextAt,
      providerId: "laravel",
    },
  ];

export function activePhpFrameworkIdentifierContextContributions(
  providers: readonly PhpFrameworkProvider[],
  registry: readonly PhpFrameworkIdentifierContextContribution[] = PHP_FRAMEWORK_IDENTIFIER_CONTEXT_CONTRIBUTIONS,
): readonly PhpFrameworkIdentifierContextContribution[] {
  return registry.filter(({ providerId }) =>
    isPhpFrameworkProviderActive(providers, providerId),
  );
}

export function resolvePhpIdentifierContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[],
  registry: readonly PhpFrameworkIdentifierContextContribution[] = PHP_FRAMEWORK_IDENTIFIER_CONTEXT_CONTRIBUTIONS,
): PhpIdentifierContext | null {
  for (const contribution of activePhpFrameworkIdentifierContextContributions(
    providers,
    registry,
  )) {
    const context = contribution.classify(source, position);

    if (context) {
      return context;
    }
  }

  return phpIdentifierContextAt(source, position);
}
