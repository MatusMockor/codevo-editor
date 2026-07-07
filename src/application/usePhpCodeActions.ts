import { useCallback } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import { missingLaravelViewReferenceAt } from "../domain/laravelDiagnostics";
import {
  phpCurrentNamespace,
  phpShortNameIsImported,
  planPhpAddImport,
} from "../domain/phpAddImport";
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
import {
  detectUnknownClassReference,
  phpCreateClassDestination,
  renderPhpTypeSkeleton,
} from "../domain/phpCreateClass";
import { planExtractInterface } from "../domain/phpExtractInterface";
import {
  phpUnusedImportRemovalAt,
  phpUnusedPrivateMethodRemovalAt,
  phpUnusedVariableRemovalAt,
} from "../domain/phpInspections";
import {
  findClassBodyInsertionOffset,
  findUseImportInsertionOffset,
  offsetToPosition,
} from "../domain/phpInsertionPoint";
import { organizePhpImports } from "../domain/phpImportsOrganizer";
import {
  phpMixinClassNames,
  phpTraitClassNames,
} from "../domain/phpMethodCompletions";
import {
  phpClassIdentifierNameAt,
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
  joinWorkspacePath,
  type IntelligenceMode,
  type WorkspaceDescriptor,
} from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  phpGenerateAccessorsCodeAction,
  phpGenerateConstructorCodeAction,
  phpGenerateConstructorWithPromotionCodeAction,
  phpGeneratePhpDocCodeAction,
} from "./phpClassGenerateCodeActions";
import { zeroLengthPhpEditRange } from "./phpCodeActionEdits";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
  PhpCodeActionTextEdit,
} from "./phpCodeActionTypes";
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
    async (
      source: string,
      range: PhpCodeActionRange,
      language: "blade" | "php",
      isRequestedRootActive: () => boolean,
    ): Promise<PhpCodeActionDescriptor | null> => {
      const requestedRoot = workspaceRoot;

      if (!requestedRoot || !isLaravelFrameworkActive) {
        return null;
      }

      const viewTargets = await collectPhpLaravelViewTargets();

      if (!isRequestedRootActive()) {
        return null;
      }

      const missing = missingLaravelViewReferenceAt(
        source,
        range.start,
        language,
        viewTargets.map((target) => target.name),
      );

      if (!missing) {
        return null;
      }

      const path = joinWorkspacePath(requestedRoot, missing.relativePath);
      const existing = await readTestFileIfExists(path);

      if (!isRequestedRootActive() || existing !== null) {
        return null;
      }

      return {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: {
          content: "",
          path,
          title: "Create Blade View",
        },
        title: `Create Blade view ${missing.name}`,
      };
    },
    [
      collectPhpLaravelViewTargets,
      isLaravelFrameworkActive,
      readTestFileIfExists,
      workspaceRoot,
    ],
  );

  // Builds the PhpStorm "Create class X" quick fix from a referenced-but-missing
  // type under the cursor. Conservative: offered only when the reference is NOT
  // already imported-and-resolvable, NOT a PHP built-in, the resolved FQN maps
  // to a project PSR-4 destination (uncertain destination -> no offer), the
  // resolved class does NOT already exist on disk, and the target file is not
  // already present. Cross-file probes make it async; the requested root is
  // re-checked after every await so a tab switch mid-flight drops the offer
  // (per-workspace isolation). Returns an action that WRITES the skeleton file
  // (via `newFile` -> applyPhpCodeActionNewFile) with NO in-document edit.
  const phpCreateClassCodeAction = useCallback(
    async (
      source: string,
      range: PhpCodeActionRange,
      isRequestedRootActive: () => boolean,
    ): Promise<PhpCodeActionDescriptor | null> => {
      const requestedRoot = workspaceRoot;
      const requestedDescriptor = workspaceDescriptor;

      if (!requestedRoot || !requestedDescriptor?.php) {
        return null;
      }

      const reference = detectUnknownClassReference(source, range.start);

      if (!reference) {
        return null;
      }

      const fqn = resolvePhpClassName(source, reference.reference);

      if (!fqn || isPhpBuiltinTypeName(fqn)) {
        return null;
      }

      const destination = phpCreateClassDestination(
        requestedRoot,
        requestedDescriptor.php.psr4Roots,
        VENDOR_PSR4_PREFIXES,
        fqn,
      );

      if (!destination) {
        return null;
      }

      // The class must not already exist. `resolvePhpClassSourcePaths` returns
      // best-guess PSR-4 candidate paths that may NOT exist on disk, so each
      // candidate is verified with a real read before it counts as "exists" -
      // otherwise the deterministic guess (the destination itself) would always
      // suppress the offer. A single existing path means the class is already
      // defined somewhere, so nothing is created.
      const candidatePaths = await resolvePhpClassSourcePaths(fqn);

      if (!isRequestedRootActive()) {
        return null;
      }

      for (const candidatePath of candidatePaths) {
        const existingSource = await readTestFileIfExists(candidatePath);

        if (!isRequestedRootActive()) {
          return null;
        }

        if (existingSource !== null) {
          return null;
        }
      }

      // The destination file itself must not already exist (a different class in
      // the expected file, or a race) - never overwrite. (Covered by the loop
      // above when the destination is among the candidates, but re-checked here
      // so a non-candidate destination is still guarded.)
      const existingTarget = await readTestFileIfExists(destination.path);

      if (!isRequestedRootActive()) {
        return null;
      }

      if (existingTarget !== null) {
        return null;
      }

      const shortName = fqn.slice(fqn.lastIndexOf("\\") + 1);
      const skeleton = renderPhpTypeSkeleton(
        reference.kind,
        shortName,
        destination.namespace,
      );

      return {
        edits: [],
        isPreferred: true,
        kind: "quickfix",
        newFile: { content: skeleton, path: destination.path },
        title: `Create ${reference.kind} ${shortName}`,
      };
    },
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
 * Orders the aggregated PHP code actions so the most-likely action for the
 * cursor / selection leads the list (PhpStorm Alt+Enter "most likely first").
 * The order is a STABLE sort by kind family - contextual quickfixes, then
 * `extract` refactors, then `inline`, then `rewrite` (generate family + add
 * type), then the organize-imports source action, then anything unkinded -
 * which preserves each family's existing relative order (e.g. the alphabetical
 * import candidates) while floating the lightbulb fixes to the top. A single
 * `isPreferred` quickfix (Create method/property/Import) therefore wins the
 * first slot, matching the action Monaco offers as the lightbulb's auto-fix.
 */
