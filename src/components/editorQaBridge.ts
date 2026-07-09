import type * as Monaco from "monaco-editor";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import {
  orderPhpMemberCompletionsByCategory,
  type PhpMethodCompletion,
} from "../domain/phpMethodCompletions";
import type { EditorDocument } from "../domain/workspace";
import type {
  BladeCompletion,
  LatteCompletion,
  NeonCompletion,
} from "./templateLanguageMonacoTypes";
import { modelPath } from "./phpMonacoDocumentContext";

type MonacoEditor = Monaco.editor.IStandaloneCodeEditor;
type MonacoPosition = Monaco.Position;

export interface EditorQaCompletionItem {
  detail?: string;
  insertText: string;
  kind: string;
  label: string;
}

export interface EditorQaBridge {
  getActiveFile(): string | null;
  getWorkspaceRoot(): string | null;
  /**
   * Deterministic provider-ref completions for QA probes. This intentionally
   * bypasses Monaco's suggestion widget rendering and calls the same
   * framework/provider refs the registered Monaco providers use.
   */
  getProviderCompletionItems(): Promise<EditorQaCompletionItem[]>;
  /** @deprecated Use getProviderCompletionItems for explicit QA semantics. */
  getCompletionItems(): Promise<EditorQaCompletionItem[]>;
  getDiagnostics(): LanguageServerDiagnostic[];
  getPosition(): EditorPosition | null;
  getValue(): string | null;
  openWorkspaceFile(path: string): Promise<boolean>;
  openWorkspaceRoot(path: string): Promise<boolean>;
  setCursor(position: EditorPosition): boolean;
  triggerCompletion(): boolean;
  triggerDefinition(): Promise<boolean>;
  triggerImplementation(): boolean;
}

export interface EditorQaDefinitionRequest {
  canNavigate(): boolean;
}

export interface EditorQaOpenWorkspaceFileRequest {
  canOpen(): boolean;
}

interface EditorQaBridgeDependencies {
  diagnosticsByPath(): Record<string, LanguageServerDiagnostic[]>;
  editor(): MonacoEditor | null;
  getActiveDocument(): EditorDocument | null;
  getWorkspaceRoot(): string | null;
  openWorkspaceFile?(
    path: string,
    request: EditorQaOpenWorkspaceFileRequest,
  ): Promise<boolean>;
  openWorkspaceRoot?(path: string): Promise<boolean>;
  provideBladeDefinition(
    source: string,
    offset: number,
    request: EditorQaDefinitionRequest,
  ): Promise<boolean>;
  provideBladeCompletions(
    source: string,
    position: MonacoPosition,
  ): Promise<BladeCompletion[]>;
  provideLatteDefinition(
    source: string,
    offset: number,
    request: EditorQaDefinitionRequest,
  ): Promise<boolean>;
  provideLatteCompletions(
    source: string,
    position: MonacoPosition,
  ): Promise<LatteCompletion[]>;
  provideNeonDefinition(
    source: string,
    offset: number,
    request: EditorQaDefinitionRequest,
  ): Promise<boolean>;
  provideNeonCompletions(
    source: string,
    position: MonacoPosition,
  ): Promise<NeonCompletion[]>;
  providePhpFrameworkDefinition(
    source: string,
    offset: number,
    request: EditorQaDefinitionRequest,
  ): Promise<boolean>;
  providePhpMethodCompletions(
    source: string,
    position: EditorPosition,
  ): Promise<PhpMethodCompletion[]>;
  providePhpPresenterLinkDefinition(
    source: string,
    offset: number,
    request: EditorQaDefinitionRequest,
  ): Promise<boolean>;
}

declare global {
  interface Window {
    __codevoQa?: EditorQaBridge;
  }
}

interface EditorQaBridgeEnvironment {
  DEV?: boolean;
  VITE_CODEVO_QA_BRIDGE?: string;
}

export function editorQaBridgeEnabled(
  environment: EditorQaBridgeEnvironment = import.meta.env,
  storage: Pick<Storage, "getItem"> | null | undefined = window.localStorage,
): boolean {
  // The localStorage escape hatch is intentionally DEV-only. Production builds
  // must never expose window.__codevoQa even if a user has the key set.
  if (!environment.DEV) {
    return false;
  }

  if (environment.VITE_CODEVO_QA_BRIDGE === "1") {
    return true;
  }

  try {
    return storage?.getItem("codevo.qaBridge") === "1";
  } catch {
    return false;
  }
}

