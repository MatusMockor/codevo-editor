import { shouldIndexWorkspace } from "../domain/intelligence";
import type { PhpClassStructure } from "../domain/phpClassStructure";
import {
  isTypeProjectSymbol,
  type ProjectSymbolSearchGateway,
} from "../domain/projectSymbols";
import type { IntelligenceMode } from "../domain/workspace";
import { phpExtractInterfaceCodeAction } from "./phpExtractInterfaceCodeActions";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import {
  phpImportClassCodeActions,
  phpImportClassShortNameAt,
} from "./phpImportCodeActions";
import {
  phpImplementMethodsCodeAction,
  phpOverrideMethodsCodeAction,
  phpSynchronizeInheritedMethodSignatureCodeAction,
  type PhpAbstractMembersCollector,
  type PhpOverridableParentMethodsCollector,
} from "./phpInheritedMemberCodeActions";

export type PhpCreateClassCodeAction = (
  source: string,
  range: PhpCodeActionRange,
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null>;

export type PhpCreateParentMemberCodeAction = (
  source: string,
  range: PhpCodeActionRange,
  isRequestedRootActive: () => boolean,
) => Promise<PhpCodeActionDescriptor | null>;

export type PhpFrameworkCodeActionContribution = (
  source: string,
  range: PhpCodeActionRange,
  isRequestedRootActive: () => boolean,
) => Promise<readonly PhpCodeActionDescriptor[] | null>;

export interface PhpWorkspaceCodeActionCollectorOptions {
  activeDocumentPath: string | null;
  collectPhpAbstractMembersToImplement: PhpAbstractMembersCollector;
  collectPhpOverridableParentMethods: PhpOverridableParentMethodsCollector;
  frameworkCodeActionContributions: readonly PhpFrameworkCodeActionContribution[];
  intelligenceMode: IntelligenceMode;
  isRequestedRootActive: () => boolean;
  phpCreateClassCodeAction: PhpCreateClassCodeAction;
  phpCreateParentMemberCodeAction: PhpCreateParentMemberCodeAction;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  range: PhpCodeActionRange;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  requestedRoot: string;
  source: string;
  structure: PhpClassStructure | null;
}

/**
 * Collects workspace-aware PHP code actions whose availability depends on async
 * project state: file existence probes, project-symbol search, and inherited
 * member collection. Returns `null` when the requested workspace root became
 * inactive while awaiting, so callers can drop the whole provider response
 * instead of mixing stale workspace actions with fresh local actions.
 */
export async function collectPhpWorkspaceCodeActions({
  activeDocumentPath,
  collectPhpAbstractMembersToImplement,
  collectPhpOverridableParentMethods,
  frameworkCodeActionContributions,
  intelligenceMode,
  isRequestedRootActive,
  phpCreateClassCodeAction,
  phpCreateParentMemberCodeAction,
  projectSymbolSearch,
  range,
  readTestFileIfExists,
  requestedRoot,
  source,
  structure,
}: PhpWorkspaceCodeActionCollectorOptions): Promise<
  PhpCodeActionDescriptor[] | null
> {
  const actions: PhpCodeActionDescriptor[] = [];

  const createClassAction = await phpCreateClassCodeAction(
    source,
    range,
    isRequestedRootActive,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (createClassAction) {
    actions.push(createClassAction);
  }

  const createParentMemberAction = await phpCreateParentMemberCodeAction(
    source,
    range,
    isRequestedRootActive,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (createParentMemberAction) {
    actions.push(createParentMemberAction);
  }

  for (const contribution of frameworkCodeActionContributions) {
    const frameworkActions = await contribution(
      source,
      range,
      isRequestedRootActive,
    );

    if (!isRequestedRootActive()) {
      return null;
    }

    if (frameworkActions) {
      actions.push(...frameworkActions);
    }
  }

  if (!structure) {
    return actions;
  }

  await collectExtractInterfaceAction({
    actions,
    activeDocumentPath,
    isRequestedRootActive,
    range,
    readTestFileIfExists,
    source,
  });

  if (!isRequestedRootActive()) {
    return null;
  }

  const declaredMethodNames = new Set(
    structure.methods.map((method) => method.name.toLowerCase()),
  );

  const synchronizeSignatureAction =
    await phpSynchronizeInheritedMethodSignatureCodeAction(
      source,
      range,
      structure,
      collectPhpAbstractMembersToImplement,
      isRequestedRootActive,
    );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (synchronizeSignatureAction) {
    actions.push(synchronizeSignatureAction);
  }

  const implementMethodsAction = await phpImplementMethodsCodeAction(
    source,
    declaredMethodNames,
    collectPhpAbstractMembersToImplement,
    isRequestedRootActive,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (implementMethodsAction) {
    actions.push(implementMethodsAction);
  }

  const overrideMethodsAction = await phpOverrideMethodsCodeAction(
    source,
    declaredMethodNames,
    collectPhpOverridableParentMethods,
    isRequestedRootActive,
  );

  if (!isRequestedRootActive()) {
    return null;
  }

  if (overrideMethodsAction) {
    actions.push(overrideMethodsAction);
  }

  await collectImportClassActions({
    actions,
    intelligenceMode,
    isRequestedRootActive,
    projectSymbolSearch,
    range,
    requestedRoot,
    source,
  });

  return isRequestedRootActive() ? actions : null;
}

async function collectExtractInterfaceAction({
  actions,
  activeDocumentPath,
  isRequestedRootActive,
  range,
  readTestFileIfExists,
  source,
}: {
  actions: PhpCodeActionDescriptor[];
  activeDocumentPath: string | null;
  isRequestedRootActive: () => boolean;
  range: PhpCodeActionRange;
  readTestFileIfExists: (path: string) => Promise<string | null>;
  source: string;
}): Promise<void> {
  const extractInterfaceAction = phpExtractInterfaceCodeAction(
    source,
    range,
    activeDocumentPath,
  );

  if (!extractInterfaceAction?.newFile) {
    return;
  }

  const existingInterface = await readTestFileIfExists(
    extractInterfaceAction.newFile.path,
  );

  if (!isRequestedRootActive() || existingInterface !== null) {
    return;
  }

  actions.push(extractInterfaceAction);
}

async function collectImportClassActions({
  actions,
  intelligenceMode,
  isRequestedRootActive,
  projectSymbolSearch,
  range,
  requestedRoot,
  source,
}: {
  actions: PhpCodeActionDescriptor[];
  intelligenceMode: IntelligenceMode;
  isRequestedRootActive: () => boolean;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  range: PhpCodeActionRange;
  requestedRoot: string;
  source: string;
}): Promise<void> {
  const importShortName = phpImportClassShortNameAt(source, range);

  if (!importShortName || !shouldIndexWorkspace(intelligenceMode)) {
    return;
  }

  const indexedSymbols = await projectSymbolSearch.searchProjectSymbols(
    requestedRoot,
    importShortName,
    25,
  );

  if (!isRequestedRootActive()) {
    return;
  }

  const candidateFqns = indexedSymbols
    .filter(isTypeProjectSymbol)
    .filter(
      (symbol) => symbol.name.toLowerCase() === importShortName.toLowerCase(),
    )
    .map((symbol) => symbol.fullyQualifiedName);

  actions.push(...phpImportClassCodeActions(source, candidateFqns));
}