function orderPhpCodeActions(
  actions: PhpCodeActionDescriptor[],
): PhpCodeActionDescriptor[] {
  return actions
    .map((action, index) => ({ action, index }))
    .sort((left, right) => {
      const byFamily =
        phpCodeActionFamilyRank(left.action) -
        phpCodeActionFamilyRank(right.action);

      if (byFamily !== 0) {
        return byFamily;
      }

      // Within a family a preferred action (the contextual fix) leads; ties keep
      // their original insertion order so nothing else is reshuffled.
      const byPreferred =
        Number(right.action.isPreferred ?? false) -
        Number(left.action.isPreferred ?? false);

      if (byPreferred !== 0) {
        return byPreferred;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.action);
}

/**
 * Ranks a code action's kind family for "most likely first" ordering: contextual
 * quickfixes (0) lead, then extract (1) / inline (2) / rewrite (3) refactors, the
 * organize-imports source action (4), and any unkinded action (5) trails. The
 * kind defaults to `quickfix` to mirror the Monaco mapper's fallback.
 */
function phpCodeActionFamilyRank(action: PhpCodeActionDescriptor): number {
  const kind = action.kind ?? "quickfix";

  if (kind.startsWith("quickfix")) {
    return 0;
  }

  if (kind.startsWith("refactor.extract")) {
    return 1;
  }

  if (kind.startsWith("refactor.inline")) {
    return 2;
  }

  if (kind.startsWith("refactor")) {
    return 3;
  }

  if (kind.startsWith("source")) {
    return 4;
  }

  return 5;
}

/**
 * Namespace prefixes "Create class" must never write into even when a project
 * PSR-4 root happens to cover them: a `Composer\` autoload entry pointing at a
 * vendored package, or the framework's own `Illuminate\` / `Symfony\` roots.
 * Defensive - a normal app maps these via the `packages` list (which the
 * destination mapper does not consult), so this only matters when a root maps
 * one of these directly.
 */
const VENDOR_PSR4_PREFIXES = ["Composer\\", "Illuminate\\", "Symfony\\"];

/**
 * Conservative set of PHP built-in / SPL / common-extension type names that
 * "Create class" must never offer to create (they already exist at runtime and
 * have no workspace source file). Lower-cased, short-name keyed: a reference is
 * a built-in when its FQN is global (no namespace) and its short name is in this
 * set. Namespaced user types of the same short name (e.g. `App\Exception`) are
 * unaffected. Not exhaustive - it covers the high-frequency names a developer
 * is most likely to reference; anything else still falls through to the
 * existence + PSR-4 guards.
 */
const PHP_BUILTIN_CLASS_NAMES = new Set(
  [
    "stdClass",
    "Closure",
    "Generator",
    "Stringable",
    "Iterator",
    "IteratorAggregate",
    "Traversable",
    "Countable",
    "ArrayAccess",
    "ArrayObject",
    "ArrayIterator",
    "JsonSerializable",
    "Serializable",
    "SplStack",
    "SplQueue",
    "SplObjectStorage",
    "SplFixedArray",
    "SplDoublyLinkedList",
    "SplPriorityQueue",
    "SplHeap",
    "SplMinHeap",
    "SplMaxHeap",
    "WeakMap",
    "WeakReference",
    "DateTime",
    "DateTimeImmutable",
    "DateTimeInterface",
    "DateInterval",
    "DateTimeZone",
    "DatePeriod",
    "Throwable",
    "Exception",
    "Error",
    "TypeError",
    "ValueError",
    "ArgumentCountError",
    "ArithmeticError",
    "DivisionByZeroError",
    "ErrorException",
    "RuntimeException",
    "LogicException",
    "InvalidArgumentException",
    "OutOfRangeException",
    "OutOfBoundsException",
    "LengthException",
    "DomainException",
    "RangeException",
    "UnexpectedValueException",
    "UnderflowException",
    "OverflowException",
    "BadFunctionCallException",
    "BadMethodCallException",
    "UnhandledMatchError",
    "JsonException",
    "ReflectionClass",
    "ReflectionMethod",
    "ReflectionProperty",
    "ReflectionFunction",
    "ReflectionParameter",
    "ReflectionNamedType",
    "ReflectionEnum",
    "PDO",
    "PDOStatement",
    "PDOException",
    "SimpleXMLElement",
    "DOMDocument",
    "DOMElement",
    "DOMNode",
    "UnitEnum",
    "BackedEnum",
  ].map((name) => name.toLowerCase()),
);

/**
 * Whether `fqn` names a PHP built-in type. Only a GLOBAL (un-namespaced) name is
 * treated as built-in - a namespaced `App\Exception` is a user type and remains
 * creatable. A leading `\` (already stripped by the resolver, but tolerated
 * here) does not make a name namespaced.
 */
function isPhpBuiltinTypeName(fqn: string): boolean {
  const normalized = fqn.trim().replace(/^\\+/, "");

  if (normalized.includes("\\")) {
    return false;
  }

  return PHP_BUILTIN_CLASS_NAMES.has(normalized.toLowerCase());
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

/**
 * Returns the bare (single-segment) short class name under the cursor that is a
 * candidate for an "Import class" quickfix, or `null` when it should not be
 * offered. Conservative gates, in order:
 *  - the cursor must sit on a `classIdentifier` reference (method calls,
 *    property/static accesses, Laravel string helpers etc. are excluded by
 *    {@link phpClassIdentifierNameAt});
 *  - the name must be unqualified (no `\`) - a qualified reference already names
 *    its namespace, so no `use` is needed;
 *  - the name must NOT already be imported by a top-level `use` (alias-aware).
 */
function phpImportClassShortNameAt(
  source: string,
  range: PhpCodeActionRange,
): string | null {
  const shortName = phpClassIdentifierNameAt(source, range.start);

  if (!shortName || shortName.includes("\\")) {
    return null;
  }

  if (phpShortNameIsImported(source, shortName)) {
    return null;
  }

  return shortName;
}

/**
 * Builds the "Import \\Fully\\Qualified\\Name" code actions for an unimported
 * class reference. Pure: the indexed candidate FQNs are resolved by the caller
 * (workspace symbol index) and passed in. A candidate is offered only when it is
 * namespaced AND its namespace differs from the file's current namespace (a
 * same-namespace class needs no `use`); duplicates are de-duplicated and the
 * actions are ordered alphabetically by FQN so an ambiguous short name yields a
 * stable list of choices. Each action inserts `use FQN;` into the existing use
 * block in sorted order (or starts a fresh block) via {@link planPhpAddImport}.
 */
function phpImportClassCodeActions(
  source: string,
  candidateFqns: readonly string[],
): PhpCodeActionDescriptor[] {
  const currentNamespace = (phpCurrentNamespace(source) ?? "").toLowerCase();
  const seen = new Set<string>();
  const actions: PhpCodeActionDescriptor[] = [];

  for (const candidate of candidateFqns) {
    const fqn = candidate.trim().replace(/^\\+/, "");

    if (!fqn.includes("\\")) {
      continue;
    }

    const key = fqn.toLowerCase();

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    const namespacePart = fqn.slice(0, fqn.lastIndexOf("\\")).toLowerCase();

    if (namespacePart === currentNamespace) {
      continue;
    }

    const action = phpImportClassCodeAction(source, fqn);

    if (action) {
      actions.push(action);
    }
  }

  const sorted = actions.sort((a, b) => a.title.localeCompare(b.title));

  // Monaco honours a SINGLE preferred action; with several import candidates for
  // an ambiguous short name only the first (alphabetically) stays preferred so
  // the others remain plain quickfix choices the user can still pick.
  return sorted.map((action, index) =>
    index === 0 ? action : { ...action, isPreferred: false },
  );
}

function phpImportClassCodeAction(
  source: string,
  fqn: string,
): PhpCodeActionDescriptor | null {
  const plan = planPhpAddImport(source, fqn);

  if (!plan) {
    return null;
  }

  const insertionPosition = offsetToPosition(source, plan.offset);

  return {
    edits: [
      {
        range: zeroLengthPhpEditRange(insertionPosition),
        text: plan.text,
      },
    ],
    // Importing the class is the contextual fix for an unresolved short name, so
    // it reads as a preferred quickfix (PhpStorm Alt+Enter -> Import at the top).
    isPreferred: true,
    kind: "quickfix",
    title: `Import ${fqn}`,
  };
}

/**
 * Offers "Remove unused import" when the cursor sits on a conservatively
 * detected unused class import (pairs with the unused-import inspection). The
 * edit deletes the whole `use ...;` statement and its trailing newline.
 * Conservative: only single, non-grouped class imports are ever offered (see
 * `phpUnusedImportRemovalAt` / `phpUnusedClassImports`).
 */
function phpRemoveUnusedImportCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedImportRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused import ${removal.label}`,
  };
}

/**
 * Offers "Remove unused method" when the cursor sits on a conservatively
 * detected unused private method (pairs with the unused-private-method
 * inspection). The edit deletes the whole method declaration (decorating lines
 * through the body's closing brace). Conservative: suppressed for any class
 * with dynamic dispatch and skipped when the body brace cannot be matched.
 */
function phpRemoveUnusedMethodCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedPrivateMethodRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused method '${removal.label}'`,
  };
}

/**
 * Offers "Remove unused variable" when the cursor sits on a conservatively
 * detected unused local whose assignment is side-effect-free (pairs with the
 * unused-variable inspection). The edit deletes the whole assignment statement
 * line. Conservative: returns null for an assignment with any potential side
 * effect (call / member access / non-trivial RHS) - those are warned but never
 * auto-removed, because deleting them would drop the side-effecting call.
 */
function phpRemoveUnusedVariableCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const removal = phpUnusedVariableRemovalAt(source, range.start);

  if (!removal) {
    return null;
  }

  return {
    edits: [removalEdit(source, removal)],
    kind: "quickfix",
    title: `Remove unused variable ${removal.label}`,
  };
}

