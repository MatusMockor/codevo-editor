import type { LanguageServerWorkspaceEdit } from "./languageServerFeatures";
import {
  matchingPairOffset,
  phpClassDeclaresMember,
  renderCreateConstantStub,
  renderCreateMethodStub,
  type MissingThisMember,
  type PhpCreateRenderTarget,
} from "./phpCreateFromUsage";
import {
  detectClassMemberIndent,
  findClassBodyInsertionOffset,
  indentLines,
  offsetToPosition,
} from "./phpInsertionPoint";
import { maskPhpSource } from "./phpSourceMask";

export interface PhpCreateParentMemberEditRequest {
  expectedParentNamespace?: string | null;
  member: MissingThisMember;
  parentClassName: string;
  parentFileUri: string;
  parentSource: string;
}

interface ParentClassDeclaration {
  bodyStartOffset: number;
  isReadonly: boolean;
  namespace: string | null;
}

export function buildPhpCreateParentMemberEdit(
  request: PhpCreateParentMemberEditRequest,
): LanguageServerWorkspaceEdit | null {
  const { member, parentSource } = request;

  if (member.target !== "parent") {
    return null;
  }

  if (member.kind !== "method" && member.kind !== "constant") {
    return null;
  }

  const parent = locateUniqueParentClass(parentSource, request.parentClassName);

  if (!parent) {
    return null;
  }

  if (!expectedNamespaceMatches(request, parent)) {
    return null;
  }

  const selector = { bodyStartOffset: parent.bodyStartOffset };

  if (
    phpClassDeclaresMember(parentSource, member.name, member.kind, selector)
  ) {
    return null;
  }

  const stub = renderMemberStub(member, {
    kind: parent.isReadonly ? "readonly-class" : "class",
    relationship: "parent",
    typeContext: "external-namespace",
  });

  if (!stub) {
    return null;
  }

  const insertion = findClassBodyInsertionOffset(parentSource, selector);

  if (!insertion) {
    return null;
  }

  const block = indentLines(
    stub,
    detectClassMemberIndent(parentSource, selector),
  );
  const leadingBlankLine = insertion.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertion.needsTrailingBlankLine ? "\n" : "";
  const position = offsetToPosition(parentSource, insertion.offset);
  const editPosition = { character: position.column, line: position.line };

  return {
    changes: {
      [request.parentFileUri]: [
        {
          newText: `${leadingBlankLine}${block}\n${trailingBlankLine}`,
          range: { end: editPosition, start: editPosition },
        },
      ],
    },
  };
}

function expectedNamespaceMatches(
  request: PhpCreateParentMemberEditRequest,
  parent: ParentClassDeclaration,
): boolean {
  const expected = request.expectedParentNamespace;

  if (expected === undefined) {
    return true;
  }

  if (expected === null || parent.namespace === null) {
    return expected === parent.namespace;
  }

  return expected.toLowerCase() === parent.namespace.toLowerCase();
}

function renderMemberStub(
  member: MissingThisMember,
  target: PhpCreateRenderTarget,
): string | null {
  if (member.kind === "constant") {
    return renderCreateConstantStub(member.name, { indent: "", target });
  }

  return renderCreateMethodStub(member.name, member.argTypes ?? [], {
    indent: "",
    isStatic: member.isStatic,
    target,
  });
}

function locateUniqueParentClass(
  source: string,
  parentClassName: string,
): ParentClassDeclaration | null {
  if (!parentClassName) {
    return null;
  }

  const masked = maskPhpSource(source);
  const pattern =
    /(?<![:\\$>A-Za-z0-9_])((?:(?:abstract|final|readonly)\s+)*)(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  const expectedName = parentClassName.toLowerCase();
  let found: ParentClassDeclaration | null = null;

  for (const match of masked.matchAll(pattern)) {
    if ((match[3] ?? "").toLowerCase() !== expectedName) {
      continue;
    }

    if (found || match[2] !== "class") {
      return null;
    }

    found = classDeclarationAt(masked, match);

    if (!found) {
      return null;
    }
  }

  return found;
}

function classDeclarationAt(
  masked: string,
  match: RegExpMatchArray,
): ParentClassDeclaration | null {
  const headerStart = match.index ?? 0;
  const bodyStartOffset = masked.indexOf("{", headerStart + match[0].length);

  if (bodyStartOffset < 0) {
    return null;
  }

  if (matchingPairOffset(masked, bodyStartOffset, "{", "}") === null) {
    return null;
  }

  return {
    bodyStartOffset,
    isReadonly: /\breadonly\b/.test(match[1] ?? ""),
    namespace: namespaceAtOffset(masked, headerStart),
  };
}

function namespaceAtOffset(masked: string, offset: number): string | null {
  const pattern = /\bnamespace\s+([^;{]+?)\s*([;{])/g;
  let active: string | null = null;

  for (const match of masked.matchAll(pattern)) {
    const namespaceStart = match.index ?? 0;

    if (namespaceStart >= offset) {
      break;
    }

    const name = match[1]?.trim().replace(/^\\+/, "") || null;

    if (match[2] === ";") {
      active = name;
      continue;
    }

    const bodyStart = namespaceStart + match[0].length - 1;
    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (bodyEnd !== null && offset > bodyStart && offset < bodyEnd) {
      return name;
    }

    active = null;
  }

  return active;
}
