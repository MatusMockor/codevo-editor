import { useEffect, type MutableRefObject } from "react";
import type * as Monaco from "monaco-editor";
import type {
  EditorPosition,
  LanguageServerFeaturesGateway,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEdit,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { PhpParameterNameInlayHint } from "../domain/phpInlayHints";
import type {
  PhpMethodCompletion,
  PhpMethodSignature,
} from "../domain/phpMethodCompletions";
import type { UserSnippet } from "../domain/snippets";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  registerLanguageServerMonacoProviders,
  type BladeCompletion,
  type LatteCompletion,
  type NeonCompletion,
  type PhpCodeActionDescriptor,
  type PhpCodeActionNewFile,
  type PhpCodeActionRange,
  type PhpWorkspaceEditApplicationContext,
} from "./languageServerMonacoProviders";

type CallbackRef<T extends (...args: never[]) => unknown> = MutableRefObject<T>;
type PositionProvider<T> = (
  source: string,
  position: EditorPosition,
) => Promise<T>;
type OffsetProvider<T> = (source: string, offset: number) => Promise<T>;

export interface EditorSurfaceLanguageProviderRegistrationDependencies {
  featuresGateway: LanguageServerFeaturesGateway;
  monacoApi: typeof Monaco | null;
  refreshGateway?: LanguageServerRefreshGateway;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  workspaceRoot: string | null;
}

export interface EditorSurfaceLanguageProviderRegistrationRefs {
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  applyPhpCodeActionNewFileRef: CallbackRef<
    (newFile: PhpCodeActionNewFile) => Promise<boolean>
  >;
  applyPhpWorkspaceEditRef: CallbackRef<
    (
      edit: LanguageServerWorkspaceEdit,
      context: PhpWorkspaceEditApplicationContext,
    ) => Promise<void>
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
  phpPresenterLinkDefinitionRef: CallbackRef<OffsetProvider<boolean>>;
  recordCompletionLatencyRef: MutableRefObject<
    ((durationMs: number, rootPath?: string) => void) | undefined
  >;
  runtimeStatusRef: MutableRefObject<LanguageServerRuntimeStatus | null>;
  userSnippetsRef: MutableRefObject<readonly UserSnippet[]>;
}

export function useEditorSurfaceLanguageProviderRegistration({
  dependencies,
  refs,
}: {
  dependencies: EditorSurfaceLanguageProviderRegistrationDependencies;
  refs: EditorSurfaceLanguageProviderRegistrationRefs;
}) {
  const {
    featuresGateway,
    monacoApi,
    refreshGateway,
    workspaceEditGateway,
    workspaceRoot,
  } = dependencies;
  const {
    activeDocumentRef,
    applyPhpCodeActionNewFileRef,
    applyPhpWorkspaceEditRef,
    bladeCodeActionsRef,
    bladeCompletionsRef,
    bladeDefinitionRef,
    clearLanguageServerDiagnosticsForPathRef,
    errorReporterRef,
    flushPendingRef,
    isLanguageServerDocumentSyncedRef,
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
    phpPresenterLinkDefinitionRef,
    recordCompletionLatencyRef,
    runtimeStatusRef,
    userSnippetsRef,
  } = refs;

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    const disposable = registerLanguageServerMonacoProviders(monacoApi, {
      applyPhpCodeActionNewFile: (newFile) =>
        applyPhpCodeActionNewFileRef.current(newFile),
      applyWorkspaceEdit: (edit, editContext) =>
        applyPhpWorkspaceEditRef.current(edit, editContext),
      clearLanguageServerDiagnosticsForPath: (path) =>
        clearLanguageServerDiagnosticsForPathRef.current(path),
      featuresGateway,
      flushPendingDocumentChange: (path) => flushPendingRef.current(path),
      getActiveDocument: () => activeDocumentRef.current,
      getRuntimeStatus: () => runtimeStatusRef.current,
      getUserSnippets: () => userSnippetsRef.current,
      getWorkspaceRoot: () => workspaceRoot,
      isDocumentSynced: (rootPath, path) =>
        workspaceRootKeysEqual(rootPath, workspaceRoot) &&
        Boolean(isLanguageServerDocumentSyncedRef.current?.(path)),
      isPhpInlayHintsEnabled: () => phpInlayHintsEnabledRef.current,
      limitNavigationResultsToOpenModels: true,
      provideBladeCodeActions: (source, range) =>
        bladeCodeActionsRef.current(source, range),
      provideBladeCompletions: (source, position) =>
        bladeCompletionsRef.current(source, position),
      provideBladeDefinition: (source, offset) =>
        bladeDefinitionRef.current(source, offset),
      provideLatteCompletions: (source, position) =>
        latteCompletionsRef.current(source, position),
      provideLatteDefinition: (source, offset) =>
        latteDefinitionRef.current(source, offset),
      provideNeonCompletions: (source, position) =>
        neonCompletionsRef.current(source, position),
      provideNeonDefinition: (source, offset) =>
        neonDefinitionRef.current(source, offset),
      providePhpPresenterLinkDefinition: (source, offset) =>
        phpPresenterLinkDefinitionRef.current(source, offset),
      providePhpPresenterLinkCompletions: (source, offset) =>
        phpPresenterLinkCompletionsRef.current(source, offset),
      isPhpFrameworkStringCompletionContext: (source, position) =>
        phpFrameworkStringCompletionContextRef.current(source, position),
      providePhpCodeActions: (source, range) =>
        phpCodeActionsRef.current(source, range),
      providePhpFrameworkDefinition: (source, offset) =>
        phpFrameworkDefinitionRef.current(source, offset),
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
    });

    return () => disposable.dispose();
  }, [
    activeDocumentRef,
    applyPhpCodeActionNewFileRef,
    applyPhpWorkspaceEditRef,
    bladeCodeActionsRef,
    bladeCompletionsRef,
    bladeDefinitionRef,
    clearLanguageServerDiagnosticsForPathRef,
    errorReporterRef,
    featuresGateway,
    flushPendingRef,
    isLanguageServerDocumentSyncedRef,
    latteCompletionsRef,
    latteDefinitionRef,
    monacoApi,
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
    phpPresenterLinkDefinitionRef,
    recordCompletionLatencyRef,
    refreshGateway,
    runtimeStatusRef,
    userSnippetsRef,
    workspaceEditGateway,
    workspaceRoot,
  ]);
}