/** Maps a character-offset removal span to a single empty-text Monaco edit. */
function removalEdit(
  source: string,
  removal: { end: number; start: number },
): PhpCodeActionTextEdit {
  const startPosition = offsetToPosition(source, removal.start);
  const endPosition = offsetToPosition(source, removal.end);

  return {
    range: {
      endColumn: endPosition.column + 1,
      endLineNumber: endPosition.line + 1,
      startColumn: startPosition.column + 1,
      startLineNumber: startPosition.line + 1,
    },
    text: "",
  };
}

/**
 * Offers "Optimize imports" when `organizePhpImports` reports a change (unused
 * imports removed and/or reordering). The edit replaces the exact span of the
 * existing top-level `use` block with the organized block. The action is
 * skipped when that span cannot be located confidently.
 */
function phpOptimizeImportsCodeAction(
  source: string,
): PhpCodeActionDescriptor | null {
  const organized = organizePhpImports(source);

  if (!organized || !organized.changed) {
    return null;
  }

  const useBlockRange = phpTopLevelUseBlockRange(source);

  if (!useBlockRange) {
    return null;
  }

  const startPosition = offsetToPosition(source, useBlockRange.start);
  const endPosition = offsetToPosition(source, useBlockRange.end);

  return {
    edits: [
      {
        range: {
          endColumn: endPosition.column + 1,
          endLineNumber: endPosition.line + 1,
          startColumn: startPosition.column + 1,
          startLineNumber: startPosition.line + 1,
        },
        text: organized.organizedUseBlock,
      },
    ],
    kind: "source.organizeImports",
    title: "Optimize imports",
  };
}

