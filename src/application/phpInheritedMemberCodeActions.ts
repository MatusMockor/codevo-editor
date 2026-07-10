import {
  phpCurrentNamespace,
  phpShortNameIsImported,
  planPhpAddImport,
} from "../domain/phpAddImport";
import type {
  PhpClassStructure,
  PhpMethodMember,
  PhpMethodModifierRange,
} from "../domain/phpClassStructure";
import { phpTopLevelTypeDeclarationNames } from "../domain/phpClassStructure";
import {
  renderImplementMethodsStubs,
  renderMethodSignature,
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
import {
  phpReplacementEdit,
  zeroLengthPhpEditRange,
} from "./phpCodeActionEdits";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
  PhpCodeActionTextEdit,
} from "./phpCodeActionTypes";

export interface AbstractMemberToImplement {
  declaringSource: string;
  declaringTypeName: string;
  member: PhpMethodMember;
}

export interface PhpAbstractMembersCollection {
  abstractMembers: Map<string, AbstractMemberToImplement>;
  conflictingNames: Set<string>;
  satisfiedNames: Set<string>;
}

export type PhpAbstractMembersCollector = (
  source: string,
  isRequestedRootActive: () => boolean,
) => Promise<PhpAbstractMembersCollection | null>;

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
        !methodNames.has(memberKey) &&
        !collected.satisfiedNames.has(memberKey) &&
        !collected.conflictingNames.has(memberKey),
    )
    .map(([, entry]) => entry);

  return phpInheritedMembersInsertionAction(
    source,
    missingMembers,
    "Implement methods",
    (members) => renderImplementMethodsStubs(members),
  );
}

export async function phpSynchronizeInheritedMethodSignatureCodeAction(
  source: string,
  range: PhpCodeActionRange,
  structure: PhpClassStructure,
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

  return planPhpInheritedMethodSignatureSynchronization(
    source,
    range,
    structure,
    collected,
  );
}

export function planPhpInheritedMethodSignatureSynchronization(
  source: string,
  range: PhpCodeActionRange,
  structure: PhpClassStructure,
  collected: PhpAbstractMembersCollection,
): PhpCodeActionDescriptor | null {
  if (structure.kind !== "class" && structure.kind !== "abstract-class") {
    return null;
  }

  const declaredTypeNames = new Set(
    phpTopLevelTypeDeclarationNames(source).map((name) => name.toLowerCase()),
  );
  const candidates = structure.methods
    .map((method) =>
      synchronizationCandidate(
        source,
        method,
        collected,
        declaredTypeNames,
      ),
    )
    .filter(
      (candidate): candidate is PhpSignatureSynchronizationCandidate =>
        candidate !== null,
    );
  const pointedCandidates = candidates.filter(({ method }) =>
    rangeTouchesMethodSignature(range, method),
  );
  const candidate =
    pointedCandidates.length === 1 ? pointedCandidates[0] : null;

  if (!candidate) {
    return null;
  }

  return synchronizationAction(source, candidate);
}

interface PhpSignatureSynchronizationCandidate {
  contract: AbstractMemberToImplement;
  imports: PhpSignatureImport[];
  method: PhpMethodMember;
  synchronizedMember: PhpMethodMember;
}

interface PhpSignatureImport {
  alias: string;
  fqn: string;
}

interface PhpInheritedSignatureReference {
  kind: "default" | "type";
  value: string;
}

interface PhpSignatureRepairPlan {
  inheritedReferences: PhpInheritedSignatureReference[];
  member: PhpMethodMember;
}

