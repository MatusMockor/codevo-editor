import type { EditorPosition } from "../domain/languageServerFeatures";
import type {
  FileEntry,
  TextSearchGateway,
} from "../domain/workspace";
import type { PhpLaravelViewVariable } from "../domain/phpLaravelViewData";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";
import type {
  PhpCodeActionContext,
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { NavigationRequest } from "./navigationRequest";

/**
 * A Blade completion item the controller hands to the Monaco "blade" completion
 * provider. Structurally compatible with the provider's BladeCompletion; kept
 * application-level so the controller does not depend on the components layer.
 */
export interface BladeCompletionItem {
  detail?: string;
  insertText: string;
  kind: "directive" | "view" | "component" | "variable" | "helper" | "member";
  label: string;
  replaceStart?: number;
  replaceEnd?: number;
}

export type BladeViewVariable = PhpLaravelViewVariable;

/**
 * Collaborators the Blade intelligence needs from the workbench shell. The heavy
 * PHP framework resolvers, target collectors and navigation primitives are
 * injected so expensive engines stay owned by the controller.
 */
export interface BladeIntelligenceDependencies {
  activeDocument: { content: string; path: string } | null;
  currentWorkspaceRootRef: { readonly current: string | null };
  frameworkRuntime: PhpFrameworkRuntimeContext;
  workspaceRoot: string | null;
  textSearch: Pick<TextSearchGateway, "searchText">;
  workspaceFiles: { readDirectory: (path: string) => Promise<FileEntry[]> };
  readNavigationFileContent: (path: string) => Promise<string>;
  relativeWorkspacePath: (workspaceRoot: string, path: string) => string;
  openNavigationTarget: (
    path: string,
    position: EditorPosition,
    label: string,
  ) => Promise<boolean>;
  resolvePhpExpressionType: (
    source: string,
    position: EditorPosition,
    expression: string,
  ) => Promise<string | null>;
  resolvePhpDeclaredType: (source: string, typeName: string | null) => string | null;
  resolvePhpClassPropertyOrRelationType: (
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ) => Promise<string | null>;
  resolvePhpReceiverMethodCompletions: (
    source: string,
    position: EditorPosition,
    receiverExpression: string,
  ) => Promise<PhpMethodCompletion[]>;
  ensurePhpFrameworkSourceCollectionsLoaded: (
    requestedRoot: string,
  ) => Promise<void>;
  collectViewTargets: PhpFrameworkTargets["collectViewTargets"];
  collectConfigTargets: PhpFrameworkTargets["collectConfigTargets"];
  collectNamedRouteTargets: PhpFrameworkTargets["collectNamedRouteTargets"];
  collectTranslationTargets: PhpFrameworkTargets["collectTranslationTargets"];
  findViewTarget: PhpFrameworkTargets["findViewTarget"];
  findConfigTarget: PhpFrameworkTargets["findConfigTarget"];
  findTranslationTarget: PhpFrameworkTargets["findTranslationTarget"];
  createMissingBladeViewCodeAction: (
    source: string,
    range: PhpCodeActionRange,
    language: "blade" | "php",
    isRequestedRootActive: () => boolean,
  ) => Promise<PhpCodeActionDescriptor | null>;
  openDirectPhpMethodTarget: (
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ) => Promise<boolean>;
  openPhpFrameworkModelAttributeTarget: (
    className: string,
    attributeName: string,
  ) => Promise<boolean>;
  openDirectPhpPropertyTarget: (
    className: string,
    propertyName: string,
  ) => Promise<boolean>;
}

/** The Blade providers + cache lifecycle the controller mount consumes. */
export interface BladeIntelligence {
  provideBladeCodeActions: (
    source: string,
    range?: PhpCodeActionRange,
    context?: PhpCodeActionContext,
  ) => Promise<PhpCodeActionDescriptor[]>;
  provideBladeCompletions: (
    source: string,
    position: EditorPosition,
  ) => Promise<BladeCompletionItem[]>;
  provideBladeDefinition: (
    source: string,
    offset: number,
    request?: NavigationRequest,
  ) => Promise<boolean>;
  invalidateBladeComponentNamesForPath: (root: string, path: string) => void;
  invalidateBladeViewDataEntriesForPath: (root: string, path: string) => void;
  resetBladeIntelligenceCaches: () => void;
}
