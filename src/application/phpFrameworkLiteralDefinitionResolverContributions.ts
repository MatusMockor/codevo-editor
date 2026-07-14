import type { PhpFrameworkLiteralDefinitionResolverContribution } from "./phpFrameworkLiteralDefinitionResolverRegistry";
import { phpLaravelLiteralDefinitionResolverContribution } from "./phpLaravelLiteralDefinitionResolverContribution";
import { phpNetteLiteralDefinitionResolverContribution } from "./phpNetteLiteralDefinitionResolverContribution";

export const PHP_FRAMEWORK_LITERAL_DEFINITION_RESOLVER_CONTRIBUTIONS: readonly PhpFrameworkLiteralDefinitionResolverContribution[] =
  [
    phpLaravelLiteralDefinitionResolverContribution,
    phpNetteLiteralDefinitionResolverContribution,
  ];
