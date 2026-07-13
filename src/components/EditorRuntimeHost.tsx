import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type * as Monaco from "monaco-editor";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import type { EditorGroupFocusRunner } from "../application/editorGroupFocusPort";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  disposeWorkspaceModels,
  registerWorkspaceIdentityDescriptor,
  type WorkspaceIdentityDescriptor,
} from "./phpMonacoDocumentContext";
import {
  disposeUnretainedEditorRuntimeModels,
  reconcileEditorRuntimeMarkers,
} from "./editorRuntimeModels";
import type { EditorRuntimeEditorMembership } from "./editorRuntimeMembership";
import {
  releaseEditorRuntimeWorkspace,
  retainEditorRuntimeWorkspace,
} from "./editorRuntimeWorkspaceLease";
import {
  useEditorSurfaceLanguageProviderRegistration,
  type EditorSurfaceLanguageProviderRegistrationDependencies,
  type EditorSurfaceLanguageProviderRegistrationRefs,
} from "./useEditorSurfaceLanguageProviderRegistration";
import {
  registerJavaScriptTypeScriptLanguageServerMonacoProviders,
  type JavaScriptTypeScriptLanguageServerProviderContext,
} from "./javascriptTypescriptLanguageServerMonacoProviders";
import {
  configureTypescriptJavascriptDefaultsOnce,
  type TypescriptJavascriptDefaultsOptions,
} from "./typescriptJavascriptDefaults";
import { EditorModelContentSyncCoordinator } from "./editorModelContentSyncCoordinator";
import {
  LocalPhpValidationCoordinator,
  type CoordinatedLocalPhpValidation,
  type LocalPhpValidationComputation,
  type LocalPhpValidationRequest,
} from "./localPhpValidationCoordinator";
import { LocalPhpMarkerWriter } from "./localPhpMarkerWriter";
import {
  PhpDocumentSymbolCoordinator,
  type PhpDocumentSymbolRequest,
} from "../application/phpDocumentSymbolCoordinator";
import type { LanguageServerDocumentSymbol } from "../domain/languageServerFeatures";

export interface LocalPhpValidationSnapshot<TSyntax, TInspection> {
  inspectionDiagnostics: TInspection[];
  syntaxDiagnostics: TSyntax[];
}

interface EditorRuntimeSurfaceRouting {
  activeDocumentRef: EditorRuntimeEditorMembership["activeDocumentRef"];
  javaScriptTypeScriptProviderContext: JavaScriptTypeScriptLanguageServerProviderContext;
  providerRefs: EditorSurfaceLanguageProviderRegistrationRefs;
  resolveDocumentForModel: EditorRuntimeEditorMembership["resolveDocumentForModel"];
}

interface EditorRuntimeSurfaceRegistration {
  activePath: string | null;
  diagnosticsByPath: Readonly<
    Record<string, readonly LanguageServerDiagnostic[]>
  >;
  editor: Monaco.editor.IStandaloneCodeEditor | null;
  groupId: string;
  monacoApi: typeof Monaco | null;
  onModelContentChange(content: string): void;
  onMarkerUrisChanged?(uris: readonly Monaco.Uri[]): void;
  providerDependencies: EditorSurfaceLanguageProviderRegistrationDependencies;
  retainPaths: readonly string[];
  routing: EditorRuntimeSurfaceRouting;
  toMarker(diagnostic: LanguageServerDiagnostic): Monaco.editor.IMarkerData;
  typescriptJavascriptDefaults: TypescriptJavascriptDefaultsOptions;
  workspaceIdentityDescriptor: WorkspaceIdentityDescriptor | null;
  workspaceRoot: string | null;
}

interface EditorRuntimeContextValue {
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
  writeLocalPhpMarkers(
    consumerId: string,
    monacoApi: typeof Monaco,
    model: Monaco.editor.ITextModel,
    markers: readonly Monaco.editor.IMarkerData[],
  ): void;
  registerSurface(
    id: string,
    registration: EditorRuntimeSurfaceRegistration,
  ): () => void;
  updateSurface(
    id: string,
    registration: EditorRuntimeSurfaceRegistration,
  ): void;
}

