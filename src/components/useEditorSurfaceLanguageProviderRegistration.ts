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
import type { WorkspaceIdentityDescriptor } from "./phpMonacoDocumentContext";
import type { PhpDocumentSymbolRequest } from "../application/phpDocumentSymbolCoordinator";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import {
  activeComposerManifestWorkspace,
  registerComposerManifestMonacoProviders,
} from "./composerManifestMonacoProviders";
import {
  activeNpmManifestWorkspace,
  registerNpmManifestMonacoProviders,
} from "./npmManifestMonacoProviders";

export interface EditorSurfaceLanguageProviderRegistrationDependencies {
  coordinatePhpDocumentSymbols?(
    request: PhpDocumentSymbolRequest,
    load: () => Promise<LanguageServerDocumentSymbol[]>,
  ): Promise<LanguageServerDocumentSymbol[]>;
  featuresGateway: LanguageServerFeaturesGateway;
  monacoApi: typeof Monaco | null;
  refreshGateway?: LanguageServerRefreshGateway;
  workspaceEditGateway?: LanguageServerWorkspaceEditGateway;
  workspaceRoot: string | null;
  workspaceIdentityDescriptor?: WorkspaceIdentityDescriptor | null;
}

export type { EditorSurfaceLanguageProviderRegistrationRefs };

export function useEditorSurfaceLanguageProviderRegistration({
  dependencies,
  refs,
}: {
  dependencies: EditorSurfaceLanguageProviderRegistrationDependencies | null;
  refs: EditorSurfaceLanguageProviderRegistrationRefs;
}) {
  const {
    featuresGateway,
    coordinatePhpDocumentSymbols,
    monacoApi,
    refreshGateway,
    workspaceEditGateway,
    workspaceIdentityDescriptor,
    workspaceRoot,
  } = dependencies ?? ({} as Partial<EditorSurfaceLanguageProviderRegistrationDependencies>);
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
    if (!dependencies || !featuresGateway || !monacoApi) {
      return;
    }

    const languageServerProviders = registerLanguageServerMonacoProviders(
      monacoApi,
      createEditorSurfaceLanguageProviderOptions({
        dependencies: {
          coordinatePhpDocumentSymbols,
          featuresGateway,
          refreshGateway,
          workspaceEditGateway,
          workspaceIdentityDescriptor,
          workspaceRoot: workspaceRoot ?? null,
        },
        refs,
      }),
    );
    const composerManifestProviders = registerComposerManifestMonacoProviders(
      monacoApi,
      { getWorkspace: activeComposerManifestWorkspace },
    );
    const npmManifestProviders = registerNpmManifestMonacoProviders(monacoApi, {
      getWorkspace: activeNpmManifestWorkspace,
    });

    return () => {
      npmManifestProviders.dispose();
      composerManifestProviders.dispose();
      languageServerProviders.dispose();
    };
  }, [
    activeDocumentRef,
    resolveDocumentForModelRef,
    applyPhpCodeActionNewFileRef,
    applyPhpWorkspaceEditRef,
    bladeCodeActionsRef,
    bladeCompletionsRef,
    bladeDefinitionRef,
    clearLanguageServerDiagnosticsForPathRef,
    coordinatePhpDocumentSymbols,
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
    workspaceIdentityDescriptor,
    workspaceRoot,
  ]);
}
