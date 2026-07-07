import type { PhpMethodMember } from "../domain/phpClassStructure";
import {
  renderImplementMethodsStubs,
  renderOverrideMethodsStubs,
  renderUseImports,
} from "../domain/phpCodeGen";
import {
  findClassBodyInsertionOffset,
  findUseImportInsertionOffset,
  offsetToPosition,
} from "../domain/phpInsertionPoint";
import {
  phpMixinClassNames,
  phpTraitClassNames,
} from "../domain/phpMethodCompletions";
import {
  phpExtendsClassName,
  phpSuperTypeReferences,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import { zeroLengthPhpEditRange } from "./phpCodeActionEdits";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionTextEdit,
} from "./phpCodeActionTypes";

export interface AbstractMemberToImplement {
  declaringSource: string;
  member: PhpMethodMember;
}

export type PhpAbstractMembersCollector = (
  source: string,
  isRequestedRootActive: () => boolean,
) => Promise<{
  abstractMembers: Map<string, AbstractMemberToImplement>;
  satisfiedNames: Set<string>;
} | null>;

export type PhpOverridableParentMethodsCollector = (
  source: string,
  isRequestedRootActive: () => boolean,
) => Promise<Map<string, AbstractMemberToImplement> | null>;

const PHP_BUILTIN_TYPE_NAMES = new Set([
  "array",
  "bool",
  "callable",
  "false",
  "float",
  "int",
  "iterable",
  "mixed",
  "never",
  "null",
  "object",
  "parent",
  "self",
  "static",
  "string",
  "true",
  "void",
]);

export async function phpImplementMethodsCodeAction(
  source: string,
  methodNames: ReadonlySet<string>,
  collect: PhpAbstractMembersCollector,
  isRequestedRootActive: () => boolean,
): Promise<PhpCodeActionDescriptor | null> {
  if (phpSuperTypeReferences(source).length === 0) {
    return null;
  }

  const collected = await collect(source, isRequestedRootActive);

  if (!isRequestedRootActive() || !collected) {
    return null;
  }

  const missingMembers = [...collected.abstractMembers.entries()]
    .filter(
      ([memberKey]) =>
        !methodNames.has(memberKey) && !collected.satisfiedNames.has(memberKey),
    )
    .map(([, entry]) => entry);

  return phpInheritedMembersInsertionAction(
    source,
    missingMembers,
    "Implement methods",
    (members) => renderImplementMethodsStubs(members),
  );
}

export function isPhpOverridableParentMethod(member: PhpMethodMember): boolean {
  if (member.isAbstract || member.isFinal) {
    return false;
  }

  if (member.visibility === "private") {
    return false;
  }

  return member.name.toLowerCase() !== "__construct";
}

export function phpSuperMethodHierarchyReferences(source: string): string[] {
  return [
    ...phpSuperTypeReferences(source),
    ...phpTraitClassNames(source),
    ...phpMixinClassNames(source),
  ];
}

export async function phpOverrideMethodsCodeAction(
  source: string,
  methodNames: ReadonlySet<string>,
  collect: PhpOverridableParentMethodsCollector,
  isRequestedRootActive: () => boolean,
): Promise<PhpCodeActionDescriptor | null> {
  if (!phpExtendsClassName(source)) {
    return null;
  }

  const overridableMembers = await collect(source, isRequestedRootActive);

  if (!isRequestedRootActive() || !overridableMembers) {
    return null;
  }

  const missingMembers = [...overridableMembers.entries()]
    .filter(([memberKey]) => !methodNames.has(memberKey))
    .map(([, entry]) => entry);

  return phpInheritedMembersInsertionAction(
    source,
    missingMembers,
    "Override methods",
    (members) => renderOverrideMethodsStubs(members),
  );
}

