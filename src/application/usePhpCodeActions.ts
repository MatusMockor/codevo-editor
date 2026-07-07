import { useCallback } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import {
  parsePhpClassStructure,
  type PhpClassStructure,
  type PhpMethodMember,
} from "../domain/phpClassStructure";
import {
  renderImplementMethodsStubs,
  renderOverrideMethodsStubs,
  renderUseImports,
} from "../domain/phpCodeGen";
import { planExtractInterface } from "../domain/phpExtractInterface";
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
  phpCurrentTypeKind,
  phpExtendsClassName,
  phpSuperTypeReferences,
  resolvePhpClassName,
} from "../domain/phpNavigation";
import {
  isTypeProjectSymbol,
  type ProjectSymbolSearchGateway,
} from "../domain/projectSymbols";
import {
  type IntelligenceMode,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { buildCreateMissingBladeViewCodeAction } from "./phpBladeViewCodeActions";
import {
  phpGenerateAccessorsCodeAction,
  phpGenerateConstructorCodeAction,
  phpGenerateConstructorWithPromotionCodeAction,
  phpGeneratePhpDocCodeAction,
} from "./phpClassGenerateCodeActions";
import { zeroLengthPhpEditRange } from "./phpCodeActionEdits";
import { buildPhpCreateClassCodeAction } from "./phpCreateClassWorkspaceCodeAction";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
  PhpCodeActionTextEdit,
} from "./phpCodeActionTypes";
import { orderPhpCodeActions } from "./phpCodeActionOrdering";
import { phpCreateFromUsageCodeAction } from "./phpCreateMemberCodeActions";
import {
  phpAddParameterCodeAction,
  phpAddParameterTypeCodeAction,
  phpAddReturnTypeCodeAction,
  phpExtractMethodCodeAction,
  phpExtractVariableCodeAction,
  phpInlineVariableCodeAction,
  phpIntroduceConstantCodeAction,
  phpIntroduceFieldCodeAction,
} from "./phpLocalRefactorCodeActions";
import {
  phpRemoveUnusedImportCodeAction,
  phpRemoveUnusedMethodCodeAction,
  phpRemoveUnusedVariableCodeAction,
} from "./phpInspectionCodeActions";
import {
  phpImportClassCodeActions,
  phpImportClassShortNameAt,
  phpOptimizeImportsCodeAction,
} from "./phpImportCodeActions";

export type {
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
  PhpCodeActionTextEdit,
  PhpCodeActionTextEditRange,
} from "./phpCodeActionTypes";

export interface AbstractMemberToImplement {
  declaringSource: string;
  member: PhpMethodMember;
}

type PhpAbstractMembersCollector = (
  source: string,
  isRequestedRootActive: () => boolean,
) => Promise<{
  abstractMembers: Map<string, AbstractMemberToImplement>;
  satisfiedNames: Set<string>;
} | null>;

type PhpOverridableParentMethodsCollector = (
  source: string,
  isRequestedRootActive: () => boolean,
) => Promise<Map<string, AbstractMemberToImplement> | null>;