function synchronizationCandidate(
  source: string,
  method: PhpMethodMember,
  collected: PhpAbstractMembersCollection,
  declaredTypeNames: ReadonlySet<string>,
): PhpSignatureSynchronizationCandidate | null {
  const memberKey = method.name.toLowerCase();
  const contract = collected.abstractMembers.get(memberKey);

  if (
    !contract ||
    collected.conflictingNames.has(memberKey) ||
    method.isAbstract ||
    method.bodyStartOffset === null ||
    !parameterShapesMatch(method, contract.member) ||
    signatureContainsUnsafeSyntax(source, method) ||
    signatureContainsUnsafeSyntax(contract.declaringSource, contract.member)
  ) {
    return null;
  }

  const repair = phpSignatureRepairPlan(source, method, contract);

  if (!repair) {
    return null;
  }

  const imports = synchronizationImports(
    source,
    contract.declaringSource,
    repair.inheritedReferences,
    declaredTypeNames,
  );

  if (!imports) {
    return null;
  }

  return {
    contract,
    imports,
    method,
    synchronizedMember: repair.member,
  };
}

function parameterShapesMatch(
  method: PhpMethodMember,
  contract: PhpMethodMember,
): boolean {
  if (method.parameters.length !== contract.parameters.length) {
    return false;
  }

  return method.parameters.every((parameter, index) => {
    const inherited = contract.parameters[index];

    return (
      inherited !== undefined &&
      parameter.name === inherited.name &&
      parameter.isByRef === inherited.isByRef &&
      parameter.isVariadic === inherited.isVariadic
    );
  });
}

function signatureContainsUnsafeSyntax(
  source: string,
  method: PhpMethodMember,
): boolean {
  const signature = source.slice(
    method.declarationOffset,
    method.signatureEndOffset,
  );

  if (/\bfunction\s*&/.test(signature) || /#\[|\/\*|\/\//.test(signature)) {
    return true;
  }

  const tokens = phpMethodReferenceTokens(method);

  if (!tokens) {
    return true;
  }

  return tokens.some((token) =>
    /^(?:self|parent)(?:\\|$)|^namespace\\/i.test(
      token.replace(/^\\+/, ""),
    ),
  );
}

function phpSignatureRepairPlan(
  source: string,
  method: PhpMethodMember,
  contract: AbstractMemberToImplement,
): PhpSignatureRepairPlan | null {
  const inheritedReferences: PhpInheritedSignatureReference[] = [];
  const inherited = contract.member;
  let hasRepair = method.isStatic !== inherited.isStatic;
  let visibility = method.visibility;

  if (visibilityRank(method.visibility) < visibilityRank(inherited.visibility)) {
    visibility = inherited.visibility;
    hasRepair = true;
  }

  const parameters: PhpMethodMember["parameters"] = [];

  for (let index = 0; index < method.parameters.length; index += 1) {
    const parameter = method.parameters[index];
    const inheritedParameter = inherited.parameters[index];

    if (!parameter || !inheritedParameter) {
      return null;
    }

    const typeDecision = phpParameterTypeDecision(
      source,
      parameter.type,
      contract.declaringSource,
      inheritedParameter.type,
    );

    if (typeDecision === "uncertain") {
      return null;
    }

    const replaceType = typeDecision === "replace";
    const replaceDefault =
      inheritedParameter.isOptional && !parameter.isOptional;

    hasRepair ||= replaceType || replaceDefault;

    if (replaceType && inheritedParameter.type) {
      inheritedReferences.push({
        kind: "type",
        value: inheritedParameter.type,
      });
    }

    if (replaceDefault && inheritedParameter.defaultValue) {
      inheritedReferences.push({
        kind: "default",
        value: inheritedParameter.defaultValue,
      });
    }

    parameters.push({
      ...parameter,
      defaultValue: replaceDefault
        ? inheritedParameter.defaultValue
        : parameter.defaultValue,
      isOptional: replaceDefault
        ? inheritedParameter.isOptional
        : parameter.isOptional,
      type: replaceType ? inheritedParameter.type : parameter.type,
    });
  }

  const returnDecision = phpReturnTypeDecision(
    source,
    method.returnType,
    contract.declaringSource,
    inherited.returnType,
  );

  if (returnDecision === "uncertain") {
    return null;
  }

  if (returnDecision === "replace" && inherited.returnType) {
    inheritedReferences.push({ kind: "type", value: inherited.returnType });
  }

  hasRepair ||= returnDecision === "replace";

  if (!hasRepair) {
    return null;
  }

  return {
    inheritedReferences,
    member: {
      ...method,
      isStatic: inherited.isStatic,
      parameters,
      returnType:
        returnDecision === "replace"
          ? inherited.returnType
          : method.returnType,
      visibility,
    },
  };
}

