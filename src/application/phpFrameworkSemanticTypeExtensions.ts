import {
  phpFrameworkContainerConcreteClassNameFromSource,
  phpFrameworkMethodCallReturnTypeFromSource,
  phpFrameworkPropertyTypeFromSource,
  phpFrameworkSuppressesSameSourceMethodReturnFallback,
} from "../domain/phpFrameworkSemanticCapabilities";
import type { PhpFrameworkSemanticProvider } from "../domain/phpFrameworkSemanticContracts";
import type {
  PhpSemanticSourceContext,
  PhpSemanticTypeExtension,
} from "../domain/phpSemanticTypeExtensions";

export interface CreatePhpFrameworkSemanticTypeExtensionsOptions {
  readonly providers: readonly PhpFrameworkSemanticProvider[];
}

export function createPhpFrameworkSemanticTypeExtensions({
  providers,
}: CreatePhpFrameworkSemanticTypeExtensionsOptions): readonly PhpSemanticTypeExtension[] {
  if (providers.length === 0) {
    return [];
  }

  return [
    {
      containerExpressionType: ({ expression, source, sourceContext }) =>
        phpFrameworkContainerConcreteClassNameFromSource(
          source,
          expression,
          providers,
          frameworkSourceContext(sourceContext),
        ),
      methodCallReturnType: ({
        callExpression,
        methodName,
        receiverExpression,
        receiverType,
        source,
        sourceContext,
      }) =>
        phpFrameworkMethodCallReturnTypeFromSource(
          source,
          methodName,
          receiverType,
          receiverExpression,
          providers,
          callExpression,
          frameworkSourceContext(sourceContext),
        ),
      propertyType: ({ propertyName, receiverType, source }) =>
        phpFrameworkPropertyTypeFromSource(
          source,
          propertyName,
          providers,
          receiverType,
        ),
      suppressSameSourceMethodReturnFallback: ({ methodName }) =>
        phpFrameworkSuppressesSameSourceMethodReturnFallback(
          methodName,
          providers,
        ),
    },
  ];
}

function frameworkSourceContext(
  sourceContext: PhpSemanticSourceContext | undefined,
): { workspaceSources?: readonly string[] } | undefined {
  if (!sourceContext) {
    return undefined;
  }

  return { workspaceSources: sourceContext.workspaceSources };
}
