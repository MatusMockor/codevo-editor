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
import type { EditorDocument, FileEntry } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  createWorkspaceRootFromPath,
  parseWorkspacePath,
} from "../domain/workspacePath";
import { TauriWorkspaceGateway } from "../infrastructure/tauriWorkspaceGateway";
import { workspaceRelativePathForDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import type { LatteCrossFileBlockMonacoContext } from "./latteTemplateMonacoProviders";
import type {
  LanguageServerMonacoDocumentRequestLease,
  LanguageServerMonacoProviderContext,
  LatteCompletion,
  PhpCodeActionDescriptor,
  PhpCodeActionNewFile,
  PhpCodeActionRange,
  PhpWorkspaceEditApplicationContext,
} from "./languageServerMonacoProviders";
import type {
  TemplateLanguageProviderRegistry,
} from "./templateLanguageMonacoTypes";
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
  clearLanguageServerDiagnosticsForPathRef: CallbackRef<(path: string) => void>;
  errorReporterRef: CallbackRef<(error: unknown) => void>;
  flushPendingRef: CallbackRef<(path: string) => Promise<void>>;
  getLanguageServerDocumentLifecycleIdentityRef?: MutableRefObject<
    ((rootPath: string, path: string) => number | null) | undefined
  >;
  requestLanguageServerDocumentLeaseRef?: MutableRefObject<
    | ((
        rootPath: string,
        path: string,
      ) => Promise<LanguageServerMonacoDocumentRequestLease | null>)
    | undefined
  >;
  isLanguageServerDocumentRequestLeaseCurrentRef?: MutableRefObject<
    | ((lease: LanguageServerMonacoDocumentRequestLease) => boolean)
    | undefined
  >;
  isLanguageServerDocumentSyncedRef: MutableRefObject<
    ((path: string) => boolean) | undefined
  >;
  largeSmartDocumentPolicyRef: MutableRefObject<LargeSmartDocumentPolicy>;
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
  templateLanguageProvidersRef: MutableRefObject<
    TemplateLanguageProviderRegistry
  >;
  userSnippetsRef: MutableRefObject<readonly UserSnippet[]>;
}

export function createEditorSurfaceLanguageProviderOptions({
  dependencies,
  refs,
}: {
  dependencies: EditorSurfaceLanguageProviderOptionsDependencies;
  refs: EditorSurfaceLanguageProviderRegistrationRefs;
}): LanguageServerMonacoProviderContext &
  Required<
    Pick<
      LatteCrossFileBlockMonacoContext,
      "listWorkspaceTemplateFiles" | "readTemplateFileContent"
    >
  > {
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
    clearLanguageServerDiagnosticsForPathRef,
    errorReporterRef,
    flushPendingRef,
    getLanguageServerDocumentLifecycleIdentityRef,
    requestLanguageServerDocumentLeaseRef,
    isLanguageServerDocumentRequestLeaseCurrentRef,
    isLanguageServerDocumentSyncedRef,
    largeSmartDocumentPolicyRef,
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
    templateLanguageProvidersRef,
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
    ...(requestLanguageServerDocumentLeaseRef
      ? {
          requestDocumentLease: (rootPath: string, path: string) =>
            requestLanguageServerDocumentLeaseRef.current?.(rootPath, path) ??
            Promise.resolve(null),
        }
      : {}),
    ...(isLanguageServerDocumentRequestLeaseCurrentRef
      ? {
          isDocumentLeaseCurrent: (
            lease: LanguageServerMonacoDocumentRequestLease,
          ) =>
            Boolean(
              isLanguageServerDocumentRequestLeaseCurrentRef.current?.(lease),
            ),
        }
      : {}),
    ...(getLanguageServerDocumentLifecycleIdentityRef
      ? {
          getDocumentLifecycleIdentity: (rootPath: string, path: string) =>
            getLanguageServerDocumentLifecycleIdentityRef.current?.(
              rootPath,
              path,
            ) ?? null,
        }
      : {}),
    getActiveDocument: () => activeDocumentRef.current,
    getDocumentForModel: (model: import("monaco-editor").editor.ITextModel) =>
      resolveDocumentForModelRef?.current(model) ?? activeDocumentRef.current,
    getLargeSmartDocumentPolicy: () => largeSmartDocumentPolicyRef.current,
    getRuntimeStatus: () => runtimeStatusRef.current,
    getTemplateLanguageProviders: () => templateLanguageProvidersRef.current,
    getUserSnippets: () => userSnippetsRef.current,
    getWorkspaceRoot: () => workspaceRoot,
    getWorkspaceIdentityDescriptor: () => workspaceIdentityDescriptor ?? null,
    isDocumentSynced: (rootPath, path) =>
      workspaceRootKeysEqual(rootPath, workspaceRoot) &&
      Boolean(isLanguageServerDocumentSyncedRef.current?.(path)),
    isPhpInlayHintsEnabled: () => phpInlayHintsEnabledRef.current,
    limitNavigationResultsToOpenModels: true,
    listWorkspaceTemplateFiles: (rootPath) =>
      listWorkspaceLatteTemplateFiles(
        rootPath,
        workspaceRoot,
        workspaceIdentityDescriptor ?? null,
      ),
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
    readTemplateFileContent: (path) =>
      readWorkspaceTemplateFileContent(
        path,
        workspaceRoot,
        workspaceIdentityDescriptor ?? null,
      ),
    recordCompletionLatency: (durationMs, rootPath) =>
      recordCompletionLatencyRef.current?.(durationMs, rootPath),
    refreshGateway,
    reportError: (error) => errorReporterRef.current(error),
    workspaceEditGateway,
  };
}