function phpResolvedTypeComparisonKey(source: string, type: string): string {
  return type
    .replace(/\\?[A-Za-z_][A-Za-z0-9_\\]*/g, (token) => {
      if (PHP_BUILTIN_TYPE_NAMES.has(token.toLowerCase())) {
        return token.toLowerCase();
      }

      return (resolvePhpClassName(source, token) ?? token)
        .replace(/^\\+/, "")
        .toLowerCase();
    })
    .replace(/\s+/g, "");
}

type PhpTypeDecision = "preserve" | "replace" | "uncertain";

function phpParameterTypeDecision(
  source: string,
  type: string | null,
  inheritedSource: string,
  inheritedType: string | null,
): PhpTypeDecision {
  if (!inheritedType) {
    return type ? "replace" : "preserve";
  }

  if (!type) {
    return "preserve";
  }

  return phpUnionTypeDecision(source, type, inheritedSource, inheritedType, true);
}

function phpReturnTypeDecision(
  source: string,
  type: string | null,
  inheritedSource: string,
  inheritedType: string | null,
): PhpTypeDecision {
  if (!inheritedType) {
    return "preserve";
  }

  if (!type) {
    return "replace";
  }

  return phpUnionTypeDecision(
    source,
    type,
    inheritedSource,
    inheritedType,
    false,
  );
}

function phpUnionTypeDecision(
  source: string,
  type: string,
  inheritedSource: string,
  inheritedType: string,
  parameterPosition: boolean,
): PhpTypeDecision {
  const resolved = phpUnionTypeAtoms(source, type);
  const inheritedResolved = phpUnionTypeAtoms(inheritedSource, inheritedType);

  if (!resolved || !inheritedResolved) {
    return phpComplexTypeDecision(
      source,
      type,
      inheritedSource,
      inheritedType,
      parameterPosition,
    );
  }

  if (setsEqual(resolved, inheritedResolved)) {
    return "preserve";
  }

  if (parameterPosition && phpUnionIsSubtype(inheritedResolved, resolved)) {
    return "preserve";
  }

  if (!parameterPosition && phpUnionIsSubtype(resolved, inheritedResolved)) {
    return "preserve";
  }

  if (parameterPosition && phpUnionIsSubtype(resolved, inheritedResolved)) {
    return "replace";
  }

  if (!parameterPosition && phpUnionIsSubtype(inheritedResolved, resolved)) {
    return "replace";
  }

  const invalidAtoms = parameterPosition
    ? [...inheritedResolved].filter((atom) => !resolved.has(atom))
    : [...resolved].filter((atom) => !inheritedResolved.has(atom));

  if (invalidAtoms.some(isProvablyDistinctPhpAtom)) {
    return "replace";
  }

  return phpAtomsAreProvablyDistinct(resolved, inheritedResolved)
    ? "replace"
    : "uncertain";
}

function phpUnionTypeAtoms(source: string, type: string): Set<string> | null {
  let normalized = type.replace(/\s+/g, "");

  if (normalized.startsWith("?")) {
    normalized = `${normalized.slice(1)}|null`;
  }

  if (/[&()]/.test(normalized)) {
    return null;
  }

  const atoms = new Set<string>();

  for (const part of normalized.split("|")) {
    const key = phpResolvedTypeComparisonKey(source, part);

    if (key === "bool") {
      atoms.add("false");
      atoms.add("true");
      continue;
    }

    atoms.add(key);
  }

  return atoms;
}

