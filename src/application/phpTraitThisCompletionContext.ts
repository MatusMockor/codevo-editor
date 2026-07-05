import type { EditorPosition } from "../domain/languageServerFeatures";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type { PhpTraitThisCompletionContext } from "./usePhpMethodCompletionResolvers";

interface PhpSameSourceTypeDeclaration {
  bodyEnd: number;
  bodyStart: number;
  fullyQualifiedName: string;
  kind: "class" | "enum" | "interface" | "trait";
  name: string;
}

export function phpTraitThisCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpTraitThisCompletionContext | null {
  const offset = phpOffsetAtPosition(source, position);
  const types = phpSameSourceTypeDeclarations(source);
  const trait = types.find(
    (type) =>
      type.kind === "trait" &&
      offset > type.bodyStart &&
      offset < type.bodyEnd,
  );

  if (!trait) {
    return null;
  }

  const hosts = types.filter(
    (type) =>
      (type.kind === "class" || type.kind === "enum") &&
      phpSameSourceTypeUsesTrait(source, type, trait.fullyQualifiedName),
  );
  const host = hosts.length === 1 ? hosts[0] : null;

  if (!host) {
    return null;
  }

  return {
    contextualThisClassName: host.fullyQualifiedName,
    declaringClassName: host.fullyQualifiedName,
    memberSource: `${phpSameSourceTypeBody(source, trait)}\n${phpSameSourceTypeBody(
      source,
      host,
    )}`,
  };
}

function phpSameSourceTypeDeclarations(
  source: string,
): PhpSameSourceTypeDeclaration[] {
  const namespaceMatch = /^\s*namespace\s+([^;{]+)[;{]/m.exec(source);
  const namespace = namespaceMatch?.[1]?.trim().replace(/^\\+/, "") ?? "";
  const types: PhpSameSourceTypeDeclaration[] = [];
  const pattern = /\b(class|enum|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(source))) {
    const kind = match[1] as PhpSameSourceTypeDeclaration["kind"] | undefined;
    const name = match[2];

    if (!kind || !name) {
      continue;
    }

    const bodyStart = source.indexOf("{", match.index + match[0].length);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd =
      phpMatchingPairOffset(source, bodyStart, "{", "}") ?? source.length;

    types.push({
      bodyEnd,
      bodyStart,
      fullyQualifiedName: namespace ? `${namespace}\\${name}` : name,
      kind,
      name,
    });
    pattern.lastIndex = bodyEnd + 1;
  }

  return types;
}

function phpSameSourceTypeUsesTrait(
  source: string,
  type: PhpSameSourceTypeDeclaration,
  traitClassName: string,
): boolean {
  const body = phpSameSourceTypeBody(source, type);

  for (const match of body.matchAll(/^\s*use\s+([^;{]+)\s*(?:;|\{)/gm)) {
    for (const trait of (match[1] ?? "").split(",")) {
      const resolvedTraitName = resolvePhpClassName(source, trait.trim());

      if (
        resolvedTraitName?.replace(/^\\+/, "").toLowerCase() ===
        traitClassName.toLowerCase()
      ) {
        return true;
      }
    }
  }

  return false;
}

function phpSameSourceTypeBody(
  source: string,
  type: PhpSameSourceTypeDeclaration,
): string {
  return source.slice(type.bodyStart + 1, type.bodyEnd);
}

function phpMatchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let quote: string | null = null;
  let depth = 0;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function phpOffsetAtPosition(source: string, position: EditorPosition): number {
  let line = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}