export function installEditorQaBridge(
  dependencies: EditorQaBridgeDependencies,
): () => void {
  const bridge = createEditorQaBridge(dependencies);
  window.__codevoQa = bridge;

  return () => {
    if (window.__codevoQa === bridge) {
      delete window.__codevoQa;
    }
  };
}

function createEditorQaBridge(
  dependencies: EditorQaBridgeDependencies,
): EditorQaBridge {
  return {
    getActiveFile: () => currentPath(dependencies),
    getCompletionItems: () => providerCompletionItems(dependencies),
    getDiagnostics: () => diagnostics(dependencies),
    getPosition: () => currentPosition(dependencies),
    getProviderCompletionItems: () => providerCompletionItems(dependencies),
    getValue: () => currentModel(dependencies)?.getValue() ?? null,
    getWorkspaceRoot: () => dependencies.getWorkspaceRoot(),
    openWorkspaceFile: (path) => openWorkspaceFile(dependencies, path),
    openWorkspaceRoot: (path) => openWorkspaceRoot(dependencies, path),
    setCursor: (position) => setCursor(dependencies, position),
    triggerCompletion: () =>
      triggerEditorAction(dependencies, "codevo.qa", "editor.action.triggerSuggest"),
    triggerDefinition: () => triggerDefinition(dependencies),
    triggerImplementation: () =>
      triggerEditorAction(
        dependencies,
        "codevo.qa",
        "editor.action.goToImplementation",
      ),
  };
}

async function openWorkspaceFile(
  dependencies: EditorQaBridgeDependencies,
  path: string,
): Promise<boolean> {
  const snapshot = currentOpenWorkspaceSnapshot(dependencies);
  const root = snapshot?.root ?? null;
  const requestedPath = workspacePathInRoot(path, root);

  if (!snapshot || !root || !requestedPath || !dependencies.openWorkspaceFile) {
    return false;
  }

  let requestStale = false;
  const request = {
    canOpen: () => {
      const current = isOpenWorkspaceSnapshotCurrent(dependencies, snapshot);

      if (!current) {
        requestStale = true;
      }

      return current;
    },
  };

  if (!request.canOpen()) {
    return false;
  }

  const opened = await dependencies.openWorkspaceFile(requestedPath, request);

  if (
    !opened ||
    requestStale ||
    !workspaceRootKeysStillEqual(dependencies, root)
  ) {
    return false;
  }

  return currentPath(dependencies) === requestedPath;
}

async function openWorkspaceRoot(
  dependencies: EditorQaBridgeDependencies,
  path: string,
): Promise<boolean> {
  const requestedPath = normalizeWorkspacePath(path);

  if (!requestedPath || !dependencies.openWorkspaceRoot) {
    return false;
  }

  await dependencies.openWorkspaceRoot(requestedPath);

  return workspaceRootKeysStillEqual(dependencies, requestedPath);
}

async function providerCompletionItems(
  dependencies: EditorQaBridgeDependencies,
): Promise<EditorQaCompletionItem[]> {
  const snapshot = currentSnapshot(dependencies);
  const document = snapshot?.document ?? null;
  const model = currentModel(dependencies);
  const position = currentPosition(dependencies);

  if (!snapshot || !document || !model || !position) {
    return [];
  }

  const source = model.getValue();

  if (document.language === "php") {
    const completions = await dependencies.providePhpMethodCompletions(
      source,
      position,
    );

    if (!isSnapshotCurrent(dependencies, snapshot)) {
      return [];
    }

    return orderPhpMemberCompletionsByCategory(completions).map(
      phpCompletionItem,
    );
  }

  if (document.language === "blade") {
    const completions = await dependencies.provideBladeCompletions(
      source,
      position,
    );

    if (!isSnapshotCurrent(dependencies, snapshot)) {
      return [];
    }

    return completions.map(templateCompletionItem);
  }

  if (document.language === "latte") {
    const completions = await dependencies.provideLatteCompletions(
      source,
      position,
    );

    if (!isSnapshotCurrent(dependencies, snapshot)) {
      return [];
    }

    return completions.map(templateCompletionItem);
  }

  if (document.language === "neon") {
    const completions = await dependencies.provideNeonCompletions(
      source,
      position,
    );

    if (!isSnapshotCurrent(dependencies, snapshot)) {
      return [];
    }

    return completions.map(templateCompletionItem);
  }

  return [];
}