/**
 * Conservatively locates the contiguous span covering the existing top-level
 * `use` statements: from the start of the first `use` line to the end of the
 * last `use` statement (before the first type body opens). Returns `null` when
 * no top-level `use` statement is found.
 */
function phpTopLevelUseBlockRange(
  source: string,
): { end: number; start: number } | null {
  const masked = phpMaskStringsAndComments(source);
  const bodyLimit = phpFirstTypeBodyOffset(masked);
  const spans: Array<{ end: number; start: number }> = [];

  for (const match of masked.matchAll(/(^|\n)([ \t]*)use\b[^;]*;/g)) {
    const lineStart = (match.index ?? 0) + match[1].length;

    if (lineStart >= bodyLimit) {
      break;
    }

    if (!phpUseStatementIsTopLevel(masked, lineStart)) {
      continue;
    }

    spans.push({
      end: lineStart + (match[0].length - match[1].length),
      start: lineStart,
    });
  }

  if (spans.length === 0) {
    return null;
  }

  if (!phpUseSpansAreContiguous(source, spans)) {
    return null;
  }

  return { end: spans[spans.length - 1].end, start: spans[0].start };
}

/**
 * Guards the optimize-imports replacement: only treat the span from the first
 * to the last `use` as safe to overwrite when the gaps BETWEEN the statements
 * (in the ORIGINAL source) hold nothing but whitespace. This protects trailing
 * comments and any stray top-level content from being silently deleted; when a
 * gap is non-empty the action is suppressed (conservative no-op).
 */
function phpUseSpansAreContiguous(
  source: string,
  spans: ReadonlyArray<{ end: number; start: number }>,
): boolean {
  for (let index = 1; index < spans.length; index += 1) {
    const gap = source.slice(spans[index - 1].end, spans[index].start);

    if (gap.trim().length > 0) {
      return false;
    }
  }

  return true;
}

function phpUseStatementIsTopLevel(masked: string, offset: number): boolean {
  let braceDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < offset && index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
  }

  return braceDepth === 0 && parenDepth === 0;
}

function phpFirstTypeBodyOffset(masked: string): number {
  const match =
    /(?<![:\\$>A-Za-z0-9_])(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/.exec(
      masked,
    );

  if (!match) {
    return masked.length;
  }

  const bodyStart = masked.indexOf("{", match.index + match[0].length);

  if (bodyStart < 0) {
    return masked.length;
  }

  return bodyStart + 1;
}

function phpMaskStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : " ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#" && next !== "[" && source[index - 1] !== "$") {
      output += " ";
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
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