export type CreateMissingBladeViewCodeAction = (
  source: string,
  range: PhpCodeActionRange,
  language: "blade" | "php",
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null>;

export interface UsePhpCodeActionsOptions {
  activeDocumentPath: string | null;
  collectPhpAbstractMembersToImplement: PhpAbstractMembersCollector;
  collectPhpLaravelViewTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  collectPhpOverridableParentMethods: PhpOverridableParentMethodsCollector;
  currentWorkspaceRootRef: { readonly current: string | null };
  intelligenceMode: IntelligenceMode;
  isLaravelFrameworkActive: boolean;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  resolvePhpClassSourcePaths: (className: string) => Promise<string[]>;
  workspaceDescriptor: WorkspaceDescriptor | null;
  workspaceRoot: string | null;
}

export interface UsePhpCodeActionsResult {
  createMissingBladeViewCodeAction: CreateMissingBladeViewCodeAction;
  providePhpCodeActions: (
    source: string,
    range?: PhpCodeActionRange,
  ) => Promise<PhpCodeActionDescriptor[]>;
}

export function usePhpCodeActions({
  activeDocumentPath,
  collectPhpAbstractMembersToImplement,
  collectPhpLaravelViewTargets,
  collectPhpOverridableParentMethods,
  currentWorkspaceRootRef,
  intelligenceMode,
  isLaravelFrameworkActive,
  projectSymbolSearch,
  readTestFileIfExists,
  resolvePhpClassSourcePaths,
  workspaceDescriptor,
  workspaceRoot,
}: UsePhpCodeActionsOptions): UsePhpCodeActionsResult {
  const createMissingBladeViewCodeAction = useCallback(
    buildCreateMissingBladeViewCodeAction({
      collectPhpLaravelViewTargets,
      isLaravelFrameworkActive,
      readTestFileIfExists,
      workspaceRoot,
    }),
    [
      collectPhpLaravelViewTargets,
      isLaravelFrameworkActive,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  const phpCreateClassCodeAction = useCallback(
    buildPhpCreateClassCodeAction({
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    }),
    [
      readTestFileIfExists,
      resolvePhpClassSourcePaths,
      workspaceDescriptor,
      workspaceRoot,
    ],
  );

  const providePhpCodeActions = useCallback(
    async (
      source: string,
      range: PhpCodeActionRange = { end: 0, start: 0 },
    ): Promise<PhpCodeActionDescriptor[]> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot) {
        return [];
      }

      const actions: PhpCodeActionDescriptor[] = [];

      // "Remove unused import" pairs with the unused-import inspection. It is a
      // single-line deletion valid anywhere a top-level `use` sits (not only in
      // a class), so it runs before the class-only guard below. Offered only
      // when the cursor is on a conservatively-detected unused class import.
      const removeUnusedImportAction = phpRemoveUnusedImportCodeAction(
        source,
        range,
      );

      if (removeUnusedImportAction) {
        actions.push(removeUnusedImportAction);
      }

      // "Remove unused variable" pairs with the unused-variable inspection. A
      // local assignment can sit in a class method OR a free function, and the
      // action is offered only for a side-effect-free assignment, so it runs
      // before the class-only guard below.
      const removeUnusedVariableAction = phpRemoveUnusedVariableCodeAction(
        source,
        range,
      );

      if (removeUnusedVariableAction) {
        actions.push(removeUnusedVariableAction);
      }

      // "Extract variable" is a pure single-file synthesis from the current
      // selection and is valid anywhere a PHP expression sits (class body or a
      // free function), so it runs before the class-only guard below.
      const extractVariableAction = phpExtractVariableCodeAction(source, range);

      if (extractVariableAction) {
        actions.push(extractVariableAction);
      }

      // "Inline variable" is the inverse of "Extract variable": from the cursor
      // on a single-assignment local it deletes the declaration and substitutes
      // the value at every usage. Like extract it is a pure single-file
      // synthesis valid in a class body or a free function, so it runs before
      // the class-only guard below.
      const inlineVariableAction = phpInlineVariableCodeAction(source, range);

      if (inlineVariableAction) {
        actions.push(inlineVariableAction);
      }

      // "Add parameter" (Change Signature - slice 1) appends an optional
      // placeholder parameter to the enclosing function's signature. It is a
      // pure single-file synthesis valid on a class method OR a free function,
      // so it runs before the class-only guard below.
      const addParameterAction = phpAddParameterCodeAction(source, range);

      if (addParameterAction) {
        actions.push(addParameterAction);
      }

      // "Add return type" / "Add type hint" (PhpStorm Alt+Enter) conservatively
      // infer a missing return type / parameter type and insert it. Both are
      // pure single-file additive insertions valid on a class method OR a free
      // function (and, for the return type, an abstract / interface
      // declaration), so they run before the class-only guard below.
      const addReturnTypeAction = phpAddReturnTypeCodeAction(source, range);

      if (addReturnTypeAction) {
        actions.push(addReturnTypeAction);
      }

      const addParameterTypeAction = phpAddParameterTypeCodeAction(
        source,
        range,
      );

      if (addParameterTypeAction) {
        actions.push(addParameterTypeAction);
      }

      // "Create class X" (PhpStorm Alt+Enter) when the cursor sits on a
      // referenced-but-unresolved class/interface/trait/enum (`new X()`,
      // `X::method()`/`X::CONST`, a type hint / return type, `extends`/
      // `implements`, `catch (X $e)`). It WRITES a new PSR-4 file with a minimal
      // skeleton, so it runs before the class-only guard (a reference may sit in
      // a class header type position OR a free function). The build is async
      // (existence probes) and re-checks the requested root after every await so
      // a tab switch mid-flight drops a stale offer (per-workspace isolation).
      const createClassAction = await phpCreateClassCodeAction(
        source,
        range,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (createClassAction) {
        actions.push(createClassAction);
      }

      const createMissingViewAction = await createMissingBladeViewCodeAction(
        source,
        range,
        "php",
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (createMissingViewAction) {
        actions.push(createMissingViewAction);
      }

      if (phpCurrentTypeKind(source) !== "class") {
        // Free-function context: only the pre-class-guard refactors are offered.
        // Order them like the class path so the list stays "most likely first".
        return orderPhpCodeActions(actions);
      }

      const structure = parsePhpClassStructure(source);

      // "Create method / property from usage" is a pure single-file synthesis
      // from the cursor offset; offered only when the cursor sits on an
      // unresolved `$this->member` usage inside the class.
      const createFromUsageAction = phpCreateFromUsageCodeAction(source, range);

      if (createFromUsageAction) {
        actions.push(createFromUsageAction);
      }

      // "Remove unused method" pairs with the unused-private-method inspection.
      // Offered only when the cursor sits on a conservatively-detected unused
      // private method; deletes the whole method (and its decorating lines).
      const removeUnusedMethodAction = phpRemoveUnusedMethodCodeAction(
        source,
        range,
      );

      if (removeUnusedMethodAction) {
        actions.push(removeUnusedMethodAction);
      }

      // "Extract method" lifts a contiguous, whole-statement selection inside a
      // class method into a new private method and replaces it with a call. It
      // is a pure single-file synthesis from the selection; the conservative
      // planner returns null whenever the extraction could change behaviour.
      const extractMethodAction = phpExtractMethodCodeAction(source, range);

      if (extractMethodAction) {
        actions.push(extractMethodAction);
      }

      // "Extract interface" (PhpStorm) synthesises a sibling
      // `<Class>Interface.php` from the class's public instance methods and adds
      // an `implements` clause to the class. It needs the active document's
      // path to place the new file (PSR-4 sibling), so it is keyed off
      // `activeDocument`. The conservative planner returns null for anything but
      // a plain class with public instance methods.
      const extractInterfaceAction = phpExtractInterfaceCodeAction(
        source,
        range,
        activeDocumentPath,
      );

      if (extractInterfaceAction?.newFile) {
        const existingInterface = await readTestFileIfExists(
          extractInterfaceAction.newFile.path,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        if (existingInterface === null) {
          actions.push(extractInterfaceAction);
        }
      }

      // "Introduce constant / field" are pure single-file syntheses keyed off the
      // cursor offset on a scalar literal (or a local variable for the field).
      // Both insert at the top of the class body and replace the original token.
      const introduceConstantAction = phpIntroduceConstantCodeAction(
        source,
        range,
      );

      if (introduceConstantAction) {
        actions.push(introduceConstantAction);
      }

      const introduceFieldAction = phpIntroduceFieldCodeAction(source, range);

      if (introduceFieldAction) {
        actions.push(introduceFieldAction);
      }

      const implementMethodsAction = await phpImplementMethodsCodeAction(
        source,
        structure,
        collectPhpAbstractMembersToImplement,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (implementMethodsAction) {
        actions.push(implementMethodsAction);
      }

      const overrideMethodsAction = await phpOverrideMethodsCodeAction(
        source,
        structure,
        collectPhpOverridableParentMethods,
        isRequestedRootActive,
      );

      if (!isRequestedRootActive()) {
        return [];
      }

      if (overrideMethodsAction) {
        actions.push(overrideMethodsAction);
      }

      const accessorsAction = phpGenerateAccessorsCodeAction(source, structure);

      if (accessorsAction) {
        actions.push(accessorsAction);
      }

      const constructorAction = phpGenerateConstructorCodeAction(
        source,
        structure,
      );

      if (constructorAction) {
        actions.push(constructorAction);
      }

      const constructorWithPromotionAction =
        phpGenerateConstructorWithPromotionCodeAction(source, structure);

      if (constructorWithPromotionAction) {
        actions.push(constructorWithPromotionAction);
      }

      const generatePhpDocAction = phpGeneratePhpDocCodeAction(
        source,
        structure,
        range,
      );

      if (generatePhpDocAction) {
        actions.push(generatePhpDocAction);
      }

      const optimizeImportsAction = phpOptimizeImportsCodeAction(source);

      if (optimizeImportsAction) {
        actions.push(optimizeImportsAction);
      }

      // "Import class" (PhpStorm Alt+Enter -> Import): when the cursor sits on an
      // unimported, unqualified class reference, look the short name up in the
      // workspace symbol index and offer a `use FQN;` insertion per candidate
      // namespace. Indexed-only (the index is per-root); the requested root is
      // re-checked after the async search and before mutating `actions` so a tab
      // switch mid-search drops stale results (per-workspace isolation).
      const importShortName = phpImportClassShortNameAt(source, range);

      if (importShortName && shouldIndexWorkspace(intelligenceMode)) {
        const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
          requestedRoot,
          importShortName,
          25,
        );

        if (!isRequestedRootActive()) {
          return [];
        }

        const candidateFqns = indexedSymbols
          .filter(isTypeProjectSymbol)
          .filter(
            (symbol) =>
              symbol.name.toLowerCase() === importShortName.toLowerCase(),
          )
          .map((symbol) => symbol.fullyQualifiedName);

        for (const importAction of phpImportClassCodeActions(
          source,
          candidateFqns,
        )) {
          actions.push(importAction);
        }
      }

      return orderPhpCodeActions(actions);
    },
    [
      activeDocumentPath,
      collectPhpAbstractMembersToImplement,
      collectPhpOverridableParentMethods,
      createMissingBladeViewCodeAction,
      intelligenceMode,
      phpCreateClassCodeAction,
      projectSymbolSearch,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  return { createMissingBladeViewCodeAction, providePhpCodeActions };
}

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

/**
 * Builds the "Implement methods" code action by resolving the abstract members
 * inherited from supertypes (cross-file, hence async) that the current class
 * has not yet implemented. Returns `null` when the class has no supertypes,
 * when resolution is dropped for a stale workspace, or when nothing is missing.
 */
async function phpImplementMethodsCodeAction(
  source: string,
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

  const implementedNames = new Set(
    structure.methods.map((method) => method.name.toLowerCase()),
  );
  const missingMembers = [...collected.abstractMembers.entries()]
    .filter(
      ([memberKey]) =>
        !implementedNames.has(memberKey) &&
        !collected.satisfiedNames.has(memberKey),
    )
    .map(([, entry]) => entry);

  if (missingMembers.length === 0) {
    return null;
  }

  const insertionPoint = findClassBodyInsertionOffset(source);

  if (!insertionPoint) {
    return null;
  }

  const stubs = renderImplementMethodsStubs(
    missingMembers.map((entry) => entry.member),
  );
  const leadingBlankLine = insertionPoint.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertionPoint.needsTrailingBlankLine ? "\n" : "";
  const insertionPosition = offsetToPosition(source, insertionPoint.offset);
  const edits: PhpCodeActionTextEdit[] = [
    {
      range: zeroLengthPhpEditRange(insertionPosition),
      text: `${leadingBlankLine}${stubs}\n${trailingBlankLine}`,
    },
  ];

  const importEdit = phpImplementMethodsImportEdit(source, missingMembers);

  if (importEdit) {
    edits.unshift(importEdit);
  }

  return { edits, kind: "refactor.rewrite", title: "Implement methods" };
}

/**
 * Decides whether a parent method may be surfaced by "Override methods". A
 * method is overridable when it is concrete (a body to delegate to via
 * `parent::`), not sealed (`final`), not `private` (private members are not
 * inherited / overridable) and not the constructor (PhpStorm excludes
 * `__construct` from override generation — it is a creation concern, not a
 * behavioural override).
 */
export function isPhpOverridableParentMethod(member: PhpMethodMember): boolean {
  if (member.isAbstract || member.isFinal) {
    return false;
  }

  if (member.visibility === "private") {
    return false;
  }

  return member.name.toLowerCase() !== "__construct";
}

/**
 * Collects every super-type reference that can carry an overridden method
 * declaration for "Go to Super Method": parent class / interfaces (extends and
 * implements), used traits and PHPDoc `@mixin` types. Walking all four mirrors
 * the resolution already used by direct method navigation and the override
 * code action.
 */
export function phpSuperMethodHierarchyReferences(source: string): string[] {
  return [
    ...phpSuperTypeReferences(source),
    ...phpTraitClassNames(source),
    ...phpMixinClassNames(source),
  ];
}

/**
 * Builds the "Override methods" code action by resolving the concrete methods
 * inherited from the parent class chain (cross-file, hence async) that the
 * current class has not yet overridden. Each stub delegates to `parent::` so
 * the inherited behaviour is preserved by default. Returns `null` when the
 * class has no parent, when resolution is dropped for a stale workspace, or
 * when nothing overridable remains.
 */
async function phpOverrideMethodsCodeAction(
  source: string,
  structure: PhpClassStructure,
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

  const declaredNames = new Set(
    structure.methods.map((method) => method.name.toLowerCase()),
  );
  const missingMembers = [...overridableMembers.entries()]
    .filter(([memberKey]) => !declaredNames.has(memberKey))
    .map(([, entry]) => entry);

  if (missingMembers.length === 0) {
    return null;
  }

  const insertionPoint = findClassBodyInsertionOffset(source);

  if (!insertionPoint) {
    return null;
  }

  const stubs = renderOverrideMethodsStubs(
    missingMembers.map((entry) => entry.member),
  );
  const leadingBlankLine = insertionPoint.needsLeadingBlankLine ? "\n" : "";
  const trailingBlankLine = insertionPoint.needsTrailingBlankLine ? "\n" : "";
  const insertionPosition = offsetToPosition(source, insertionPoint.offset);
  const edits: PhpCodeActionTextEdit[] = [
    {
      range: zeroLengthPhpEditRange(insertionPosition),
      text: `${leadingBlankLine}${stubs}\n${trailingBlankLine}`,
    },
  ];

  const importEdit = phpImplementMethodsImportEdit(source, missingMembers);

  if (importEdit) {
    edits.unshift(importEdit);
  }

  return { edits, kind: "refactor.rewrite", title: "Override methods" };
}

/**
 * Offers "Extract interface" (PhpStorm) when the cursor sits on a concrete
 * `class` declaration that exposes at least one public instance method. The
 * `planExtractInterface` planner synthesises a sibling `<Class>Interface.php`
 * (carrying the public-instance-method signatures) and the in-place edit that
 * adds `implements <Class>Interface` to the class header. The resulting action
 * therefore CREATES a file (the new interface) and EDITS the current document
 * (the implements clause). Returns `null` for any shape the conservative
 * planner rejects (abstract class / interface / trait / enum, no public
 * instance methods, parse failure, cursor outside a class) so the action is
 * never offered where it could create an empty or malformed interface.
 *
 * `sourcePath` is the active document's absolute path; without it the sibling
 * interface path cannot be derived, so the action is not offered.
 */
function phpExtractInterfaceCodeAction(
  source: string,
  range: PhpCodeActionRange,
  sourcePath: string | null,
): PhpCodeActionDescriptor | null {
  if (!sourcePath) {
    return null;
  }

  const plan = planExtractInterface(source, range.start, sourcePath);

  if (!plan) {
    return null;
  }

  const implementsPosition = offsetToPosition(
    source,
    plan.implementsEdit.offset,
  );

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(implementsPosition),
        text: plan.implementsEdit.text,
      },
    ],
    kind: "refactor.extract",
    newFile: {
      content: plan.interfaceText,
      path: plan.interfaceFilePath,
    },
    title: "Extract interface",
  };
}

function shortPhpName(className: string): string {
  const normalized = className.trim().replace(/^\+/, "");
  const segments = normalized
    .split("\\")
    .filter((segment) => segment.length > 0);

  return segments[segments.length - 1] ?? normalized;
}

function phpImplementMethodsImportEdit(
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