async function triggerDefinition(
  dependencies: EditorQaBridgeDependencies,
): Promise<boolean> {
  const snapshot = currentSnapshot(dependencies);
  const document = snapshot?.document ?? null;
  const model = currentModel(dependencies);
  const position = currentPosition(dependencies);

  if (!snapshot || !document || !model || !position) {
    return false;
  }

  const source = model.getValue();
  const offset = offsetAtPosition(model, source, position);
  let requestStale = false;
  const request = {
    canNavigate: () => {
      const current = isSnapshotCurrent(dependencies, snapshot);

      if (!current) {
        requestStale = true;
      }

      return current;
    },
  };

  if (document.language === "php") {
    const presenterHandled =
      await dependencies.providePhpPresenterLinkDefinition(
        source,
        offset,
        request,
      );

    if (requestStale || !isSnapshotCurrent(dependencies, snapshot)) {
      return false;
    }

    if (presenterHandled) {
      return true;
    }

    const frameworkHandled = await dependencies.providePhpFrameworkDefinition(
      source,
      offset,
      request,
    );

    if (requestStale || !isSnapshotCurrent(dependencies, snapshot)) {
      return false;
    }

    if (frameworkHandled) {
      return true;
    }
  }

  if (document.language === "blade") {
    const handled = await dependencies.provideBladeDefinition(
      source,
      offset,
      request,
    );

    if (requestStale || !isSnapshotCurrent(dependencies, snapshot)) {
      return false;
    }

    if (handled) {
      return true;
    }
  }

  if (document.language === "latte") {
    const handled = await dependencies.provideLatteDefinition(
      source,
      offset,
      request,
    );

    if (requestStale || !isSnapshotCurrent(dependencies, snapshot)) {
      return false;
    }

    if (handled) {
      return true;
    }
  }

  if (document.language === "neon") {
    const handled = await dependencies.provideNeonDefinition(
      source,
      offset,
      request,
    );

    if (requestStale || !isSnapshotCurrent(dependencies, snapshot)) {
      return false;
    }

    if (handled) {
      return true;
    }
  }

  if (requestStale || !isSnapshotCurrent(dependencies, snapshot)) {
    return false;
  }

  return triggerEditorAction(
    dependencies,
    "codevo.qa",
    "editor.action.revealDefinition",
  );
}

function setCursor(
  dependencies: EditorQaBridgeDependencies,
  position: EditorPosition,
): boolean {
  const editor = dependencies.editor();
  const model = currentModel(dependencies);

  if (!editor || !model) {
    return false;
  }

  editor.focus();
  editor.setPosition(position);
  editor.revealPositionInCenter(position);

  return true;
}

function triggerEditorAction(
  dependencies: EditorQaBridgeDependencies,
  source: string,
  action: string,
): boolean {
  const editor = dependencies.editor();

  if (!editor?.getModel()) {
    return false;
  }

  editor.focus();
  editor.trigger(source, action, {});

  return true;
}

function diagnostics(
  dependencies: EditorQaBridgeDependencies,
): LanguageServerDiagnostic[] {
  const path = currentPath(dependencies);

  if (!path) {
    return [];
  }

  return dependencies.diagnosticsByPath()[path] ?? [];
}

function workspacePathInRoot(
  path: string,
  workspaceRoot: string | null,
): string | null {
  if (!workspaceRoot) {
    return null;
  }

  const normalizedPath = normalizeWorkspacePath(path);
  const normalizedRoot = normalizeWorkspacePath(workspaceRoot);

  if (!normalizedPath || !normalizedRoot) {
    return null;
  }

  if (normalizedPath === normalizedRoot) {
    return normalizedPath;
  }

  const rootPrefix = normalizedRoot.endsWith("/")
    ? normalizedRoot
    : `${normalizedRoot}/`;

  if (!normalizedPath.startsWith(rootPrefix)) {
    return null;
  }

  return normalizedPath;
}

