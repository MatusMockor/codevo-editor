import type { MutableRefObject } from "react";
import type {
  EditorPosition,
  LanguageServerFeaturesGateway,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type { NavigationRequest } from "../application/navigationRequest";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { LargeSmartDocumentPolicy } from "../domain/largeDocumentPolicy";
import type { PhpParameterNameInlayHint } from "../domain/phpInlayHints";
import type {
  PhpMethodCompletion,
  PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import type { UserSnippet } from "../domain/snippets";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type {
  BladeCompletion,
  LanguageServerMonacoProviderContext,
  LatteCompletion,
  NeonCompletion,
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
  PhpWorkspaceEditApplicationContext,
} from "./languageServerMonacoProviders";
import type { WorkspaceEditApplicationDecision } from "../application/workspaceEditApplication";
import type { WorkspaceIdentityDescriptor } from "./phpMonacoDocumentContext";
import type { PhpDocumentSymbolRequest } from "../application/phpDocumentSymbolCoordinator";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";

type CallbackRef<T extends (...args: never[]) => unknown> = MutableRefObject<T>;
type PositionProvider<T> = (
  source: string,
  position: EditorPosition,
) => Promise<T>;
type OffsetProvider<T> = (
  source: string,
  offset: number,
  request?: NavigationRequest,
) => Promise<T>;

export interface EditorSurfaceLanguageProviderOptionsDependencies {
  coordinatePhpDocumentSymbols?(
    request: PhpDocumentSymbolRequest,
    load: () => Promise<LanguageServerDocumentSymbol[]>,
  ): Promise<LanguageServerDocumentSymbol[]>;
  featuresGateway: LanguageServerFeaturesGateway;
  refreshGateway?: LanguageServerRefreshGateway;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  workspaceRoot: string | null;
  workspaceIdentityDescriptor?: WorkspaceIdentityDescriptor | null;
}

export interface EditorSurfaceLanguageProviderRegistrationRefs {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  resolveDocumentForModelRef?: MutableRefObject<
    (model: import("monaco-editor").editor.ITextModel) => EditorDocument | null
  >;
  applyPhpCodeActionNewFileRef: CallbackRef<
    (newFile: PhpCodeActionNewFile) => Promise<boolean>
  >;
  applyPhpWorkspaceEditRef: CallbackRef<
    (
      edit: LanguageServerWorkspaceEdit,
      context: PhpWorkspaceEditApplicationContext,
    ) => Promise<WorkspaceEditApplicationDecision>
  >;
  bladeCodeActionsRef: CallbackRef<
    (
      source: string,
      range: PhpCodeActionRange,
    ) => Promise<PhpCodeActionDescriptor[]>
  >;
  bladeCompletionsRef: CallbackRef<PositionProvider<BladeCompletion[]>>;
  bladeDefinitionRef: CallbackRef<OffsetProvider<boolean>>;
  clearLanguageServerDiagnosticsForPathRef: CallbackRef<(path: string) => void>;
  errorReporterRef: CallbackRef<(error: unknown) => void>;
  flushPendingRef: CallbackRef<(path: string) => Promise<void>>;
  isLanguageServerDocumentSyncedRef: MutableRefObject<
    ((path: string) => boolean) | undefined
  >;
  largeSmartDocumentPolicyRef: MutableRefObject<LargeSmartDocumentPolicy>;
  latteCompletionsRef: CallbackRef<PositionProvider<LatteCompletion[]>>;
  latteDefinitionRef: CallbackRef<OffsetProvider<boolean>>;
  neonCompletionsRef: CallbackRef<PositionProvider<NeonCompletion[]>>;
  neonDefinitionRef: CallbackRef<OffsetProvider<boolean>>;
  phpCodeActionsRef: CallbackRef<
    (
      source: string,
      range: PhpCodeActionRange,
    ) => Promise<PhpCodeActionDescriptor[]>
  >;
  phpFrameworkDefinitionRef: CallbackRef<OffsetProvider<boolean>>;
  phpFrameworkStringCompletionContextRef: CallbackRef<
    (source: string, position: EditorPosition) => boolean
  >;
  phpInlayHintsEnabledRef: MutableRefObject<boolean>;
  phpMethodCompletionsRef: CallbackRef<PositionProvider<PhpMethodCompletion[]>>;
  phpMethodSignatureRef: CallbackRef<PositionProvider<PhpMethodSignature | null>>;
  phpParameterInlayHintsRef: CallbackRef<
    (
      source: string,
      range: { endLine: number; startLine: number },
    ) => Promise<PhpParameterNameInlayHint[]>
  >;
  phpPresenterLinkCompletionsRef: CallbackRef<
    OffsetProvider<LatteCompletion[] | null>
  >;
  phpPresenterLinkCompletionContextRef: CallbackRef<
    (source: string, offset: number) => boolean
  >;
  phpPresenterLinkDefinitionRef: CallbackRef<OffsetProvider<boolean>>;
  recordCompletionLatencyRef: MutableRefObject<
    ((durationMs: number, rootPath?: string) => void) | undefined
  >;
  runtimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  userSnippetsRef: MutableRefObject<readonly UserSnippet[]>;
}

export function createEditorSurfaceLanguageProviderOptions({
  dependencies,
  refs,
}: {
  dependencies: EditorSurfaceLanguageProviderOptionsDependencies;
  refs: EditorSurfaceLanguageProviderRegistrationRefs;
}): LanguageServerMonacoProviderContext {
  const {
    featuresGateway,
    coordinatePhpDocumentSymbols,
    refreshGateway,
    workspaceEditGateway,
    workspaceRoot,
    workspaceIdentityDescriptor,
  } = dependencies;
  const {
    activeDocumentRef,
    resolveDocumentForModelRef,
    applyPhpCodeActionNewFileRef,
    applyPhpWorkspaceEditRef,
    bladeCodeActionsRef,
    bladeCompletionsRef,
    bladeDefinitionRef,
    clearLanguageServerDiagnosticsForPathRef,
    errorReporterRef,
    flushPendingRef,
    isLanguageServerDocumentSyncedRef,
    largeSmartDocumentPolicyRef,
    latteCompletionsRef,
    latteDefinitionRef,
    neonCompletionsRef,
    neonDefinitionRef,
    phpCodeActionsRef,
    phpFrameworkDefinitionRef,
    phpFrameworkStringCompletionContextRef,
    phpInlayHintsEnabledRef,
    phpMethodCompletionsRef,
    phpMethodSignatureRef,
    phpParameterInlayHintsRef,
    phpPresenterLinkCompletionsRef,
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkDefinitionRef,
    recordCompletionLatencyRef,
    runtimeStatusRef,
    userSnippetsRef,
  } = refs;

  return {
    applyPhpCodeActionNewFile: (newFile) =>
      applyPhpCodeActionNewFileRef.current(newFile),
    applyWorkspaceEdit: (edit, editContext) =>
      applyPhpWorkspaceEditRef.current(edit, editContext),
    clearLanguageServerDiagnosticsForPath: (path) =>
      clearLanguageServerDiagnosticsForPathRef.current(path),
    coordinatePhpDocumentSymbols,
    featuresGateway,
    flushPendingDocumentChange: (path) => flushPendingRef.current(path),
    getActiveDocument: () => activeDocumentRef.current,
    getDocumentForModel: (model: import("monaco-editor").editor.ITextModel) =>
      resolveDocumentForModelRef?.current(model) ?? activeDocumentRef.current,
    getLargeSmartDocumentPolicy: () => largeSmartDocumentPolicyRef.current,
    getRuntimeStatus: () => runtimeStatusRef.current,
    getUserSnippets: () => userSnippetsRef.current,
    getWorkspaceRoot: () => workspaceRoot,
    getWorkspaceIdentityDescriptor: () => workspaceIdentityDescriptor ?? null,
    isDocumentSynced: (rootPath, path) =>
      workspaceRootKeysEqual(rootPath, workspaceRoot) &&
      Boolean(isLanguageServerDocumentSyncedRef.current?.(path)),
    isPhpInlayHintsEnabled: () => phpInlayHintsEnabledRef.current,
    limitNavigationResultsToOpenModels: true,
    provideBladeCodeActions: (source, range) =>
      bladeCodeActionsRef.current(source, range),
    provideBladeCompletions: (source, position) =>
      bladeCompletionsRef.current(source, position),
    provideBladeDefinition: (source, offset, request) =>
      callOffsetProvider(bladeDefinitionRef.current, source, offset, request),
    provideLatteCompletions: (source, position) =>
      latteCompletionsRef.current(source, position),
    provideLatteDefinition: (source, offset, request) =>
      callOffsetProvider(latteDefinitionRef.current, source, offset, request),
    provideNeonCompletions: (source, position) =>
      neonCompletionsRef.current(source, position),
    provideNeonDefinition: (source, offset, request) =>
      callOffsetProvider(neonDefinitionRef.current, source, offset, request),
    providePhpPresenterLinkDefinition: (source, offset, request) =>
      callOffsetProvider(
        phpPresenterLinkDefinitionRef.current,
        source,
        offset,
        request,
      ),
    providePhpPresenterLinkCompletions: (source, offset) =>
      phpPresenterLinkCompletionsRef.current(source, offset),
    isPhpPresenterLinkCompletionContext: (source, offset) =>
      phpPresenterLinkCompletionContextRef.current(source, offset),
    isPhpFrameworkStringCompletionContext: (source, position) =>
      phpFrameworkStringCompletionContextRef.current(source, position),
    providePhpCodeActions: (source, range) =>
      phpCodeActionsRef.current(source, range),
    providePhpFrameworkDefinition: (source, offset, request) =>
      callOffsetProvider(phpFrameworkDefinitionRef.current, source, offset, request),
    providePhpMethodCompletions: (source, position) =>
      phpMethodCompletionsRef.current(source, position),
    providePhpMethodSignature: (source, position) =>
      phpMethodSignatureRef.current(source, position),
    providePhpParameterInlayHints: (source, range) =>
      phpParameterInlayHintsRef.current(source, range),
    recordCompletionLatency: (durationMs, rootPath) =>
      recordCompletionLatencyRef.current?.(durationMs, rootPath),
    refreshGateway,
    reportError: (error) => errorReporterRef.current(error),
    workspaceEditGateway,
  };
}

function callOffsetProvider<T>(
  provider: OffsetProvider<T>,
  source: string,
  offset: number,
  request?: NavigationRequest,
): Promise<T> {
  if (!request) {
    return provider(source, offset);
  }

  return provider(source, offset, request);
}
