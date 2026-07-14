import {
  type PhpFileOutline,
  type PhpFileOutlineNode,
  type PhpFileOutlineNodeKind,
} from "./phpFileOutline";
import { maskPhpSource } from "./phpSourceMask";
import { getFileName } from "./workspace";

const TOKEN_PATTERN =
  /[{}()]|\bnamespace\b(?:\s+(?<namespaceName>[A-Za-z_][A-Za-z0-9_\\]*))?\s*(?<namespaceDelimiter>[;{])|(?<![:$\\>A-Za-z0-9_])(?:(?:abstract|final|readonly)\s+)*(?<typeKind>class|interface|trait|enum)\s+(?<typeName>[A-Za-z_][A-Za-z0-9_]*)|\bfunction\s+&?\s*(?<functionName>[A-Za-z_][A-Za-z0-9_]*)(?=\s*\()|\b(?:public|protected|private|var)\b[^;=(){}$]*\$(?<propertyName>[A-Za-z_][A-Za-z0-9_]*)|\bconst\s+(?:[A-Za-z_][A-Za-z0-9_]*\s+)?(?<constantName>[A-Za-z_][A-Za-z0-9_]*)\s*=/g;

const TYPE_KINDS: Record<string, PhpFileOutlineNodeKind> = {
  class: "class",
  enum: "enum",
  interface: "interface",
  trait: "trait",
};

interface OpenType {
  memberDepth: number;
  node: PhpFileOutlineNode;
}

export function shallowPhpFileOutline(
  path: string,
  source: string,
): PhpFileOutline {
  const masked = maskPhpSource(source);
  const relativePath = getFileName(path);
  const nodes: PhpFileOutlineNode[] = [];
  const position = createPositionTracker(masked);

  let braceDepth = 0;
  let parenDepth = 0;
  let topLevelDepth = 0;
  let namespaceName = "";
  let pendingType: PhpFileOutlineNode | null = null;
  let openType: OpenType | null = null;

  const buildNode = (
    kind: PhpFileOutlineNodeKind,
    label: string,
    fullyQualifiedName: string,
    offset: number,
  ): PhpFileOutlineNode => {
    const location = position.at(offset);

    return {
      children: [],
      column: location.column,
      fullyQualifiedName,
      id: `symbol:${fullyQualifiedName}`,
      kind,
      label,
      lineNumber: location.lineNumber,
      path,
      relativePath,
    };
  };

  const addMemberOrTopLevel = (
    memberKind: PhpFileOutlineNodeKind,
    topLevelKind: PhpFileOutlineNodeKind | null,
    label: string,
    offset: number,
  ): void => {
    if (parenDepth !== 0) {
      return;
    }

    if (openType && braceDepth === openType.memberDepth) {
      const fullyQualifiedName = `${openType.node.fullyQualifiedName}::${label}`;
      openType.node.children.push(
        buildNode(memberKind, label, fullyQualifiedName, offset),
      );
      return;
    }

    if (!topLevelKind || openType || braceDepth !== topLevelDepth) {
      return;
    }

    nodes.push(
      buildNode(
        topLevelKind,
        label,
        qualifiedName(namespaceName, label),
        offset,
      ),
    );
  };

  for (const match of masked.matchAll(TOKEN_PATTERN)) {
    const token = match[0];
    const groups = match.groups ?? {};
    const offset = match.index ?? 0;

    if (token === "{") {
      braceDepth += 1;

      if (pendingType) {
        openType = { memberDepth: braceDepth, node: pendingType };
        pendingType = null;
      }

      continue;
    }

    if (token === "}") {
      if (openType && braceDepth === openType.memberDepth) {
        openType = null;
      }

      braceDepth = Math.max(0, braceDepth - 1);
      topLevelDepth = Math.min(topLevelDepth, braceDepth);
      continue;
    }

    if (token === "(") {
      parenDepth += 1;
      continue;
    }

    if (token === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }

    if (groups.namespaceDelimiter) {
      namespaceName = groups.namespaceName ?? "";
      pendingType = null;
      openType = null;

      if (groups.namespaceDelimiter === "{") {
        braceDepth += 1;
        topLevelDepth = braceDepth;
        continue;
      }

      topLevelDepth = braceDepth;
      continue;
    }

    if (groups.typeKind && groups.typeName) {
      if (braceDepth !== topLevelDepth || parenDepth !== 0 || openType) {
        continue;
      }

      if (isPrecededByNewKeyword(masked, offset)) {
        continue;
      }

      const kind = TYPE_KINDS[groups.typeKind];

      if (!kind) {
        continue;
      }

      const node = buildNode(
        kind,
        groups.typeName,
        qualifiedName(namespaceName, groups.typeName),
        offset,
      );
      nodes.push(node);
      pendingType = node;
      continue;
    }

    if (groups.functionName) {
      addMemberOrTopLevel("method", "function", groups.functionName, offset);
      continue;
    }

    if (groups.propertyName) {
      addMemberOrTopLevel("property", null, `$${groups.propertyName}`, offset);

      for (const segment of groupedDeclarationSegments(
        masked,
        offset + token.length,
        "property",
      )) {
        addMemberOrTopLevel("property", null, segment.label, segment.offset);
      }

      continue;
    }

    if (groups.constantName) {
      addMemberOrTopLevel("constant", "constant", groups.constantName, offset);

      for (const segment of groupedDeclarationSegments(
        masked,
        offset + token.length,
        "constant",
      )) {
        addMemberOrTopLevel("constant", "constant", segment.label, segment.offset);
      }
    }
  }

  return { nodes };
}

const PROPERTY_SEGMENT_PATTERN = /\$([A-Za-z_][A-Za-z0-9_]*)/y;
const CONSTANT_SEGMENT_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)\s*=/y;

function groupedDeclarationSegments(
  masked: string,
  startIndex: number,
  kind: "constant" | "property",
): Array<{ label: string; offset: number }> {
  const segments: Array<{ label: string; offset: number }> = [];
  let depth = 0;

  for (let index = startIndex; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{" && depth === 0 && kind === "property") {
      return segments;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) {
        return segments;
      }

      depth -= 1;
      continue;
    }

    if (depth !== 0) {
      continue;
    }

    if (character === ";") {
      return segments;
    }

    if (character !== ",") {
      continue;
    }

    let cursor = index + 1;

    while (cursor < masked.length && /\s/.test(masked[cursor] || "")) {
      cursor += 1;
    }

    if (kind === "property") {
      PROPERTY_SEGMENT_PATTERN.lastIndex = cursor;
      const match = PROPERTY_SEGMENT_PATTERN.exec(masked);

      if (!match) {
        continue;
      }

      segments.push({ label: `$${match[1]}`, offset: cursor });
      index = cursor + match[0].length - 1;
      continue;
    }

    CONSTANT_SEGMENT_PATTERN.lastIndex = cursor;
    const match = CONSTANT_SEGMENT_PATTERN.exec(masked);

    if (!match) {
      continue;
    }

    segments.push({ label: match[1] || "", offset: cursor });
    index = cursor + match[0].length - 1;
  }

  return segments;
}

function qualifiedName(namespaceName: string, name: string): string {
  if (!namespaceName) {
    return name;
  }

  return `${namespaceName}\\${name}`;
}

function isPrecededByNewKeyword(masked: string, offset: number): boolean {
  let index = offset - 1;

  while (index >= 0 && /\s/.test(masked[index] || "")) {
    index -= 1;
  }

  if (index < 2 || masked.slice(index - 2, index + 1) !== "new") {
    return false;
  }

  const before = masked[index - 3];

  if (before === undefined) {
    return true;
  }

  return !/[A-Za-z0-9_$\\]/.test(before);
}

function createPositionTracker(masked: string): {
  at(offset: number): { column: number; lineNumber: number };
} {
  let scanned = 0;
  let line = 1;
  let lineStart = 0;

  return {
    at(offset: number) {
      for (let index = scanned; index < offset; index += 1) {
        if (masked.charCodeAt(index) === 10) {
          line += 1;
          lineStart = index + 1;
        }
      }

      scanned = Math.max(scanned, offset);
      return { column: offset - lineStart + 1, lineNumber: line };
    },
  };
}