const EditorRuntimeContext = createContext<EditorRuntimeContextValue | null>(null);

export function useEditorRuntimeContext(): EditorRuntimeContextValue | null {
  return useContext(EditorRuntimeContext);
}

export function EditorRuntimeHost({
  children,
  onGroupFocusRunnerChange,
}: {
  children: ReactNode;
  onGroupFocusRunnerChange?: (runner: EditorGroupFocusRunner | null) => void;
}) {
  const registrationsRef = useRef(
    new Map<string, EditorRuntimeSurfaceRegistration>(),
  );
  const [revision, setRevision] = useState(0);
  const admittedWorkspaceRootRef = useRef<string | null>(null);
  const focusedGroupRef = useRef<string | null>(null);
  const activeRegistrationRef = useRef<EditorRuntimeSurfaceRegistration | null>(
    null,
  );
  const runtimeWorkspaceRef = useRef<{
    monacoApi: typeof Monaco;
    root: string;
  } | null>(null);
  const previousDiagnosticsRef = useRef<
    Readonly<Record<string, readonly LanguageServerDiagnostic[]>>
  >({});
  const markedModelsRef = useRef<WeakSet<Monaco.editor.ITextModel>>(
    new WeakSet(),
  );
  const disposedModelsRef = useRef<WeakSet<Monaco.editor.ITextModel>>(
    new WeakSet(),
  );
  const lifecycleGenerationRef = useRef(0);
  const focusRequestGenerationRef = useRef(0);
  const pendingFocusFrameRef = useRef<number | null>(null);
  const workspaceLeaseOwnerRef = useRef(Symbol("editor-runtime-host"));
  const contentSyncCoordinatorRef = useRef<EditorModelContentSyncCoordinator | null>(
    null,
  );
  if (!contentSyncCoordinatorRef.current) {
    contentSyncCoordinatorRef.current = new EditorModelContentSyncCoordinator();
  }
  const localPhpValidationCoordinatorRef = useRef(
    new LocalPhpValidationCoordinator<unknown, unknown>(),
  );
  const localPhpMarkerWriterRef = useRef(new LocalPhpMarkerWriter());
  const phpDocumentSymbolCoordinatorRef = useRef(
    new PhpDocumentSymbolCoordinator(),
  );

  const coordinatePhpDocumentSymbols = useCallback(
    (
      request: PhpDocumentSymbolRequest,
      load: () => Promise<LanguageServerDocumentSymbol[]>,
    ) => phpDocumentSymbolCoordinatorRef.current.coordinate(request, load),
    [],
  );

  const coordinateLocalPhpValidation = useCallback(
    <TSyntax, TInspection>(
      request: LocalPhpValidationRequest,
      compute: () => LocalPhpValidationComputation<
        LocalPhpValidationSnapshot<TSyntax, TInspection>,
        LocalPhpValidationSnapshot<TSyntax, TInspection>
      >,
    ) =>
      localPhpValidationCoordinatorRef.current.coordinate(
        request,
        compute as () => LocalPhpValidationComputation<unknown, unknown>,
      ) as CoordinatedLocalPhpValidation<
        LocalPhpValidationSnapshot<TSyntax, TInspection>,
        LocalPhpValidationSnapshot<TSyntax, TInspection>
      >,
    [],
  );

  const writeLocalPhpMarkers = useCallback(
    (
      consumerId: string,
      monacoApi: typeof Monaco,
      model: Monaco.editor.ITextModel,
      markers: readonly Monaco.editor.IMarkerData[],
    ) => {
      const registration = registrationsRef.current.get(consumerId);
      if (!registration || registration.monacoApi !== monacoApi) {
        return;
      }

      localPhpMarkerWriterRef.current.write(monacoApi, model, markers);
    },
    [],
  );

  const updateSurface = useCallback(
    (id: string, registration: EditorRuntimeSurfaceRegistration) => {
      const current = registrationsRef.current.get(id);
      if (
        !current ||
        !canAdmitRegistration(
          id,
          registration,
          registrationsRef.current,
          admittedWorkspaceRootRef.current,
        )
      ) {
        return;
      }

      // Routing callbacks and refs are mutable by design. Replace them without
      // waking the host unless a model/provider/marker ownership input changed.
      registrationsRef.current.set(id, registration);
      if (activeRegistrationRef.current === current) {
        activeRegistrationRef.current = registration;
      }
      admittedWorkspaceRootRef.current = admittedWorkspaceRoot(
        registrationsRef.current,
      );
      if (registrationsStructurallyEqual(current, registration)) {
        return;
      }

      setRevision((current) => current + 1);
    },
    [],
  );

  const registerSurface = useCallback(
    (id: string, registration: EditorRuntimeSurfaceRegistration) => {
      // The first concrete root owns this host while any accepted surface is
      // mounted. A foreign split is ignored, so it can never become active and
      // dispose or mark models belonging to either workspace.
      if (
        !canAdmitRegistration(
          id,
          registration,
          registrationsRef.current,
          admittedWorkspaceRootRef.current,
        )
      ) {
        return () => undefined;
      }

      registrationsRef.current.set(id, registration);
      admittedWorkspaceRootRef.current = admittedWorkspaceRoot(
        registrationsRef.current,
      );
      setRevision((current) => current + 1);

      return () => {
        const removedRegistration = registrationsRef.current.get(id);
        const removedOwnedRuntime = Boolean(
          removedRegistration &&
            registrationOwnsRuntime(
              removedRegistration,
              admittedWorkspaceRootRef.current,
            ),
        );
        const removed = registrationsRef.current.delete(id);
        if (!removed) {
          return;
        }
        localPhpValidationCoordinatorRef.current.releaseConsumer(id);

        admittedWorkspaceRootRef.current = admittedWorkspaceRoot(
          registrationsRef.current,
        );
        if (removedOwnedRuntime || removedRegistration?.monacoApi) {
          setRevision((current) => current + 1);
        }
      };
    },
    [],
  );

  const focusGroup = useCallback((groupId: string) => {
    const groupIsRegistered = [...registrationsRef.current.values()].some(
      (registration) =>
        registration.groupId === groupId &&
        registrationOwnsRuntime(
          registration,
          admittedWorkspaceRootRef.current,
        ),
    );
    if (!groupIsRegistered || focusedGroupRef.current === groupId) {
      return;
    }

    focusedGroupRef.current = groupId;
    setRevision((current) => current + 1);
  }, []);

  const focusRegisteredEditorGroup = useCallback<EditorGroupFocusRunner>(
    (groupId) => {
      const target = registeredEditorGroup(
        registrationsRef.current,
        groupId,
        admittedWorkspaceRootRef.current,
      );
      if (!target) {
        return false;
      }

      focusGroup(groupId);
      if (pendingFocusFrameRef.current !== null) {
        cancelAnimationFrame(pendingFocusFrameRef.current);
      }
      const generation = ++focusRequestGenerationRef.current;
      const requestedMonacoApi = target.monacoApi;
      const requestedWorkspaceRoot = target.workspaceRoot;
      pendingFocusFrameRef.current = requestAnimationFrame(() => {
        if (focusRequestGenerationRef.current !== generation) {
          return;
        }
        pendingFocusFrameRef.current = null;
        const current = registeredEditorGroup(
          registrationsRef.current,
          groupId,
          admittedWorkspaceRootRef.current,
        );
        if (
          !current ||
          current.monacoApi !== requestedMonacoApi ||
          !workspaceRootKeysEqual(
            current.workspaceRoot,
            requestedWorkspaceRoot,
          )
        ) {
          return;
        }
        current.editor?.focus();
      });
      return true;
    },
    [focusGroup],
  );

  useEffect(() => () => {
    focusRequestGenerationRef.current += 1;
    if (pendingFocusFrameRef.current === null) {
      return;
    }
    cancelAnimationFrame(pendingFocusFrameRef.current);
    pendingFocusFrameRef.current = null;
  }, []);

  useEffect(() => {
    onGroupFocusRunnerChange?.(focusRegisteredEditorGroup);
    return () => onGroupFocusRunnerChange?.(null);
  }, [focusRegisteredEditorGroup, onGroupFocusRunnerChange]);

  const registrations = [...registrationsRef.current.values()];
  const owningRegistrations = registrations.filter(
    (registration) =>
      registrationOwnsRuntime(
        registration,
        admittedWorkspaceRootRef.current,
      ),
  );
  const contentSyncRegistrations = admittedWorkspaceRootRef.current
    ? owningRegistrations
    : registrations;
  const focusedRegistration = owningRegistrations.find(
    (registration) => registration.groupId === focusedGroupRef.current,
  );
  const activeRegistration =
    focusedRegistration ?? owningRegistrations[0] ?? null;
  const configurationRegistration =
    activeRegistration ?? registrations.find(({ monacoApi }) => monacoApi) ?? null;
  activeRegistrationRef.current = activeRegistration;
  useEffect(() => {
    contentSyncCoordinatorRef.current?.update(
      contentSyncRegistrations.map((registration) => ({
        activePath: registration.activePath,
        editor: registration.editor,
        getModel: () => {
          const model = registration.editor?.getModel() ?? null;
          if (!model || !registration.activePath) {
            return null;
          }
          if (!registration.workspaceRoot) {
            return model;
          }
          return registration.routing.resolveDocumentForModel(model)?.path ===
            registration.activePath
            ? model
            : null;
        },
        groupId: registration.groupId,
        onChange: registration.onModelContentChange,
      })),
      focusedGroupRef.current,
    );
  });

  const routedProviderRefs = useMemo(
    () => routedRefs(activeRegistrationRef, registrationsRef, focusedGroupRef),
    [],
  );
  useEditorSurfaceLanguageProviderRegistration({
    dependencies: activeRegistration?.providerDependencies ?? null,
    refs: routedProviderRefs,
  });
  const routedJavaScriptTypeScriptContext = useMemo(
    () =>
      new Proxy({} as JavaScriptTypeScriptLanguageServerProviderContext, {
        get(_target, property) {
          return Reflect.get(
            activeRegistrationRef.current?.routing
              .javaScriptTypeScriptProviderContext ?? {},
            property,
          );
        },
      }),
    [],
  );

  useEffect(() => {
    const monacoApi = activeRegistration?.monacoApi;
    const context =
      activeRegistration?.routing.javaScriptTypeScriptProviderContext;
    if (!monacoApi || !context) {
      return;
    }

    const disposable = registerJavaScriptTypeScriptLanguageServerMonacoProviders(
      monacoApi,
      routedJavaScriptTypeScriptContext,
    );
    return () => disposable.dispose();
  }, [
    activeRegistration?.routing.javaScriptTypeScriptProviderContext.completeFunctionCalls,
    activeRegistration?.routing.javaScriptTypeScriptProviderContext.featuresGateway,
    activeRegistration?.routing.javaScriptTypeScriptProviderContext.refreshGateway,
    activeRegistration?.routing.javaScriptTypeScriptProviderContext.workspaceEditGateway,
    activeRegistration?.monacoApi,
    activeRegistration?.workspaceRoot,
    routedJavaScriptTypeScriptContext,
  ]);

  useEffect(() => {
    const monacoApi = configurationRegistration?.monacoApi;
    const configuration = configurationRegistration?.typescriptJavascriptDefaults;
    if (!monacoApi || !configuration) {
      return;
    }

    configureTypescriptJavascriptDefaultsOnce(monacoApi, configuration);
  }, [
    configurationRegistration?.monacoApi,
    configurationRegistration?.typescriptJavascriptDefaults.managedLanguageServerActive,
    configurationRegistration?.typescriptJavascriptDefaults.validationEnabled,
  ]);

  useEffect(() => {
    if (!activeRegistration?.monacoApi) {
      return;
    }

    const monacoApi = activeRegistration.monacoApi;
    const workspaceRoot = activeRegistration.workspaceRoot;
    if (workspaceRoot) {
      const previousWorkspace = runtimeWorkspaceRef.current;
      if (
        previousWorkspace &&
        (previousWorkspace.monacoApi !== monacoApi ||
          !workspaceRootKeysEqual(previousWorkspace.root, workspaceRoot))
      ) {
        if (releaseEditorRuntimeWorkspace(
          previousWorkspace.monacoApi,
          previousWorkspace.root,
          workspaceLeaseOwnerRef.current,
        )) {
          const preserveWorkspaceMappings =
            previousWorkspace.monacoApi !== monacoApi &&
            workspaceRootKeysEqual(previousWorkspace.root, workspaceRoot);
          disposeWorkspaceModels(
            previousWorkspace.monacoApi,
            previousWorkspace.root,
            { preserveWorkspaceMappings },
          );
        }
        markedModelsRef.current = new WeakSet();
        disposedModelsRef.current = new WeakSet();
        previousDiagnosticsRef.current = {};
      }
      retainEditorRuntimeWorkspace(
        monacoApi,
        workspaceRoot,
        workspaceLeaseOwnerRef.current,
      );
      runtimeWorkspaceRef.current = { monacoApi, root: workspaceRoot };
    }

    const diagnosticsByPath = activeRegistration.diagnosticsByPath;
    reconcileEditorRuntimeMarkers(
      monacoApi,
      workspaceRoot,
      diagnosticsByPath,
      previousDiagnosticsRef.current,
      markedModelsRef.current,
      activeRegistration.toMarker,
    );
    previousDiagnosticsRef.current = diagnosticsByPath;

    disposeUnretainedEditorRuntimeModels(
      monacoApi,
      workspaceRoot,
      owningRegistrations.map((registration) => ({
        activePath: registration.activePath,
        retainPaths: registration.retainPaths,
      })),
      disposedModelsRef.current,
    );
  }, [revision, activeRegistration]);

  useEffect(() => {
    const monacoApi = configurationRegistration?.monacoApi;
    if (
      !monacoApi ||
      typeof monacoApi.editor.onDidChangeMarkers !== "function"
    ) {
      return;
    }

    const disposable = monacoApi.editor.onDidChangeMarkers((uris) => {
      for (const registration of registrationsRef.current.values()) {
        if (
          admittedWorkspaceRootRef.current &&
          !registrationOwnsRuntime(
            registration,
            admittedWorkspaceRootRef.current,
          )
        ) {
          continue;
        }

        registration.onMarkerUrisChanged?.(uris);
      }
    });

    return () => disposable.dispose();
  }, [configurationRegistration?.monacoApi]);

  useEffect(() => {
    const descriptor = activeRegistration?.workspaceIdentityDescriptor;
    const root = activeRegistration?.workspaceRoot;
    if (!descriptor || !root || !descriptor.policy) {
      return;
    }

    return registerWorkspaceIdentityDescriptor(descriptor, root);
  }, [
    activeRegistration?.workspaceIdentityDescriptor,
    activeRegistration?.workspaceRoot,
  ]);

  useEffect(() => {
    const generation = ++lifecycleGenerationRef.current;
    return () => {
      const workspace = runtimeWorkspaceRef.current;
      queueMicrotask(() => {
        if (
          lifecycleGenerationRef.current !== generation ||
          !workspace
        ) {
          return;
        }
        if (releaseEditorRuntimeWorkspace(
          workspace.monacoApi,
          workspace.root,
          workspaceLeaseOwnerRef.current,
        )) {
          disposeWorkspaceModels(workspace.monacoApi, workspace.root);
        }
      });
    };
  }, []);

  useEffect(
    () => () => {
      contentSyncCoordinatorRef.current?.dispose();
      localPhpValidationCoordinatorRef.current.dispose();
      phpDocumentSymbolCoordinatorRef.current.clear();
    },
    [],
  );

  const value = useMemo<EditorRuntimeContextValue>(
    () => ({
      coordinateLocalPhpValidation,
      coordinatePhpDocumentSymbols,
      focusGroup,
      registerSurface,
      updateSurface,
      writeLocalPhpMarkers,
    }),
    [
      coordinateLocalPhpValidation,
      coordinatePhpDocumentSymbols,
      focusGroup,
      registerSurface,
      updateSurface,
      writeLocalPhpMarkers,
    ],
  );

  return (
    <EditorRuntimeContext.Provider value={value}>
      {children}
    </EditorRuntimeContext.Provider>
  );
}

