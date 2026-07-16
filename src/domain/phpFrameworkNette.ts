import type {
  PhpFrameworkContainerAutowiredCandidate,
  PhpFrameworkContainerBinding,
} from "./phpFrameworkProviders";
import { PHP_CLASS_NAME_CAPTURE_PATTERN } from "./phpReceiverExpressions";
import {
  neonServiceDefinitionsFromSource,
  neonServiceAliasesFromSource,
  neonServicesFromSource,
  type NeonServiceFactory,
} from "./netteDiContainer";

export function phpNetteContainerExpressionClassName(
  expression: string,
): string | null {
  const normalized = expression.trim();
  const match = new RegExp(
    `\\??->\\s*getByType\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\b`,
  ).exec(normalized);

  if (!match || !netteContainerCallIsOutermost(normalized, match)) {
    return null;
  }

  return normalizedPhpClassName(match[1] ?? "");
}

export function phpNetteContainerBindingsFromSource(
  _source: string,
): PhpFrameworkContainerBinding[] {
  return [];
}

export function phpNetteContainerAutowiredCandidatesFromSources(
  sources: readonly string[],
): PhpFrameworkContainerAutowiredCandidate[] {
  const anonymousServices: Array<{
    service: ReturnType<
      typeof neonServiceDefinitionsFromSource
    >[number]["service"];
    source: string;
  }> = [];
  const namedServices = new Map<
    string,
    {
      autowired: boolean | string[];
      autowiredResolved: boolean;
      className: string | null;
      creationResolved: boolean;
      factoryMetadata: NeonServiceFactory | null;
      lowerFieldsBlocked: boolean;
      source: string;
    }
  >();

  for (const source of sources) {
    const definitions = neonServiceDefinitionsFromSource(source);

    for (let index = definitions.length - 1; index >= 0; index -= 1) {
      const definition = definitions[index];

      if (!definition) {
        continue;
      }

      const { service } = definition;

      if (!service.serviceName) {
        anonymousServices.push({ service, source });
        continue;
      }

      const merged = namedServices.get(service.serviceName) ?? {
        autowired: true,
        autowiredResolved: false,
        className: null,
        creationResolved: false,
        factoryMetadata: null,
        lowerFieldsBlocked: false,
        source,
      };

      if (merged.lowerFieldsBlocked) {
        continue;
      }

      if (!merged.creationResolved && definition.creationConfigured) {
        merged.className = service.className;
        merged.factoryMetadata = service.factoryMetadata ?? null;
        merged.creationResolved = true;
        merged.source = source;
      }

      if (!merged.autowiredResolved && definition.autowiredConfigured) {
        merged.autowired = service.autowired;
        merged.autowiredResolved = true;
      }

      if (definition.preventsMerging) {
        merged.lowerFieldsBlocked = true;
      }

      namedServices.set(service.serviceName, merged);
    }
  }

  const aliases = mergedNetteServiceAliases(sources);
  const anonymousCandidates = anonymousServices.flatMap(
    ({ service, source }) => {
      const candidate = netteAutowiredCandidate(
        service,
        source,
        namedServices,
        aliases,
      );
      return candidate ? [candidate] : [];
    },
  );
  const namedCandidates = Array.from(namedServices.values()).flatMap(
    (service) => {
      const candidate = netteAutowiredCandidate(
        service,
        service.source,
        namedServices,
        aliases,
      );
      return candidate ? [candidate] : [];
    },
  );

  return [...namedCandidates, ...anonymousCandidates];
}

function netteAutowiredCandidate(
  service: {
    autowired: boolean | string[];
    className: string | null;
    factoryMetadata?: NeonServiceFactory | null;
  },
  source: string,
  namedServices: ReadonlyMap<
    string,
    { className: string | null; factoryMetadata: NeonServiceFactory | null }
  > = new Map(),
  aliases: ReadonlyMap<string, string> = new Map(),
): PhpFrameworkContainerAutowiredCandidate | null {
  if (service.autowired === false) {
    return null;
  }

  const producedTypeSource = netteProducedTypeSource(
    service,
    namedServices,
    aliases,
  );

  if (!producedTypeSource) {
    return null;
  }

  return {
    autowiredTypes: Array.isArray(service.autowired)
      ? service.autowired.map((type) =>
          type.toLowerCase() === "self"
            ? producedTypeSource.kind === "class"
              ? producedTypeSource.className
              : "self"
            : (netteNeonClassName(type) ?? type),
        )
      : null,
    producedTypeSource,
    source,
  };
}