function phpComplexTypeDecision(
  source: string,
  type: string,
  inheritedSource: string,
  inheritedType: string,
  parameterPosition: boolean,
): PhpTypeDecision {
  const normalized = phpResolvedTypeComparisonKey(source, type);
  const inheritedNormalized = phpResolvedTypeComparisonKey(
    inheritedSource,
    inheritedType,
  );

  if (normalized === inheritedNormalized) {
    return "preserve";
  }

  const plain = phpUnionTypeAtoms(source, type);
  const inheritedPlain = phpUnionTypeAtoms(inheritedSource, inheritedType);

  if (plain) {
    const inheritedArms = phpStandaloneUnionAtoms(
      inheritedSource,
      inheritedType,
    );

    if (isSubset(plain, inheritedArms)) {
      return parameterPosition ? "replace" : "preserve";
    }
  }

  if (inheritedPlain) {
    const arms = phpStandaloneUnionAtoms(source, type);

    if (isSubset(inheritedPlain, arms)) {
      return parameterPosition ? "preserve" : "replace";
    }
  }

  return (
    (plain !== null && [...plain].every(isProvablyDistinctPhpAtom)) ||
    (inheritedPlain !== null &&
      [...inheritedPlain].every(isProvablyDistinctPhpAtom))
  )
    ? "replace"
    : "uncertain";
}

function phpStandaloneUnionAtoms(source: string, type: string): Set<string> {
  const atoms = new Set<string>();
  let depth = 0;
  let start = 0;
  const normalized = type.replace(/\s+/g, "");

  for (let index = 0; index <= normalized.length; index += 1) {
    const character = normalized[index] ?? "|";

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== "|" || depth !== 0) {
      continue;
    }

    const arm = normalized.slice(start, index);
    start = index + 1;

    if (!arm || /[&()]/.test(arm)) {
      continue;
    }

    const key = phpResolvedTypeComparisonKey(source, arm);

    if (key === "bool") {
      atoms.add("false");
      atoms.add("true");
      continue;
    }

    atoms.add(key);
  }

  return atoms;
}

function phpAtomsAreProvablyDistinct(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    [...left].every(isProvablyDistinctPhpAtom) ||
    [...right].every(isProvablyDistinctPhpAtom)
  );
}

function phpUnionIsSubtype(
  subtype: ReadonlySet<string>,
  supertype: ReadonlySet<string>,
): boolean {
  return [...subtype].every((atom) =>
    [...supertype].some((candidate) => phpAtomIsSubtype(atom, candidate)),
  );
}

function phpAtomIsSubtype(subtype: string, supertype: string): boolean {
  if (subtype === supertype || subtype === "never") {
    return true;
  }

  if (supertype === "mixed") {
    return subtype !== "void";
  }

  return subtype === "array" && supertype === "iterable";
}

function isProvablyDistinctPhpAtom(atom: string): boolean {
  return PROVABLY_DISTINCT_PHP_TYPE_ATOMS.has(atom);
}

function isSubset(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return [...left].every((value) => right.has(value));
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && isSubset(left, right);
}

function visibilityRank(visibility: PhpMethodMember["visibility"]): number {
  if (visibility === "public") {
    return 2;
  }

  if (visibility === "protected") {
    return 1;
  }

  return 0;
}

function synchronizationImports(
  classSource: string,
  declaringSource: string,
  references: PhpInheritedSignatureReference[],
  declaredTypeNames: ReadonlySet<string>,
): PhpSignatureImport[] | null {
  const imports = new Map<string, PhpSignatureImport>();

  for (const reference of references) {
    const tokens = phpReferenceTokens(reference);

    if (!tokens) {
      return null;
    }

    for (const token of tokens) {
      if (!addSynchronizationImport(
        imports,
        classSource,
        declaringSource,
        token,
        declaredTypeNames,
      )) {
        return null;
      }
    }
  }

  return [...imports.values()];
}