export function resolveRuntimeDocumentForModel(
  registrations: readonly EditorRuntimeSurfaceRegistration[],
  model: Monaco.editor.ITextModel,
  focusedGroupId: string | null,
): EditorDocument | null {
  const ordered = [
    ...registrations.filter(({ groupId }) => groupId === focusedGroupId),
    ...registrations.filter(({ groupId }) => groupId !== focusedGroupId),
  ];

  for (const registration of ordered) {
    const resolved = registration.routing.resolveDocumentForModel(model);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function routedRefs(
  activeRegistrationRef: MutableRefObject<
    EditorRuntimeSurfaceRegistration | null
  >,
  registrationsRef: MutableRefObject<
    Map<string, EditorRuntimeSurfaceRegistration>
  >,
  focusedGroupRef: MutableRefObject<string | null>,
): EditorSurfaceLanguageProviderRegistrationRefs {
  const cache = new Map<PropertyKey, object>();

  return new Proxy({} as EditorSurfaceLanguageProviderRegistrationRefs, {
    get(_target, property) {
      let routedRef = cache.get(property);
      if (!routedRef) {
        if (property === "resolveDocumentForModelRef") {
          routedRef = {
            get current() {
              return (model: Monaco.editor.ITextModel) =>
                resolveRuntimeDocumentForModel(
                  [...registrationsRef.current.values()].filter(
                    (registration) =>
                      registrationOwnsRuntime(
                        registration,
                        activeRegistrationRef.current?.workspaceRoot ?? null,
                      ),
                  ),
                  model,
                  focusedGroupRef.current,
                );
            },
          };
          cache.set(property, routedRef);
          return routedRef;
        }

        if (property === "phpCodeActionsRef") {
          routedRef = {
            get current() {
              return (
                source: string,
                range: Parameters<
                  EditorSurfaceLanguageProviderRegistrationRefs["phpCodeActionsRef"]["current"]
                >[1],
              ) => {
                const registration =
                  registrationForPhpProviderSource(
                    [...registrationsRef.current.values()].filter(
                      (candidate) =>
                        registrationOwnsRuntime(
                          candidate,
                          activeRegistrationRef.current?.workspaceRoot ?? null,
                        ),
                    ),
                    source,
                    focusedGroupRef.current,
                  ) ?? activeRegistrationRef.current;

                return (
                  registration?.routing.providerRefs.phpCodeActionsRef.current(
                    source,
                    range,
                  ) ?? Promise.resolve([])
                );
              };
            },
          };
          cache.set(property, routedRef);
          return routedRef;
        }

        routedRef = {
          get current() {
            return Reflect.get(
              activeRegistrationRef.current?.routing.providerRefs ?? {},
              property,
            )?.current;
          },
        };
        cache.set(property, routedRef);
      }

      return routedRef;
    },
  });
}

function registrationForPhpProviderSource(
  registrations: readonly EditorRuntimeSurfaceRegistration[],
  source: string,
  focusedGroupId: string | null,
): EditorRuntimeSurfaceRegistration | null {
  const matches = registrations.filter((registration) => {
    const document = registration.routing.activeDocumentRef.current;

    return document?.language === "php" && document.content === source;
  });

  if (matches.length === 0) {
    return null;
  }

  return (
    matches.find((registration) => registration.groupId === focusedGroupId) ??
    matches[0] ??
    null
  );
}

function canAdmitRegistration(
  id: string,
  candidate: EditorRuntimeSurfaceRegistration,
  registrations: ReadonlyMap<string, EditorRuntimeSurfaceRegistration>,
  admittedRoot: string | null,
): boolean {
  if (!candidate.workspaceRoot) {
    return (
      !admittedRoot &&
      (registrations.size === 0 || registrations.has(id))
    );
  }

  if (admittedRoot) {
    if (workspaceRootKeysEqual(candidate.workspaceRoot, admittedRoot)) {
      return true;
    }

    return registrations.size === 1 && registrations.has(id);
  }

  if (registrations.size === 0 || registrations.has(id)) {
    return true;
  }

  return false;
}

function registrationOwnsRuntime(
  registration: EditorRuntimeSurfaceRegistration,
  admittedRoot: string | null,
): boolean {
  if (!admittedRoot) {
    return false;
  }

  return workspaceRootKeysEqual(registration.workspaceRoot, admittedRoot);
}

function registeredEditorGroup(
  registrations: ReadonlyMap<string, EditorRuntimeSurfaceRegistration>,
  groupId: string,
  admittedRoot: string | null,
): EditorRuntimeSurfaceRegistration | null {
  for (const registration of registrations.values()) {
    if (
      registration.groupId === groupId &&
      registration.editor &&
      registrationOwnsRuntime(registration, admittedRoot)
    ) {
      return registration;
    }
  }

  return null;
}

function admittedWorkspaceRoot(
  registrations: ReadonlyMap<string, EditorRuntimeSurfaceRegistration>,
): string | null {
  for (const registration of registrations.values()) {
    if (registration.workspaceRoot) {
      return registration.workspaceRoot;
    }
  }

  return null;
}

function registrationsStructurallyEqual(
  left: EditorRuntimeSurfaceRegistration,
  right: EditorRuntimeSurfaceRegistration,
): boolean {
  const leftJavaScript = left.routing.javaScriptTypeScriptProviderContext;
  const rightJavaScript = right.routing.javaScriptTypeScriptProviderContext;

  return (
    left.activePath === right.activePath &&
    left.diagnosticsByPath === right.diagnosticsByPath &&
    left.editor === right.editor &&
    left.groupId === right.groupId &&
    left.monacoApi === right.monacoApi &&
    left.providerDependencies.featuresGateway ===
      right.providerDependencies.featuresGateway &&
    left.providerDependencies.refreshGateway ===
      right.providerDependencies.refreshGateway &&
    left.providerDependencies.workspaceEditGateway ===
      right.providerDependencies.workspaceEditGateway &&
    leftJavaScript.completeFunctionCalls ===
      rightJavaScript.completeFunctionCalls &&
    leftJavaScript.featuresGateway === rightJavaScript.featuresGateway &&
    leftJavaScript.refreshGateway === rightJavaScript.refreshGateway &&
    leftJavaScript.workspaceEditGateway ===
      rightJavaScript.workspaceEditGateway &&
    pathsEqual(left.retainPaths, right.retainPaths) &&
    left.typescriptJavascriptDefaults.managedLanguageServerActive ===
      right.typescriptJavascriptDefaults.managedLanguageServerActive &&
    left.typescriptJavascriptDefaults.validationEnabled ===
      right.typescriptJavascriptDefaults.validationEnabled &&
    left.workspaceIdentityDescriptor === right.workspaceIdentityDescriptor &&
    workspaceRootKeysEqual(left.workspaceRoot, right.workspaceRoot)
  );
}

function pathsEqual(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

export type { EditorRuntimeSurfaceRegistration, EditorRuntimeSurfaceRouting };
