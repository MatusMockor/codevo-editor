import type { EditorPosition } from "./languageServerFeatures";
import { resolvePhpClassName } from "./phpClassNameResolution";
import { defaultPhpFrameworkProviders } from "./phpFrameworkProviderDefaults";
import type {
  PhpFrameworkContainerAutowiredCandidate,
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
    ) ??
    phpFrameworkAutowiredConcreteClassNameFromSources(
      abstractClassName,
      [source, ...(sourceContext?.workspaceSources ?? [])],
      providers,
    ) ??
    abstractClassName
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

export function phpFrameworkContainerConcreteClassNamesFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): string[] {
  return providers.flatMap(
    (provider) =>
      provider.semantics?.containerConcreteClassNamesFromSource?.({ source }) ??
      [],
  );
}

export function phpFrameworkSupportsContainerBindingsFromSource(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) =>
      provider.semantics?.containerBindingsFromSource !== undefined ||
      provider.semantics?.containerAutowiredCandidatesFromSources !== undefined,
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

function phpFrameworkAutowiredConcreteClassNameFromSources(
  abstractClassName: string,
  sources: readonly string[],
  providers: readonly PhpFrameworkProvider[],
): string | null {
  const candidates = phpFrameworkContainerAutowiredCandidatesFromSources(
    sources,
    providers,
  );
  const matches = candidates.filter((candidate) =>
    candidate.producedTypeSource.kind === "class" &&
    phpFrameworkSourceDeclaresClassImplementing(
      sources,
      candidate.producedTypeSource.className,
      abstractClassName,
    ),
  );
  const eligible = matches.filter((candidate) =>
    candidate.autowiredTypes
      ? candidate.autowiredTypes.some((type) =>
          phpFrameworkRequestedTypeMatchesAutowiredType(
            sources,
            abstractClassName,
            type,
          ),
        )
      : true,
  );
  const preferred = eligible.filter((candidate) => candidate.autowiredTypes);

  if (preferred.length === 1) {
    return phpFrameworkCandidateClassName(preferred[0]);
  }

  if (preferred.length > 1) {
    return null;
  }

  if (eligible.length !== 1) {
    return null;
  }

  return phpFrameworkCandidateClassName(eligible[0]);
}

export function phpFrameworkContainerAutowiredCandidatesFromSources(
  sources: readonly string[],
  providers: readonly PhpFrameworkProvider[],
): PhpFrameworkContainerAutowiredCandidate[] {
  const candidates: PhpFrameworkContainerAutowiredCandidate[] = [];

  for (const provider of providers) {
    const providerCandidates =
      provider.semantics?.containerAutowiredCandidatesFromSources?.({ sources });

    if (providerCandidates) {
      candidates.push(...providerCandidates);
      continue;
    }

    for (const source of sources) {
      for (const className of phpFrameworkContainerConcreteClassNamesFromSource(
        source,
        [provider],
      )) {
        const normalized = phpFrameworkNormalizedClassName(className);

        if (
          candidates.some(
            (candidate) =>
              candidate.producedTypeSource.kind === "class" &&
              phpFrameworkNormalizedClassName(
                candidate.producedTypeSource.className,
              ) === normalized,
          )
        ) {
          continue;
        }

        candidates.push({
          autowiredTypes: null,
          producedTypeSource: { className, kind: "class" },
          source,
        });
      }
    }
  }

  return candidates;
}

function phpFrameworkCandidateClassName(
  candidate: PhpFrameworkContainerAutowiredCandidate | undefined,
): string | null {
  if (!candidate || candidate.producedTypeSource.kind !== "class") {
    return null;
  }

  return candidate.producedTypeSource.className;
}

function phpFrameworkRequestedTypeMatchesAutowiredType(
  sources: readonly string[],
  requestedType: string,
  autowiredType: string,
): boolean {
  if (
    phpFrameworkNormalizedClassName(requestedType) ===
    phpFrameworkNormalizedClassName(autowiredType)
  ) {
    return true;
  }

  return phpFrameworkSourceDeclaresClassImplementing(
    sources,
    requestedType,
    autowiredType,
  );
}

function phpFrameworkSourceDeclaresClassImplementing(
  sources: readonly string[],
  className: string,
  interfaceName: string,
): boolean {
  const normalizedClassName = phpFrameworkNormalizedClassName(className);

  for (const source of sources) {
    if (
      phpFrameworkCurrentClassName(source)?.toLowerCase() !==
      normalizedClassName
    ) {
      continue;
    }

    if (phpFrameworkDirectInterfaceNames(source).some(
      (implementedName) =>
        phpFrameworkNormalizedClassName(implementedName) ===
        phpFrameworkNormalizedClassName(interfaceName),
    )) {
      return true;
    }
  }

  return false;
}

function phpFrameworkCurrentClassName(source: string): string | null {
  const namespace = /^\s*namespace\s+([^;{]+)[;{]/m
    .exec(source)?.[1]
    ?.trim()
    .replace(/^\\+/, "");
  const match = /^\s*(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/m.exec(
    source,
  );
  const shortName = match?.[1] ?? null;

  if (!shortName) {
    return null;
  }

  return namespace ? `${namespace}\\${shortName}` : shortName;
}

function phpFrameworkDirectInterfaceNames(
  source: string,
): string[] {
  const match = /^\s*(?:abstract\s+|final\s+|readonly\s+)*class\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+extends\s+[^\s{]+)?\s+implements\s+([^{]+)/m.exec(
    source,
  );
  const implementsList = match?.[1] ?? "";

  if (!implementsList) {
    return [];
  }

  return implementsList
    .split(",")
    .map((part) => part.trim().replace(/<[\s\S]*$/, ""))
    .map((part) => resolvePhpClassName(source, part))
    .filter((part): part is string => Boolean(part));
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