function addSynchronizationImport(
  imports: Map<string, PhpSignatureImport>,
  classSource: string,
  declaringSource: string,
  token: string,
  declaredTypeNames: ReadonlySet<string>,
): boolean {
  const normalizedToken = token.replace(/^\\+/, "");

  if (PHP_BUILTIN_TYPE_NAMES.has(normalizedToken.toLowerCase())) {
    return true;
  }

  const expectedFqn =
    phpResolvedImportableFqn(declaringSource, token) ??
    phpResolvedGlobalClassName(declaringSource, token);

  if (!expectedFqn || token.startsWith("\\")) {
    return true;
  }

  const currentResolution = resolvePhpClassName(classSource, token)
    ?.replace(/^\\+/, "")
    .toLowerCase();

  if (currentResolution === expectedFqn.toLowerCase()) {
    return true;
  }

  const binding = phpImportBindingForReference(
    declaringSource,
    normalizedToken,
    expectedFqn,
  );

  if (!binding) {
    return false;
  }

  if (
    declaredTypeNames.has(binding.alias.toLowerCase()) ||
    phpShortNameIsImported(classSource, binding.alias) ||
    !planPhpAddImport(classSource, binding.fqn)
  ) {
    return false;
  }

  const aliasKey = binding.alias.toLowerCase();
  const existing = imports.get(aliasKey);

  if (existing && existing.fqn.toLowerCase() !== binding.fqn.toLowerCase()) {
    return false;
  }

  imports.set(aliasKey, binding);

  return true;
}

function phpResolvedGlobalClassName(
  declaringSource: string,
  token: string,
): string | null {
  if (phpCurrentNamespace(declaringSource) !== null) {
    return null;
  }

  const normalizedToken = token.replace(/^\\+/, "");

  if (!normalizedToken || normalizedToken.includes("\\")) {
    return null;
  }

  const resolved = resolvePhpClassName(declaringSource, token)?.replace(
    /^\\+/,
    "",
  );

  return resolved === normalizedToken ? resolved : null;
}

function phpImportBindingForReference(
  declaringSource: string,
  token: string,
  expectedFqn: string,
): PhpSignatureImport | null {
  const [alias, ...suffix] = token.split("\\");

  if (!alias) {
    return null;
  }

  if (suffix.length === 0) {
    return { alias, fqn: expectedFqn };
  }

  const prefixFqn = resolvePhpClassName(declaringSource, alias)?.replace(
    /^\\+/,
    "",
  );

  if (!prefixFqn) {
    return null;
  }

  if (`${prefixFqn}\\${suffix.join("\\")}`.toLowerCase() !== expectedFqn.toLowerCase()) {
    return null;
  }

  return { alias, fqn: prefixFqn };
}

function phpMethodReferenceTokens(member: PhpMethodMember): string[] | null {
  const references: PhpInheritedSignatureReference[] = [
    ...member.parameters.map((parameter) => parameter.type),
    member.returnType,
  ]
    .filter((value): value is string => value !== null)
    .map((value) => ({ kind: "type", value }));

  references.push(
    ...member.parameters
      .map((parameter) => parameter.defaultValue)
      .filter((value): value is string => value !== null)
      .map((value) => ({ kind: "default" as const, value })),
  );

  const tokens: string[] = [];

  for (const reference of references) {
    const parsed = phpReferenceTokens(reference);

    if (!parsed) {
      return null;
    }

    tokens.push(...parsed);
  }

  return tokens;
}

function phpReferenceTokens(
  reference: PhpInheritedSignatureReference,
): string[] | null {
  if (reference.kind === "type") {
    return [...reference.value.matchAll(/\\?[A-Za-z_][A-Za-z0-9_\\]*/g)].map(
      (match) => match[0],
    );
  }

  const scanned = maskPhpDefaultStrings(reference.value);
  const classConstantTokens = [
    ...scanned.matchAll(
      /\\?[A-Za-z_][A-Za-z0-9_\\]*(?=\s*::)/g,
    ),
  ].map((match) => match[0]);
  const newMatches = [
    ...scanned.matchAll(
      /\bnew\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)\b/g,
    ),
  ];
  const newKeywordCount = [...scanned.matchAll(/\bnew\b/g)].length;

  if (
    newMatches.length !== newKeywordCount ||
    newMatches.some((match) =>
      /^(?:class|namespace|parent|self|static)(?:\\|$)/i.test(match[1] ?? ""),
    )
  ) {
    return null;
  }

  return [
    ...classConstantTokens,
    ...newMatches.map((match) => match[1]).filter(Boolean),
  ];
}