function netteProducedTypeSource(
  service: {
    className: string | null;
    factoryMetadata?: NeonServiceFactory | null;
  },
  namedServices: ReadonlyMap<
    string,
    { className: string | null; factoryMetadata: NeonServiceFactory | null }
  >,
  aliases: ReadonlyMap<string, string>,
): PhpFrameworkContainerAutowiredCandidate["producedTypeSource"] | null {
  const factory = service.factoryMetadata;

  if (!factory) {
    const className = netteNeonServiceConcreteClassName(service);
    return className ? { className, kind: "class" } : null;
  }

  const declaringClassName =
    factory.kind === "classMethod"
      ? netteNeonClassName(factory.className)
      : netteFactoryServiceOwnerClassName(
          factory.serviceName,
          namedServices,
          aliases,
          new Set<string>(),
        );

  if (!declaringClassName) {
    return null;
  }

  return {
    declaringClassName,
    kind: "factoryMethod",
    methodName: factory.methodName,
    staticOnly: factory.kind === "classMethod",
  };
}

function netteFactoryServiceOwnerClassName(
  serviceName: string,
  namedServices: ReadonlyMap<
    string,
    { className: string | null; factoryMetadata: NeonServiceFactory | null }
  >,
  aliases: ReadonlyMap<string, string>,
  visited: Set<string>,
): string | null {
  const directClassName = netteNeonClassName(serviceName);

  if (directClassName) {
    return directClassName;
  }

  if (visited.has(serviceName)) {
    return null;
  }

  visited.add(serviceName);
  const matchingServices = Array.from(namedServices.entries()).filter(
    ([name]) => name === serviceName,
  );

  if (matchingServices.length === 1) {
    const owner = matchingServices[0]?.[1];
    const ownerClassName = owner
      ? netteNeonServiceConcreteClassName(owner)
      : null;

    if (ownerClassName) {
      return ownerClassName;
    }
  }

  const aliasTarget = aliases.get(serviceName);

  if (!aliasTarget) {
    return null;
  }

  return netteFactoryServiceOwnerClassName(
    aliasTarget,
    namedServices,
    aliases,
    visited,
  );
}

function mergedNetteServiceAliases(
  sources: readonly string[],
): ReadonlyMap<string, string> {
  const targets = new Map<string, string>();
  const ambiguous = new Set<string>();

  for (const source of sources) {
    for (const alias of neonServiceAliasesFromSource(source)) {
      const existing = targets.get(alias.serviceName);

      if (existing && existing !== alias.targetName) {
        ambiguous.add(alias.serviceName);
        continue;
      }

      targets.set(alias.serviceName, alias.targetName);
    }
  }

  for (const serviceName of ambiguous) {
    targets.delete(serviceName);
  }

  return targets;
}

export function phpNetteContainerConcreteClassNamesFromSource(
  source: string,
): string[] {
  const classNames: string[] = [];

  for (const service of neonServicesFromSource(source)) {
    if (service.autowired === false) {
      continue;
    }

    const className = netteNeonServiceConcreteClassName(service);

    if (!className || classNames.some((seen) => seen === className)) {
      continue;
    }

    classNames.push(className);
  }

  return classNames;
}

export function isNetteContainerBindingCandidatePath(path: string): boolean {
  return path.toLowerCase().endsWith(".neon");
}

function netteContainerCallIsOutermost(
  expression: string,
  match: RegExpExecArray,
): boolean {
  const openOffset = (match.index ?? 0) + match[0].lastIndexOf("(");

  if (expression[openOffset] !== "(") {
    return false;
  }

  const closeOffset = matchingPairOffset(expression, openOffset);

  if (closeOffset === null) {
    return false;
  }

  return expression.slice(closeOffset + 1).trim().length === 0;
}

function matchingPairOffset(source: string, openOffset: number): number | null {
  let depth = 0;

  for (let offset = openOffset; offset < source.length; offset += 1) {
    const character = source[offset];

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return offset;
    }
  }

  return null;
}

function netteNeonClassName(value: string): string | null {
  const normalized = unquoteNetteNeonToken(value.trim());
  const match = new RegExp(`^\\\\?${PHP_CLASS_NAME_CAPTURE_PATTERN}$`).exec(
    normalized,
  );

  if (!match || !match[1]?.includes("\\")) {
    return null;
  }

  return normalizedPhpClassName(match[1]);
}

function unquoteNetteNeonToken(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function netteNeonServiceConcreteClassName(service: {
  className: string | null;
}): string | null {
  if (!service.className) {
    return null;
  }

  return netteNeonClassName(service.className);
}

function normalizedPhpClassName(className: string): string | null {
  const normalized = className.trim().replace(/^\\+/, "");

  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}
