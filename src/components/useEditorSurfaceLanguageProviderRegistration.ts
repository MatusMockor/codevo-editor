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
  workspaceTrusted?: boolean;
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
  const hasDependencies = dependencies !== null;
  const {
    coordinatePhpDocumentSymbols,
    featuresGateway,
    monacoApi,
    refreshGateway,
    workspaceEditGateway,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceTrusted,
  } = dependencies ?? ({} as Partial<EditorSurfaceLanguageProviderRegistrationDependencies>);
  const {
    activeDocumentRef,
    applyPhpCodeActionNewFileRef,
    applyPhpWorkspaceEditRef,
    clearLanguageServerDiagnosticsForPathRef,
    errorReporterRef,
    flushPendingRef,
    getLanguageServerDocumentLifecycleIdentityRef,
    isLanguageServerDocumentRequestLeaseCurrentRef,
    isLanguageServerDocumentSyncedRef,
    largeSmartDocumentPolicyRef,
    openPhpChangeSignatureRef,
    phpCodeActionsRef,
    phpFrameworkDefinitionRef,
    phpFrameworkStringCompletionContextRef,
    phpInlayHintsEnabledRef,
    phpMethodCompletionsRef,
    phpMethodSignatureRef,
    phpParameterInlayHintsRef,
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkCompletionsRef,
    phpPresenterLinkDefinitionRef,
    recordCompletionLatencyRef,
    requestLanguageServerDocumentLeaseRef,
    resolveDocumentForModelRef,
    runtimeStatusRef,
    templateLanguageProvidersRef,
    userSnippetsRef,
  } = refs;

  useEffect(() => {
    if (!hasDependencies || !featuresGateway || !monacoApi) {
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
          workspaceTrusted,
        },
        refs: {
          activeDocumentRef,
          applyPhpCodeActionNewFileRef,
          applyPhpWorkspaceEditRef,
          clearLanguageServerDiagnosticsForPathRef,
          errorReporterRef,
          flushPendingRef,
          getLanguageServerDocumentLifecycleIdentityRef,
          isLanguageServerDocumentRequestLeaseCurrentRef,
          isLanguageServerDocumentSyncedRef,
          largeSmartDocumentPolicyRef,
          openPhpChangeSignatureRef,
          phpCodeActionsRef,
          phpFrameworkDefinitionRef,
          phpFrameworkStringCompletionContextRef,
          phpInlayHintsEnabledRef,
          phpMethodCompletionsRef,
          phpMethodSignatureRef,
          phpParameterInlayHintsRef,
          phpPresenterLinkCompletionContextRef,
          phpPresenterLinkCompletionsRef,
          phpPresenterLinkDefinitionRef,
          recordCompletionLatencyRef,
          requestLanguageServerDocumentLeaseRef,
          resolveDocumentForModelRef,
          runtimeStatusRef,
          templateLanguageProvidersRef,
          userSnippetsRef,
        },
      }),
    );
    const composerManifestProviders = registerComposerManifestMonacoProviders(monacoApi, {
      getWorkspace: activeComposerManifestWorkspace,
    });
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
    applyPhpCodeActionNewFileRef,
    applyPhpWorkspaceEditRef,
    clearLanguageServerDiagnosticsForPathRef,
    coordinatePhpDocumentSymbols,
    errorReporterRef,
    featuresGateway,
    flushPendingRef,
    getLanguageServerDocumentLifecycleIdentityRef,
    hasDependencies,
    isLanguageServerDocumentRequestLeaseCurrentRef,
    isLanguageServerDocumentSyncedRef,
    largeSmartDocumentPolicyRef,
    monacoApi,
    openPhpChangeSignatureRef,
    phpCodeActionsRef,
    phpFrameworkDefinitionRef,
    phpFrameworkStringCompletionContextRef,
    phpInlayHintsEnabledRef,
    phpMethodCompletionsRef,
    phpMethodSignatureRef,
    phpParameterInlayHintsRef,
    phpPresenterLinkCompletionContextRef,
    phpPresenterLinkCompletionsRef,
    phpPresenterLinkDefinitionRef,
    recordCompletionLatencyRef,
    refreshGateway,
    requestLanguageServerDocumentLeaseRef,
    resolveDocumentForModelRef,
    runtimeStatusRef,
    templateLanguageProvidersRef,
    userSnippetsRef,
    workspaceEditGateway,
    workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceTrusted,
  ]);
}
