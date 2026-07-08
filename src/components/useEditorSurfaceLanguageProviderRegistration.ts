import { useEffect } from "react";
import type * as Monaco from "monaco-editor";
import type {
  LanguageServerFeaturesGateway,
  LanguageServerRefreshGateway,
  LanguageServerWorkspaceEditGateway,
} from "../domain/languageServerFeatures";
import { registerLanguageServerMonacoProviders } from "./languageServerMonacoProviders";
import {
  createEditorSurfaceLanguageProviderOptions,
  type EditorSurfaceLanguageProviderRegistrationRefs,
} from "./editorSurfaceLanguageProviderOptions";

export interface EditorSurfaceLanguageProviderRegistrationDependencies {
  featuresGateway: LanguageServerFeaturesGateway;
  monacoApi: typeof Monaco | null;
  refreshGateway?: LanguageServerRefreshGateway;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  workspaceRoot: string | null;
}

export type { EditorSurfaceLanguageProviderRegistrationRefs };

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
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkDefinitionRef,
    recordCompletionLatencyRef,
    runtimeStatusRef,
    userSnippetsRef,
  } = refs;

  useEffect(() => {
    if (!monacoApi) {
      return;
    }

    const disposable = registerLanguageServerMonacoProviders(
      monacoApi,
      createEditorSurfaceLanguageProviderOptions({
        dependencies: {
          featuresGateway,
          refreshGateway,
          workspaceEditGateway,
          workspaceRoot,
        },
        refs,
      }),
    );

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
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkDefinitionRef,
    recordCompletionLatencyRef,
    refreshGateway,
    runtimeStatusRef,
    userSnippetsRef,
    workspaceEditGateway,
    workspaceRoot,
  ]);
}