async function readWorkspaceTemplateFileContent(
  path: string,
  workspaceRoot: string | null,
  descriptor: WorkspaceIdentityDescriptor | null,
): Promise<string | null> {
  if (!isWorkspaceContainedPath(path, workspaceRoot, descriptor)) {
    return null;
  }

  try {
    return await workspaceTemplateFileGateway(descriptor).readTextFile(path);
  } catch {
    return null;
  }
}

const WORKSPACE_TEMPLATE_FILE_LIMIT = 2001;
const WORKSPACE_TEMPLATE_SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  "vendor",
]);
const WORKSPACE_TEMPLATE_EXTENSION = ".latte";

async function listWorkspaceLatteTemplateFiles(
  rootPath: string,
  workspaceRoot: string | null,
  descriptor: WorkspaceIdentityDescriptor | null,
): Promise<string[] | null> {
  if (!isWorkspaceContainedPath(rootPath, workspaceRoot, descriptor)) {
    return null;
  }

  const gateway = workspaceTemplateFileGateway(descriptor);
  const collected: string[] = [];
  const pendingDirectories = [rootPath];

  for (let index = 0; index < pendingDirectories.length; index += 1) {
    const entries = await readWorkspaceDirectoryEntries(
      gateway,
      pendingDirectories[index],
    );

    if (entries === null) {
      return null;
    }

    for (const entry of entries) {
      if (entry.kind === "directory") {
        queueWorkspaceTemplateDirectory(pendingDirectories, entry);
        continue;
      }

      if (!entry.name.endsWith(WORKSPACE_TEMPLATE_EXTENSION)) {
        continue;
      }

      collected.push(entry.path);

      if (collected.length >= WORKSPACE_TEMPLATE_FILE_LIMIT) {
        return collected;
      }
    }
  }

  return collected;
}

async function readWorkspaceDirectoryEntries(
  gateway: TauriWorkspaceGateway,
  directory: string,
): Promise<FileEntry[] | null> {
  try {
    return await gateway.readDirectory(directory);
  } catch {
    return null;
  }
}

function queueWorkspaceTemplateDirectory(
  pendingDirectories: string[],
  entry: FileEntry,
): void {
  if (isSkippedWorkspaceTemplateDirectory(entry.name)) {
    return;
  }

  pendingDirectories.push(entry.path);
}

function isSkippedWorkspaceTemplateDirectory(name: string): boolean {
  if (name.startsWith(".")) {
    return true;
  }

  return WORKSPACE_TEMPLATE_SKIPPED_DIRECTORIES.has(name);
}

function isWorkspaceContainedPath(
  path: string,
  workspaceRoot: string | null,
  descriptor: WorkspaceIdentityDescriptor | null,
): boolean {
  if (descriptor) {
    return workspaceRelativePathForDescriptor(descriptor, path) !== null;
  }

  if (!workspaceRoot) {
    return false;
  }

  const root = createWorkspaceRootFromPath(workspaceRoot);

  if (!root.ok) {
    return false;
  }

  return parseWorkspacePath(root.value, path).ok;
}

function workspaceTemplateFileGateway(
  descriptor: WorkspaceIdentityDescriptor | null,
): TauriWorkspaceGateway {
  if (!descriptor) {
    return new TauriWorkspaceGateway();
  }

  return new TauriWorkspaceGateway({
    descriptorForPath: () => descriptor,
  });
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