function maskPhpDefaultStrings(value: string): string {
  let masked = "";
  let quote: string | null = null;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";

    if (!quote) {
      if (character === "'" || character === '"' || character === "`") {
        quote = character;
        masked += " ";
        continue;
      }

      masked += character;
      continue;
    }

    masked += " ";

    if (character === "\\") {
      masked += " ";
      index += 1;
      continue;
    }

    if (character === quote) {
      quote = null;
    }
  }

  return masked;
}

const PROVABLY_DISTINCT_PHP_TYPE_ATOMS = new Set([
  "array",
  "false",
  "float",
  "int",
  "never",
  "null",
  "string",
  "true",
  "void",
]);

function rangeTouchesMethodSignature(
  range: PhpCodeActionRange,
  method: PhpMethodMember,
): boolean {
  return (
    range.end >= method.memberStartOffset &&
    range.start <= method.signatureEndOffset
  );
}

function synchronizationAction(
  source: string,
  candidate: PhpSignatureSynchronizationCandidate,
): PhpCodeActionDescriptor | null {
  const edits = candidate.method.modifierRanges
    .filter(
      (modifier) =>
        modifier.name === "public" ||
        modifier.name === "protected" ||
        modifier.name === "private" ||
        modifier.name === "static",
    )
    .map((modifier) => modifierRemovalEdit(source, modifier));

  edits.push(
    phpReplacementEdit(
      source,
      candidate.method.declarationOffset,
      candidate.method.signatureEndOffset,
      renderMethodSignature(candidate.synchronizedMember),
    ),
  );

  const importEdit = phpSignatureSynchronizationImportEdit(
    source,
    candidate.imports,
  );

  if (candidate.imports.length > 0 && !importEdit) {
    return null;
  }

  if (importEdit) {
    edits.unshift(importEdit);
  }

  return {
    edits,
    kind: "refactor.rewrite",
    title: `Synchronize signature with ${candidate.contract.declaringTypeName}::${candidate.method.name}`,
  };
}

function modifierRemovalEdit(
  source: string,
  modifier: PhpMethodModifierRange,
): PhpCodeActionTextEdit {
  const lineStart = source.lastIndexOf("\n", modifier.startOffset - 1) + 1;
  const newline = source.indexOf("\n", modifier.endOffset);
  const lineEnd = newline < 0 ? source.length : newline;
  const prefix = source.slice(lineStart, modifier.startOffset);
  const suffix = source.slice(modifier.endOffset, lineEnd);

  if (/^[ \t]*$/.test(prefix) && /^[ \t]*$/.test(suffix)) {
    return phpReplacementEdit(
      source,
      lineStart,
      newline < 0 ? lineEnd : newline + 1,
      "",
    );
  }

  let end = modifier.endOffset;

  while (source[end] === " " || source[end] === "\t") {
    end += 1;
  }

  return phpReplacementEdit(source, modifier.startOffset, end, "");
}

function phpSignatureSynchronizationImportEdit(
  source: string,
  imports: PhpSignatureImport[],
): PhpCodeActionTextEdit | null {
  if (imports.length === 0) {
    return null;
  }

  const insertionPoint = findUseImportInsertionOffset(source);

  if (!insertionPoint) {
    return null;
  }

  const lines = imports
    .sort((left, right) => left.fqn.localeCompare(right.fqn))
    .map(({ alias, fqn }) => {
      const aliasSuffix =
        shortPhpName(fqn).toLowerCase() === alias.toLowerCase()
          ? ""
          : ` as ${alias}`;

      return `use ${fqn}${aliasSuffix};`;
    })
    .join("\n");
  const position = offsetToPosition(source, insertionPoint.offset);
  const leadingNewline = insertionPoint.needsLeadingNewline ? "\n" : "";

  return {
    range: zeroLengthPhpEditRange(position),
    text: `${leadingNewline}${lines}\n`,
  };
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
