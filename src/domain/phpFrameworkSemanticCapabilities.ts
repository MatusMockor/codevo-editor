import type { EditorPosition } from "./languageServerFeatures";
import { defaultPhpFrameworkProviders } from "./phpFrameworkProviderDefaults";
import type {
  PhpFrameworkContainerBinding,
  PhpFrameworkProvider,
  PhpFrameworkQueryCallbackContext,
  PhpFrameworkSourceContext,
} from "./phpFrameworkProviders";

export function phpFrameworkPropertyTypeFromSource(
  source: string,
  propertyName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  receiverType: string | null = null,
): string | null {
  for (const provider of providers) {
    const propertyType = provider.semantics?.propertyTypeFromSource?.({
      propertyName,
      receiverType,
      source,
    });

    if (propertyType) {
      return propertyType;
    }
  }

  return null;
}

/**
 * First query-callback context returned by the active providers. Provider
 * order is precedence order; providers without the capability are inert.
 */
export function phpFrameworkQueryCallbackContextForVariable(
  source: string,
  position: EditorPosition,
  variableName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkQueryCallbackContext | null {
  for (const provider of providers) {
    const context = provider.semantics?.queryCallbackContextForVariable?.({
      position,
      source,
      variableName,
    });

    if (context) {
      return context;
    }
  }

  return null;
}

export function phpFrameworkMethodCallReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
  receiverExpression: string | null,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  callExpression: string | null = null,
  sourceContext?: PhpFrameworkSourceContext,
): string | null {
  for (const provider of providers) {
    const returnType = provider.semantics?.methodCallReturnTypeFromSource?.({
      callExpression,
      methodName,
      receiverExpression,
      receiverType,
      sourceContext,
      source,
    });

    if (returnType) {
      return returnType;
    }
  }

  return null;
}

export function phpFrameworkSuppressesSameSourceMethodReturnFallback(
  methodName: string,
  providers?: readonly PhpFrameworkProvider[],
): boolean {
  if (!providers) {
    return methodName === "findOrFail";
  }

  if (providers.length === 0) {
    return false;
  }

  return providers.some(
    (provider) =>
      provider.semantics?.suppressesSameSourceMethodReturnFallback?.({
        methodName,
      }) === true,
  );
}

export function phpFrameworkContainerExpressionClassName(
  expression: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): string | null {
  for (const provider of providers) {
    const className = provider.semantics?.containerExpressionClassName?.({
      expression,
    });

    if (className) {
      return className;
    }
  }

  return null;
}

export function phpFrameworkContainerConcreteClassNameFromSource(
  source: string,
  expression: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
): string | null {
  const abstractClassName = phpFrameworkContainerExpressionClassName(
    expression,
    providers,
  );

  if (!abstractClassName) {
    return null;
  }

  return (
    phpFrameworkConcreteClassNameFromBindings(
      abstractClassName,
      phpFrameworkContainerBindingsFromSources(
        [source, ...(sourceContext?.workspaceSources ?? [])],
        providers,
      ),
    ) ?? abstractClassName
  );
}

export function phpFrameworkContainerBindingsFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkContainerBinding[] {
  return providers.flatMap(
    (provider) =>
      provider.semantics?.containerBindingsFromSource?.({ source }) ?? [],
  );
}

export function phpFrameworkSupportsContainerBindingsFromSource(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) =>
      provider.semantics?.containerBindingsFromSource !== undefined,
  );
}

export function isPhpFrameworkContainerBindingCandidatePath(
  path: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) =>
      provider.semantics?.isContainerBindingCandidatePath?.({ path }) === true,
  );
}

function phpFrameworkContainerBindingsFromSources(
  sources: readonly string[],
  providers: readonly PhpFrameworkProvider[],
): PhpFrameworkContainerBinding[] {
  const bindings: PhpFrameworkContainerBinding[] = [];

  for (const source of sources) {
    for (const binding of phpFrameworkContainerBindingsFromSource(
      source,
      providers,
    )) {
      if (bindings.some((seen) => phpFrameworkBindingsEqual(seen, binding))) {
        continue;
      }

      bindings.push(binding);
    }
  }

  return bindings;
}

function phpFrameworkConcreteClassNameFromBindings(
  abstractClassName: string,
  bindings: readonly PhpFrameworkContainerBinding[],
): string | null {
  const normalizedAbstract = phpFrameworkNormalizedClassName(abstractClassName);

  return (
    bindings.find(
      (binding) =>
        phpFrameworkNormalizedClassName(binding.abstractClassName) ===
        normalizedAbstract,
    )?.concreteClassName ?? null
  );
}

function phpFrameworkBindingsEqual(
  left: PhpFrameworkContainerBinding,
  right: PhpFrameworkContainerBinding,
): boolean {
  return (
    phpFrameworkNormalizedClassName(left.abstractClassName) ===
      phpFrameworkNormalizedClassName(right.abstractClassName) &&
    phpFrameworkNormalizedClassName(left.concreteClassName) ===
      phpFrameworkNormalizedClassName(right.concreteClassName)
  );
}

function phpFrameworkNormalizedClassName(className: string): string {
  return className.trim().replace(/^\\+/, "").toLowerCase();
}
