import { detectLatteControlAt, detectLatteFormMacroAt } from "./netteComponents";

export interface NetteStaticComponentFactoryReference {
  end: number;
  kind: "control" | "form";
  name: string;
  start: number;
}

export interface NetteStaticComponentFactoryReferenceResult {
  complete: boolean;
  references: NetteStaticComponentFactoryReference[];
}

/**
 * Projects only unambiguous component-factory usages that are safe inputs for
 * missing-factory diagnostics. A validated render-part (`name:part`) retains
 * the base factory name; dotted, dynamic and malformed targets are omitted.
 * An exceeded result cap returns no partial semantic claims.
 */
export function netteStaticComponentFactoryReferences(
  source: string,
  maxReferences: number,
): NetteStaticComponentFactoryReferenceResult {
  if (!Number.isSafeInteger(maxReferences) || maxReferences < 1) {
    return { complete: false, references: [] };
  }

  const macro = /\{\s*(control|form)\b/g;
  const references: NetteStaticComponentFactoryReference[] = [];

  for (let match = macro.exec(source); match !== null; match = macro.exec(source)) {
    if (macro.lastIndex <= match.index) {
      macro.lastIndex = match.index + 1;
    }

    let nameOffset = macro.lastIndex;

    while (source[nameOffset] === " " || source[nameOffset] === "\t") {
      nameOffset += 1;
    }

    if (source[nameOffset] === "'" || source[nameOffset] === '"') {
      nameOffset += 1;
    }

    const kind: "control" | "form" = match[1] === "control" ? "control" : "form";
    const detection =
      kind === "control"
        ? detectLatteControlAt(source, nameOffset)
        : detectLatteFormMacroAt(source, nameOffset);

    if (
      !detection ||
      detection.name.length > 128 ||
      !/^[a-z][A-Za-z0-9_]*$/.test(detection.name) ||
      (kind === "control" &&
        !hasSafeControlTargetTail(source, detection.nameStart, detection.nameEnd))
    ) {
      continue;
    }

    if (references.length >= maxReferences) {
      return { complete: false, references: [] };
    }

    references.push({
      end: detection.nameEnd,
      kind,
      name: detection.name,
      start: detection.nameStart,
    });
  }

  return { complete: true, references };
}

function hasSafeControlTargetTail(source: string, nameStart: number, nameEnd: number): boolean {
  const quote = source[nameStart - 1];

  if (quote === "'" || quote === '"') {
    return source[nameEnd] === quote;
  }

  const next = source[nameEnd];

  if (next === ":") {
    const part = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(nameEnd + 1));

    if (!part) {
      return false;
    }

    const afterPart = source[nameEnd + 1 + part[0].length];

    return afterPart === "}" || /\s/.test(afterPart ?? "");
  }

  return next === "}" || /\s/.test(next ?? "");
}