function phpInheritedMembersInsertionAction(
  source: string,
  missingMembers: AbstractMemberToImplement[],
  title: string,
  renderStubs: (members: PhpMethodMember[]) => string,
): PhpCodeActionDescriptor | null {
  if (missingMembers.length === 0) {
    return null;
  }

  const insertionPoint = findClassBodyInsertionOffset(source);

  if (!insertionPoint) {
    return null;
  }

  const stubs = renderStubs(missingMembers.map((entry) => entry.member));
  const leadingBlankLine = insertionPoint.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertionPoint.needsTrailingBlankLine ? "\n" : "";
  const insertionPosition = offsetToPosition(source, insertionPoint.offset);
  const edits: PhpCodeActionTextEdit[] = [
    {
      range: zeroLengthPhpEditRange(insertionPosition),
      text: `${leadingBlankLine}${stubs}\n${trailingBlankLine}`,
    },
  ];

  const importEdit = phpInheritedMethodsImportEdit(source, missingMembers);

  if (importEdit) {
    edits.unshift(importEdit);
  }

  return { edits, kind: "refactor.rewrite", title };
}

function shortPhpName(className: string): string {
  const normalized = className.trim().replace(/^\+/, "");
  const segments = normalized
    .split("\\")
    .filter((segment) => segment.length > 0);

  return segments[segments.length - 1] ?? normalized;
}

function phpInheritedMethodsImportEdit(
  classSource: string,
  missingMembers: AbstractMemberToImplement[],
): PhpCodeActionTextEdit | null {
  const requiredFqns = new Set<string>();

  for (const entry of missingMembers) {
    for (const token of phpSignatureClassTypeTokens(entry.member)) {
      const fqn = phpResolvedImportableFqn(entry.declaringSource, token);

      if (!fqn) {
        continue;
      }

      if (shortPhpName(fqn).toLowerCase() !== token.toLowerCase()) {
        continue;
      }

      if (phpTypeTokenAlreadyResolvable(classSource, token, fqn)) {
        continue;
      }

      requiredFqns.add(fqn);
    }
  }

  if (requiredFqns.size === 0) {
    return null;
  }

  const insertionPoint = findUseImportInsertionOffset(classSource);

  if (!insertionPoint) {
    return null;
  }

  const importLines = renderUseImports([...requiredFqns]);

  if (!importLines) {
    return null;
  }

  const insertionPosition = offsetToPosition(
    classSource,
    insertionPoint.offset,
  );
  const leadingNewline = insertionPoint.needsLeadingNewline ? "\n" : "";

  return {
    range: zeroLengthPhpEditRange(insertionPosition),
    text: `${leadingNewline}${importLines}\n`,
  };
}

function phpSignatureClassTypeTokens(member: PhpMethodMember): string[] {
  const types = [
    ...member.parameters.map((parameter) => parameter.type),
    member.returnType,
  ];

  return types.flatMap(phpClassTypeTokensFromType);
}

function phpClassTypeTokensFromType(type: string | null): string[] {
  if (!type) {
    return [];
  }

  return type
    .replace(/^\?/, "")
    .split(/[|&]/)
    .map((part) => part.trim().replace(/^\?/, "").replace(/^\\+/, ""))
    .filter(
      (part) =>
        /^[A-Za-z_][A-Za-z0-9_\\]*$/.test(part) &&
        !PHP_BUILTIN_TYPE_NAMES.has(part.toLowerCase()),
    );
}

function phpResolvedImportableFqn(
  declaringSource: string,
  token: string,
): string | null {
  const resolved = resolvePhpClassName(declaringSource, token);

  if (!resolved) {
    return null;
  }

  const normalized = resolved.trim().replace(/^\\+/, "");

  return normalized.includes("\\") ? normalized : null;
}

function phpTypeTokenAlreadyResolvable(
  classSource: string,
  token: string,
  fqn: string,
): boolean {
  const resolved = resolvePhpClassName(classSource, token);

  if (!resolved) {
    return false;
  }

  return (
    resolved.trim().replace(/^\\+/, "").toLowerCase() === fqn.toLowerCase()
  );
}