function normalizeWorkspacePath(path: string): string | null {
  const trimmedPath = path.trim();

  if (!trimmedPath || trimmedPath.includes("\0")) {
    return null;
  }

  const normalizedPath = trimmedPath
    .split("\\")
    .join("/")
    .replace(/\/+/g, "/");
  const segments: string[] = [];

  for (const segment of normalizedPath.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      const previous = segments[segments.length - 1];

      if (!previous || previous.endsWith(":")) {
        return null;
      }

      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  if (normalizedPath.startsWith("/")) {
    return `/${segments.join("/")}`;
  }

  if (/^[A-Za-z]:$/.test(segments[0] ?? "")) {
    return segments.join("/");
  }

  return null;
}

function workspaceRootKeysStillEqual(
  dependencies: EditorQaBridgeDependencies,
  root: string,
): boolean {
  return (
    normalizeWorkspacePath(dependencies.getWorkspaceRoot() ?? "") ===
    normalizeWorkspacePath(root)
  );
}

function currentPosition(
  dependencies: EditorQaBridgeDependencies,
): MonacoPosition | null {
  return dependencies.editor()?.getPosition() ?? null;
}

function currentModel(
  dependencies: EditorQaBridgeDependencies,
): Monaco.editor.ITextModel | null {
  const document = dependencies.getActiveDocument();
  const model = dependencies.editor()?.getModel() ?? null;

  if (!document || !model || modelPath(model) !== document.path) {
    return null;
  }

  return model;
}

function currentPath(dependencies: EditorQaBridgeDependencies): string | null {
  if (!currentModel(dependencies)) {
    return null;
  }

  return dependencies.getActiveDocument()?.path ?? null;
}

interface EditorQaSnapshot {
  document: EditorDocument;
  model: Monaco.editor.ITextModel;
  path: string;
  root: string | null;
  version: number | null;
}

interface EditorQaOpenWorkspaceSnapshot {
  documentPath: string | null;
  model: Monaco.editor.ITextModel | null;
  root: string;
  version: number | null;
}

function currentOpenWorkspaceSnapshot(
  dependencies: EditorQaBridgeDependencies,
): EditorQaOpenWorkspaceSnapshot | null {
  const root = dependencies.getWorkspaceRoot();
  const document = dependencies.getActiveDocument();
  const model = dependencies.editor()?.getModel() ?? null;

  if (!root) {
    return null;
  }

  if (document && (!model || modelPath(model) !== document.path)) {
    return null;
  }

  return {
    documentPath: document?.path ?? null,
    model,
    root,
    version: model ? modelVersion(model) : null,
  };
}

function currentSnapshot(
  dependencies: EditorQaBridgeDependencies,
): EditorQaSnapshot | null {
  const document = dependencies.getActiveDocument();
  const model = currentModel(dependencies);

  if (!document || !model) {
    return null;
  }

  return {
    document,
    model,
    path: document.path,
    root: dependencies.getWorkspaceRoot(),
    version: modelVersion(model),
  };
}

function isSnapshotCurrent(
  dependencies: EditorQaBridgeDependencies,
  snapshot: EditorQaSnapshot,
): boolean {
  const document = dependencies.getActiveDocument();
  const model = currentModel(dependencies);

  if (!document || !model) {
    return false;
  }

  if (document.path !== snapshot.path) {
    return false;
  }

  if (dependencies.getWorkspaceRoot() !== snapshot.root) {
    return false;
  }

  if (model !== snapshot.model) {
    return false;
  }

  return modelVersion(model) === snapshot.version;
}

function isOpenWorkspaceSnapshotCurrent(
  dependencies: EditorQaBridgeDependencies,
  snapshot: EditorQaOpenWorkspaceSnapshot,
): boolean {
  const document = dependencies.getActiveDocument();
  const model = dependencies.editor()?.getModel() ?? null;

  if (!workspaceRootKeysStillEqual(dependencies, snapshot.root)) {
    return false;
  }

  if ((document?.path ?? null) !== snapshot.documentPath) {
    return false;
  }

  if (document && (!model || modelPath(model) !== document.path)) {
    return false;
  }

  if (model !== snapshot.model) {
    return false;
  }

  return (model ? modelVersion(model) : null) === snapshot.version;
}

function modelVersion(model: Monaco.editor.ITextModel): number | null {
  const versionProvider = (
    model as Monaco.editor.ITextModel & {
      getVersionId?: () => number;
    }
  ).getVersionId;

  return versionProvider?.() ?? null;
}

function offsetAtPosition(
  model: Monaco.editor.ITextModel,
  source: string,
  position: EditorPosition,
): number {
  const offsetProvider = (
    model as Monaco.editor.ITextModel & {
      getOffsetAt?: (position: EditorPosition) => number;
    }
  ).getOffsetAt;

  if (offsetProvider) {
    return offsetProvider(position);
  }

  const lines = source.split("\n");
  const previousLines = lines.slice(0, Math.max(0, position.lineNumber - 1));
  const previousLength = previousLines.reduce(
    (length, line) => length + line.length + 1,
    0,
  );

  return previousLength + Math.max(0, position.column - 1);
}

function phpCompletionItem(item: PhpMethodCompletion): EditorQaCompletionItem {
  return {
    detail: item.returnType ?? undefined,
    insertText: item.insertText ?? item.name,
    kind: item.kind ?? "method",
    label: item.name,
  };
}

function templateCompletionItem(
  item: BladeCompletion | LatteCompletion | NeonCompletion,
): EditorQaCompletionItem {
  return {
    detail: item.detail,
    insertText: item.insertText,
    kind: item.kind,
    label: item.label,
  };
}
