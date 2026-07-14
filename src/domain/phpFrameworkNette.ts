import type { PhpFrameworkContainerBinding } from "./phpFrameworkProviders";
import { PHP_CLASS_NAME_CAPTURE_PATTERN } from "./phpReceiverExpressions";
import { neonServicesFromSource } from "./netteDiContainer";

interface NetteNeonServiceFrame {
  abstractClassName: string;
  indent: number;
}

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
  source: string,
): PhpFrameworkContainerBinding[] {
  const bindings = phpNetteFqnKeyContainerBindingsFromSource(source);

  for (const service of neonServicesFromSource(source)) {
    const abstractClassName = service.serviceName
      ? netteNeonClassName(service.serviceName)
      : null;

    if (!abstractClassName) {
      continue;
    }

    pushNetteContainerBinding(
      bindings,
      abstractClassName,
      netteNeonServiceConcreteClassName(service),
    );
  }

  return bindings;
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

function phpNetteFqnKeyContainerBindingsFromSource(
  source: string,
): PhpFrameworkContainerBinding[] {
  const bindings: PhpFrameworkContainerBinding[] = [];
  let activeFrame: NetteNeonServiceFrame | null = null;
  let servicesIndent: number | null = null;

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripNetteNeonComment(rawLine);

    if (line.trim().length === 0) {
      continue;
    }

    const indent = line.search(/\S/);
    const keyValue = netteNeonKeyValueLine(line);

    if (!keyValue) {
      continue;
    }

    if (indent === 0 && keyValue.key !== "services") {
      servicesIndent = null;
      activeFrame = null;
      continue;
    }

    if (keyValue.key === "services") {
      servicesIndent = indent;
      activeFrame = null;
      continue;
    }

    if (servicesIndent === null || indent <= servicesIndent) {
      activeFrame = null;
      continue;
    }

    if (activeFrame && indent <= activeFrame.indent) {
      activeFrame = null;
    }

    if (activeFrame && keyValue.key === "factory") {
      pushNetteContainerBinding(
        bindings,
        activeFrame.abstractClassName,
        netteNeonClassName(keyValue.value),
      );
      continue;
    }

    const abstractClassName = netteNeonClassName(keyValue.key);

    if (!abstractClassName) {
      continue;
    }

    const concreteClassName = netteNeonClassName(keyValue.value);

    if (concreteClassName) {
      pushNetteContainerBinding(bindings, abstractClassName, concreteClassName);
      continue;
    }

    activeFrame = { abstractClassName, indent };
  }

  return bindings;
}

function stripNetteNeonComment(line: string): string {
  const commentOffset = line.indexOf("#");

  if (commentOffset < 0) {
    return line;
  }

  return line.slice(0, commentOffset);
}

function netteNeonKeyValueLine(
  line: string,
): { key: string; value: string } | null {
  const match = /^(\s*)(["']?[^:"']+(?:\\[^:"']+)*["']?)\s*:\s*(.*)$/.exec(
    line,
  );

  if (!match) {
    return null;
  }

  return {
    key: unquoteNetteNeonToken(match[2] ?? "").trim(),
    value: (match[3] ?? "").trim(),
  };
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
  factory: string | null;
}): string | null {
  if (service.className) {
    return netteNeonClassName(service.className);
  }

  if (!service.factory) {
    return null;
  }

  const factoryClass = service.factory.split("::")[0]?.trim() ?? "";

  if (factoryClass.startsWith("@")) {
    return null;
  }

  return netteNeonClassName(factoryClass);
}

function normalizedPhpClassName(className: string): string | null {
  const normalized = className.trim().replace(/^\\+/, "");

  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

function pushNetteContainerBinding(
  bindings: PhpFrameworkContainerBinding[],
  abstractClassName: string,
  concreteClassName: string | null,
): void {
  if (!concreteClassName) {
    return;
  }

  if (
    bindings.some(
      (binding) =>
        binding.abstractClassName === abstractClassName &&
        binding.concreteClassName === concreteClassName,
    )
  ) {
    return;
  }

  bindings.push({ abstractClassName, concreteClassName });
}
