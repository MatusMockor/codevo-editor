import type {
  PhpFrameworkContainerAutowiredCandidate,
  PhpFrameworkContainerBinding,
} from "./phpFrameworkProviders";
import { PHP_CLASS_NAME_CAPTURE_PATTERN } from "./phpReceiverExpressions";
import {
  neonServiceDefinitionsFromSource,
  neonServicesFromSource,
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
  const anonymousCandidates: PhpFrameworkContainerAutowiredCandidate[] = [];
  const namedServices = new Map<
    string,
    {
      autowired: boolean | string[];
      autowiredResolved: boolean;
      className: string | null;
      creationResolved: boolean;
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
        const candidate = netteAutowiredCandidate(service, source);

        if (candidate) {
          anonymousCandidates.push(candidate);
        }

        continue;
      }

      const merged = namedServices.get(service.serviceName) ?? {
        autowired: true,
        autowiredResolved: false,
        className: null,
        creationResolved: false,
        lowerFieldsBlocked: false,
        source,
      };

      if (merged.lowerFieldsBlocked) {
        continue;
      }

      if (!merged.creationResolved && definition.creationConfigured) {
        merged.className = service.className;
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

  const namedCandidates = Array.from(namedServices.values()).flatMap((service) => {
    const candidate = netteAutowiredCandidate(service, service.source);
    return candidate ? [candidate] : [];
  });

  return [...namedCandidates, ...anonymousCandidates];
}

function netteAutowiredCandidate(
  service: {
    autowired: boolean | string[];
    className: string | null;
  },
  source: string,
): PhpFrameworkContainerAutowiredCandidate | null {
  if (service.autowired === false) {
    return null;
  }

  const className = netteNeonServiceConcreteClassName(service);

  if (!className) {
    return null;
  }

  return {
    autowiredTypes: Array.isArray(service.autowired)
      ? service.autowired.map((type) =>
          type.toLowerCase() === "self"
            ? className
            : (netteNeonClassName(type) ?? type),
        )
      : null,
    className,
    source,
  };
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
