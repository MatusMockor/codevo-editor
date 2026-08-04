import { createContext, useContext } from "react";
import type * as Monaco from "monaco-editor";
import type { PhpDocumentSymbolRequest } from "../application/phpDocumentSymbolCoordinator";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";
import type {
  CoordinatedLocalPhpValidation,
  LocalPhpValidationComputation,
  LocalPhpValidationRequest,
} from "./localPhpValidationCoordinator";
import type { EditorRuntimeEditorMembership } from "./editorRuntimeMembership";
import type {
  EditorSurfaceLanguageProviderRegistrationDependencies,
  EditorSurfaceLanguageProviderRegistrationRefs,
} from "./useEditorSurfaceLanguageProviderRegistration";
import type { JavaScriptTypeScriptLanguageServerProviderContext } from "./javascriptTypescriptLanguageServerMonacoProviders";
import type { TypescriptJavascriptDefaultsOptions } from "./typescriptJavascriptDefaults";
import type { WorkspaceIdentityDescriptor } from "./phpMonacoDocumentContext";
import type { LargeSmartDocumentMetrics } from "../domain/largeDocumentPolicy";

export interface LocalPhpValidationSnapshot<TSyntax, TInspection> {
  inspectionDiagnostics: TInspection[];
  syntaxDiagnostics: TSyntax[];
}

export interface EditorRuntimeSurfaceRouting {
  activeDocumentRef: EditorRuntimeEditorMembership["activeDocumentRef"];
  javaScriptTypeScriptProviderContext: JavaScriptTypeScriptLanguageServerProviderContext;
  providerRefs: EditorSurfaceLanguageProviderRegistrationRefs;
  resolveDocumentForModel: EditorRuntimeEditorMembership["resolveDocumentForModel"];
}

export interface EditorRuntimeSurfaceRegistration {
  activePath: string | null;
  diagnosticsByPath: Readonly<Record<string, readonly LanguageServerDiagnostic[]>>;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  groupId: string;
  monacoApi: typeof Monaco | null;
  onModelContentChange(
    content: string,
    path?: string,
    metrics?: LargeSmartDocumentMetrics,
  ): boolean | void;
  onMarkerUrisChanged?(uris: readonly Monaco.Uri[]): void;
  providerDependencies: EditorSurfaceLanguageProviderRegistrationDependencies;
  retainPaths: readonly string[];
  routing: EditorRuntimeSurfaceRouting;
  toMarker(diagnostic: LanguageServerDiagnostic): Monaco.editor.IMarkerData;
  typescriptJavascriptDefaults: TypescriptJavascriptDefaultsOptions;
  workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  workspaceRoot: string | null;
}

export interface EditorRuntimeContextValue {
  getActiveJavaScriptTypeScriptOwnerEpoch(): number;
  getActiveJavaScriptTypeScriptOwnerIdentity(): object | null;
  coordinatePhpDocumentSymbols(
    request: PhpDocumentSymbolRequest,
    load: () => Promise<LanguageServerDocumentSymbol[]>,
  ): Promise<LanguageServerDocumentSymbol[]>;
  coordinateLocalPhpValidation<TSyntax, TInspection>(
    request: LocalPhpValidationRequest,
    compute: () => LocalPhpValidationComputation<
      LocalPhpValidationSnapshot<TSyntax, TInspection>,
      LocalPhpValidationSnapshot<TSyntax, TInspection>
    >,
  ): CoordinatedLocalPhpValidation<
    LocalPhpValidationSnapshot<TSyntax, TInspection>,
    LocalPhpValidationSnapshot<TSyntax, TInspection>
  >;
  focusGroup(groupId: string): void;
  acknowledgeExactLiveModelContent?(
    groupId: string,
    path: string,
    model: Monaco.editor.ITextModel,
  ): boolean;
  ownsExactLiveModelContent?(
    groupId: string,
    path: string,
    model: Monaco.editor.ITextModel,
  ): boolean;
  writeLocalPhpMarkers(
    consumerId: string,
    monacoApi: typeof Monaco,
    model: Monaco.editor.ITextModel,
    markers: readonly Monaco.editor.IMarkerData[],
  ): void;
  registerSurface(id: string, registration: EditorRuntimeSurfaceRegistration): () => void;
  updateSurface(id: string, registration: EditorRuntimeSurfaceRegistration): void;
}

export const EditorRuntimeContext = createContext<EditorRuntimeContextValue | null>(null);

export function useEditorRuntimeContext(): EditorRuntimeContextValue | null {
  return useContext(EditorRuntimeContext);
}
