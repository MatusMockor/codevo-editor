import type * as Monaco from "monaco-editor";
import { useCallback, useEffect, useRef } from "react";
import {
  isLargeSmartDocumentContent,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import {
  pathFromLanguageServerUri,
  type LanguageServerLocation,
} from "../domain/languageServerFeatures";
import { createWorkspaceRootFromPath, parseWorkspacePath } from "../domain/workspacePath";
import { readBoundedJavaScriptTypeScriptNavigationModel } from "./editorSurfaceLanguageProviderOptions";
import { toWorkspaceMonacoUri, type WorkspaceIdentityDescriptor } from "./phpMonacoDocumentContext";
import { monacoModelRegistry, type MonacoModelLease } from "./monacoModelRegistry";

type Disposable = Monaco.IDisposable;
type MonacoEvent<T> = (
  listener: (event: T) => unknown,
  thisArgs?: unknown,
  disposables?: Disposable[],
) => Disposable;

export interface JavaScriptTypeScriptMonacoEventEmitter<T> {
  dispose(): void;
  event: MonacoEvent<T>;
  fire(event: T): void;
}

type MonacoWorkspaceSymbol = {
  containerName?: string;
  kind: Monaco.languages.SymbolKind;
  location: Monaco.languages.Location;
  name: string;
};

type MonacoWorkspaceSymbolProvider = {
  provideWorkspaceSymbols(
    query: string,
    token?: Monaco.CancellationToken,
  ): Promise<MonacoWorkspaceSymbol[]>;
};

type MonacoWorkspaceSymbolRegistry = {
  registerWorkspaceSymbolProvider?(provider: MonacoWorkspaceSymbolProvider): Disposable;
};

interface PeekWidget {
  onDidClose(listener: () => void): Disposable;
}

interface ReferencesController {
  _widget?: PeekWidget;
  dispose(): void;
  toggleWidget(...args: unknown[]): unknown;
}

interface DefinitionOpenAuthority {
  readonly range: LanguageServerLocation["range"];
  readonly resource: string;
}

export interface JavaScriptTypeScriptTransientNavigationModels {
  dispose(): void;
  modelCount(): number;
  prepare(
    locations: readonly LanguageServerLocation[],
    isCurrent: () => boolean,
    feature: JavaScriptTypeScriptNavigationFeature,
  ): Promise<readonly JavaScriptTypeScriptPreparedNavigationTarget[]>;
}

export interface JavaScriptTypeScriptPreparedNavigationTarget {
  readonly location: LanguageServerLocation;
  readonly resource?: Monaco.Uri;
}

export type JavaScriptTypeScriptNavigationFeature =
  "declaration" | "definition" | "implementation" | "references" | "typeDefinition";

export const MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS = 8;

export async function prepareJavaScriptTypeScriptNavigationModels(
  prepare: JavaScriptTypeScriptTransientNavigationModels["prepare"] | undefined,
  locations: readonly LanguageServerLocation[],
  isCurrent: () => boolean,
  feature: JavaScriptTypeScriptNavigationFeature,
): Promise<readonly JavaScriptTypeScriptPreparedNavigationTarget[] | null> {
  if (!isCurrent()) {
    return null;
  }

  const preparedLocations = await prepare?.(locations, isCurrent, feature);
  if (!isCurrent()) {
    return null;
  }
  return (
    preparedLocations ??
    locations.map((location) => ({
      location,
    }))
  );
}

export function javaScriptTypeScriptDefinitionGesture(
  editor: Monaco.editor.IStandaloneCodeEditor | null,
): { gotoDefinition?: (...args: unknown[]) => unknown } | null {
  if (!editor) {
    return null;
  }

  return editor.getContribution("editor.contrib.gotodefinitionatposition") as {
    gotoDefinition?: (...args: unknown[]) => unknown;
  } | null;
}

export function disableJavaScriptTypeScriptDefinitionGesture(gesture: {
  gotoDefinition?: (...args: unknown[]) => unknown;
}): void {
  gesture.gotoDefinition = () => Promise.resolve();
}

export function languageServerUriToMonacoUri(
  monaco: typeof Monaco,
  rootPath: string | undefined,
  uri: string,
): unknown {
  const path = pathFromLanguageServerUri(uri);

  if (!path) {
    return uri;
  }

  if (!rootPath) {
    return monaco.Uri.file(path);
  }

  const existingModel = monacoModelRegistry(monaco).modelForPath(rootPath, path);
  return existingModel?.uri ?? toWorkspaceMonacoUri(monaco, rootPath, path) ?? uri;
}

export function toMonacoPositionLike(position: unknown): unknown {
  if (position && typeof position === "object" && "line" in position && "character" in position) {
    const value = position as { character: unknown; line: unknown };

    if (typeof value.line === "number" && typeof value.character === "number") {
      return {
        column: value.character + 1,
        lineNumber: value.line + 1,
      };
    }
  }

  return position;
}

export function useJavaScriptTypeScriptTransientNavigationModels({
  descriptor,
  editor,
  monaco,
  openDefinition,
  policy,
  workspaceRoot,
}: {
  descriptor: WorkspaceIdentityDescriptor | null;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  monaco: typeof Monaco | null;
  openDefinition(): void;
  policy: LargeSmartDocumentPolicy;
  workspaceRoot: string | null;
}): JavaScriptTypeScriptTransientNavigationModels["prepare"] {
  const readContextRef = useRef({ descriptor, openDefinition, policy, workspaceRoot });
  const controllerRef = useRef<JavaScriptTypeScriptTransientNavigationModels | null>(null);
  readContextRef.current = { descriptor, openDefinition, policy, workspaceRoot };

  useEffect(() => {
    if (!editor || !monaco || !workspaceRoot) {
      return;
    }

    const controller = createJavaScriptTypeScriptTransientNavigationModels({
      editor,
      monaco,
      openDefinition: () => readContextRef.current.openDefinition(),
      readFile: (path) => {
        const context = readContextRef.current;

        if (!context.workspaceRoot) {
          return Promise.resolve(null);
        }

        const openUri = toWorkspaceMonacoUri(monaco, context.workspaceRoot, path);
        const openContent = openUri ? monaco.editor.getModel(openUri)?.getValue() : undefined;

        if (openContent !== undefined) {
          return Promise.resolve(
            isLargeSmartDocumentContent(openContent, context.policy) ? null : openContent,
          );
        }

        return readBoundedJavaScriptTypeScriptNavigationModel(
          path,
          context.workspaceRoot,
          context.descriptor,
          context.policy,
        );
      },
      workspaceRoot,
    });
    controllerRef.current = controller;

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [editor, monaco, workspaceRoot]);

  return useCallback(
    (locations, isCurrent, feature) =>
      controllerRef.current?.prepare(locations, isCurrent, feature) ??
      Promise.resolve<readonly JavaScriptTypeScriptPreparedNavigationTarget[]>(
        locations.map((location) => ({ location })),
      ),
    [],
  );
}

export function createJavaScriptTypeScriptTransientNavigationModels({
  editor,
  monaco,
  openDefinition,
  readFile,
  workspaceRoot,
}: {
  editor: Pick<Monaco.editor.ICodeEditor, "getContribution">;
  monaco: typeof Monaco;
  openDefinition?(): void;
  readFile(path: string): Promise<string | null>;
  workspaceRoot: string;
}): JavaScriptTypeScriptTransientNavigationModels {
  const root = createWorkspaceRootFromPath(workspaceRoot);
  const modelRegistry = monacoModelRegistry(monaco);
  const models = new Map<string, Monaco.editor.ITextModel>();
  const modelLeases = new Map<string, MonacoModelLease>();
  const modelDisposeSubscriptions = new Map<string, Disposable>();
  const pendingPeekModels = new Set<string>();
  const peekModels = new Set<string>();
  const peekSubscriptions = new Set<Disposable>();
  const adoptedTransientModels = new WeakSet<Monaco.editor.ITextModel>();
  let definitionOpenAuthority: DefinitionOpenAuthority | null = null;
  let definitionOpenAuthorityExpiry: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const referencesController = editor.getContribution<ReferencesController>(
    "editor.contrib.referencesController",
  );
  const originalToggleWidget =
    typeof referencesController?.toggleWidget === "function"
      ? referencesController.toggleWidget.bind(referencesController)
      : null;
  const editorOpener =
    openDefinition && typeof monaco.editor.registerEditorOpener === "function"
      ? monaco.editor.registerEditorOpener({
          openCodeEditor: (source, resource, selectionOrPosition) => {
            const authority = definitionOpenAuthority;
            if (
              source !== editor ||
              !authority ||
              authority.resource !== resource.toString() ||
              !selectionMatchesLanguageServerRange(selectionOrPosition, authority.range)
            ) {
              return false;
            }

            const adoptedModel = modelRegistry.modelForUri(resource);
            if (adoptedModel && modelRegistry.isTransientModel(adoptedModel)) {
              adoptedTransientModels.add(adoptedModel);
            }
            clearDefinitionOpenAuthority();
            openDefinition();
            return true;
          },
        })
      : null;

  if (referencesController && originalToggleWidget) {
    referencesController.toggleWidget = (...args: unknown[]) => {
      const result = originalToggleWidget(...args);
      const widget = referencesController._widget;

      if (pendingPeekModels.size === 0) {
        return result;
      }

      const ownedKeys = [...pendingPeekModels];
      pendingPeekModels.clear();
      if (!widget) {
        ownedKeys.forEach((key) => {
          peekModels.delete(key);
          disposeModel(key);
        });
        return result;
      }

      ownedKeys.forEach((key) => peekModels.add(key));
      const subscription = widget.onDidClose(() => {
        subscription.dispose();
        peekSubscriptions.delete(subscription);
        ownedKeys.forEach((key) => {
          if (pendingPeekModels.has(key) || !peekModels.delete(key)) {
            return;
          }
          disposeModel(key);
        });
      });
      peekSubscriptions.add(subscription);
      return result;
    };
  }

  function disposeModel(key: string): void {
    const model = models.get(key);

    if (!model) {
      return;
    }

    releaseModel(key, model, true);
  }

  function disposeReleasedTransientModel(
    model: Monaco.editor.ITextModel,
    wasFinalLease: boolean,
  ): void {
    if (!wasFinalLease || model.isDisposed?.()) {
      return;
    }
    if (adoptedTransientModels.has(model)) {
      return;
    }
    if (modelRegistry.isRuntimeRetained(model)) {
      return;
    }
    if (!model.isAttachedToEditor?.()) {
      model.dispose();
      return;
    }

    queueMicrotask(() => {
      if (
        !model.isDisposed?.() &&
        modelRegistry.isTransientModel(model) &&
        !modelRegistry.hasActiveLease(model) &&
        !modelRegistry.isRuntimeRetained(model) &&
        !model.isAttachedToEditor?.()
      ) {
        model.dispose();
      }
    });
  }

  function releaseModel(
    key: string,
    model: Monaco.editor.ITextModel,
    disposeWhenReleased: boolean,
  ): void {
    if (models.get(key) !== model) {
      return;
    }

    models.delete(key);
    pendingPeekModels.delete(key);
    peekModels.delete(key);
    const wasFinalLease = modelLeases.get(key)?.release() ?? false;
    modelLeases.delete(key);
    modelDisposeSubscriptions.get(key)?.dispose();
    modelDisposeSubscriptions.delete(key);
    if (disposeWhenReleased) {
      disposeReleasedTransientModel(model, wasFinalLease);
    }
  }

  function retainTransientModel(
    key: string,
    model: Monaco.editor.ITextModel,
    lease: MonacoModelLease,
  ): void {
    models.set(key, model);
    modelLeases.set(key, lease);
    modelDisposeSubscriptions.set(
      key,
      model.onWillDispose(() => {
        releaseModel(key, model, false);
      }),
    );
  }

  function clearDefinitionOpenAuthority(): void {
    definitionOpenAuthority = null;
    if (definitionOpenAuthorityExpiry !== null) {
      clearTimeout(definitionOpenAuthorityExpiry);
      definitionOpenAuthorityExpiry = null;
    }
  }

  function publishDefinitionOpenAuthority(
    location: LanguageServerLocation,
    preparedResource?: Monaco.Uri,
  ): void {
    clearDefinitionOpenAuthority();
    const path = pathFromLanguageServerUri(location.uri);

    if (!path) {
      return;
    }

    const resource =
      preparedResource ??
      toWorkspaceMonacoUri(monaco, workspaceRoot, path) ??
      monaco.Uri.file(path);
    definitionOpenAuthority = {
      range: location.range,
      resource: resource.toString(),
    };
    definitionOpenAuthorityExpiry = setTimeout(clearDefinitionOpenAuthority, 0);
  }

  function evictAvailableModel(protectedKeys: ReadonlySet<string>): boolean {
    const key = [...models.keys()].find(
      (candidate) => !peekModels.has(candidate) && !protectedKeys.has(candidate),
    );

    if (!key) {
      return false;
    }

    disposeModel(key);
    return true;
  }

  async function prepareLocation(
    location: LanguageServerLocation,
    isCurrent: () => boolean,
    protectedKeys: ReadonlySet<string>,
  ): Promise<Monaco.Uri | null> {
    if (disposed || !root.ok || !isCurrent()) {
      return null;
    }

    const path = pathFromLanguageServerUri(location.uri);

    if (!path) {
      return null;
    }

    const workspacePath = parseWorkspacePath(root.value, path);

    if (!workspacePath.ok) {
      return monaco.Uri.file(path);
    }

    const uri = toWorkspaceMonacoUri(monaco, workspaceRoot, path) ?? monaco.Uri.file(path);
    const key = workspacePath.value.key;
    const cachedModel = models.get(key);

    if (cachedModel) {
      const existingWorkspaceModel = monacoModelRegistry(monaco).modelForPath(workspaceRoot, path, {
        exclude: cachedModel,
      });

      if (existingWorkspaceModel) {
        const resource = existingWorkspaceModel.uri;
        disposeModel(key);
        const lease = modelRegistry.leaseTransientModel(existingWorkspaceModel);
        if (lease) {
          retainTransientModel(key, existingWorkspaceModel, lease);
          pendingPeekModels.add(key);
        }
        return resource;
      }

      if (!disposed && isCurrent() && models.get(key) === cachedModel) {
        pendingPeekModels.add(key);
      }
      return !disposed && isCurrent() ? cachedModel.uri : null;
    }

    const existingWorkspaceModel = monacoModelRegistry(monaco).modelForPath(workspaceRoot, path);
    if (existingWorkspaceModel) {
      const lease = modelRegistry.leaseTransientModel(existingWorkspaceModel);
      if (lease) {
        retainTransientModel(key, existingWorkspaceModel, lease);
        pendingPeekModels.add(key);
      }
      return existingWorkspaceModel.uri;
    }

    const content = await readFile(path);

    if (disposed || content === null || !isCurrent()) {
      return null;
    }
    const modelOpenedDuringRead = monacoModelRegistry(monaco).modelForPath(workspaceRoot, path);
    if (modelOpenedDuringRead) {
      const lease = modelRegistry.leaseTransientModel(modelOpenedDuringRead);
      if (lease) {
        retainTransientModel(key, modelOpenedDuringRead, lease);
        pendingPeekModels.add(key);
      }
      return modelOpenedDuringRead.uri;
    }

    if (
      models.size >= MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS &&
      !evictAvailableModel(protectedKeys)
    ) {
      return null;
    }

    if (disposed || !isCurrent()) {
      return null;
    }

    const model = monaco.editor.createModel(content, undefined, uri);
    const modelLease = modelRegistry.registerTransientModel(model);
    if (!modelLease) {
      model.dispose();
      return null;
    }
    retainTransientModel(key, model, modelLease);
    pendingPeekModels.add(key);
    return model.uri;
  }

  return {
    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      if (referencesController && originalToggleWidget) {
        referencesController.toggleWidget = originalToggleWidget;
      }
      peekSubscriptions.forEach((subscription) => subscription.dispose());
      peekSubscriptions.clear();
      editorOpener?.dispose();
      clearDefinitionOpenAuthority();
      [...models.keys()].forEach(disposeModel);
    },
    modelCount: () => models.size,
    prepare: async (locations, isCurrent, feature) => {
      const uniqueLocations = new Map<string, LanguageServerLocation>();

      for (const location of locations) {
        if (uniqueLocations.size >= MAX_JAVASCRIPT_TYPESCRIPT_TRANSIENT_NAVIGATION_MODELS) {
          break;
        }

        uniqueLocations.set(location.uri, location);
      }

      const protectedKeys = new Set(
        [...uniqueLocations.values()].flatMap((location) => {
          if (!root.ok) {
            return [];
          }
          const path = pathFromLanguageServerUri(location.uri);
          if (!path) {
            return [];
          }
          const workspacePath = parseWorkspacePath(root.value, path);
          return workspacePath.ok ? [workspacePath.value.key] : [];
        }),
      );
      clearDefinitionOpenAuthority();
      const preparationResults = await Promise.all(
        [...uniqueLocations.values()].map(async (location) => {
          try {
            return {
              location,
              resource: await prepareLocation(location, isCurrent, protectedKeys),
            };
          } catch {
            return { location, resource: null };
          }
        }),
      );

      if (!isCurrent()) {
        return [];
      }

      const preparedResources = new Map(
        preparationResults.flatMap(({ location, resource }) =>
          resource ? [[location.uri, resource] as const] : [],
        ),
      );
      const preparedLocations = locations.flatMap((location) => {
        const resource = preparedResources.get(location.uri);
        return resource ? [{ location, resource }] : [];
      });

      if (feature === "definition") {
        const exactLocations = new Map(
          preparedLocations.map((target) => [languageServerLocationKey(target.location), target]),
        );
        if (exactLocations.size === 1) {
          const [target] = exactLocations.values();
          if (target) {
            publishDefinitionOpenAuthority(target.location, target.resource);
          }
        }
      }
      return preparedLocations;
    },
  };
}

function languageServerLocationKey(location: LanguageServerLocation): string {
  const { end, start } = location.range;
  return [location.uri, start.line, start.character, end.line, end.character].join("\u0000");
}

function selectionMatchesLanguageServerRange(
  selectionOrPosition: Monaco.IRange | Monaco.IPosition | undefined,
  range: LanguageServerLocation["range"],
): boolean {
  if (!selectionOrPosition) {
    return false;
  }

  if ("startLineNumber" in selectionOrPosition) {
    return (
      selectionOrPosition.startLineNumber === range.start.line + 1 &&
      selectionOrPosition.startColumn === range.start.character + 1 &&
      selectionOrPosition.endLineNumber === range.end.line + 1 &&
      selectionOrPosition.endColumn === range.end.character + 1
    );
  }

  return (
    selectionOrPosition.lineNumber === range.start.line + 1 &&
    selectionOrPosition.column === range.start.character + 1
  );
}

export interface JavaScriptTypeScriptMonacoProviderBindings {
  readonly codeAction: Monaco.languages.CodeActionProvider;
  readonly codeLens: Monaco.languages.CodeLensProvider;
  readonly completion: Monaco.languages.CompletionItemProvider;
  readonly declaration: Monaco.languages.DeclarationProvider;
  readonly definition: Monaco.languages.DefinitionProvider;
  readonly documentFormatting: Monaco.languages.DocumentFormattingEditProvider;
  readonly documentHighlight: Monaco.languages.DocumentHighlightProvider;
  readonly documentRangeFormatting: Monaco.languages.DocumentRangeFormattingEditProvider;
  readonly documentRangeSemanticTokens: Monaco.languages.DocumentRangeSemanticTokensProvider;
  readonly documentSemanticTokens: Monaco.languages.DocumentSemanticTokensProvider;
  readonly documentSymbol: Monaco.languages.DocumentSymbolProvider;
  readonly foldingRange: Monaco.languages.FoldingRangeProvider;
  readonly hover: Monaco.languages.HoverProvider;
  readonly implementation: Monaco.languages.ImplementationProvider;
  readonly inlayHints: Monaco.languages.InlayHintsProvider;
  readonly linkedEditingRange: Monaco.languages.LinkedEditingRangeProvider;
  readonly links: Monaco.languages.LinkProvider;
  readonly onTypeFormatting: Monaco.languages.OnTypeFormattingEditProvider;
  readonly references: Monaco.languages.ReferenceProvider;
  readonly rename: Monaco.languages.RenameProvider;
  readonly selectionRange: Monaco.languages.SelectionRangeProvider;
  readonly signatureHelp: Monaco.languages.SignatureHelpProvider;
  readonly typeDefinition: Monaco.languages.TypeDefinitionProvider;
  readonly workspaceSymbols: MonacoWorkspaceSymbolProvider;
}

const JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS = [
  "javascript",
  "typescript",
  "javascriptreact",
  "typescriptreact",
  // Vue single-file components use the same tsserver. Without the optional
  // Vue plugin the server returns no result, so registration remains safe.
  "vue",
] as const;

const JAVASCRIPT_TYPESCRIPT_LANGUAGE_ID_SET = new Set<string>(JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS);

const JAVASCRIPT_TYPESCRIPT_CODE_ACTION_KINDS = [
  "quickfix",
  "refactor",
  "refactor.move",
  "source",
  "source.fixAll",
  "source.fixAll.ts",
  "source.addMissingImports.ts",
  "source.organizeImports",
  "source.organizeImports.ts",
  "source.removeUnused.ts",
  "source.removeUnusedImports.ts",
  "source.sortImports.ts",
] as const;

export function isJavaScriptTypeScriptMonacoLanguage(language: string): boolean {
  return JAVASCRIPT_TYPESCRIPT_LANGUAGE_ID_SET.has(language);
}

export function createJavaScriptTypeScriptMonacoEventEmitter<
  T,
>(): JavaScriptTypeScriptMonacoEventEmitter<T> {
  const listeners = new Set<{
    listener: (event: T) => unknown;
    thisArgs?: unknown;
  }>();

  return {
    dispose: () => {
      listeners.clear();
    },
    event: (listener, thisArgs, disposables) => {
      const entry = { listener, thisArgs };
      listeners.add(entry);
      const disposable = {
        dispose: () => {
          listeners.delete(entry);
        },
      };
      disposables?.push(disposable);
      return disposable;
    },
    fire: (event) => {
      for (const entry of Array.from(listeners)) {
        entry.listener.call(entry.thisArgs, event);
      }
    },
  };
}

export function registerJavaScriptTypeScriptMonacoProviderBindings(
  monaco: typeof Monaco,
  providers: JavaScriptTypeScriptMonacoProviderBindings,
): readonly Disposable[] {
  const registry = monaco.languages as Partial<typeof monaco.languages>;
  const disposables: Disposable[] = [];
  const workspaceSymbolRegistry = registry as MonacoWorkspaceSymbolRegistry;

  if (workspaceSymbolRegistry.registerWorkspaceSymbolProvider) {
    disposables.push(
      workspaceSymbolRegistry.registerWorkspaceSymbolProvider(providers.workspaceSymbols),
    );
  }

  for (const language of JAVASCRIPT_TYPESCRIPT_LANGUAGE_IDS) {
    registerLanguageProviders(registry, disposables, language, providers);
  }

  return disposables;
}

function registerLanguageProviders(
  registry: Partial<typeof Monaco.languages>,
  disposables: Disposable[],
  language: string,
  providers: JavaScriptTypeScriptMonacoProviderBindings,
): void {
  registerProvider(
    registry.registerHoverProvider?.bind(registry),
    disposables,
    language,
    providers.hover,
  );
  registerProvider(
    registry.registerCompletionItemProvider?.bind(registry),
    disposables,
    language,
    providers.completion,
  );
  registerProvider(
    registry.registerSignatureHelpProvider?.bind(registry),
    disposables,
    language,
    providers.signatureHelp,
  );
  registerProvider(
    registry.registerDefinitionProvider?.bind(registry),
    disposables,
    language,
    providers.definition,
  );
  registerProvider(
    registry.registerDeclarationProvider?.bind(registry),
    disposables,
    language,
    providers.declaration,
  );
  registerProvider(
    registry.registerImplementationProvider?.bind(registry),
    disposables,
    language,
    providers.implementation,
  );
  registerProvider(
    registry.registerTypeDefinitionProvider?.bind(registry),
    disposables,
    language,
    providers.typeDefinition,
  );
  registerProvider(
    registry.registerReferenceProvider?.bind(registry),
    disposables,
    language,
    providers.references,
  );
  registerProvider(
    registry.registerRenameProvider?.bind(registry),
    disposables,
    language,
    providers.rename,
  );

  if (registry.registerCodeActionProvider) {
    disposables.push(
      registry.registerCodeActionProvider(language, providers.codeAction, {
        providedCodeActionKinds: [...JAVASCRIPT_TYPESCRIPT_CODE_ACTION_KINDS],
      }),
    );
  }

  registerProvider(
    registry.registerCodeLensProvider?.bind(registry),
    disposables,
    language,
    providers.codeLens,
  );
  registerProvider(
    registry.registerDocumentFormattingEditProvider?.bind(registry),
    disposables,
    language,
    providers.documentFormatting,
  );
  registerProvider(
    registry.registerDocumentRangeFormattingEditProvider?.bind(registry),
    disposables,
    language,
    providers.documentRangeFormatting,
  );
  registerProvider(
    registry.registerOnTypeFormattingEditProvider?.bind(registry),
    disposables,
    language,
    providers.onTypeFormatting,
  );
  registerProvider(
    registry.registerInlayHintsProvider?.bind(registry),
    disposables,
    language,
    providers.inlayHints,
  );
  registerProvider(
    registry.registerDocumentHighlightProvider?.bind(registry),
    disposables,
    language,
    providers.documentHighlight,
  );
  registerProvider(
    registry.registerDocumentSymbolProvider?.bind(registry),
    disposables,
    language,
    providers.documentSymbol,
  );
  registerProvider(
    registry.registerLinkProvider?.bind(registry),
    disposables,
    language,
    providers.links,
  );
  registerProvider(
    registry.registerFoldingRangeProvider?.bind(registry),
    disposables,
    language,
    providers.foldingRange,
  );
  registerProvider(
    registry.registerSelectionRangeProvider?.bind(registry),
    disposables,
    language,
    providers.selectionRange,
  );
  registerProvider(
    registry.registerLinkedEditingRangeProvider?.bind(registry),
    disposables,
    language,
    providers.linkedEditingRange,
  );
  registerProvider(
    registry.registerDocumentSemanticTokensProvider?.bind(registry),
    disposables,
    language,
    providers.documentSemanticTokens,
  );
  registerProvider(
    registry.registerDocumentRangeSemanticTokensProvider?.bind(registry),
    disposables,
    language,
    providers.documentRangeSemanticTokens,
  );
}

function registerProvider<T>(
  register: ((languageSelector: string, provider: T) => Disposable) | undefined,
  disposables: Disposable[],
  language: string,
  provider: T,
): void {
  if (register) {
    disposables.push(register(language, provider));
  }
}
