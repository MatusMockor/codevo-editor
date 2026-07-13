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

export interface PhpCreateMemberWorkspaceEditRequest {
  expectedNamespace?: string | null;
  member: MissingThisMember;
  targetClassName: string;
  targetFileUri: string;
  targetSource: string;
}

interface TargetClassDeclaration {
  bodyStartOffset: number;
  hasExtendsClause: boolean;
  isReadonly: boolean;
  namespace: string | null;
}

export function buildPhpCreateMemberWorkspaceEdit(
  request: PhpCreateMemberWorkspaceEditRequest,
): LanguageServerWorkspaceEdit | null {
  const { member, targetSource } = request;

  if (member.target !== "parent" && member.target !== "external") {
    return null;
  }

  if (member.kind !== "method" && member.kind !== "constant") {
    return null;
  }

  const target = locateUniqueTargetClass(targetSource, request.targetClassName);

  if (!target) {
    return null;
  }

  if (!expectedNamespaceMatches(request, target)) {
    return null;
  }

  const selector = { bodyStartOffset: target.bodyStartOffset };

  if (
    phpClassDeclaresMember(targetSource, member.name, member.kind, selector)
  ) {
    return null;
  }

  if (
    member.target === "external" &&
    mayInheritOrInterceptMembers(targetSource, target, selector)
  ) {
    return null;
  }

  const stub = renderMemberStub(member, {
    kind: target.isReadonly ? "readonly-class" : "class",
    relationship: member.target,
    typeContext: "external-namespace",
  });

  if (!stub) {
    return null;
  }

  const insertion = findClassBodyInsertionOffset(targetSource, selector);

  if (!insertion) {
    return null;
  }

  const block = indentLines(
    stub,
    detectClassMemberIndent(targetSource, selector),
  );
  const leadingBlankLine = insertion.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertion.needsTrailingBlankLine ? "\n" : "";
  const position = offsetToPosition(targetSource, insertion.offset);
  const editPosition = { character: position.column, line: position.line };

  return {
    changes: {
      [request.targetFileUri]: [
        {
          newText: `${leadingBlankLine}${block}\n${trailingBlankLine}`,
          range: { end: editPosition, start: editPosition },
        },
      ],
    },
  };
}

function expectedNamespaceMatches(
  request: PhpCreateMemberWorkspaceEditRequest,
  target: TargetClassDeclaration,
): boolean {
  const expected = request.expectedNamespace;

  if (expected === undefined) {
    return true;
  }

  if (expected === null || target.namespace === null) {
    return expected === target.namespace;
  }

  return expected.toLowerCase() === target.namespace.toLowerCase();
}

function mayInheritOrInterceptMembers(
  source: string,
  target: TargetClassDeclaration,
  selector: { bodyStartOffset: number },
): boolean {
  if (target.hasExtendsClause) {
    return true;
  }

  return (
    phpClassDeclaresMember(source, "__callStatic", "method", selector) ||
    phpClassDeclaresMember(source, "__call", "method", selector)
  );
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

function locateUniqueTargetClass(
  source: string,
  targetClassName: string,
): TargetClassDeclaration | null {
  if (!targetClassName) {
    return null;
  }

  const masked = maskPhpSource(source);
  const pattern =
    /(?<![:\\$>A-Za-z0-9_])((?:(?:abstract|final|readonly)\s+)*)(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  const expectedName = targetClassName.toLowerCase();
  let found: TargetClassDeclaration | null = null;

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
): TargetClassDeclaration | null {
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
    hasExtendsClause: /\bextends\b/.test(
      masked.slice(headerStart + match[0].length, bodyStartOffset),
    ),
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
