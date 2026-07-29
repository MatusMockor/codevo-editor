// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  adoptLegacyCachedWorkspaceState,
  createDebugGatewayHarness,
  createDeferred,
  createInitialEditorGroupsState,
  debugBreakpointStorageKey,
  type DebugGateway,
  DebugGatewayHarness,
  defaultAppSettings,
  defaultPhpLanguageServerOptions,
  defaultWorkspaceSettings,
  describe,
  deserializeBreakpoints,
  directoryEntry,
  documentReadCount,
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  type FileEntry,
  fileHistoryGitGateway,
  type FileSearchResult,
  fileUriFromPath,
  flushAsyncTurns,
  flushSearchEverywhereDebounce,
  type GitChangedFile,
  inMemoryBreakpointStorage,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  type LanguageServerDiagnosticEvent,
  type LanguageServerDiagnosticsGateway,
  type LanguageServerFeaturesGateway,
  type LanguageServerGateway,
  type LanguageServerPlan,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  normalizeWorkspaceSession,
  phpactorLanguageServerPlan,
  phpProjectDescriptor,
  phpWorkspaceDescriptor,
  positionAfter,
  type ProjectSymbolSearchGateway,
  type ProjectSymbolSearchResult,
  range,
  readyJavaScriptTypeScriptPlan,
  runCommand,
  runningStatus,
  serializeBreakpoints,
  type SettingsGateway,
  setupWorkbenchControllerTestHarness,
  trustedDescriptor,
  vi,
  waitForReact,
  withWorkspaceIdentityLease,
  type WorkbenchWorkspaceGateways,
  type WorkspaceDescriptor,
  workspaceRootKeysEqual,
  type WorkspaceRuntimeLifecycleGateway,
  type WorkspaceTrustGateway,
  type WorkspaceTrustState,
} from "./testSupport";

describe("useWorkbenchController workspace identity, editor groups, bookmarks, and debugger wiring", () => {
  const { getRoot, renderController } = setupWorkbenchControllerTestHarness();

  it("fences real PHP class fallback navigation by owner at the same root", async () => {
    const sharedRoot = "/selected/navigation-owner";
    const sourcePath = `${sharedRoot}/src/Source.php`;
    const targetPath = `${sharedRoot}/src/Target.php`;
    const source = `<?php
namespace App\\Http;

use Vendor\\MissingClass;

MissingClass::class;
`;
    const firstOwner = trustedDescriptor("ws-navigation-owner-a", sharedRoot);
    const secondOwner = trustedDescriptor("ws-navigation-owner-b", sharedRoot);
    const descriptors = [firstOwner, secondOwner];
    const classSearch =
      createDeferred<Awaited<ReturnType<ProjectSymbolSearchGateway["searchProjectSymbols"]>>>();
    const readTextFile = vi.fn(async (path: string) =>
      path === sourcePath ? source : "<?php\nclass MissingClass {}\n",
    );
    const { dependencies, getWorkbench } = renderController({
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? secondOwner),
        unregister: vi.fn(async () => undefined),
      },
    });
    vi.mocked(
      dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
    ).mockImplementationOnce(async () => classSearch.promise);

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
      await getWorkbench().setSmartMode("fullSmart");
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "Source.php"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(source, "\nMissingCla"));
    });
    const messageBeforeNavigation = getWorkbench().message;

    let navigationPromise: Promise<void> = Promise.resolve();
    act(() => {
      navigationPromise = Promise.resolve(
        getWorkbench()
          .commands.find((candidate) => candidate.id === "editor.goToDefinition")
          ?.run(),
      );
    });
    await waitForReact(() => {
      expect(
        dependencies.workspaceGateways.projectSymbols.searchProjectSymbols,
      ).toHaveBeenCalledWith(sharedRoot, "Vendor\\MissingClass", 25);
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
    });
    classSearch.resolve([
      {
        column: 7,
        containerName: null,
        fullyQualifiedName: "Vendor\\MissingClass",
        kind: "class",
        lineNumber: 2,
        name: "MissingClass",
        path: targetPath,
        relativePath: "src/Target.php",
      },
    ]);
    await act(async () => {
      await navigationPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(getWorkbench().activePath).not.toBe(targetPath);
    expect(readTextFile).not.toHaveBeenCalledWith(targetPath);
    expect(getWorkbench().message).toBe(messageBeforeNavigation);
    expect(getWorkbench().implementationChooser).toBeNull();
    expect(getWorkbench().navigationHistory).toEqual({
      backStack: [],
      forwardStack: [],
    });
  });
  it("allows pending TypeScript navigation across aliases of the same owner", async () => {
    const firstOwner = {
      ...trustedDescriptor("ws-navigation-alias", "/selected/navigation-first"),
      canonicalRoot: "/canonical/navigation-alias",
    };
    const secondOwner = {
      ...trustedDescriptor("ws-navigation-alias", "/selected/navigation-second"),
      canonicalRoot: "/canonical/navigation-alias",
    };
    const sourcePath = `${firstOwner.selectedPath}/src/main.ts`;
    const targetPath = `${secondOwner.selectedPath}/src/target.ts`;
    const source = "import { target } from './target';\ntarget();\n";
    const definitionResult =
      createDeferred<Awaited<ReturnType<LanguageServerFeaturesGateway["definition"]>>>();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        definition: true,
      },
      kind: "running",
      rootPath: firstOwner.selectedPath,
      sessionId: 1202,
    };
    const features = featuresGateway();
    vi.mocked(features.definition).mockImplementationOnce(async () => definitionResult.promise);
    const { getWorkbench } = renderController({
      javaScriptTypeScriptInitialRuntimeStatus: runtimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway: features,
      javaScriptTypeScriptRuntimeStatus: runtimeStatus,
      readTextFile: vi.fn(async (path: string) =>
        path === sourcePath ? source : "export const target = 1;\n",
      ),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path) =>
          path === firstOwner.selectedPath ? firstOwner : secondOwner,
        ),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(firstOwner.selectedPath);
      await flushAsyncTurns(24);
      await getWorkbench().openPinnedFile(fileEntry(sourcePath, "main.ts"));
    });
    act(() => {
      getWorkbench().updateActiveEditorPosition(positionAfter(source, "target()"));
    });

    let navigationPromise: Promise<void> = Promise.resolve();
    act(() => {
      navigationPromise = Promise.resolve(
        getWorkbench()
          .commands.find((candidate) => candidate.id === "editor.goToDefinition")
          ?.run(),
      );
    });
    await waitForReact(() => {
      expect(features.definition).toHaveBeenCalled();
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(secondOwner.selectedPath);
      await flushAsyncTurns(24);
    });
    definitionResult.resolve([
      {
        range: range(0, 13, 0, 19),
        uri: fileUriFromPath(targetPath),
      },
    ]);
    await act(async () => {
      await navigationPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(getWorkbench().activePath).toBe(targetPath);
  });
  it("keeps workspace cache state distinct for admitted owners at the same path", async () => {
    const sharedRoot = "/selected/cache-owner";
    const path = `${sharedRoot}/src/Shared.php`;
    const firstOwner = trustedDescriptor("ws-cache-owner-a", sharedRoot);
    const secondOwner = trustedDescriptor("ws-cache-owner-b", sharedRoot);
    const descriptors = [firstOwner, secondOwner, firstOwner];
    const { getWorkbench } = renderController({
      readTextFile: vi.fn(async () => "<?php\n// disk\n"),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? firstOwner),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
      await getWorkbench().openPinnedFile(fileEntry(path, "Shared.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\n// owner A\n");
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
      await getWorkbench().openPinnedFile(fileEntry(path, "Shared.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\n// owner B\n");
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(firstOwner);
    expect(getWorkbench().activeDocument).toEqual(
      expect.objectContaining({
        content: "<?php\n// owner A\n",
        path,
      }),
    );
  });
  it("preserves dirty documents and view state when canonical owners share a selected root and workspace ID", async () => {
    const selectedRoot = "/selected/canonical-owner";
    const path = `${selectedRoot}/src/Shared.php`;
    const ownerA = {
      ...trustedDescriptor("ws-canonical-owner", selectedRoot),
      canonicalRoot: "/canonical/owner-a",
    };
    const ownerB = {
      ...trustedDescriptor("ws-canonical-owner", selectedRoot),
      canonicalRoot: "/canonical/owner-b",
    };
    const descriptors = [ownerA, ownerB, ownerA];
    const { dependencies, getWorkbench } = renderController({
      readTextFile: vi.fn(async () => "<?php\n// disk\n"),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? ownerA),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
      await getWorkbench().openPinnedFile(fileEntry(path, "Shared.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\n// owner A dirty\n");
      getWorkbench().updateEditorViewState(path, {
        column: 7,
        line: 4,
        scrollTop: 140,
      });
    });
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });
    expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
      {
        canonicalKey: ownerA.canonicalRoot,
        legacyRawKeys: [ownerA.canonicalRoot, selectedRoot],
      },
      expect.any(Object),
    );

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "Shared.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("<?php\n// owner B dirty\n");
      getWorkbench().updateEditorViewState(path, {
        column: 3,
        line: 9,
        scrollTop: 320,
      });
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });

    expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
      {
        canonicalKey: ownerB.canonicalRoot,
        legacyRawKeys: [ownerB.canonicalRoot, selectedRoot],
      },
      expect.any(Object),
    );
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(ownerA);
    expect(getWorkbench().activeDocument).toEqual(
      expect.objectContaining({
        content: "<?php\n// owner A dirty\n",
        path,
        savedContent: "<?php\n// disk\n",
      }),
    );
    expect(getWorkbench().restoredEditorViewStates[path]).toEqual({
      column: 7,
      line: 4,
      scrollTop: 140,
    });
  });
  it("keeps the active workspace unchanged when the trusted picker is cancelled", async () => {
    const openFromPicker = vi.fn(async () => ({ status: "cancelled" as const }));
    const { getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker,
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspace();
    });

    expect(openFromPicker).toHaveBeenCalledOnce();
    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceIdentityDescriptor).toBeNull();
    expect(getWorkbench().workspaceIdentityStatus).toBe("legacyCompatibility");
  });
  it("admits a direct alias before canonical settings and keeps selected runtime ownership", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-alias", "/selected/workspace"),
      canonicalRoot: "/canonical/workspace",
    };
    const order: string[] = [];
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn(async () => {
        order.push("settings");
        return defaultWorkspaceSettings();
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const openPath = vi.fn(async () => {
      order.push("admission");
      return descriptor;
    });
    const { dependencies, getWorkbench } = renderController({
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath,
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
    });

    expect(order.slice(0, 2)).toEqual(["admission", "settings"]);
    expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith({
      canonicalKey: descriptor.canonicalRoot,
      legacyRawKeys: [descriptor.canonicalRoot, descriptor.selectedPath],
    });
    expect(getWorkbench().workspaceRoot).toBe(descriptor.selectedPath);
    expect(getWorkbench().workspaceTabs).toEqual([descriptor.selectedPath]);
    expect(dependencies.workspaceTrustGateway.getTrust).toHaveBeenCalledWith(
      descriptor.selectedPath,
    );
    expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
      descriptor.selectedPath,
      "basic",
    );

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
    });
    expect(settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
      {
        canonicalKey: descriptor.canonicalRoot,
        legacyRawKeys: [descriptor.canonicalRoot, descriptor.selectedPath],
      },
      expect.any(Object),
    );
  });
  it("keeps a direct admission current through the open-time PHP probe", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-php-open-owner", "/selected/php"),
      canonicalRoot: "/canonical/php",
    };
    const tools =
      createDeferred<
        Awaited<ReturnType<WorkbenchWorkspaceGateways["phpTools"]["detectPhpTools"]>>
      >();
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(() => tools.promise),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      languageServerPlan: phpactorLanguageServerPlan(),
      phpToolGateway,
      runtimeStatus: {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 303,
      },
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptor),
        unregister: vi.fn(async () => undefined),
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });

    let openPromise: Promise<unknown> | null = null;
    await act(async () => {
      openPromise = getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
      for (let index = 0; index < 24; index += 1) {
        await Promise.resolve();
      }
    });
    expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith(descriptor.selectedPath);
    await act(async () => {
      tools.resolve({ intelephense: null, phpactor: null });
      await openPromise;
      for (let index = 0; index < 24; index += 1) {
        await Promise.resolve();
      }
    });

    expect(dependencies.languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      descriptor.selectedPath,
      defaultPhpLanguageServerOptions(),
    );
    expect(getWorkbench().languageServerPlan?.status).toBe("ready");
  });
  it("rejects same-path owner A hydration after owner B becomes current", async () => {
    const selectedRoot = "/selected/shared-hydration";
    const firstOwner = trustedDescriptor("ws-hydration-owner-a", selectedRoot);
    const secondOwner = trustedDescriptor("ws-hydration-owner-b", selectedRoot);
    const firstTrust = createDeferred<WorkspaceTrustState>();
    const firstDetection = createDeferred<WorkspaceDescriptor>();
    const firstManifest = createDeferred<string>();
    const descriptors = [firstOwner, secondOwner];
    let trustRequest = 0;
    let detectionRequest = 0;
    let directoryRequest = 0;
    let manifestRequest = 0;
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      phpToolGateway,
      readDirectory: vi.fn(async () => {
        directoryRequest += 1;
        return [fileEntry(`${selectedRoot}/composer.json`, "composer.json")];
      }),
      readTextFile: vi.fn(async () => {
        manifestRequest += 1;
        if (manifestRequest === 1) {
          return firstManifest.promise;
        }

        return '{"scripts":{"owner-b":"phpunit"}}';
      }),
      workspaceDetectionGateway: {
        detectWorkspace: vi.fn(async () => {
          detectionRequest += 1;
          if (detectionRequest === 1) {
            return firstDetection.promise;
          }

          return {
            javaScriptTypeScript: null,
            php: null,
            rootPath: selectedRoot,
          };
        }),
      },
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? secondOwner),
        unregister: vi.fn(async () => undefined),
      },
      workspaceTrustGateway: {
        getTrust: vi.fn(async () => {
          trustRequest += 1;
          if (trustRequest === 1) {
            return firstTrust.promise;
          }

          return { rootPath: selectedRoot, trusted: false };
        }),
        setTrust: vi.fn(async (rootPath, trusted) => ({ rootPath, trusted })),
      },
    });

    let firstOpen: Promise<unknown> | null = null;
    await act(async () => {
      firstOpen = getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });
    expect(directoryRequest).toBe(1);
    expect(manifestRequest).toBe(1);

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(getWorkbench().workspaceTrust).toEqual({
      rootPath: selectedRoot,
      trusted: false,
    });
    expect(
      getWorkbench().commands.some((command) => command.id === "script.composer.owner-b"),
    ).toBe(true);

    await act(async () => {
      firstTrust.resolve({ rootPath: selectedRoot, trusted: true });
      firstDetection.resolve({
        ...phpWorkspaceDescriptor(),
        rootPath: selectedRoot,
      });
      firstManifest.resolve('{"scripts":{"owner-a":"phpunit"}}');
      await firstOpen;
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(getWorkbench().workspaceTrust?.trusted).toBe(false);
    expect(getWorkbench().workspaceDescriptor).toEqual({
      javaScriptTypeScript: null,
      php: null,
      rootPath: selectedRoot,
    });
    expect(
      getWorkbench().commands.some((command) => command.id === "script.composer.owner-a"),
    ).toBe(false);
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
  });
  it("waits for owner B session hydration after replacing owner A at the same path", async () => {
    const selectedRoot = "/selected/shared-session";
    const firstPath = `${selectedRoot}/src/OwnerA.ts`;
    const secondPath = `${selectedRoot}/src/OwnerB.ts`;
    const firstOwner = trustedDescriptor("ws-session-owner-a", selectedRoot);
    const secondOwner = trustedDescriptor("ws-session-owner-b", selectedRoot);
    const firstDocument = createDeferred<string>();
    const secondDocument = createDeferred<string>();
    const descriptors = [firstOwner, secondOwner];
    let settingsLoad = 0;
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn(async () => {
        settingsLoad += 1;
        const activePath = settingsLoad === 1 ? firstPath : secondPath;
        return {
          ...defaultWorkspaceSettings(),
          session: normalizeWorkspaceSession({
            activePath,
            bottomPanelView: "problems" as const,
            openPaths: [activePath],
            sidebarView: "files" as const,
          }),
        };
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const readTextFile = vi.fn((path: string) => {
      if (path === firstPath) {
        return firstDocument.promise;
      }

      return secondDocument.promise;
    });
    const { getWorkbench } = renderController({
      readTextFile,
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? secondOwner),
        unregister: vi.fn(async () => undefined),
      },
    });

    let firstOpen: Promise<unknown> | null = null;
    await act(async () => {
      firstOpen = getWorkbench().openWorkspaceRoot(selectedRoot);
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(firstPath);
      });
    });

    let secondOpen: Promise<unknown> | null = null;
    await act(async () => {
      secondOpen = getWorkbench().openWorkspaceRoot(selectedRoot);
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith(secondPath);
      });
    });
    vi.mocked(settingsGateway.saveWorkspaceSettings).mockClear();

    await act(async () => {
      firstDocument.resolve("export const owner = 'a';\n");
      await firstOpen;
      getWorkbench().setSidebarView("git");
      await flushAsyncTurns(24);
    });

    expect(settingsGateway.saveWorkspaceSettings).not.toHaveBeenCalled();

    await act(async () => {
      secondDocument.resolve("export const owner = 'b';\n");
      await secondOpen;
      await flushAsyncTurns(24);
    });
    expect(getWorkbench().activePath).toBe(secondPath);
    expect(settingsGateway.saveWorkspaceSettings).not.toHaveBeenCalled();

    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await waitForReact(() => {
      expect(settingsGateway.saveWorkspaceSettings).toHaveBeenCalledOnce();
    });
  });
  it("rejects an in-flight PHP probe from a replaced owner at the same path", async () => {
    const selectedRoot = "/selected/shared-php-probe";
    const firstOwner = trustedDescriptor("ws-php-probe-owner-a", selectedRoot);
    const secondOwner = trustedDescriptor("ws-php-probe-owner-b", selectedRoot);
    const firstTrust = createDeferred<WorkspaceTrustState>();
    const tools =
      createDeferred<
        Awaited<ReturnType<WorkbenchWorkspaceGateways["phpTools"]["detectPhpTools"]>>
      >();
    const descriptors = [firstOwner, secondOwner];
    let trustRequest = 0;
    let detectionRequest = 0;
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(() => tools.promise),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      phpToolGateway,
      workspaceDetectionGateway: {
        detectWorkspace: vi.fn(async () => {
          detectionRequest += 1;
          return detectionRequest === 1
            ? { ...phpWorkspaceDescriptor(), rootPath: selectedRoot }
            : {
                javaScriptTypeScript: null,
                php: null,
                rootPath: selectedRoot,
              };
        }),
      },
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? secondOwner),
        unregister: vi.fn(async () => undefined),
      },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
      workspaceTrustGateway: {
        getTrust: vi.fn(async () => {
          trustRequest += 1;
          if (trustRequest === 1) {
            return firstTrust.promise;
          }

          return { rootPath: selectedRoot, trusted: true };
        }),
        setTrust: vi.fn(async (rootPath, trusted) => ({ rootPath, trusted })),
      },
    });

    let firstOpen: Promise<unknown> | null = null;
    await act(async () => {
      firstOpen = getWorkbench().openWorkspaceRoot(selectedRoot);
      await waitForReact(() => {
        expect(phpToolGateway.detectPhpTools).toHaveBeenCalledTimes(1);
      });
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);

    await act(async () => {
      tools.resolve({ intelephense: null, phpactor: null });
      firstTrust.resolve({ rootPath: selectedRoot, trusted: true });
      await firstOpen;
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(getWorkbench().phpTools).toBe(null);
    expect(getWorkbench().languageServerPlan).toBe(null);
    expect(
      getWorkbench().notices.some((notice) => notice.groupKey === `phpactor-setup:${selectedRoot}`),
    ).toBe(false);
    expect(dependencies.languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();
  });
  it("keeps a direct admission current through the open-time TypeScript probe", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-ts-open-owner", "/selected/typescript"),
      canonicalRoot: "/canonical/typescript",
    };
    const plan = createDeferred<LanguageServerPlan>();
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(() => plan.promise),
      planPhpLanguageServer: vi.fn(async () => phpactorLanguageServerPlan()),
    };
    const { dependencies, getWorkbench } = renderController({
      languageServerGateway,
      javaScriptTypeScriptRuntimeStatus: {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 304,
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptor),
        unregister: vi.fn(async () => undefined),
      },
    });

    let openPromise: Promise<unknown> | null = null;
    await act(async () => {
      openPromise = getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
      for (let index = 0; index < 24; index += 1) {
        await Promise.resolve();
      }
    });
    expect(languageServerGateway.planJavaScriptTypeScriptLanguageServer).toHaveBeenCalled();
    await act(async () => {
      plan.resolve(readyJavaScriptTypeScriptPlan(descriptor.selectedPath));
      await openPromise;
      for (let index = 0; index < 24; index += 1) {
        await Promise.resolve();
      }
    });

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith(descriptor.selectedPath, expect.any(Object));
  });
  it("routes background diagnostics by the admitted event root owner", async () => {
    const workspaceA = trustedDescriptor("ws-diagnostics-owner-a", "/selected/diagnostics-a");
    const workspaceB = trustedDescriptor("ws-diagnostics-owner-b", "/selected/diagnostics-b");
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const { getWorkbench } = renderController({
      languageServerDiagnosticsGateway: {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishDiagnostics = listener;
          return () => undefined;
        }),
      },
      runtimeStatus: {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 305,
      },
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path) =>
          path === workspaceA.selectedPath ? workspaceA : workspaceB,
        ),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(workspaceB.selectedPath);
      await getWorkbench().openWorkspaceRoot(workspaceA.selectedPath);
      await flushAsyncTurns(24);
    });

    const diagnosticPath = `${workspaceB.selectedPath}/src/Background.php`;
    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "background owner diagnostic",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: workspaceB.selectedPath,
        sessionId: 305,
        uri: fileUriFromPath(diagnosticPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[diagnosticPath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(workspaceB.selectedPath);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().languageServerDiagnosticsByPath[diagnosticPath]).toHaveLength(1);
  });
  it("transfers one admitted runtime owner across selected aliases and forgets it on final close", async () => {
    const firstAlias = {
      ...trustedDescriptor("ws-shared-alias", "/selected/first"),
      canonicalRoot: "/canonical/shared",
    };
    const secondAlias = {
      ...trustedDescriptor("ws-shared-alias", "/selected/second"),
      canonicalRoot: "/canonical/shared",
    };
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 301,
    };
    const openPath = vi.fn(async (path: string) =>
      path === firstAlias.selectedPath ? firstAlias : secondAlias,
    );
    const { dependencies, getWorkbench } = renderController({
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath,
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(firstAlias.selectedPath);
      await flushAsyncTurns();
    });
    const diagnosticPath = `${firstAlias.selectedPath}/src/Alias.php`;
    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "shared owner diagnostic",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: firstAlias.selectedPath,
        sessionId: 301,
        uri: fileUriFromPath(diagnosticPath),
        version: null,
      });
    });
    await flushAsyncTurns();
    expect(getWorkbench().languageServerDiagnosticsByPath[diagnosticPath]).toHaveLength(1);

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(secondAlias.selectedPath);
      await flushAsyncTurns();
    });

    expect(getWorkbench().languageServerDiagnosticsByPath[diagnosticPath]).toHaveLength(1);
    expect(dependencies.languageServerRuntimeGateway.getStatus).toHaveBeenCalledWith(
      secondAlias.selectedPath,
    );
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(secondAlias.selectedPath);
      await getWorkbench().openWorkspaceRoot(secondAlias.selectedPath);
      await flushAsyncTurns();
    });

    expect(getWorkbench().languageServerDiagnosticsByPath).toEqual({});
  });
  it("routes PHP and TypeScript diagnostics from a retained runtime's old selected alias", async () => {
    const firstAlias = {
      ...trustedDescriptor("ws-retained-runtime-alias", "/selected/retained-first"),
      canonicalRoot: "/canonical/retained-runtime",
    };
    const secondAlias = {
      ...trustedDescriptor("ws-retained-runtime-alias", "/selected/retained-second"),
      canonicalRoot: "/canonical/retained-runtime",
    };
    let publishPhpDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishTypeScriptDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null =
      null;
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const runtimeGateway = (sessionId: number): LanguageServerRuntimeGateway => ({
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, sessionId)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, sessionId)),
      stop: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      subscribeStatus: vi.fn(async () => () => undefined),
    });
    const phpRuntimeGateway = runtimeGateway(602);
    const typeScriptRuntimeGateway = runtimeGateway(702);
    const phpDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishPhpDiagnostics = listener;
        return () => undefined;
      }),
    };
    const typeScriptDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishTypeScriptDiagnostics = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      javaScriptTypeScriptLanguageServerDiagnosticsGateway: typeScriptDiagnosticsGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway: typeScriptRuntimeGateway,
      languageServerDiagnosticsGateway: phpDiagnosticsGateway,
      languageServerRuntimeGateway: phpRuntimeGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path) =>
          path === firstAlias.selectedPath ? firstAlias : secondAlias,
        ),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(firstAlias.selectedPath);
      await flushAsyncTurns(24);
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(secondAlias.selectedPath);
      await flushAsyncTurns(24);
    });

    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({ sessionId: 602 }),
    );
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ sessionId: 702 }),
    );
    expect(getWorkbench().workspaceSettings.javaScriptTypeScriptValidation).toBe(true);
    expect(typeScriptRuntimeGateway.stop).not.toHaveBeenCalled();

    const phpPath = `${firstAlias.selectedPath}/src/Retained.php`;
    const typeScriptPath = `${firstAlias.selectedPath}/src/retained.ts`;
    act(() => {
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "retained PHP runtime",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: firstAlias.selectedPath,
        sessionId: 602,
        uri: fileUriFromPath(phpPath),
        version: null,
      });
      publishTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "retained TypeScript runtime",
            severity: "warning",
            source: "tsserver",
          },
        ],
        rootPath: firstAlias.selectedPath,
        sessionId: 702,
        uri: fileUriFromPath(typeScriptPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondAlias);
    expect(getWorkbench().languageServerDiagnosticsByPath[phpPath]).toHaveLength(1);
    expect(getWorkbench().languageServerDiagnosticsByPath[typeScriptPath]).toHaveLength(1);

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        {
          ...getWorkbench().workspaceSettings,
          javaScriptTypeScriptValidation: false,
        },
        true,
      );
      await flushAsyncTurns(24);
    });
    expect(getWorkbench().languageServerDiagnosticsByPath[typeScriptPath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        {
          ...getWorkbench().workspaceSettings,
          javaScriptTypeScriptValidation: true,
        },
        true,
      );
      await flushAsyncTurns(24);
    });
    const resumedTypeScriptPath = `${firstAlias.selectedPath}/src/resumed.ts`;
    act(() => {
      publishTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "resumed TypeScript validation",
            severity: "warning",
            source: "tsserver",
          },
        ],
        rootPath: firstAlias.selectedPath,
        sessionId: 702,
        uri: fileUriFromPath(resumedTypeScriptPath),
        version: null,
      });
    });
    await flushAsyncTurns();
    expect(getWorkbench().languageServerDiagnosticsByPath[resumedTypeScriptPath]).toHaveLength(1);
  });
  it("retires replaced and closed owner claims before reusing unchanged sessions", async () => {
    const sharedRoot = "/selected/retired-owner-root";
    const firstOwner = trustedDescriptor("ws-retired-owner-a", sharedRoot);
    const secondOwner = trustedDescriptor("ws-retired-owner-b", sharedRoot);
    const secondOwnerAlias = {
      ...trustedDescriptor("ws-retired-owner-b", "/selected/retired-owner-b"),
      canonicalRoot: secondOwner.canonicalRoot,
    };
    const otherOwner = trustedDescriptor("ws-retired-owner-other", "/selected/retired-owner-other");
    const thirdOwner = trustedDescriptor("ws-retired-owner-c", sharedRoot);
    const descriptors = [firstOwner, secondOwner, secondOwnerAlias, otherOwner, thirdOwner];
    let publishPhpDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishTypeScriptDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null =
      null;
    const runtimeGateway = (sessionId: number): LanguageServerRuntimeGateway => ({
      getStatus: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId,
      })),
      stop: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      subscribeStatus: vi.fn(async () => () => undefined),
    });
    const { getWorkbench } = renderController({
      javaScriptTypeScriptLanguageServerDiagnosticsGateway: {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishTypeScriptDiagnostics = listener;
          return () => undefined;
        }),
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway: runtimeGateway(911),
      languageServerDiagnosticsGateway: {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishPhpDiagnostics = listener;
          return () => undefined;
        }),
      },
      languageServerRuntimeGateway: runtimeGateway(811),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? thirdOwner),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
    });

    const replacementPhpPath = `${sharedRoot}/src/Replacement.php`;
    const replacementTypeScriptPath = `${sharedRoot}/src/replacement.ts`;
    act(() => {
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "replacement PHP owner",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: sharedRoot,
        sessionId: 811,
        uri: fileUriFromPath(replacementPhpPath),
        version: null,
      });
      publishTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "replacement TypeScript owner",
            severity: "warning",
            source: "tsserver",
          },
        ],
        rootPath: sharedRoot,
        sessionId: 911,
        uri: fileUriFromPath(replacementTypeScriptPath),
        version: null,
      });
    });
    await flushAsyncTurns();
    expect(getWorkbench().languageServerDiagnosticsByPath[replacementPhpPath]).toHaveLength(1);
    expect(getWorkbench().languageServerDiagnosticsByPath[replacementTypeScriptPath]).toHaveLength(
      1,
    );

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(secondOwnerAlias.selectedPath);
      await flushAsyncTurns(24);
      await getWorkbench().openWorkspaceRoot(otherOwner.selectedPath);
      await flushAsyncTurns(24);
      await getWorkbench().closeWorkspaceTab(secondOwnerAlias.selectedPath);
      await flushAsyncTurns(24);
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
    });

    const reopenedPhpPath = `${sharedRoot}/src/Reopened.php`;
    const reopenedTypeScriptPath = `${sharedRoot}/src/reopened.ts`;
    act(() => {
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "reopened PHP owner",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: sharedRoot,
        sessionId: 811,
        uri: fileUriFromPath(reopenedPhpPath),
        version: null,
      });
      publishTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "reopened TypeScript owner",
            severity: "warning",
            source: "tsserver",
          },
        ],
        rootPath: sharedRoot,
        sessionId: 911,
        uri: fileUriFromPath(reopenedTypeScriptPath),
        version: null,
      });
    });
    await flushAsyncTurns();
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(thirdOwner);
    expect(getWorkbench().languageServerDiagnosticsByPath[reopenedPhpPath]).toHaveLength(1);
    expect(getWorkbench().languageServerDiagnosticsByPath[reopenedTypeScriptPath]).toHaveLength(1);
  });
  it("keeps shared keepAlive claims ambiguous and matches sessions by runtime kind", async () => {
    const sharedRoot = "/selected/concurrent-owner-root";
    const firstOwner = {
      ...trustedDescriptor("ws-concurrent-owner-a", sharedRoot),
      canonicalRoot: "/canonical/concurrent-owner-a",
    };
    const firstOwnerAlias = {
      ...trustedDescriptor("ws-concurrent-owner-a", "/selected/concurrent-owner-a"),
      canonicalRoot: firstOwner.canonicalRoot,
    };
    const secondOwner = {
      ...trustedDescriptor("ws-concurrent-owner-b", sharedRoot),
      canonicalRoot: "/canonical/concurrent-owner-b",
    };
    const descriptors = [firstOwner, firstOwnerAlias, secondOwner];
    let phpSessionId = 31;
    let typeScriptSessionId = 41;
    let publishPhpStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    let publishTypeScriptStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    let publishPhpDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishTypeScriptDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null =
      null;
    const runtimeGateway = (
      currentSessionId: () => number,
      captureStatusListener: (listener: (status: LanguageServerRuntimeStatus) => void) => void,
    ): LanguageServerRuntimeGateway => ({
      getStatus: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: currentSessionId(),
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running" as const,
        rootPath,
        sessionId: currentSessionId(),
      })),
      stop: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      subscribeStatus: vi.fn(async (listener) => {
        captureStatusListener(listener);
        return () => undefined;
      }),
    });
    const { getWorkbench } = renderController({
      javaScriptTypeScriptLanguageServerDiagnosticsGateway: {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishTypeScriptDiagnostics = listener;
          return () => undefined;
        }),
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway: runtimeGateway(
        () => typeScriptSessionId,
        (listener) => {
          publishTypeScriptStatus = listener;
        },
      ),
      languageServerDiagnosticsGateway: {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishPhpDiagnostics = listener;
          return () => undefined;
        }),
      },
      languageServerRuntimeGateway: runtimeGateway(
        () => phpSessionId,
        (listener) => {
          publishPhpStatus = listener;
        },
      ),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? secondOwner),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
      await getWorkbench().openWorkspaceRoot(firstOwnerAlias.selectedPath);
      await flushAsyncTurns(24);
      await getWorkbench().openWorkspaceRoot(sharedRoot);
      await flushAsyncTurns(24);
    });

    const ambiguousPhpPath = `${sharedRoot}/src/Ambiguous.php`;
    const ambiguousTypeScriptPath = `${sharedRoot}/src/ambiguous.ts`;
    act(() => {
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "ambiguous PHP owners",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: sharedRoot,
        sessionId: 31,
        uri: fileUriFromPath(ambiguousPhpPath),
        version: null,
      });
      publishTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "ambiguous TypeScript owners",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: sharedRoot,
        sessionId: 41,
        uri: fileUriFromPath(ambiguousTypeScriptPath),
        version: null,
      });
    });
    await flushAsyncTurns();
    expect(getWorkbench().languageServerDiagnosticsByPath[ambiguousPhpPath]).toBeUndefined();
    expect(getWorkbench().languageServerDiagnosticsByPath[ambiguousTypeScriptPath]).toBeUndefined();

    phpSessionId = 41;
    typeScriptSessionId = 31;
    act(() => {
      publishPhpStatus?.({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        rootPath: sharedRoot,
        sessionId: phpSessionId,
      });
      publishTypeScriptStatus?.({
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        rootPath: sharedRoot,
        sessionId: typeScriptSessionId,
      });
    });
    await flushAsyncTurns(24);
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({ sessionId: 41 }),
    );
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ sessionId: 31 }),
    );

    const routedPhpPath = `${sharedRoot}/src/Routed.php`;
    const routedTypeScriptPath = `${sharedRoot}/src/routed.ts`;
    act(() => {
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "runtime-kind PHP owner",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: sharedRoot,
        sessionId: 41,
        uri: fileUriFromPath(routedPhpPath),
        version: null,
      });
      publishTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "runtime-kind TypeScript owner",
            severity: "warning",
            source: "tsserver",
          },
        ],
        rootPath: sharedRoot,
        sessionId: 31,
        uri: fileUriFromPath(routedTypeScriptPath),
        version: null,
      });
    });
    await flushAsyncTurns();
    expect(getWorkbench().languageServerDiagnosticsByPath[routedPhpPath]).toHaveLength(1);
    expect(getWorkbench().languageServerDiagnosticsByPath[routedTypeScriptPath]).toHaveLength(1);
  });
  it("isolates distinct admitted owners that select the same execution root", async () => {
    const selectedRoot = "/selected/shared-root";
    const firstOwner = trustedDescriptor("ws-owner-a", selectedRoot);
    const secondOwner = trustedDescriptor("ws-owner-b", selectedRoot);
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const descriptors = [firstOwner, secondOwner, firstOwner];
    const { getWorkbench } = renderController({
      languageServerDiagnosticsGateway: {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishDiagnostics = listener;
          return () => undefined;
        }),
      },
      runtimeStatus: {
        capabilities: emptyLanguageServerCapabilities(),
        kind: "running",
        sessionId: 302,
      },
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? firstOwner),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns();
    });
    const firstPath = `${selectedRoot}/src/First.php`;
    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "first owner",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: selectedRoot,
        sessionId: 302,
        uri: fileUriFromPath(firstPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns();
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(getWorkbench().languageServerDiagnosticsByPath).toEqual({});

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns();
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(firstOwner);
    expect(getWorkbench().languageServerDiagnosticsByPath[firstPath]).toHaveLength(1);
  });
  it("rejects late PHP and TypeScript diagnostics from a replaced owner at the same root", async () => {
    const selectedRoot = "/selected/reused-runtime-root";
    const firstOwner = trustedDescriptor("ws-reused-owner-a", selectedRoot);
    const secondOwner = trustedDescriptor("ws-reused-owner-b", selectedRoot);
    const descriptors = [firstOwner, secondOwner];
    let publishPhpDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishTypeScriptDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null =
      null;
    let phpSessionId = 401;
    let typeScriptSessionId = 501;
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: selectedRoot,
      sessionId,
    });
    const runtimeGateway = (currentSessionId: () => number): LanguageServerRuntimeGateway => ({
      getStatus: vi.fn(async () => runningStatus(currentSessionId())),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus(currentSessionId())),
      stop: vi.fn(async () => ({
        kind: "stopped" as const,
        rootPath: selectedRoot,
      })),
      subscribeStatus: vi.fn(async () => () => undefined),
    });
    const { getWorkbench } = renderController({
      javaScriptTypeScriptLanguageServerDiagnosticsGateway: {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishTypeScriptDiagnostics = listener;
          return () => undefined;
        }),
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway: runtimeGateway(() => typeScriptSessionId),
      languageServerDiagnosticsGateway: {
        subscribeDiagnostics: vi.fn(async (listener) => {
          publishPhpDiagnostics = listener;
          return () => undefined;
        }),
      },
      languageServerRuntimeGateway: runtimeGateway(() => phpSessionId),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptors.shift() ?? secondOwner),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });

    phpSessionId = 402;
    typeScriptSessionId = 502;
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(selectedRoot);
      await flushAsyncTurns(24);
    });
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({ sessionId: 402 }),
    );
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ sessionId: 502 }),
    );

    const latePhpPath = `${selectedRoot}/src/LateA.php`;
    const lateTypeScriptPath = `${selectedRoot}/src/LateA.ts`;
    const ambiguousPath = `${selectedRoot}/src/Ambiguous.php`;
    const currentPhpPath = `${selectedRoot}/src/CurrentB.php`;
    const currentTypeScriptPath = `${selectedRoot}/src/CurrentB.ts`;
    act(() => {
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "late owner A PHP",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: selectedRoot,
        sessionId: 401,
        uri: fileUriFromPath(latePhpPath),
        version: null,
      });
      publishTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "late owner A TypeScript",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: selectedRoot,
        sessionId: 501,
        uri: fileUriFromPath(lateTypeScriptPath),
        version: null,
      });
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "ambiguous root-only owner",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: selectedRoot,
        sessionId: 999,
        uri: fileUriFromPath(ambiguousPath),
        version: null,
      });
      publishPhpDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "current owner B PHP",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: selectedRoot,
        sessionId: 402,
        uri: fileUriFromPath(currentPhpPath),
        version: null,
      });
      publishTypeScriptDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "current owner B TypeScript",
            severity: "warning",
            source: "tsserver",
          },
        ],
        rootPath: selectedRoot,
        sessionId: 502,
        uri: fileUriFromPath(currentTypeScriptPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(secondOwner);
    expect(getWorkbench().languageServerDiagnosticsByPath[latePhpPath]).toBeUndefined();
    expect(getWorkbench().languageServerDiagnosticsByPath[lateTypeScriptPath]).toBeUndefined();
    expect(getWorkbench().languageServerDiagnosticsByPath[ambiguousPath]).toBeUndefined();
    expect(getWorkbench().languageServerDiagnosticsByPath[currentPhpPath]).toHaveLength(1);
    expect(getWorkbench().languageServerDiagnosticsByPath[currentTypeScriptPath]).toHaveLength(1);
  });
  it("admits a restored alias through openPath before opening it", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-restored", "/selected/restored"),
      canonicalRoot: "/canonical/restored",
    };
    const openPath = vi.fn(async () => descriptor);
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => ({
        ...defaultAppSettings(),
        recentWorkspacePath: descriptor.selectedPath,
        workspaceTabs: [descriptor.selectedPath],
      })),
      loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath,
        unregister: vi.fn(async () => undefined),
      },
    });

    await flushAsyncTurns(24);

    expect(openPath).toHaveBeenCalledExactlyOnceWith(descriptor.selectedPath);
    expect(getWorkbench().workspaceRoot).toBe(descriptor.selectedPath);
    expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith({
      canonicalKey: descriptor.canonicalRoot,
      legacyRawKeys: [descriptor.canonicalRoot, descriptor.selectedPath],
    });
  });
  it("unregisters a superseded direct admission and never opens it later", async () => {
    const descriptorA = trustedDescriptor("ws-direct-a", "/workspace-a");
    const descriptorB = trustedDescriptor("ws-direct-b", "/workspace-b");
    const admissionA = createDeferred<typeof descriptorA>();
    const unregister = vi.fn(async () => undefined);
    const openPath = vi.fn((path: string) =>
      path === descriptorA.selectedPath ? admissionA.promise : Promise.resolve(descriptorB),
    );
    const { getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath,
        unregister,
      },
    });

    let firstOpen!: Promise<boolean>;
    await act(async () => {
      firstOpen = getWorkbench().openWorkspaceRoot(descriptorA.selectedPath);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(openPath).toHaveBeenCalledWith(descriptorA.selectedPath);
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptorB.selectedPath);
    });
    await act(async () => {
      admissionA.resolve(descriptorA);
      await firstOpen;
    });

    expect(unregister).toHaveBeenCalledExactlyOnceWith(descriptorA.workspaceId);
    expect(getWorkbench().workspaceRoot).toBe(descriptorB.selectedPath);
    expect(getWorkbench().workspaceTabs).toEqual([descriptorB.selectedPath]);
  });
  it("does not unregister an active native workspace when a same-id alias loses", async () => {
    const canonicalRoot = "/real/shared";
    const activeDescriptor = {
      ...trustedDescriptor("ws-shared", "/link/active"),
      canonicalRoot,
    };
    const staleDescriptor = {
      ...trustedDescriptor("ws-shared", "/link/stale"),
      canonicalRoot,
    };
    const staleSettings = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const unregister = vi.fn(async () => undefined);
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn((identity) => {
        const legacyRawKeys =
          typeof identity === "string" ? [identity] : (identity.legacyRawKeys ?? []);
        return legacyRawKeys.includes(staleDescriptor.selectedPath)
          ? staleSettings.promise
          : Promise.resolve(defaultWorkspaceSettings());
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path) =>
          path === activeDescriptor.selectedPath ? activeDescriptor : staleDescriptor,
        ),
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(activeDescriptor.selectedPath);
    });
    let staleOpen!: Promise<boolean>;
    await act(async () => {
      staleOpen = getWorkbench().openWorkspaceRoot(staleDescriptor.selectedPath);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith({
        canonicalKey: canonicalRoot,
        legacyRawKeys: [canonicalRoot, staleDescriptor.selectedPath],
      });
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab(activeDescriptor.selectedPath);
      staleSettings.resolve(defaultWorkspaceSettings());
      await staleOpen;
    });

    expect(getWorkbench().workspaceRoot).toBe(activeDescriptor.selectedPath);
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(activeDescriptor);
    expect(unregister).not.toHaveBeenCalled();
  });
  it("defers loser cleanup while a same-id winner is still in openPath", async () => {
    const canonicalRoot = "/real/pending-winner";
    const descriptorA = {
      ...trustedDescriptor("ws-pending-winner", "/link/pending-a"),
      canonicalRoot,
    };
    const descriptorB = {
      ...trustedDescriptor("ws-pending-winner", "/link/pending-b"),
      canonicalRoot,
    };
    const settingsA = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const admissionB = createDeferred<typeof descriptorB>();
    const unregister = vi.fn(async () => undefined);
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn((identity) => {
        const legacyRawKeys =
          typeof identity === "string" ? [identity] : (identity.legacyRawKeys ?? []);
        return legacyRawKeys.includes(descriptorA.selectedPath)
          ? settingsA.promise
          : Promise.resolve(defaultWorkspaceSettings());
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn((path) =>
          path === descriptorA.selectedPath ? Promise.resolve(descriptorA) : admissionB.promise,
        ),
        unregister,
      },
    });

    let openA!: Promise<boolean>;
    await act(async () => {
      openA = getWorkbench().openWorkspaceRoot(descriptorA.selectedPath);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledOnce();
    });
    let openB!: Promise<boolean>;
    await act(async () => {
      openB = getWorkbench().openWorkspaceRoot(descriptorB.selectedPath);
      await Promise.resolve();
    });
    await act(async () => {
      settingsA.resolve(defaultWorkspaceSettings());
      await openA;
    });

    expect(unregister).not.toHaveBeenCalled();

    await act(async () => {
      admissionB.resolve(descriptorB);
      await openB;
    });

    expect(getWorkbench().workspaceRoot).toBe(descriptorB.selectedPath);
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptorB);
    expect(unregister).not.toHaveBeenCalled();
  });
  it("lets a concurrent same-id alias win with its own migrated settings", async () => {
    const canonicalRoot = "/real/concurrent";
    const descriptorA = {
      ...trustedDescriptor("ws-concurrent", "/link/a"),
      canonicalRoot,
    };
    const descriptorB = {
      ...trustedDescriptor("ws-concurrent", "/link/b"),
      canonicalRoot,
    };
    const settingsA = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const settingsOnlyUnderB = {
      ...defaultWorkspaceSettings(),
      statusBar: {
        ...defaultWorkspaceSettings().statusBar,
        message: false,
      },
    };
    const unregister = vi.fn(async () => undefined);
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn((identity) => {
        const legacyRawKeys =
          typeof identity === "string" ? [identity] : (identity.legacyRawKeys ?? []);
        if (legacyRawKeys.includes(descriptorB.selectedPath)) {
          return Promise.resolve(settingsOnlyUnderB);
        }
        return settingsA.promise;
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path) =>
          path === descriptorA.selectedPath ? descriptorA : descriptorB,
        ),
        unregister,
      },
    });

    let openA!: Promise<boolean>;
    await act(async () => {
      openA = getWorkbench().openWorkspaceRoot(descriptorA.selectedPath);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith({
        canonicalKey: canonicalRoot,
        legacyRawKeys: [canonicalRoot, descriptorA.selectedPath],
      });
    });
    let openB!: Promise<boolean>;
    await act(async () => {
      openB = getWorkbench().openWorkspaceRoot(descriptorB.selectedPath);
      await Promise.resolve();
    });
    await act(async () => {
      settingsA.resolve(defaultWorkspaceSettings());
      await Promise.all([openA, openB]);
    });

    expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith({
      canonicalKey: canonicalRoot,
      legacyRawKeys: [canonicalRoot, descriptorB.selectedPath],
    });
    expect(getWorkbench().workspaceRoot).toBe(descriptorB.selectedPath);
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptorB);
    expect(getWorkbench().workspaceSettings.statusBar.message).toBe(false);
    expect(unregister).not.toHaveBeenCalled();
  });
  it("invalidates a deferred openPath admission on unmount", async () => {
    const descriptor = trustedDescriptor("ws-unmounted-open", "/workspace-late");
    const admission = createDeferred<typeof descriptor>();
    const unregister = vi.fn(async () => undefined);
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(() => admission.promise),
        unregister,
      },
    });

    const staleWorkbench = getWorkbench();
    let open!: Promise<boolean>;
    await act(async () => {
      open = staleWorkbench.openWorkspaceRoot(descriptor.selectedPath);
      await Promise.resolve();
    });
    await act(async () => {
      getRoot().unmount();
      await Promise.resolve();
    });
    admission.resolve(descriptor);
    await open;

    expect(unregister).toHaveBeenCalledExactlyOnceWith(descriptor.workspaceId);
    expect(settingsGateway.loadWorkspaceSettings).not.toHaveBeenCalled();
    expect(staleWorkbench.workspaceRoot).toBeNull();
    expect(staleWorkbench.workspaceIdentityDescriptor).toBeNull();
  });
  it("invalidates a deferred canonical settings admission on unmount", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-unmounted-settings", "/link/unmounted"),
      canonicalRoot: "/real/unmounted",
    };
    const settings = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const unregister = vi.fn(async () => undefined);
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn(() => settings.promise),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptor),
        unregister,
      },
    });

    const staleWorkbench = getWorkbench();
    let open!: Promise<boolean>;
    await act(async () => {
      open = staleWorkbench.openWorkspaceRoot(descriptor.selectedPath);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledOnce();
    });
    await act(async () => {
      getRoot().unmount();
      await Promise.resolve();
    });
    settings.resolve(defaultWorkspaceSettings());
    await open;

    expect(unregister).toHaveBeenCalledExactlyOnceWith(descriptor.workspaceId);
    expect(dependencies.workspaceGateways.detection.detectWorkspace).not.toHaveBeenCalled();
    expect(dependencies.workspaceTrustGateway.getTrust).not.toHaveBeenCalled();
    expect(staleWorkbench.workspaceRoot).toBeNull();
    expect(staleWorkbench.workspaceIdentityDescriptor).toBeNull();
  });
  it("coalesces sequential same-id aliases into one selected workspace tab", async () => {
    const canonicalRoot = "/real/sequential";
    const descriptorA = {
      ...trustedDescriptor("ws-sequential", "/link/sequential-a"),
      canonicalRoot,
    };
    const descriptorB = {
      ...trustedDescriptor("ws-sequential", "/link/sequential-b"),
      canonicalRoot,
    };
    const otherDescriptor = trustedDescriptor("ws-sequential-other", "/workspace-other");
    const unregister = vi.fn(async () => undefined);
    const { getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path) => {
          if (path === descriptorB.selectedPath) {
            return descriptorB;
          }
          if (path === otherDescriptor.selectedPath) {
            return otherDescriptor;
          }
          return descriptorA;
        }),
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptorA.selectedPath);
    });
    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptorB.selectedPath);
    });

    expect(getWorkbench().workspaceRoot).toBe(descriptorB.selectedPath);
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptorB);
    expect(getWorkbench().workspaceTabs).toEqual([descriptorB.selectedPath]);
    expect(getWorkbench().sidebarView).toBe("git");
    expect(unregister).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(otherDescriptor.selectedPath);
    });
    expect(getWorkbench().workspaceTabs).toEqual([
      descriptorB.selectedPath,
      otherDescriptor.selectedPath,
    ]);
    await act(async () => {
      await getWorkbench().activateWorkspaceTab(descriptorB.selectedPath);
    });
    expect(getWorkbench().workspaceTabs).toEqual([
      descriptorB.selectedPath,
      otherDescriptor.selectedPath,
    ]);
    expect(getWorkbench().sidebarView).toBe("git");

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(canonicalRoot);
    });
    expect(getWorkbench().workspaceTabs).toEqual([otherDescriptor.selectedPath]);
    expect(getWorkbench().workspaceRoot).toBe(otherDescriptor.selectedPath);
    expect(unregister).toHaveBeenCalledExactlyOnceWith(descriptorB.workspaceId);

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptorA.selectedPath);
    });
    expect(getWorkbench().workspaceRoot).toBe(descriptorA.selectedPath);
    expect(getWorkbench().workspaceTabs).toEqual([
      otherDescriptor.selectedPath,
      descriptorA.selectedPath,
    ]);
  });
  it("preserves canonical mappings when a dirty alias close is cancelled", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-close-cancel", "/link/close-cancel"),
      canonicalRoot: "/real/close-cancel",
    };
    const unregister = vi.fn(async () => undefined);
    const { dependencies, getWorkbench } = renderController({
      readTextFile: vi.fn(async () => "const clean = true;\n"),
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptor),
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(
        fileEntry(`${descriptor.selectedPath}/Dirty.ts`, "Dirty.ts"),
      );
    });
    act(() => {
      getWorkbench().updateActiveDocument("const dirty = true;\n");
    });
    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(false);
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptor.canonicalRoot);
    });

    expect(getWorkbench().workspaceTabs).toEqual([descriptor.selectedPath]);
    expect(getWorkbench().workspaceRoot).toBe(descriptor.selectedPath);
    expect(unregister).not.toHaveBeenCalled();
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().setStatusBarItemVisibility("message", false);
    });
    expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenLastCalledWith(
      {
        canonicalKey: descriptor.canonicalRoot,
        legacyRawKeys: [descriptor.canonicalRoot, descriptor.selectedPath],
      },
      expect.any(Object),
    );

    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(true);
    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptor.canonicalRoot);
    });
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      descriptor.selectedPath,
    );
  });
  it("preserves canonical mappings when alias close settings persistence fails", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-close-failure", "/link/close-failure"),
      canonicalRoot: "/real/close-failure",
    };
    const unregister = vi.fn(async () => undefined);
    const { dependencies, getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptor),
        unregister,
      },
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
    });
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockRejectedValueOnce(
      new Error("close settings failed"),
    );
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptor.canonicalRoot);
    });

    expect(getWorkbench().workspaceTabs).toEqual([descriptor.selectedPath]);
    expect(getWorkbench().workspaceRoot).toBe(descriptor.selectedPath);
    expect(unregister).not.toHaveBeenCalled();
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().setStatusBarItemVisibility("message", false);
    });
    expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenLastCalledWith(
      {
        canonicalKey: descriptor.canonicalRoot,
        legacyRawKeys: [descriptor.canonicalRoot, descriptor.selectedPath],
      },
      expect.any(Object),
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptor.canonicalRoot);
    });
    expect(getWorkbench().workspaceTabs).toEqual([]);
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      descriptor.selectedPath,
    );
  });
  it("retains identity ownership after unregister failure and retries on close", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-close-unregister-retry", "/link/retry-close"),
      canonicalRoot: "/real/retry-close",
    };
    const unregister = vi
      .fn<(workspaceId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("transient unregister failure"))
      .mockResolvedValue(undefined);
    const { dependencies, getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptor),
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
    });
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptor.canonicalRoot);
    });

    expect(unregister).toHaveBeenCalledOnce();
    expect(getWorkbench().workspaceTabs).toEqual([descriptor.selectedPath]);
    expect(getWorkbench().workspaceRoot).toBe(descriptor.selectedPath);
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptor);
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptor.canonicalRoot);
    });

    expect(unregister).toHaveBeenCalledTimes(2);
    expect(unregister).toHaveBeenLastCalledWith(descriptor.workspaceId);
    expect(getWorkbench().workspaceTabs).toEqual([]);
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledExactlyOnceWith(descriptor.selectedPath);
  });
  it("retains failed identity ownership for one unmount retry", async () => {
    const descriptor = {
      ...trustedDescriptor("ws-close-unregister-unmount", "/link/retry-unmount"),
      canonicalRoot: "/real/retry-unmount",
    };
    const unregister = vi
      .fn<(workspaceId: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error("transient unregister failure"))
      .mockResolvedValue(undefined);
    const { getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptor),
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
      await getWorkbench().closeWorkspaceTab(descriptor.selectedPath);
    });

    expect(unregister).toHaveBeenCalledOnce();
    expect(getWorkbench().workspaceTabs).toEqual([descriptor.selectedPath]);

    await act(async () => {
      getRoot().unmount();
      await Promise.resolve();
    });

    expect(unregister).toHaveBeenCalledTimes(2);
    expect(unregister).toHaveBeenLastCalledWith(descriptor.workspaceId);
  });
  it("defers close cleanup until unrelated admission release succeeds", async () => {
    const descriptorA = trustedDescriptor(
      "ws-deferred-release-success",
      "/workspace-deferred-success",
    );
    const descriptorB = trustedDescriptor(
      "ws-unrelated-admission-success",
      "/workspace-unrelated-success",
    );
    const admissionB = createDeferred<typeof descriptorB>();
    const releaseA = createDeferred<void>();
    const unregister = vi.fn((workspaceId: string) =>
      workspaceId === descriptorA.workspaceId ? releaseA.promise : Promise.resolve(),
    );
    const { dependencies, getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn((path) =>
          path === descriptorB.selectedPath ? admissionB.promise : Promise.resolve(descriptorA),
        ),
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptorA.selectedPath);
    });

    let openingB!: Promise<boolean>;
    await act(async () => {
      openingB = getWorkbench().openWorkspaceRoot(descriptorB.selectedPath);
      await Promise.resolve();
    });
    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptorA.selectedPath);
    });

    expect(unregister).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceTabs).toEqual([descriptorA.selectedPath]);

    admissionB.resolve(descriptorB);
    await act(async () => openingB);
    await waitForReact(() => {
      expect(unregister).toHaveBeenCalledExactlyOnceWith(descriptorA.workspaceId);
    });

    releaseA.resolve();
    await act(async () => {
      await releaseA.promise;
      await Promise.resolve();
    });
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptorA.selectedPath);
    });

    expect(
      unregister.mock.calls.filter(([workspaceId]) => workspaceId === descriptorA.workspaceId),
    ).toHaveLength(1);
    expect(getWorkbench().workspaceTabs).toEqual([descriptorB.selectedPath]);
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledExactlyOnceWith(descriptorA.selectedPath);
  });
  it("preserves deferred close state after unrelated admission release fails and retries", async () => {
    const descriptorA = trustedDescriptor(
      "ws-deferred-release-failure",
      "/workspace-deferred-failure",
    );
    const descriptorB = trustedDescriptor(
      "ws-unrelated-admission-failure",
      "/workspace-unrelated-failure",
    );
    const admissionB = createDeferred<typeof descriptorB>();
    const firstReleaseA = createDeferred<void>();
    let releaseAttempts = 0;
    const unregister = vi.fn((workspaceId: string) => {
      if (workspaceId !== descriptorA.workspaceId) {
        return Promise.resolve();
      }

      releaseAttempts += 1;
      if (releaseAttempts === 1) {
        return firstReleaseA.promise;
      }

      return Promise.resolve();
    });
    const { dependencies, getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn((path) =>
          path === descriptorB.selectedPath ? admissionB.promise : Promise.resolve(descriptorA),
        ),
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptorA.selectedPath);
    });

    let openingB!: Promise<boolean>;
    await act(async () => {
      openingB = getWorkbench().openWorkspaceRoot(descriptorB.selectedPath);
      await Promise.resolve();
    });
    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptorA.selectedPath);
    });

    admissionB.resolve(descriptorB);
    await act(async () => openingB);
    await waitForReact(() => {
      expect(releaseAttempts).toBe(1);
    });

    firstReleaseA.reject(new Error("deferred unregister failed"));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(getWorkbench().workspaceTabs).toEqual([
      descriptorA.selectedPath,
      descriptorB.selectedPath,
    ]);
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptorA.selectedPath);
    });

    expect(releaseAttempts).toBe(2);
    expect(getWorkbench().workspaceTabs).toEqual([descriptorB.selectedPath]);
    expect(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).toHaveBeenCalledExactlyOnceWith(descriptorA.selectedPath);
  });
  it("keeps a same-id alias reopened while close settings persistence waits", async () => {
    const canonicalRoot = "/real/reopen-during-close";
    const descriptorA = {
      ...trustedDescriptor("ws-reopen-during-close", "/link/close-a"),
      canonicalRoot,
    };
    const descriptorB = {
      ...trustedDescriptor("ws-reopen-during-close", "/link/close-b"),
      canonicalRoot,
    };
    const closeSettings = createDeferred<void>();
    const unregister = vi.fn(async () => undefined);
    const { dependencies, getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async (path) =>
          path === descriptorB.selectedPath ? descriptorB : descriptorA,
        ),
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptorA.selectedPath);
    });
    act(() => {
      getWorkbench().setSidebarView("git");
    });

    const saveAppSettings = vi.mocked(dependencies.settingsGateway.saveAppSettings);
    saveAppSettings.mockClear();
    saveAppSettings
      .mockImplementationOnce(() => closeSettings.promise)
      .mockResolvedValue(undefined);

    let closing!: Promise<void>;
    await act(async () => {
      closing = getWorkbench().closeWorkspaceTab(descriptorA.canonicalRoot);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(saveAppSettings).toHaveBeenCalledOnce();
    });

    let reopening!: Promise<boolean>;
    await act(async () => {
      reopening = getWorkbench().openWorkspaceRoot(descriptorB.selectedPath);
      await Promise.resolve();
    });

    closeSettings.resolve();
    await act(async () => {
      await Promise.all([closing, reopening]);
    });

    expect(getWorkbench().workspaceTabs).toEqual([descriptorB.selectedPath]);
    expect(getWorkbench().workspaceRoot).toBe(descriptorB.selectedPath);
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptorB);
    expect(getWorkbench().sidebarView).toBe("git");
    expect(unregister).not.toHaveBeenCalled();
  });
  it("keeps a same-path reopen while the single final runtime disposal waits", async () => {
    const canonicalRoot = "/real/reopen-during-clear";
    const descriptor = {
      ...trustedDescriptor("ws-reopen-during-clear", "/link/clear-a"),
      canonicalRoot,
    };
    const finalRuntimeStop = createDeferred<void>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: descriptor.selectedPath,
      sessionId: 77,
    };
    const { dependencies, getWorkbench } = renderController({
      runtimeStatus: runningStatus,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
        openPath: vi.fn(async () => descriptor),
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
    });
    act(() => {
      getWorkbench().setSidebarView("git");
    });

    const disposeWorkspace = vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    );
    disposeWorkspace.mockClear();
    disposeWorkspace
      .mockImplementationOnce(() => finalRuntimeStop.promise)
      .mockResolvedValue(undefined);

    let closing!: Promise<void>;
    await act(async () => {
      closing = getWorkbench().closeWorkspaceTab(descriptor.selectedPath);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(disposeWorkspace).toHaveBeenCalledOnce();
    });

    let reopening!: Promise<boolean>;
    await act(async () => {
      reopening = getWorkbench().openWorkspaceRoot(descriptor.selectedPath);
      await Promise.resolve();
    });

    finalRuntimeStop.resolve();
    await act(async () => {
      await Promise.all([closing, reopening]);
    });

    expect(disposeWorkspace).toHaveBeenCalledOnce();
    expect(getWorkbench().workspaceTabs).toEqual([descriptor.selectedPath]);
    expect(getWorkbench().workspaceRoot).toBe(descriptor.selectedPath);
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptor);
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(runningStatus);
  });
  it("restores the canonical cache winner when admitted over legacy alias collisions", async () => {
    const aliasRoot = "/link/workspace";
    const canonicalRoot = "/real/workspace";
    const otherRoot = "/other/workspace";
    const identityGateway: WorkbenchWorkspaceGateways["identity"] = {
      getDescriptor: vi.fn(),
      openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
      unregister: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({ workspaceIdentityGateway: identityGateway });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(aliasRoot);
    });
    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(otherRoot);
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(canonicalRoot);
    });
    act(() => {
      getWorkbench().setSidebarView("php");
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(otherRoot);
    });

    identityGateway.openPath = vi.fn(async () => ({
      ...trustedDescriptor("ws-canonical-winner", aliasRoot),
      canonicalRoot,
    }));
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(aliasRoot);
    });

    expect(getWorkbench().workspaceRoot).toBe(aliasRoot);
    expect(getWorkbench().sidebarView).toBe("php");
  });
  it("promotes the newest active legacy snapshot when the same root gains an identity", async () => {
    const workspaceRoot = "/workspace/legacy-to-admitted";
    const otherRoot = "/workspace/legacy-to-admitted-other";
    const admittedDescriptor = trustedDescriptor("ws-newly-admitted", workspaceRoot);
    const identityGateway: WorkbenchWorkspaceGateways["identity"] = {
      getDescriptor: vi.fn(),
      openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
      unregister: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      workspaceIdentityGateway: identityGateway,
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(workspaceRoot);
    });
    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(otherRoot);
    });
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(workspaceRoot);
    });
    expect(getWorkbench().sidebarView).toBe("git");

    act(() => {
      getWorkbench().setSidebarView("php");
    });
    identityGateway.openPath = vi.fn(async () => admittedDescriptor);
    await act(async () => {
      await getWorkbench().openWorkspaceRoot(workspaceRoot);
    });

    expect(getWorkbench().workspaceIdentityDescriptor).toBe(admittedDescriptor);
    expect(getWorkbench().sidebarView).toBe("php");
  });
  it("rejects foreign legacy cache owners without adopting their editor state", () => {
    const admittedDescriptor = {
      ...trustedDescriptor("ws-admitted", "/link/workspace"),
      canonicalRoot: "/real/workspace",
    };
    const canonicalOwner = {
      ...trustedDescriptor("ws-canonical-foreign", "/real/workspace"),
      canonicalRoot: "/real/workspace",
    };
    const selectedOwner = trustedDescriptor("ws-selected-foreign", "/link/workspace");
    const canonicalState = {
      editorSurface: { marker: "canonical-documents" },
      navigationHistory: { marker: "canonical-history" },
      workspaceIdentityDescriptor: canonicalOwner,
    };
    const selectedState = {
      editorSurface: { marker: "selected-documents" },
      navigationHistory: { marker: "selected-history" },
      workspaceIdentityDescriptor: selectedOwner,
    };

    const adopted = adoptLegacyCachedWorkspaceState(admittedDescriptor, [
      canonicalState,
      selectedState,
    ]);

    expect(adopted).toBeNull();
    expect(canonicalState).toEqual({
      editorSurface: { marker: "canonical-documents" },
      navigationHistory: { marker: "canonical-history" },
      workspaceIdentityDescriptor: canonicalOwner,
    });
    expect(selectedState).toEqual({
      editorSurface: { marker: "selected-documents" },
      navigationHistory: { marker: "selected-history" },
      workspaceIdentityDescriptor: selectedOwner,
    });
  });
  it("migrates a same-owner legacy alias after rejecting a foreign canonical entry", () => {
    const admittedDescriptor = {
      ...trustedDescriptor("ws-shared", "/link/workspace"),
      canonicalRoot: "/real/workspace",
    };
    const foreignDescriptor = {
      ...trustedDescriptor("ws-foreign", "/real/workspace"),
      canonicalRoot: "/real/workspace",
    };
    const staleAliasDescriptor = {
      ...trustedDescriptor("ws-shared", "/old-link/workspace"),
      canonicalRoot: "/real/workspace",
    };
    const foreignCanonicalState = {
      editorSurface: { marker: "foreign-documents" },
      navigationHistory: { marker: "foreign-history" },
      workspaceIdentityDescriptor: foreignDescriptor,
    };
    const matchingAliasState = {
      editorSurface: { marker: "owned-documents" },
      navigationHistory: { marker: "owned-history" },
      workspaceIdentityDescriptor: staleAliasDescriptor,
    };

    const adopted = adoptLegacyCachedWorkspaceState(admittedDescriptor, [
      foreignCanonicalState,
      matchingAliasState,
    ]);

    expect(adopted).toBe(matchingAliasState);
    expect(matchingAliasState.workspaceIdentityDescriptor).toBe(admittedDescriptor);
    expect(matchingAliasState.editorSurface).toEqual({
      marker: "owned-documents",
    });
    expect(matchingAliasState.navigationHistory).toEqual({
      marker: "owned-history",
    });
    expect(foreignCanonicalState.workspaceIdentityDescriptor).toBe(foreignDescriptor);
  });
  it("opens, caches, and restores separate trusted descriptors across project tabs", async () => {
    const descriptorA = {
      workspaceId: "ws-a",
      selectedPath: "/link/a",
      canonicalRoot: "/real/a",
      caseSensitive: null,
      unicodeNormalizationPolicy: "unknown" as const,
      policy: { caseSensitive: true as const, unicodeNormalization: "none" as const },
    };
    const descriptorB = {
      workspaceId: "ws-b",
      selectedPath: "/workspace-b",
      canonicalRoot: "/workspace-b",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved" as const,
      policy: { caseSensitive: true as const, unicodeNormalization: "none" as const },
    };
    const openFromPicker = vi
      .fn()
      .mockResolvedValueOnce({ status: "opened", descriptor: descriptorA })
      .mockResolvedValueOnce({ status: "opened", descriptor: descriptorB });
    const { dependencies, getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker,
        unregister: vi.fn(async () => undefined),
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspace();
    });
    await act(async () => {
      await getWorkbench().openWorkspace();
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptorB);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(descriptorA.selectedPath);
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptorA);
    expect(getWorkbench().workspaceTabs).toEqual([
      descriptorA.selectedPath,
      descriptorB.selectedPath,
    ]);
    expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
      descriptorA.selectedPath,
      "basic",
    );
    expect(dependencies.smartModeGateway.setMode).toHaveBeenCalledWith(
      descriptorB.selectedPath,
      "basic",
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab(descriptorA.selectedPath);
    });
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      descriptorA.selectedPath,
    );
  });
  it("releases an unadopted descriptor when workspace opening throws", async () => {
    const unregister = vi.fn(async () => undefined);
    const descriptor = {
      workspaceId: "ws-failed",
      selectedPath: "/failed",
      canonicalRoot: "/failed",
      caseSensitive: true,
      unicodeNormalizationPolicy: "preserved" as const,
      policy: { caseSensitive: true as const, unicodeNormalization: "none" as const },
    };

    await expect(
      withWorkspaceIdentityLease(descriptor, unregister, async () => {
        throw new Error("open failed");
      }),
    ).rejects.toThrow("open failed");
    expect(unregister).toHaveBeenCalledExactlyOnceWith("ws-failed");
  });
  it("releases a picker descriptor when its open is superseded before adoption", async () => {
    const firstSettings = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => defaultAppSettings()),
      loadWorkspaceSettings: vi.fn((identity) =>
        (typeof identity === "string" ? identity : identity.canonicalKey) === "/workspace-a"
          ? firstSettings.promise
          : Promise.resolve(defaultWorkspaceSettings()),
      ),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const descriptorA = trustedDescriptor("ws-a", "/workspace-a");
    const descriptorB = trustedDescriptor("ws-b", "/workspace-b");
    const unregister = vi.fn(async () => undefined);
    const openFromPicker = vi
      .fn()
      .mockResolvedValueOnce({ status: "opened", descriptor: descriptorA })
      .mockResolvedValueOnce({ status: "opened", descriptor: descriptorB });
    const { getWorkbench } = renderController({
      settingsGateway,
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker,
        unregister,
      },
    });

    let firstOpen!: Promise<void>;
    await act(async () => {
      firstOpen = getWorkbench().openWorkspace();
      await Promise.resolve();
    });
    await act(async () => {
      await getWorkbench().openWorkspace();
    });
    await act(async () => {
      firstSettings.resolve(defaultWorkspaceSettings());
      await firstOpen;
    });

    expect(unregister).toHaveBeenCalledExactlyOnceWith("ws-a");
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(descriptorB);
  });
  it("replaces a cached descriptor with a fresh picker identity exactly once", async () => {
    const oldDescriptor = trustedDescriptor("ws-old", "/workspace");
    const freshDescriptor = trustedDescriptor("ws-fresh", "/workspace");
    const unregister = vi.fn(async () => undefined);
    const openFromPicker = vi
      .fn()
      .mockResolvedValueOnce({ status: "opened", descriptor: oldDescriptor })
      .mockResolvedValueOnce({ status: "opened", descriptor: freshDescriptor });
    const { getWorkbench } = renderController({
      workspaceIdentityGateway: {
        getDescriptor: vi.fn(),
        openFromPicker,
        unregister,
      },
    });

    await act(async () => {
      await getWorkbench().openWorkspace();
    });
    await act(async () => {
      await getWorkbench().openWorkspace();
    });
    await waitForReact(() => {
      expect(unregister).toHaveBeenCalledExactlyOnceWith("ws-old");
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(freshDescriptor);
    expect(unregister).not.toHaveBeenCalledWith("ws-fresh");

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace");
    });
    expect(getWorkbench().workspaceIdentityDescriptor).toBe(freshDescriptor);
    expect(unregister).toHaveBeenCalledTimes(1);
  });
  it("keeps a shared split document alive until its final group membership closes", async () => {
    const path = "/workspace/src/Shared.ts";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 91,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export const shared = true;\n"),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile({ kind: "file", name: "Shared.ts", path });
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));

    const split = getWorkbench().editorGroups;
    const groupIds = Object.keys(split.groups);
    expect(groupIds).toHaveLength(2);
    expect(groupIds.every((groupId) => split.groups[groupId].activePath === path)).toBe(true);
    vi.mocked(dependencies.documentSyncGateway.didClose).mockClear();

    await act(async () => {
      await getWorkbench().closeDocumentInEditorGroup(groupIds[0], path);
    });
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([path]);
    expect(dependencies.documentSyncGateway.didClose).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().closeDocumentInEditorGroup(groupIds[1], path);
    });
    await flushAsyncTurns(12);
    expect(getWorkbench().openDocuments).toEqual([]);
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledOnce();
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith("/workspace", path, 91);
  });
  it("routes previous and next commands from a directly focused same-file group", async () => {
    const path = "/workspace/src/Shared.ts";
    const editorGroupFocusRunner = vi.fn(() => true);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      editorGroupFocusRunner,
      readTextFile: vi.fn(async () => "export const shared = true;\n"),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile({ kind: "file", name: "Shared.ts", path });
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));

    const [leftGroupId, rightGroupId] = Object.keys(getWorkbench().editorGroups.groups);
    expect(
      [leftGroupId, rightGroupId].map(
        (groupId) => getWorkbench().editorGroups.groups[groupId].activePath,
      ),
    ).toEqual([path, path]);

    act(() => getWorkbench().activateEditorGroup(leftGroupId));
    act(() => getWorkbench().activateEditorGroup(rightGroupId));
    expect(getWorkbench().editorGroups.activeGroupId).toBe(rightGroupId);

    act(() => {
      getWorkbench()
        .commands.find((command) => command.id === "editor.focusPreviousGroup")
        ?.run();
    });
    expect(getWorkbench().editorGroups.activeGroupId).toBe(leftGroupId);
    expect(editorGroupFocusRunner).toHaveBeenLastCalledWith(leftGroupId);

    act(() => {
      getWorkbench()
        .commands.find((command) => command.id === "editor.focusNextGroup")
        ?.run();
    });
    expect(getWorkbench().editorGroups.activeGroupId).toBe(rightGroupId);
    expect(editorGroupFocusRunner).toHaveBeenLastCalledWith(rightGroupId);
    expect(editorGroupFocusRunner).toHaveBeenCalledTimes(2);
  });
  it("isolates a cold workspace from another project's split layout and restores the cached split", async () => {
    const path = "/workspace-a/src/App.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async () => "export const app = true;\n"),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile({ kind: "file", name: "App.ts", path });
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    expect(Object.keys(getWorkbench().editorGroups.groups)).toHaveLength(2);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().editorGroups).toEqual(createInitialEditorGroupsState("editor-main"));

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(Object.keys(getWorkbench().editorGroups.groups)).toHaveLength(2);
    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([path]);
  });
  it("allocates a fresh group id after restoring an existing split session", async () => {
    const path = "/workspace/src/App.ts";
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      session: {
        bottomPanelView: "problems" as const,
        editor: {
          activeGroupId: "editor-1",
          groups: {
            "editor-main": { activePath: path, openPaths: [path], previewPath: null },
            "editor-1": { activePath: path, openPaths: [path], previewPath: null },
          },
          layout: {
            kind: "split" as const,
            orientation: "horizontal" as const,
            sizes: [0.5, 0.5] as [number, number],
            children: [
              { kind: "group" as const, groupId: "editor-main" },
              { kind: "group" as const, groupId: "editor-1" },
            ],
          },
        },
        sidebarView: "files" as const,
        version: 1 as const,
      },
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile: vi.fn(async () => "export const app = true;\n"),
      workspaceSettings,
    });
    await flushAsyncTurns(24);

    expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual(["editor-main", "editor-1"]);
    act(() => getWorkbench().splitActiveEditorGroup("right"));

    expect(Object.keys(getWorkbench().editorGroups.groups)).toEqual([
      "editor-main",
      "editor-1",
      "editor-2",
    ]);
  });
  it("moves a tab between groups atomically without closing its document", async () => {
    const path = "/workspace/src/Move.ts";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 92,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export const moved = true;\n"),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile({ kind: "file", name: "Move.ts", path });
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    const groupIds = Object.keys(getWorkbench().editorGroups.groups);
    vi.mocked(dependencies.documentSyncGateway.didClose).mockClear();
    await act(async () => {
      getWorkbench().closeDocumentInEditorGroup(groupIds[1], path);
      getWorkbench().moveEditorGroupTab(groupIds[0], groupIds[1], path);
      await Promise.resolve();
    });

    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([path]);
    expect(getWorkbench().editorGroups.groups[groupIds[0]].activePath).toBeNull();
    expect(getWorkbench().editorGroups.groups[groupIds[1]].activePath).toBe(path);
    expect(dependencies.documentSyncGateway.didClose).not.toHaveBeenCalled();
  });
  it("prompts only when closing the final dirty split membership", async () => {
    const path = "/workspace/src/Dirty.ts";
    const confirm = vi.fn(() => false);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      prompter: { confirm, prompt: vi.fn(() => null) },
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile({ kind: "file", name: "Dirty.ts", path });
    });
    act(() => getWorkbench().splitActiveEditorGroup("right"));
    const groupIds = Object.keys(getWorkbench().editorGroups.groups);
    act(() => getWorkbench().updateActiveDocument("export const value = 2;\n"));

    await act(async () => {
      await getWorkbench().closeDocumentInEditorGroup(groupIds[0], path);
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(getWorkbench().openDocuments).toHaveLength(1);

    await act(async () => {
      await getWorkbench().closeDocumentInEditorGroup(groupIds[1], path);
    });
    expect(confirm).toHaveBeenCalledOnce();
    expect(getWorkbench().openDocuments).toHaveLength(1);
  });
  it("opens the Express panel for a JS workspace without an active document", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument).toBeNull();
    await act(async () => {
      await runCommand(getWorkbench(), "panel.showExpressRoutes");
    });
    expect(getWorkbench().bottomPanelView).toBe("expressRoutes");
    expect(getWorkbench().bottomPanelVisible).toBe(true);
  });
  describe("bookmarks", () => {
    it("toggles a bookmark at the active cursor line capturing the line preview", async () => {
      const readTextFile = vi.fn(async () => "line one\nline two\nline three\n");
      const { getWorkbench } = renderController({ readTextFile });
      const file = fileEntry("/workspace/src/User.php", "User.php");

      await act(async () => {
        await getWorkbench().openPinnedFile(file);
      });
      await flushAsyncTurns();

      act(() => {
        getWorkbench().updateActiveEditorPosition({ column: 1, lineNumber: 2 });
      });
      act(() => {
        getWorkbench().toggleBookmarkAtCursor();
      });

      expect(getWorkbench().bookmarks).toEqual([
        { lineNumber: 2, path: file.path, preview: "line two" },
      ]);

      act(() => {
        getWorkbench().toggleBookmarkAtCursor();
      });

      expect(getWorkbench().bookmarks).toEqual([]);
    });

    it("keeps bookmarks isolated per workspace tab with no leak across A -> B -> A", async () => {
      const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
        detectWorkspace: vi.fn(async (rootPath) => ({
          javaScriptTypeScript: null,
          php: null,
          rootPath,
        })),
      };
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        readTextFile: vi.fn(async () => "alpha\nbeta\ngamma\n"),
        workspaceDetectionGateway,
      });
      await waitForReact(() => {
        expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
      });

      const fileA = fileEntry("/workspace-a/src/A.php", "A.php");
      await act(async () => {
        await getWorkbench().openPinnedFile(fileA);
      });
      await flushAsyncTurns();
      act(() => {
        getWorkbench().updateActiveEditorPosition({ column: 1, lineNumber: 1 });
      });
      act(() => {
        getWorkbench().toggleBookmarkAtCursor();
      });

      expect(getWorkbench().bookmarks).toEqual([
        { lineNumber: 1, path: fileA.path, preview: "alpha" },
      ]);

      // Switch to workspace B: its bookmark list must start empty (no leak).
      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns(24);

      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
      expect(getWorkbench().bookmarks).toEqual([]);

      const fileB = fileEntry("/workspace-b/src/B.php", "B.php");
      await act(async () => {
        await getWorkbench().openPinnedFile(fileB);
      });
      await flushAsyncTurns();
      act(() => {
        getWorkbench().updateActiveEditorPosition({ column: 1, lineNumber: 2 });
      });
      act(() => {
        getWorkbench().toggleBookmarkAtCursor();
      });

      expect(getWorkbench().bookmarks).toEqual([
        { lineNumber: 2, path: fileB.path, preview: "beta" },
      ]);

      // Switch back to workspace A: its original bookmark must be restored and
      // workspace B's bookmark must not bleed in.
      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-a");
      });
      await flushAsyncTurns(24);

      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
      expect(getWorkbench().bookmarks).toEqual([
        { lineNumber: 1, path: fileA.path, preview: "alpha" },
      ]);
    });

    it("navigates to the next bookmark across files and reveals it", async () => {
      const { getWorkbench } = renderController({
        readTextFile: vi.fn(async () => "one\ntwo\nthree\nfour\n"),
      });
      const file = fileEntry("/workspace/src/User.php", "User.php");

      await act(async () => {
        await getWorkbench().openPinnedFile(file);
      });
      await flushAsyncTurns();

      act(() => {
        getWorkbench().updateActiveEditorPosition({ column: 1, lineNumber: 2 });
      });
      act(() => {
        getWorkbench().toggleBookmarkAtCursor();
      });
      act(() => {
        getWorkbench().updateActiveEditorPosition({ column: 1, lineNumber: 4 });
      });
      act(() => {
        getWorkbench().toggleBookmarkAtCursor();
      });

      // Cursor sits on line 4 (the last bookmark); next wraps to line 2.
      await act(async () => {
        await getWorkbench().goToNextBookmark();
      });
      await flushAsyncTurns();

      expect(getWorkbench().editorRevealTarget?.position.lineNumber).toBe(2);

      // Previous from line 2 wraps back to line 4.
      act(() => {
        getWorkbench().updateActiveEditorPosition({ column: 1, lineNumber: 2 });
      });
      await act(async () => {
        await getWorkbench().goToPreviousBookmark();
      });
      await flushAsyncTurns();

      expect(getWorkbench().editorRevealTarget?.position.lineNumber).toBe(4);
    });
  });
  describe("turning IDE mode off", () => {
    it("tells the user PHPactor and the index are stopping before the runtime finishes stopping", async () => {
      const runtimeStop =
        createDeferred<Awaited<ReturnType<LanguageServerRuntimeGateway["stop"]>>>();
      const { dependencies, getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace/laravel-app",
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          intelligenceMode: "fullSmart",
        },
      });
      await flushAsyncTurns();
      vi.mocked(dependencies.languageServerRuntimeGateway.stop).mockImplementationOnce(
        async () => runtimeStop.promise,
      );

      let modePromise: Promise<void> = Promise.resolve();
      await act(async () => {
        modePromise = getWorkbench().setSmartMode("basic");
        await Promise.resolve();
      });
      await waitForReact(() => {
        expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith(
          "/workspace/laravel-app",
        );
      });

      // The PHPactor stop is still in flight (deferred), so the "what's being
      // killed" message must already be visible - the user should not have to
      // wait for the stop to complete to learn IDE mode is shutting things down.
      expect(getWorkbench().message).toBe("Stopping PHPactor + index for laravel-app");

      await act(async () => {
        runtimeStop.resolve({
          kind: "stopped",
          rootPath: "/workspace/laravel-app",
        });
        await modePromise;
      });
      await flushAsyncTurns();

      expect(getWorkbench().intelligenceMode).toBe("basic");
    });

    it("does not show a stopping message when IDE mode was already off", async () => {
      const { getWorkbench } = renderController({
        appSettings: {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace/laravel-app",
        },
        workspaceDescriptor: phpWorkspaceDescriptor(),
        workspaceSettings: {
          ...defaultWorkspaceSettings(),
          intelligenceMode: "basic",
        },
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().setSmartMode("basic");
      });

      expect(getWorkbench().message).not.toBe("Stopping PHPactor + index for laravel-app");
    });
  });
  describe("debugger wiring", () => {
    const expectDefaultDebugStart = (
      start: DebugGatewayHarness["start"],
      launch: Parameters<DebugGateway["start"]>[1],
    ) => expect(start).toHaveBeenCalledWith("/workspace", launch, [], "none", [], []);

    it("starts a vitest debug session for the active JS test file via debug.start", async () => {
      const testPath = "/workspace/packages/math/src/sum.test.ts";
      const readTextFile = vi.fn(async (path: string) => {
        if (path === testPath) {
          return `it("adds numbers", () => {});\n`;
        }

        if (path === "/workspace/packages/math/vitest.config.ts") {
          return "export default {};";
        }

        throw new Error(`missing: ${path}`);
      });
      const debugGateway = createDebugGatewayHarness();
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugGateway: debugGateway.gateway,
        readTextFile,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(testPath, "sum.test.ts"));
      });
      expect(getWorkbench().isActiveDocumentJsTest).toBe(true);

      await act(async () => {
        await runCommand(getWorkbench(), "debug.start");
      });
      await flushAsyncTurns();

      expectDefaultDebugStart(debugGateway.start, {
        kind: "js-test-file",
        runner: "vitest",
        filePath: testPath,
        packageRootPath: "/workspace/packages/math",
      });
      expect(getWorkbench().debugSession.snapshot.state).toEqual({
        kind: "running",
        sessionId: 7,
      });

      await act(async () => {
        debugGateway.emit({
          rootPath: "/workspace",
          sessionId: 7,
          seq: 1,
          payload: { kind: "started", sessionId: 7 },
        });
        debugGateway.emit({
          rootPath: "/workspace",
          sessionId: 7,
          seq: 2,
          payload: {
            kind: "stopped",
            reason: "breakpoint",
            frames: [
              {
                frameId: 1,
                name: "adds numbers",
                filePath: testPath,
                lineNumber: 1,
                column: 1,
              },
            ],
            pauseGeneration: 1,
          },
        });
        await Promise.resolve();
      });
      await flushAsyncTurns();

      expect(getWorkbench().debugStoppedLocation).toEqual({
        filePath: testPath,
        lineNumber: 1,
      });
    });

    it("starts a node-script debug session for a plain JS file via debug.start", async () => {
      const scriptPath = "/workspace/tools/build.js";
      const readTextFile = vi.fn(async (path: string) => {
        if (path === scriptPath) {
          return "console.log('build');\n";
        }

        throw new Error(`missing: ${path}`);
      });
      const debugGateway = createDebugGatewayHarness();
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugGateway: debugGateway.gateway,
        readTextFile,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(scriptPath, "build.js"));
      });

      await act(async () => {
        await runCommand(getWorkbench(), "debug.start");
        await flushAsyncTurns();
      });

      expectDefaultDebugStart(debugGateway.start, { kind: "node-script", scriptPath });
    });

    it("starts a php-script debug session for the active PHP file via debug.start", async () => {
      const scriptPath = "/workspace/public/index.php";
      const debugGateway = createDebugGatewayHarness();
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugGateway: debugGateway.gateway,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(scriptPath, "index.php"));
      });

      await act(async () => {
        await runCommand(getWorkbench(), "debug.start");
        await flushAsyncTurns();
      });

      expectDefaultDebugStart(debugGateway.start, { kind: "php-script", scriptPath });
      expect(getWorkbench().bottomPanelVisible).toBe(true);
    });

    it("starts a dedicated php-test-file debug session for PHPUnit and Pest files", async () => {
      const testPath = "/workspace/tests/Feature/InvoiceTest.php";
      const debugGateway = createDebugGatewayHarness();
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugGateway: debugGateway.gateway,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(testPath, "InvoiceTest.php"));
      });
      expect(getWorkbench().isActiveDocumentPhpTest).toBe(true);

      await act(async () => {
        await runCommand(getWorkbench(), "debug.start");
        await flushAsyncTurns();
      });

      expectDefaultDebugStart(debugGateway.start, { kind: "php-test-file", filePath: testPath });
      expect(String(getWorkbench().bottomPanelView)).toBe("debug");
    });

    it("starts a php listen session via debug.listenPhp", async () => {
      const debugGateway = createDebugGatewayHarness();
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugGateway: debugGateway.gateway,
        workspaceDescriptor: phpWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      await act(async () => {
        await runCommand(getWorkbench(), "debug.listenPhp");
        await flushAsyncTurns();
      });

      expectDefaultDebugStart(debugGateway.start, { kind: "php-listen" });
      expect(String(getWorkbench().bottomPanelView)).toBe("debug");
      expect(getWorkbench().bottomPanelVisible).toBe(true);
    });

    it("toggles a breakpoint at the cursor via command and persists it", async () => {
      const testPath = "/workspace/src/sum.test.ts";
      const readTextFile = vi.fn(async () => `it("adds", () => {});\nit("subs", () => {});\n`);
      const storage = inMemoryBreakpointStorage();
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugBreakpointStorage: storage,
        debugGateway: createDebugGatewayHarness().gateway,
        readTextFile,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(testPath, "sum.test.ts"));
      });
      act(() => {
        getWorkbench().updateActiveEditorPosition({ column: 1, lineNumber: 2 });
      });

      await act(async () => {
        await runCommand(getWorkbench(), "debug.toggleBreakpoint");
        await flushAsyncTurns();
      });

      expect(getWorkbench().debugSession.breakpoints).toEqual([
        expect.objectContaining({
          filePath: testPath,
          lineNumber: 2,
          enabled: true,
        }),
      ]);

      const raw = storage.getItem(debugBreakpointStorageKey("/workspace"));
      expect(raw).not.toBeNull();
      expect(deserializeBreakpoints(raw as string)).toEqual([
        expect.objectContaining({ filePath: testPath, lineNumber: 2 }),
      ]);
    });

    it("ignores debug.toggleBreakpoint on a read-only document", async () => {
      const storage = inMemoryBreakpointStorage();
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugBreakpointStorage: storage,
        debugGateway: createDebugGatewayHarness().gateway,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      act(() => {
        getWorkbench().openReadOnlyDocument(
          {
            content: `it("adds", () => {});\n`,
            language: "typescript",
            name: "sum.test.ts",
            path: "/workspace/src/sum.test.ts",
            readOnly: true,
            savedContent: `it("adds", () => {});\n`,
          },
          { pin: true },
        );
      });
      act(() => {
        getWorkbench().updateActiveEditorPosition({ column: 1, lineNumber: 1 });
      });

      await act(async () => {
        await runCommand(getWorkbench(), "debug.toggleBreakpoint");
        await flushAsyncTurns();
      });

      expect(getWorkbench().debugSession.breakpoints).toEqual([]);
      expect(storage.getItem(debugBreakpointStorageKey("/workspace"))).toBeNull();
    });

    it("drops a debug.start whose runner detection resolves after the active document changed", async () => {
      const testPath = "/workspace/src/sum.test.ts";
      const otherPath = "/workspace/src/other.js";
      const vitestConfig = createDeferred<string>();
      const readTextFile = vi.fn(async (path: string) => {
        if (path === testPath) {
          return `it("adds numbers", () => {});\n`;
        }

        if (path === otherPath) {
          return "console.log('other');\n";
        }

        if (path === "/workspace/vitest.config.ts") {
          return vitestConfig.promise;
        }

        throw new Error(`missing: ${path}`);
      });
      const debugGateway = createDebugGatewayHarness();
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugGateway: debugGateway.gateway,
        readTextFile,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(testPath, "sum.test.ts"));
      });

      let pendingStart: Promise<void> = Promise.resolve();
      act(() => {
        pendingStart = runCommand(getWorkbench(), "debug.start");
      });

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(otherPath, "other.js"));
      });

      await act(async () => {
        vitestConfig.resolve("export default {};");
        await pendingStart;
        await flushAsyncTurns();
      });

      expect(debugGateway.start).not.toHaveBeenCalled();
    });

    it("restores persisted breakpoints when the workspace opens", async () => {
      const persisted = [
        {
          id: "bp-42",
          filePath: "/workspace/src/sum.test.ts",
          lineNumber: 3,
          enabled: true,
        },
      ];
      const storage = inMemoryBreakpointStorage({
        [debugBreakpointStorageKey("/workspace")]: serializeBreakpoints(persisted),
      });
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugBreakpointStorage: storage,
        debugGateway: createDebugGatewayHarness().gateway,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      expect(getWorkbench().workspaceRoot).toBe("/workspace");
      expect(getWorkbench().debugSession.breakpoints).toEqual(persisted);
    });

    it("navigates to a debug frame location through the workbench navigation path", async () => {
      const filePath = "/workspace/src/service.ts";
      const readTextFile = vi.fn(
        async () => "line one\nline two\nline three\nline four\nline five\n",
      );
      const { getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        debugGateway: createDebugGatewayHarness().gateway,
        readTextFile,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns();

      await act(async () => {
        await getWorkbench().openDebugLocation(filePath, 5);
      });
      await flushAsyncTurns();

      expect(getWorkbench().activePath).toBe(filePath);
      expect(getWorkbench().editorRevealTarget?.position.lineNumber).toBe(5);
    });
  });
});

describe("useWorkbenchController workspace lifecycle, language runtimes, and save coordination", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("switches between persisted project tabs without stopping another project runtime", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-a", "/workspace-b"]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
    expect(dependencies.terminalGateway.stopRoot).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-a", "/workspace-b"]);
    expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({
        recentWorkspacePath: "/workspace-b",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      }),
    );
  });
  it("keeps runtime operation latencies scoped to the active project tab", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    act(() => {
      getWorkbench().recordCompletionLatency(12, "/workspace-a");
      getWorkbench().recordCompletionLatency(18, "/workspace-a", "definition");
    });

    expect(getWorkbench().getLatencySnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "completion",
          stats: expect.objectContaining({ count: 1, last: 12 }),
        }),
        expect.objectContaining({
          kind: "definition",
          stats: expect.objectContaining({ count: 1, last: 18 }),
        }),
      ]),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().getLatencySnapshot()).toEqual([]);

    act(() => {
      getWorkbench().recordCompletionLatency(30, "/workspace-b");
    });

    expect(getWorkbench().getLatencySnapshot()).toEqual([
      expect.objectContaining({
        kind: "completion",
        stats: expect.objectContaining({ count: 1, last: 30 }),
      }),
    ]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().getLatencySnapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "completion",
          stats: expect.objectContaining({ count: 1, last: 12 }),
        }),
        expect.objectContaining({
          kind: "definition",
          stats: expect.objectContaining({ count: 1, last: 18 }),
        }),
      ]),
    );
  });
  it("does not restore synthetic Git diff tabs from the workspace cache", async () => {
    const change: GitChangedFile = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: "/workspace-a/src/User.php",
      relativePath: "src/User.php",
      status: "modified",
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      gitGateway: fileHistoryGitGateway({}),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openGitChange(change);
    });

    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        path: "mockor-git-diff:worktree:/workspace-a/src/User.php",
      }),
    ]);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().openDocuments).toEqual([]);
    expect(getWorkbench().activePath).toBeNull();
    expect(getWorkbench().previewPath).toBeNull();
  });
  it("restores a dirty text tab without Git diffs or documents from another project", async () => {
    const firstRoot = "/workspace-a";
    const secondRoot = "/workspace-b";
    const firstFile = fileEntry(`${firstRoot}/src/Dirty.php`, "Dirty.php");
    const secondFile = fileEntry(`${secondRoot}/src/Other.php`, "Other.php");
    const savedContent = `// ${firstFile.path}\n`;
    const dirtyContent = "<?php\n// dirty\n";
    const change: GitChangedFile = {
      isStaged: false,
      isUnversioned: false,
      oldPath: null,
      oldRelativePath: null,
      path: `${firstRoot}/src/Changed.php`,
      relativePath: "src/Changed.php",
      status: "modified",
    };
    const diffPath = `mockor-git-diff:worktree:${change.path}`;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: firstRoot,
        workspaceTabs: [firstRoot, secondRoot],
      },
      gitGateway: fileHistoryGitGateway({}),
      readTextFile: vi.fn(async (path: string) => `// ${path}\n`),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(firstFile);
    });
    act(() => {
      getWorkbench().updateActiveDocument(dirtyContent);
    });
    await act(async () => {
      await getWorkbench().openGitChange(change);
    });
    expect(getWorkbench().activePath).toBe(diffPath);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(secondRoot);
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(secondFile);
    });
    await act(async () => {
      await getWorkbench().activateWorkspaceTab(firstRoot);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe(firstRoot);
    expect(getWorkbench().openDocuments).toEqual([
      expect.objectContaining({
        content: dirtyContent,
        path: firstFile.path,
        savedContent,
      }),
    ]);
    expect(getWorkbench().openDocuments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ path: secondFile.path })]),
    );
    expect(getWorkbench().openDocuments.map((document) => document.path)).not.toContain(diffPath);
  });
  it("ignores inactive workspace runtime dispose errors after switching project tabs", async () => {
    const workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway = {
      disposeWorkspace: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          throw new Error("stale runtime dispose");
        }
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "suspendOnBackground",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceRuntimeLifecycleGateway,
    });
    await flushAsyncTurns();
    vi.mocked(workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith("/workspace-a");
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Runtime" && notice.message.includes("stale runtime dispose"),
      ),
    ).toBe(false);
  });
  it("ignores stale PHP tools detection errors after switching project tabs", async () => {
    const workspaceATools = createDeferred<{
      intelephense: null;
      phpactor: null;
    }>();
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceATools.promise;
        }

        return {
          intelephense: null,
          phpactor: null,
        };
      }),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      // IDE mode keeps the open-time PHP probe active so the stale-switch
      // isolation guard is exercised (the probe is deferred in basic mode).
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace-b");
    });

    await act(async () => {
      workspaceATools.reject(new Error("stale PHP tools"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "PHP Tools" && notice.message.includes("stale PHP tools"),
      ),
    ).toBe(false);
  });
  it("does not run PHP-specific workspace setup for a JavaScript-only project", async () => {
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "Language server unavailable in test.",
            provider: "phpactor" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerGateway,
      phpToolGateway,
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().workspaceDescriptor?.php).toBeNull();
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();
    expect(getWorkbench().languageServerPlan).toBeNull();
  });
  it("defers PHP probe at open for a PHP project in basic mode", async () => {
    // In basic (light) mode the PHP language server never runs, so the
    // open-time PHP probe (detectPhpTools + planPhpLanguageServer) is pure
    // overhead. It must be deferred until the user enables IDE mode.
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerGateway,
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();
    expect(getWorkbench().languageServerPlan).toBeNull();
    expect(getWorkbench().phpTools).toBeNull();
  });
  it("warms up the PHP probe at open before the directory load resolves in IDE mode", async () => {
    // Warmup: in IDE mode for a PHP project, the phpactor handshake latency
    // (composer/autoload scan) dominates time-to-ready. The open-time probe
    // (detectPhpTools -> plan -> autostart) only needs the workspace descriptor
    // to know the project is PHP; it must NOT be serialized behind the
    // directory load / session restore. Firing it as soon as detection
    // confirms a PHP project lets the handshake run in the background while the
    // user navigates.
    const workspaceDirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace") {
        return workspaceDirectory.promise;
      }

      return [];
    });
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerGateway,
      phpToolGateway,
      readDirectory,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });

    // The directory load is still pending, but the PHP probe must already have
    // fired so the phpactor handshake starts warming up immediately.
    await waitForReact(() => {
      expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace");
    });
    await waitForReact(() => {
      expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
        "/workspace",
        defaultPhpLanguageServerOptions(),
      );
    });
    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().intelligenceMode).toBe("fullSmart");

    // Let the deferred directory load settle so teardown is clean.
    await act(async () => {
      workspaceDirectory.resolve([]);
      await Promise.resolve();
    });
    await flushAsyncTurns(24);
  });
  it("force-warms the phpactor index with a documentSymbol request after the first PHP didOpen", async () => {
    // Cold first-nav lag root cause: the open-time PHP probe only runs
    // detectPhpTools + planPhpLanguageServer (starts phpactor) but issues NO
    // real LSP request, so phpactor's index stays cold until the user's first
    // Cmd+B / hover / completion eats the full cold-index latency. Firing one
    // low-priority documentSymbol request after the first didOpen forces
    // phpactor to index, so the first real navigation is already warm.
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const path = "/workspace/app/Models/User.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path }),
        71,
      );
    });
    await waitForReact(() => {
      expect(dependencies.languageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
        "/workspace",
        path,
      );
    });
  });
  it("force-warms the phpactor index only once per workspace session", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const firstPath = "/workspace/app/Models/User.php";
    const secondPath = "/workspace/app/Models/Account.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(
        async (requestedPath: string) => `<?php\n// ${requestedPath}\nclass Generated {}\n`,
      ),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(firstPath, "User.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.languageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
        "/workspace",
        firstPath,
      );
    });
    expect(
      vi.mocked(dependencies.languageServerFeaturesGateway.documentSymbols).mock.calls,
    ).toHaveLength(1);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(secondPath, "Account.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
        "/workspace",
        expect.objectContaining({ path: secondPath }),
        71,
      );
    });

    // The second PHP didOpen must not trigger another warm-up request: the
    // index is already warm for this workspace session.
    expect(
      vi.mocked(dependencies.languageServerFeaturesGateway.documentSymbols).mock.calls,
    ).toHaveLength(1);
    expect(
      vi
        .mocked(dependencies.languageServerFeaturesGateway.documentSymbols)
        .mock.calls.every(([rootPath]) => rootPath === "/workspace"),
    ).toBe(true);
  });
  it("warms the phpactor index per workspace tab without leaking the warm-up across tabs", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: undefined,
      sessionId: 71,
    };
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (rootPath) => ({
        javaScriptTypeScript: null,
        php: phpProjectDescriptor(),
        rootPath,
      })),
    };
    const pathA = "/workspace-a/app/Models/User.php";
    const pathB = "/workspace-b/app/Models/Account.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(
        async (requestedPath: string) => `<?php\n// ${requestedPath}\nclass Generated {}\n`,
      ),
      runtimeStatus: runningStatus,
      workspaceDetectionGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(pathA, "User.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.languageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
        "/workspace-a",
        pathA,
      );
    });

    // Switch to workspace B and open one of its PHP files: a fresh per-tab
    // warm-up must fire for B, and the warm-up requests must never target the
    // wrong root (no cross-tab leak).
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(pathB, "Account.php"));
    });
    await flushAsyncTurns(24);

    await waitForReact(() => {
      expect(dependencies.languageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
        "/workspace-b",
        pathB,
      );
    });

    const warmUpCalls = vi.mocked(dependencies.languageServerFeaturesGateway.documentSymbols).mock
      .calls;
    // Warm-up A targeted /workspace-a/...; warm-up B targeted /workspace-b/...
    // Never the reverse.
    expect(
      warmUpCalls.some(
        ([rootPath, requestedPath]) => rootPath === "/workspace-a" && requestedPath === pathA,
      ),
    ).toBe(true);
    expect(
      warmUpCalls.some(
        ([rootPath, requestedPath]) => rootPath === "/workspace-b" && requestedPath === pathB,
      ),
    ).toBe(true);
    expect(
      warmUpCalls.every(
        ([rootPath, requestedPath]) =>
          (rootPath === "/workspace-a" && requestedPath.startsWith("/workspace-a/")) ||
          (rootPath === "/workspace-b" && requestedPath.startsWith("/workspace-b/")),
      ),
    ).toBe(true);
  });
  it("does not warm up the PHP probe at open for a PHP project in basic mode", async () => {
    // The basic-mode defer (P2b) must be preserved: warmup only applies when
    // IDE mode is on. In basic mode the probe stays deferred even though
    // detection confirms a PHP project.
    const workspaceDirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace") {
        return workspaceDirectory.promise;
      }

      return [];
    });
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerGateway,
      phpToolGateway,
      readDirectory,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });

    await waitForReact(() => {
      expect(getWorkbench().intelligenceMode).toBe("basic");
    });
    await flushAsyncTurns(24);

    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();

    await act(async () => {
      workspaceDirectory.resolve([]);
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
  });
  it("runs the deferred PHP probe and surfaces the IDE engine notice when switching a PHP project to IDE mode", async () => {
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerGateway,
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    // Deferred at open in basic mode.
    expect(phpToolGateway.detectPhpTools).not.toHaveBeenCalled();
    expect(languageServerGateway.planPhpLanguageServer).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().setSmartMode("fullSmart");
    });
    await flushAsyncTurns(24);

    // Enabling IDE mode runs the previously deferred PHP probe.
    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace");
    expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );
    expect(getWorkbench().languageServerPlan?.message).toBe("PHPactor /workspace ready");
    // phpactor is missing, so the install notice must be surfaced.
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "PHP IDE Engine" && notice.message.includes("managed PHP IDE engine"),
      ),
    ).toBe(true);
  });
  it("runs PHP-specific workspace setup for a PHP project in full smart mode", async () => {
    const phpToolGateway: WorkbenchWorkspaceGateways["phpTools"] = {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    };
    const languageServerGateway: LanguageServerGateway = {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          }) satisfies LanguageServerPlan,
      ),
      planPhpLanguageServer: vi.fn(
        async (rootPath) =>
          ({
            ...phpactorLanguageServerPlan(),
            message: `PHPactor ${rootPath} ready`,
          }) satisfies LanguageServerPlan,
      ),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerGateway,
      phpToolGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(phpToolGateway.detectPhpTools).toHaveBeenCalledWith("/workspace");
    expect(languageServerGateway.planPhpLanguageServer).toHaveBeenCalledWith(
      "/workspace",
      defaultPhpLanguageServerOptions(),
    );
  });
  it("ignores stale workspace trust errors after switching project tabs", async () => {
    const workspaceATrust =
      createDeferred<Awaited<ReturnType<WorkspaceTrustGateway["getTrust"]>>>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceATrust.promise;
        }

        return {
          rootPath,
          trusted: true,
        };
      }),
      setTrust: vi.fn(async (rootPath, trusted) => ({
        rootPath,
        trusted,
      })),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith("/workspace-b");
    });

    await act(async () => {
      workspaceATrust.reject(new Error("stale workspace trust"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Trust" && notice.message.includes("stale workspace trust"),
      ),
    ).toBe(false);
  });
  it("ignores stale workspace trust toggle errors after switching project tabs", async () => {
    const workspaceATrustToggle =
      createDeferred<Awaited<ReturnType<WorkspaceTrustGateway["setTrust"]>>>();
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: true,
      })),
      setTrust: vi.fn(async (rootPath, trusted) => {
        if (rootPath === "/workspace-a") {
          return workspaceATrustToggle.promise;
        }

        return {
          rootPath,
          trusted,
        };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceTrustGateway,
    });
    await flushAsyncTurns();

    let trustPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      trustPromise = getWorkbench().toggleWorkspaceTrust();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(workspaceTrustGateway.setTrust).toHaveBeenCalledWith("/workspace-a", false);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      workspaceATrustToggle.reject(new Error("stale trust toggle"));
      await trustPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Trust" && notice.message.includes("stale trust toggle"),
      ),
    ).toBe(false);
  });
  it("does not continue stale workspace trust revocation after stopping project language runtimes", async () => {
    const stopRuntime = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      stop: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return stopRuntime.promise;
        }

        return { kind: "stopped" as const, rootPath };
      }),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.languageServerGateway.planPhpLanguageServer).mockClear();

    let trustPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      trustPromise = getWorkbench().toggleWorkspaceTrust();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace-a");
      expect(
        dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
      ).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      stopRuntime.resolve({ kind: "stopped", rootPath: "/workspace-a" });
      await trustPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      vi
        .mocked(dependencies.languageServerGateway.planPhpLanguageServer)
        .mock.calls.some(([rootPath]) => rootPath === "/workspace-a"),
    ).toBe(false);
  });
  it("ignores stale workspace detection errors after switching project tabs", async () => {
    const workspaceADetection =
      createDeferred<
        Awaited<ReturnType<WorkbenchWorkspaceGateways["detection"]["detectWorkspace"]>>
      >();
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-a") {
          return workspaceADetection.promise;
        }

        return {
          javaScriptTypeScript: null,
          php: null,
          rootPath,
        };
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceDetectionGateway,
    });
    await waitForReact(() => {
      expect(workspaceDetectionGateway.detectWorkspace).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(workspaceDetectionGateway.detectWorkspace).toHaveBeenCalledWith("/workspace-b");
    });

    await act(async () => {
      workspaceADetection.reject(new Error("stale workspace detection"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace Detection" &&
          notice.message.includes("stale workspace detection"),
      ),
    ).toBe(false);
  });
  it("does not let stale workspace settings load overwrite the active project tab", async () => {
    const workspaceASettingsLoad = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace-a",
      workspaceTabs: ["/workspace-a", "/workspace-b"],
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async (path: string) => {
        if (path === "/workspace-a") {
          return workspaceASettingsLoad.promise;
        }

        return defaultWorkspaceSettings();
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings,
      settingsGateway,
    });
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    await act(async () => {
      workspaceASettingsLoad.reject(new Error("stale workspace settings load"));
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Settings" && notice.message.includes("stale workspace settings load"),
      ),
    ).toBe(false);
  });
  it("waits for an in-flight settings save before reloading the same project tab", async () => {
    const workspaceSettingsSave = createDeferred<void>();
    const initialWorkspaceSettings = {
      ...defaultWorkspaceSettings(),
      javaScriptTypeScriptValidation: false,
    };
    let persistedWorkspaceSettings = initialWorkspaceSettings;
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace-a",
      workspaceTabs: ["/workspace-a", "/workspace-b"],
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async (path: string) =>
        path === "/workspace-a" ? persistedWorkspaceSettings : defaultWorkspaceSettings(),
      ),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async (path, settings) => {
        if (path !== "/workspace-a") {
          return;
        }

        await workspaceSettingsSave.promise;
        persistedWorkspaceSettings = settings;
      }),
    };
    const { getWorkbench } = renderController({ appSettings, settingsGateway });
    await flushAsyncTurns(24);

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        {
          ...getWorkbench().workspaceSettings,
          javaScriptTypeScriptValidation: true,
        },
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        "/workspace-a",
        expect.objectContaining({ javaScriptTypeScriptValidation: true }),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    const workspaceALoadsBeforeReturn = vi
      .mocked(settingsGateway.loadWorkspaceSettings)
      .mock.calls.filter(([path]) => path === "/workspace-a").length;

    let returnToWorkspaceA: Promise<void> = Promise.resolve();
    act(() => {
      returnToWorkspaceA = getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(
      vi
        .mocked(settingsGateway.loadWorkspaceSettings)
        .mock.calls.filter(([path]) => path === "/workspace-a"),
    ).toHaveLength(workspaceALoadsBeforeReturn);

    await act(async () => {
      workspaceSettingsSave.resolve(undefined);
      await Promise.all([savePromise, returnToWorkspaceA]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().workspaceSettings.javaScriptTypeScriptValidation).toBe(true);
  });
  it("does not continue a pending workspace open after closing its project tab", async () => {
    const workspaceSettingsLoad = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace",
      workspaceTabs: ["/workspace"],
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async (path: string) => {
        if (path === "/workspace") {
          return workspaceSettingsLoad.promise;
        }

        return defaultWorkspaceSettings();
      }),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const workspaceDetectionGateway: WorkbenchWorkspaceGateways["detection"] = {
      detectWorkspace: vi.fn(async (path) => ({
        javaScriptTypeScript: null,
        php: null,
        rootPath: path,
      })),
    };
    const { getWorkbench } = renderController({
      appSettings,
      settingsGateway,
      workspaceDetectionGateway,
    });
    await waitForReact(() => {
      expect(settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith("/workspace");
    });

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceTabs).toEqual([]);

    await act(async () => {
      workspaceSettingsLoad.resolve(defaultWorkspaceSettings());
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBeNull();
    expect(getWorkbench().workspaceTabs).toEqual([]);
    expect(workspaceDetectionGateway.detectWorkspace).not.toHaveBeenCalled();
  });
  it("ignores stale workspace-open settings persistence errors after switching project tabs", async () => {
    const workspaceASettingsSave = createDeferred<void>();
    const appSettings = {
      ...defaultAppSettings(),
      recentWorkspacePath: "/workspace-a",
      workspaceTabs: ["/workspace-a", "/workspace-b"],
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async () => defaultWorkspaceSettings()),
      saveAppSettings: vi.fn(async (nextSettings) => {
        if (nextSettings.recentWorkspacePath === "/workspace-a") {
          return workspaceASettingsSave.promise;
        }
      }),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings,
      settingsGateway,
    });
    await waitForReact(() => {
      expect(settingsGateway.saveAppSettings).toHaveBeenCalledWith(
        expect.objectContaining({ recentWorkspacePath: "/workspace-a" }),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    await act(async () => {
      workspaceASettingsSave.reject(new Error("stale workspace-open settings"));
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Settings" && notice.message.includes("stale workspace-open settings"),
      ),
    ).toBe(false);
  });
  it("ignores stale directory load errors after switching project tabs", async () => {
    const workspaceADirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace-a") {
        return workspaceADirectory.promise;
      }

      return [];
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory,
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith("/workspace-b");
    });
    expect(getWorkbench().loadingDirectories.has("/workspace-a")).toBe(false);

    await act(async () => {
      workspaceADirectory.reject(new Error("stale directory load"));
      await Promise.resolve();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Workspace" && notice.message.includes("stale directory load"),
      ),
    ).toBe(false);
  });
  it("does not continue stale workspace opens after directory load resolves", async () => {
    const workspaceADirectory = createDeferred<FileEntry[]>();
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace-a") {
        return workspaceADirectory.promise;
      }

      return [];
    });
    const workspaceTrustGateway: WorkspaceTrustGateway = {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: rootPath !== "/workspace-a",
      })),
      setTrust: vi.fn(async (rootPath, trusted) => ({
        rootPath,
        trusted,
      })),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory,
      workspaceTrustGateway,
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith("/workspace-a");
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await waitForReact(() => {
      expect(workspaceTrustGateway.getTrust).toHaveBeenCalledWith("/workspace-b");
    });

    await act(async () => {
      workspaceADirectory.resolve([directoryEntry("/workspace-a/src", "src")]);
      await Promise.resolve();
    });
    await flushAsyncTurns(24);

    // The second project must stay active; nothing resolved late for the first
    // project (its directory entries or its distinct trust verdict) may leak
    // into the now-active workspace.
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTrust?.rootPath).toBe("/workspace-b");
    expect(getWorkbench().workspaceTrust?.trusted).toBe(true);
    expect(
      Object.keys(getWorkbench().entriesByDirectory).some((directory) =>
        directory.startsWith("/workspace-a"),
      ),
    ).toBe(false);
  });
  it("treats trailing-separator project tabs as the active workspace", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "singleActive",
        workspaceTabs: ["/workspace-a/", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a/");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalled();
    expect(dependencies.settingsGateway.saveAppSettings).not.toHaveBeenCalled();
  });
  it("closes the active normalized project tab through the current workspace root", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a/", "/workspace-b"],
      },
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a/");
    });
    await flushAsyncTurns();

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).not.toHaveBeenCalledWith(
      "/workspace-a/",
    );
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
  });
  it("does not activate cached files from inactive project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    expect(getWorkbench().activePath).toBe(path);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    let opened = true;
    await act(async () => {
      opened = await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns();

    expect(opened).toBe(false);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(path);
  });
  it("does not close text search for results from inactive project tabs", async () => {
    const stalePath = "/workspace-a/src/User.php";
    const readTextFile = vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    act(() => {
      getWorkbench().setTextSearchOpen(true);
    });

    await act(async () => {
      await getWorkbench().openTextSearchResult({
        column: 7,
        lineNumber: 3,
        lineText: "final class User {}",
        path: stalePath,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(stalePath);
    expect(getWorkbench().textSearchOpen).toBe(true);
    expect(getWorkbench().message).not.toBe("Opened src/User.php:3:7");
    expect(readTextFile).not.toHaveBeenCalledWith(stalePath);
  });
  it("does not close Quick Open for results from inactive project tabs", async () => {
    const stalePath = "/workspace-a/src/User.php";
    const readTextFile = vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`);
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    act(() => {
      getWorkbench().setQuickOpenOpen(true);
    });

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path: stalePath,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(stalePath);
    expect(getWorkbench().quickOpenOpen).toBe(true);
    expect(readTextFile).not.toHaveBeenCalledWith(stalePath);
  });
  it("resets Quick Open input and stale results every time it opens", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      searchFiles: vi.fn(async (_root: string, query: string) =>
        query === "package.json"
          ? [
              {
                name: "package.json",
                path: "/workspace/package.json",
                relativePath: "package.json",
              },
            ]
          : [],
      ),
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setQuickOpenQuery("package.json");
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 140);
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().quickOpenQuery).toBe("package.json");
    expect(getWorkbench().quickOpenResults).toEqual([
      expect.objectContaining({ name: "package.json" }),
    ]);

    act(() => {
      getWorkbench().setQuickOpenOpen(false);
      getWorkbench().setQuickOpenOpen(true);
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 140);
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().quickOpenOpen).toBe(true);
    expect(getWorkbench().quickOpenQuery).toBe("");
    expect(getWorkbench().quickOpenLoading).toBe(false);
    expect(getWorkbench().quickOpenResults).toEqual([]);
  });
  it("aggregates files, symbols and actions into one Search Everywhere model", async () => {
    const userSymbol: ProjectSymbolSearchResult = {
      column: 7,
      containerName: null,
      fullyQualifiedName: "App\\Models\\User",
      kind: "class",
      lineNumber: 12,
      name: "User",
      path: "/workspace/app/Models/User.php",
      relativePath: "app/Models/User.php",
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      projectSymbols: [userSymbol],
      // The file/symbol gateways are already query-filtered upstream; return the
      // fixtures regardless so this test focuses on aggregation, while the
      // action section is filtered here by the live query (matches "search").
      searchFiles: vi.fn(async () => [
        {
          name: "User.php",
          path: "/workspace/app/Models/User.php",
          relativePath: "app/Models/User.php",
        },
      ]),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().openSearchEverywhere();
      getWorkbench().setSearchEverywhereQuery("search");
    });
    await flushSearchEverywhereDebounce();

    const sections = getWorkbench().searchEverywhereModel.sections;
    expect(sections.map((section) => section.kind)).toEqual(["file", "symbol", "action"]);
    expect(sections[0].items[0]).toMatchObject({ kind: "file" });
    expect(sections[1].items[0]).toMatchObject({ kind: "symbol" });
    expect(sections[2].items.every((item) => item.kind === "action")).toBe(true);
  });
  it("dispatches Search Everywhere file, symbol and action results correctly", async () => {
    const symbol: ProjectSymbolSearchResult = {
      column: 7,
      containerName: null,
      fullyQualifiedName: "App\\Models\\User",
      kind: "class",
      lineNumber: 12,
      name: "User",
      path: "/workspace/app/Models/User.php",
      relativePath: "app/Models/User.php",
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      projectSymbols: [symbol],
      searchFiles: vi.fn(async () => [
        {
          name: "User.php",
          path: "/workspace/app/Models/User.php",
          relativePath: "app/Models/User.php",
        },
      ]),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    // Symbol -> open file + reveal at the symbol position.
    await act(async () => {
      await getWorkbench().activateSearchEverywhereItem({
        id: "symbol:0:/workspace/app/Models/User.php:12:7",
        kind: "symbol",
        label: "User",
        detail: "class · app/Models/User.php:12",
        symbol,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().searchEverywhereOpen).toBe(false);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path: "/workspace/app/Models/User.php",
      position: { column: 7, lineNumber: 12 },
    });

    // Action -> runs the command (re-open then activate the action).
    act(() => {
      getWorkbench().openSearchEverywhere();
    });
    const showCommands = getWorkbench().commands.find(
      (candidate) => candidate.id === "commands.show",
    );
    expect(showCommands).toBeDefined();

    await act(async () => {
      await getWorkbench().activateSearchEverywhereItem({
        id: "action:0:commands.show",
        kind: "action",
        label: showCommands?.title ?? "",
        detail: "Workbench",
        shortcut: null,
        command: showCommands!,
      });
    });

    expect(getWorkbench().searchEverywhereOpen).toBe(false);
    expect(getWorkbench().paletteOpen).toBe(true);
  });
  it("drops stale Search Everywhere results after switching project tabs", async () => {
    const slowSearch = createDeferred<FileSearchResult[]>();
    let firstQuery = true;
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      searchFiles: vi.fn(async () => {
        if (firstQuery) {
          firstQuery = false;
          return slowSearch.promise;
        }

        return [];
      }),
    });
    await flushAsyncTurns(24);

    act(() => {
      getWorkbench().openSearchEverywhere();
      getWorkbench().setSearchEverywhereQuery("user");
    });
    // Let the debounce fire so the slow search is in flight against workspace-a.
    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    // The stale search now resolves; its results must be dropped.
    await act(async () => {
      slowSearch.resolve([
        {
          name: "Stale.php",
          path: "/workspace-a/app/Stale.php",
          relativePath: "app/Stale.php",
        },
      ]);
      await slowSearch.promise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    const fileItems = getWorkbench()
      .searchEverywhereModel.sections.flatMap((section) => section.items)
      .filter((item) => item.kind === "file");
    expect(fileItems).toHaveLength(0);
  });
  it("opening Search Everywhere closes the dialogs it aggregates", async () => {
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setClassOpenOpen(true);
      getWorkbench().setPaletteOpen(true);
      getWorkbench().setWorkspaceSymbolsOpen(true);
    });

    act(() => {
      getWorkbench().openSearchEverywhere();
    });

    expect(getWorkbench().searchEverywhereOpen).toBe(true);
    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().classOpenOpen).toBe(false);
    expect(getWorkbench().paletteOpen).toBe(false);
    expect(getWorkbench().workspaceSymbolsOpen).toBe(false);
  });
  it("ignores stale open file errors after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const openFile = createDeferred<string>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? openFile.promise : `<?php\n// ${requestedPath}\n`,
      ),
    });
    await flushAsyncTurns();

    let openPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(path);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      openFile.reject(new Error("stale open"));
      await openPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Open File" && notice.message.includes("stale open"),
      ),
    ).toBe(false);
  });
  it("clears the in-flight open flag when a stale open errors after switching tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const openFile = createDeferred<string>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? openFile.promise : `<?php\n// ${requestedPath}\n`,
      ),
    });
    await flushAsyncTurns();

    let openPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(path);
    });

    expect(getWorkbench().isOpeningFile).toBe(true);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      openFile.reject(new Error("stale open"));
      await openPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().isOpeningFile).toBe(false);
  });
  it("clears the in-flight open flag when a stale open resolves after switching tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const openFile = createDeferred<string>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? openFile.promise : `<?php\n// ${requestedPath}\n`,
      ),
    });
    await flushAsyncTurns();

    let openPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(path);
    });

    expect(getWorkbench().isOpeningFile).toBe(true);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    let opened = true;
    await act(async () => {
      openFile.resolve("<?php\nclass User {}\n");
      opened = await openPromise;
    });
    await flushAsyncTurns();

    expect(opened).toBe(false);
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).not.toBe(path);
    expect(getWorkbench().isOpeningFile).toBe(false);
  });
  it("shows the opened document as soon as its content is read", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const path = "/workspace/app/Models/User.php";
    const read = createDeferred<string>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => read.promise),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    let openPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });

    expect(getWorkbench().activeDocument).toBeNull();
    expect(dependencies.documentSyncGateway.didOpen).not.toHaveBeenCalled();

    let opened = false;
    await act(async () => {
      read.resolve("<?php\nclass User {}\n");
      opened = await openPromise;
    });

    expect(opened).toBe(true);
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");

    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path }),
      71,
    );
  });
  it("populates a Quick Open document immediately when a delayed read resolves", async () => {
    const path = "/workspace/app/Http/Controllers/CommentController.php";
    const read = createDeferred<string>();
    const readTextFile = vi.fn(async (requestedPath: string) => {
      expect(requestedPath).toBe(path);
      return read.promise;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().activeDocument).toBeNull();

    let openPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      openPromise = getWorkbench().openSearchResult({
        name: "CommentController.php",
        path,
        relativePath: "app/Http/Controllers/CommentController.php",
      });
      await Promise.resolve();
    });

    expect(getWorkbench().activeDocument).toBeNull();
    expect(readTextFile).toHaveBeenCalledTimes(1);

    await act(async () => {
      read.resolve("<?php\nfinal class CommentController {}\n");
      await openPromise;
    });

    expect(getWorkbench().activePath).toBe(path);
    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe(
      "<?php\nfinal class CommentController {}\n",
    );
  });
  it("refreshes a Quick Open PHP document when the initial read is unexpectedly empty", async () => {
    const path = "/workspace/app/Http/Controllers/publicapi/AiHub/CommentController.php";
    const source =
      "<?php\nnamespace App\\Http\\Controllers\\publicapi\\AiHub;\n\nfinal class CommentController {}\n";
    let readCount = 0;
    const readTextFile = vi.fn(async (requestedPath: string) => {
      expect(requestedPath).toBe(path);
      readCount += 1;
      return readCount === 1 ? "" : source;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "CommentController.php",
        path,
        relativePath: "app/Http/Controllers/publicapi/AiHub/CommentController.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activePath).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe("");

    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 180);
      });
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(2);
    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe(source);
    expect(getWorkbench().openDocuments.find((document) => document.path === path)?.content).toBe(
      source,
    );
  });
  it("refreshes an already-open empty Quick Open PHP document without reopening", async () => {
    const path = "/workspace/app/Http/Controllers/publicapi/AiHub/CommentController.php";
    const source =
      "<?php\nnamespace App\\Http\\Controllers\\publicapi\\AiHub;\n\nfinal class CommentController {}\n";
    let readCount = 0;
    const readTextFile = vi.fn(async (requestedPath: string) => {
      expect(requestedPath).toBe(path);
      readCount += 1;
      return readCount < 3 ? "" : source;
    });
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      session: {
        activePath: path,
        bottomPanelView: "terminal" as const,
        openPaths: [path],
        sidebarView: "files" as const,
      },
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings,
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().activePath).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe("");

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "CommentController.php",
        path,
        relativePath: "app/Http/Controllers/publicapi/AiHub/CommentController.php",
      });
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(2);
    expect(getWorkbench().activeDocument?.content).toBe("");

    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 180);
      });
    });
    await flushAsyncTurns();

    expect(documentReadCount(readTextFile)).toBe(3);
    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe(source);
  });
  it("reports an in-flight open while reading the file and clears it once visible", async () => {
    const path = "/workspace/app/Models/User.php";
    const read = createDeferred<string>();
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => read.promise),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    let openPromise: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });

    expect(getWorkbench().isOpeningFile).toBe(true);
    expect(getWorkbench().activeDocument).toBeNull();

    await act(async () => {
      read.resolve("<?php\nclass User {}\n");
      await openPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().isOpeningFile).toBe(false);
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");
  });
  it("keeps the latest opened file when a slower read resolves after a faster one", async () => {
    const slowPath = "/workspace/app/Models/User.php";
    const fastPath = "/workspace/app/Models/Account.php";
    const slowRead = createDeferred<string>();
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === slowPath ? slowRead.promise : `<?php\n// ${requestedPath}\n`,
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    let slowOpen: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      slowOpen = getWorkbench().openPinnedFile(fileEntry(slowPath, "User.php"));
      await Promise.resolve();
    });

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(fastPath, "Account.php"));
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.path).toBe(fastPath);
    expect(getWorkbench().isOpeningFile).toBe(false);

    await act(async () => {
      slowRead.resolve("<?php\nclass User {}\n");
      await slowOpen;
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.path).toBe(fastPath);
    expect(getWorkbench().activeDocument?.content).toBe(`<?php\n// ${fastPath}\n`);
    expect(getWorkbench().isOpeningFile).toBe(false);
  });
  it("re-reads disk when re-opening a document whose saved content is empty", async () => {
    const path = "/workspace/src/User.php";
    const contentsByPath: Record<string, string> = {
      [path]: "",
    };
    const readTextFile = vi.fn(
      async (requestedPath: string) => contentsByPath[requestedPath] ?? "",
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toBe("");
    expect(getWorkbench().activeDocument?.savedContent).toBe("");

    contentsByPath[path] = "<?php\nclass User {}\n";

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");
    expect(getWorkbench().activeDocument?.savedContent).toBe("<?php\nclass User {}\n");
  });
  it("keeps unsaved edits when re-opening a document with an empty saved content", async () => {
    const path = "/workspace/src/Draft.php";
    const contentsByPath: Record<string, string> = {
      [path]: "",
    };
    const readTextFile = vi.fn(
      async (requestedPath: string) => contentsByPath[requestedPath] ?? "",
    );
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "Draft.php",
        path,
        relativePath: "src/Draft.php",
      });
    });
    await flushAsyncTurns();

    await act(async () => {
      getWorkbench().updateActiveDocument("<?php\n// work in progress\n");
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toBe("<?php\n// work in progress\n");

    readTextFile.mockClear();
    contentsByPath[path] = "<?php\n// disk would overwrite\n";

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "Draft.php",
        path,
        relativePath: "src/Draft.php",
      });
    });
    await flushAsyncTurns();

    expect(readTextFile).not.toHaveBeenCalled();
    expect(getWorkbench().activeDocument?.content).toBe("<?php\n// work in progress\n");
  });
  it("drops an empty-document re-read after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const read = createDeferred<string>();
    const contentsByPath: Record<string, string> = {
      [path]: "",
    };
    const readTextFile = vi.fn(async (requestedPath: string) => {
      if (requestedPath !== path) {
        return `<?php\n// ${requestedPath}\n`;
      }

      if (contentsByPath[path] === "") {
        return "";
      }

      return read.promise;
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe("");

    contentsByPath[path] = "<?php\nclass User {}\n";

    let reopen: Promise<void> = Promise.resolve();
    await act(async () => {
      reopen = getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
      await Promise.resolve();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      read.resolve("<?php\nclass User {}\n");
      await reopen;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activeDocument?.path).not.toBe(path);
  });
  it("keeps an empty document open when the re-read fails", async () => {
    const path = "/workspace/src/User.php";
    let failNextRead = false;
    const readTextFile = vi.fn(async () => {
      if (failNextRead) {
        throw new Error("EBUSY: file is locked");
      }

      return "";
    });
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile,
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openSearchResult({
        name: "User.php",
        path,
        relativePath: "src/User.php",
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.content).toBe("");

    failNextRead = true;

    let opened: boolean | undefined;
    await act(async () => {
      opened = await getWorkbench().openFile({
        kind: "file",
        name: "User.php",
        path,
      });
    });
    await flushAsyncTurns();

    expect(opened).toBe(true);
    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().activeDocument?.path).toBe(path);
    expect(getWorkbench().activeDocument?.content).toBe("");
  });
  it("cancels pending file opens while closing the active project tab", async () => {
    const path = "/workspace-a/src/User.php";
    const openFile = createDeferred<string>();
    const disposeWorkspace = createDeferred<void>();
    const workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway = {
      disposeWorkspace: vi.fn((rootPath) =>
        rootPath === "/workspace-a" ? disposeWorkspace.promise : Promise.resolve(),
      ),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (requestedPath: string) =>
        requestedPath === path ? openFile.promise : `<?php\n// ${requestedPath}\n`,
      ),
      workspaceRuntimeLifecycleGateway,
    });
    await flushAsyncTurns();

    let openPromise: Promise<boolean> = Promise.resolve(true);
    await act(async () => {
      openPromise = getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.readTextFile).toHaveBeenCalledWith(path);
    });

    let closePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      closePromise = getWorkbench().closeWorkspaceTab("/workspace-a");
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
        "/workspace-a",
      );
    });

    let opened = true;
    await act(async () => {
      openFile.resolve("<?php\nclass User {}\n");
      opened = await openPromise;
    });
    await flushAsyncTurns();

    expect(opened).toBe(false);
    expect(getWorkbench().activePath).not.toBe(path);
    expect(getWorkbench().openDocuments.some((document) => document.path === path)).toBe(false);

    await act(async () => {
      disposeWorkspace.resolve(undefined);
      await closePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace-b"]);
    expect(getWorkbench().activePath).not.toBe(path);
  });
  it("restores cached JavaScript and TypeScript runtime status when activating a kept-alive project tab", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const workspaceBStatus = createDeferred<LanguageServerRuntimeStatus>();
    const runningWorkspaceBStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace-b",
      sessionId: 88,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => {
        if (rootPath === "/workspace-b") {
          return workspaceBStatus.promise;
        }

        return { kind: "stopped" as const, rootPath };
      }),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningWorkspaceBStatus),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningWorkspaceBStatus);
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace-b",
        sessionId: 88,
      }),
    );

    workspaceBStatus.resolve(runningWorkspaceBStatus);
    await flushAsyncTurns(24);
  });
  it("does not let a stale JavaScript and TypeScript plan overwrite the active project tab", async () => {
    const workspaceAPlan = createDeferred<LanguageServerPlan>();
    const workspaceBPlan = readyJavaScriptTypeScriptPlan("/workspace-b");
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    vi.mocked(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).mockImplementation(async (rootPath) =>
      rootPath === "/workspace-a"
        ? workspaceAPlan.promise
        : readyJavaScriptTypeScriptPlan(rootPath),
    );
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().javaScriptTypeScriptLanguageServerPlan).toEqual(workspaceBPlan);

    workspaceAPlan.resolve(readyJavaScriptTypeScriptPlan("/workspace-a"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().javaScriptTypeScriptLanguageServerPlan).toEqual(workspaceBPlan);
  });
  it("caches stopped JavaScript and TypeScript status when suspending an inactive project runtime", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const runningWorkspaceAStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
        definition: true,
      },
      kind: "running",
      rootPath: "/workspace-a/",
      sessionId: 44,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningWorkspaceAStatus),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        runtimePolicy: "suspendOnBackground",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningWorkspaceAStatus);
    });
    await flushAsyncTurns();

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "running", rootPath: "/workspace-a/" }),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns();

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }),
    );
  });
  it("closes synced JavaScript and TypeScript documents before switching project tabs with keep-alive runtimes", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 44,
    };
    const path = "/workspace-a/src/App.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => `// ${requestedPath}\n`),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path }),
      44,
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalledWith("/workspace-a");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace-a",
      path,
      44,
    );
  });
  it("closes synced JavaScript and TypeScript documents before stopping an active project runtime", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 45,
    };
    const path = "/workspace-a/src/App.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => `// ${requestedPath}\n`),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace-a",
      expect.objectContaining({ path }),
      45,
    );

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace-a",
      path,
      45,
    );
    expect(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).toHaveBeenCalledWith(
      "/workspace-a",
    );
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace).mock
        .invocationCallOrder[0],
    );
  });
  it("restores cached JavaScript and TypeScript diagnostics when switching project tabs", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 51,
    };
    const path = "/workspace-a/src/App.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Type mismatch",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 51,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
  });
  it.each([
    {
      activeValidation: false,
      backgroundRoot: "/workspace-b/",
      backgroundValidation: true,
      expectedCount: 0,
      title: "does not preload settings for an unadmitted background alias",
    },
    {
      activeValidation: true,
      backgroundRoot: "/workspace-b",
      backgroundValidation: false,
      expectedCount: 0,
      title: "suppresses background diagnostics using the background root settings",
    },
  ])(
    "$title",
    async ({ activeValidation, backgroundRoot, backgroundValidation, expectedCount }) => {
      let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
      let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
      const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway =
        {
          subscribeDiagnostics: vi.fn(async (listener) => {
            publishDiagnostics = listener;
            return () => undefined;
          }),
        };
      const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
        getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 301)),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async (rootPath) => runningStatus(rootPath, 303)),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async (listener) => {
          publishRuntimeStatus = listener;
          return () => undefined;
        }),
      };
      const workspaceAPath = "/workspace-a/src/App.ts";
      const workspaceBPath = "/workspace-b/src/App.ts";
      const appSettings = {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      };
      const settingsGateway: SettingsGateway = {
        loadAppSettings: vi.fn(async () => appSettings),
        loadWorkspaceSettings: vi.fn(async (rootPath) => ({
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptValidation: workspaceRootKeysEqual(rootPath, "/workspace-b")
            ? backgroundValidation
            : activeValidation,
        })),
        saveAppSettings: vi.fn(async () => undefined),
        saveWorkspaceSettings: vi.fn(async () => undefined),
      };
      const { getWorkbench } = renderController({
        appSettings,
        javaScriptTypeScriptLanguageServerDiagnosticsGateway,
        javaScriptTypeScriptLanguageServerRuntimeGateway,
        settingsGateway,
      });
      await flushAsyncTurns(24);

      act(() => {
        publishRuntimeStatus?.(runningStatus(backgroundRoot, 302));
        publishDiagnostics?.({
          diagnostics: [
            {
              character: 0,
              line: 0,
              message: "Workspace B type mismatch",
              severity: "error",
              source: "tsserver",
            },
          ],
          rootPath: backgroundRoot,
          sessionId: 302,
          uri: fileUriFromPath(workspaceBPath),
          version: null,
        });
      });
      await flushAsyncTurns();

      expect(getWorkbench().languageServerDiagnosticsByPath[workspaceAPath]).toBeUndefined();
      expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]).toBeUndefined();

      await act(async () => {
        await getWorkbench().activateWorkspaceTab("/workspace-b");
      });
      await flushAsyncTurns(24);

      expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]?.length ?? 0).toBe(
        expectedCount,
      );
    },
  );
  it("caches PHP runtime status and diagnostics for background project tabs", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const workspaceBStatus = createDeferred<LanguageServerRuntimeStatus>();
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn((rootPath) =>
        rootPath === "/workspace-b"
          ? workspaceBStatus.promise
          : Promise.resolve(runningStatus(rootPath, 301)),
      ),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 303)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const workspaceBPath = "/workspace-b/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 302));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Workspace B PHP issue",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 302,
        uri: fileUriFromPath(workspaceBPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerRuntimeStatus).not.toEqual(
      expect.objectContaining({ rootPath: "/workspace-b" }),
    );
    expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace-b",
        sessionId: 302,
      }),
    );
    expect(getWorkbench().languageServerDiagnosticsByPath[workspaceBPath]).toHaveLength(1);

    act(() => {
      workspaceBStatus.resolve(runningStatus("/workspace-b", 302));
    });
    await flushAsyncTurns(4);
  });
  it("ignores PHP diagnostics without an explicit workspace root", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 61,
    };
    const path = "/workspace/app/Models/User.php";
    const uri = fileUriFromPath(path);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Rootless PHP diagnostic should be ignored.",
            severity: "error",
            source: "phpactor",
          },
        ],
        sessionId: 61,
        uri,
        version: null,
      } as any);
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "phpactor" && notice.message.includes("Rootless PHP diagnostic"),
      ),
    ).toBe(false);
  });
  it("aggregates diagnostic severity counts for the active workspace only", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 401)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 401)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const activePath = "/workspace-a/app/Models/User.php";
    const inactivePath = "/workspace-b/app/Models/Post.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 402));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Active error",
            severity: "error",
            source: "phpactor",
          },
          {
            character: 4,
            line: 2,
            message: "Active warning",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 401,
        uri: fileUriFromPath(activePath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Inactive error should not count",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 402,
        uri: fileUriFromPath(inactivePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 1,
    });
  });
  it("reports zero diagnostics when the active workspace has none", async () => {
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("includes local PHP diagnostics in Problems and status without folding them into LSP marker state", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const path = "/workspace/app/Broken.php";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "PHPactor warning",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 71,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().updateLocalPhpDiagnostics(path, [
        {
          character: 9,
          endCharacter: 10,
          endLine: 2,
          line: 2,
          message: "syntax error, unexpected end of file",
          severity: "error",
          source: "PHP Syntax",
        },
      ]);
    });

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 1,
    });
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toEqual([
      {
        character: 0,
        line: 0,
        message: "PHPactor warning",
        severity: "warning",
        source: "phpactor",
      },
    ]);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.groupKey?.startsWith("php-local-diagnostics:") &&
          notice.message.includes("syntax error, unexpected end of file"),
      ),
    ).toBe(true);

    act(() => {
      getWorkbench().updateLocalPhpDiagnostics(path, []);
    });

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 1,
    });
    expect(
      getWorkbench().notices.some((notice) =>
        notice.groupKey?.startsWith("php-local-diagnostics:"),
      ),
    ).toBe(false);
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
  });
  it("derives active PHP diagnostics from the open document so Problems and status do not wait for parser callbacks", async () => {
    const path = "/workspace/routes/codevo_qa_broken.php";
    const source = "<?php  \n\nfunction codevoQaBroken(\n";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => source),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "codevo_qa_broken.php"));
    });
    await flushAsyncTurns();

    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.groupKey?.startsWith("php-local-diagnostics:") &&
          notice.message.includes("Unclosed delimiter"),
      ),
    ).toBe(true);
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
  });
  it("publishes live dotenv duplicate warnings to markers and Problems, then clears them after a fix and close", async () => {
    const path = "/workspace/.env";
    const source = "APP_NAME=Codevo\nAPP_NAME=Editor\n";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => source),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, ".env"));
    });
    await flushAsyncTurns();

    expect(getWorkbench().activeDocument?.language).toBe("dotenv");
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toEqual([
      expect.objectContaining({
        character: 0,
        endCharacter: 8,
        line: 0,
        message: "Duplicate key APP_NAME — overridden by a later assignment",
        severity: "warning",
      }),
    ]);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.groupKey === `php-local-diagnostics:${fileUriFromPath(path)}` &&
          notice.message.includes("Duplicate key APP_NAME"),
      ),
    ).toBe(true);

    act(() => {
      getWorkbench().updateActiveDocument("APP_NAME=Editor\n");
    });

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("Duplicate key APP_NAME")),
    ).toBe(false);

    act(() => {
      getWorkbench().updateActiveDocument(source);
    });
    act(() => {
      getWorkbench().closeDocument(path);
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("Duplicate key APP_NAME")),
    ).toBe(false);
  });
  it("does not publish dotenv warnings for another language or workspace", async () => {
    const dotenvPath = "/workspace-a/.env";
    const textPath = "/workspace-a/config.txt";
    const source = "APP_NAME=Codevo\nAPP_NAME=Editor\n";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async () => source),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(textPath, "config.txt"));
    });
    expect(getWorkbench().languageServerDiagnosticsByPath[textPath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(dotenvPath, ".env"));
    });
    expect(getWorkbench().languageServerDiagnosticsByPath[dotenvPath]).toHaveLength(1);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[dotenvPath]).toBeUndefined();
    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("Duplicate key APP_NAME")),
    ).toBe(false);
  });
  it("coalesces a burst of PHP diagnostics events into a single batched flush", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 71,
    };
    const fileCount = 40;
    const paths = Array.from(
      { length: fileCount },
      (_unused, index) => `/workspace/app/Models/Model${index}.php`,
    );
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      paths.forEach((path, index) => {
        publishDiagnostics?.({
          diagnostics: [
            {
              character: 0,
              line: 0,
              message: `Issue in model ${index}`,
              severity: "error",
              source: "phpactor",
            },
          ],
          rootPath: "/workspace",
          sessionId: 71,
          uri: fileUriFromPath(path),
          version: null,
        });
      });
    });

    // The burst is buffered: nothing is applied until the scheduled flush.
    expect(Object.keys(getWorkbench().languageServerDiagnosticsByPath)).toHaveLength(0);

    await flushAsyncTurns();

    const applied = getWorkbench().languageServerDiagnosticsByPath;
    expect(Object.keys(applied)).toHaveLength(fileCount);
    paths.forEach((path) => {
      expect(applied[path]).toHaveLength(1);
    });
    expect(getWorkbench().diagnosticsSummary.errors).toBe(fileCount);
  });
  it("coalesces a burst of JavaScript/TypeScript diagnostics into one flush", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 81,
    };
    const fileCount = 25;
    const paths = Array.from(
      { length: fileCount },
      (_unused, index) => `/workspace/src/module${index}.ts`,
    );
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
    });
    await flushAsyncTurns(24);

    act(() => {
      paths.forEach((path, index) => {
        publishDiagnostics?.({
          diagnostics: [
            {
              character: 0,
              line: 0,
              message: `Type error ${index}`,
              severity: "error",
              source: "tsserver",
            },
          ],
          rootPath: "/workspace",
          sessionId: 81,
          uri: fileUriFromPath(path),
          version: null,
        });
      });
    });

    expect(Object.keys(getWorkbench().languageServerDiagnosticsByPath)).toHaveLength(0);

    await flushAsyncTurns();

    const applied = getWorkbench().languageServerDiagnosticsByPath;
    expect(Object.keys(applied)).toHaveLength(fileCount);
    expect(getWorkbench().diagnosticsSummary.errors).toBe(fileCount);
  });
  it("applies only the latest buffered version per document within a burst", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 91,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          { character: 0, line: 0, message: "v1", severity: "error", source: "phpactor" },
          { character: 0, line: 1, message: "v1b", severity: "error", source: "phpactor" },
        ],
        rootPath: "/workspace",
        sessionId: 91,
        uri: fileUriFromPath(path),
        version: 1,
      });
      publishDiagnostics?.({
        diagnostics: [
          { character: 0, line: 0, message: "v2", severity: "warning", source: "phpactor" },
        ],
        rootPath: "/workspace",
        sessionId: 91,
        uri: fileUriFromPath(path),
        version: 2,
      });
    });
    await flushAsyncTurns();

    const applied = getWorkbench().languageServerDiagnosticsByPath[path];
    expect(applied).toHaveLength(1);
    expect(applied?.[0]?.message).toBe("v2");
    expect(getWorkbench().diagnosticsSummary).toEqual({ errors: 0, warnings: 1 });
  });
  it("drops buffered diagnostics for an inactive workspace root on flush", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 501)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 501)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const activePath = "/workspace-a/app/Models/User.php";
    const inactivePath = "/workspace-b/app/Models/Post.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 502));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Active root issue",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 501,
        uri: fileUriFromPath(activePath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Inactive root issue must not leak",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 502,
        uri: fileUriFromPath(inactivePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    const applied = getWorkbench().languageServerDiagnosticsByPath;
    expect(applied[activePath]).toHaveLength(1);
    expect(applied[inactivePath]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });
  });
  it("bounds diagnostics across many files with an exact retention receipt", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 601,
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    // 2100 files each contributing one diagnostic notice exceeds the 2000
    // global cap, so the list must be bounded and carry a single overflow notice.
    const fileCount = 2100;
    act(() => {
      for (let index = 0; index < fileCount; index += 1) {
        publishDiagnostics?.({
          diagnostics: [
            {
              character: 0,
              line: 0,
              message: `Issue ${index}`,
              severity: "error",
              source: "phpactor",
            },
          ],
          rootPath: "/workspace",
          sessionId: 601,
          uri: fileUriFromPath(`/workspace/app/File${index}.php`),
          version: null,
        });
      }
    });
    await flushAsyncTurns();

    const retentionReceipt = getWorkbench().notices.find((notice) =>
      notice.groupKey?.startsWith("diagnostics-retention-receipt:"),
    );

    expect(retentionReceipt).toMatchObject({
      kind: "overflow",
      message: "Retained 2000 of 2100 published diagnostics.",
    });
    expect(Object.keys(getWorkbench().languageServerDiagnosticsByPath)).toHaveLength(2000);
    expect(getWorkbench().diagnosticsSummary.errors).toBe(2000);
  });
  it("preserves the per-document notice cap with an overflow indicator", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 611,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: Array.from({ length: 250 }, (_unused, index) => ({
          character: 0,
          line: index,
          message: `Diagnostic ${index}`,
          severity: "error" as const,
          source: "phpactor",
        })),
        rootPath: "/workspace",
        sessionId: 611,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    const groupKey = `language-server-diagnostics:${fileUriFromPath(path)}`;
    const groupNotices = getWorkbench().notices.filter((notice) => notice.groupKey === groupKey);

    // 100 kept diagnostics + 1 per-document overflow indicator.
    expect(groupNotices).toHaveLength(101);
    expect(groupNotices[100].kind).toBe("overflow");
    // Editor markers stay uncapped: all 250 diagnostics are tracked.
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(250);
  });
  it("clears diagnostics for a deleted PHP document and sends didClose", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 701,
    };
    const path = "/workspace/app/Models/User.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Undefined variable",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 701,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    expect(dependencies.languageServerDocumentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      path,
      701,
    );
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("caps the per-document diagnostic notices without dropping markers", async () => {
    // STABILITY: a single Laravel file can publish hundreds of diagnostics.
    // Mapping every one to a notice and re-rendering the notices panel freezes
    // the main thread, so notices are capped with a truthful "N more" indicator.
    // Editor markers come from a separate, uncapped source and must keep ALL of
    // them.
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 731,
    };
    const path = "/workspace/app/Models/User.php";
    const uri = fileUriFromPath(path);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    const diagnostics = Array.from({ length: 300 }, (_, index) => ({
      character: 0,
      line: index,
      message: `Diagnostic ${index}`,
      severity: "error" as const,
      source: "phpactor",
    }));

    act(() => {
      publishDiagnostics?.({
        diagnostics,
        rootPath: "/workspace",
        sessionId: 731,
        uri,
        version: null,
      });
    });
    await flushAsyncTurns();

    const groupNotices = getWorkbench().notices.filter(
      (notice) => notice.groupKey === `language-server-diagnostics:${uri}`,
    );

    // Notices are bounded: 100 diagnostics + 1 overflow indicator, never 300.
    expect(groupNotices).toHaveLength(101);
    const overflow = groupNotices[groupNotices.length - 1];
    expect(overflow.severity).toBe("info");
    // The hidden count is truthful (300 - 100 = 200), not a lie about "100".
    expect(overflow.message).toContain("200 not shown");

    // Markers (the separate, uncapped source) keep ALL 300 diagnostics so no
    // squiggle is lost.
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(300);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 300,
      warnings: 0,
    });
  });
  it("does not send a debounced didChange after the document was closed", async () => {
    // STABILITY: the 150ms didChange debounce timer can fire and enqueue its
    // sync operation while an earlier sync (here a held didOpen) is still in
    // flight. If closeDocument runs in the meantime, the document is removed
    // from the synced set and a didClose is sent; the queued didChange must then
    // be dropped so it never targets a closed document (UnknownDocument/desync).
    const didOpen = createDeferred<void>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 741,
    };
    const path = "/workspace/app/Models/User.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    // Hold the didOpen sync so the per-document sync queue stays busy; any
    // didChange enqueued afterwards is blocked behind it until we resolve it.
    vi.mocked(dependencies.languageServerDocumentSyncGateway.didOpen).mockReturnValue(
      didOpen.promise,
    );
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    // Edit the document, then let the 150ms debounce elapse so the didChange
    // timer fires and enqueues its (queued, blocked) sync operation.
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nclass User\n{\n}\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    // Close the document: this removes it from the synced set and enqueues a
    // didClose behind the still-blocked didChange.
    act(() => {
      getWorkbench().closeDocument(path);
    });

    // Release the held didOpen so the queue drains: didChange must be skipped.
    act(() => {
      didOpen.resolve(undefined);
    });
    await flushAsyncTurns(24);

    expect(dependencies.languageServerDocumentSyncGateway.didChange).not.toHaveBeenCalled();
    expect(dependencies.languageServerDocumentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      path,
      741,
    );
  });
  it("does not send a debounced JavaScript and TypeScript didChange after the document was closed", async () => {
    // STABILITY: the 150ms didChange debounce timer can fire and enqueue its
    // sync operation while an earlier sync (here a held didOpen) is still in
    // flight. If closeDocument runs in the meantime, the document is removed
    // from the synced set and a didClose is sent; the queued didChange must then
    // be dropped so it never targets a closed document (UnknownDocument/desync).
    // Single-tab close does not bump the JS/TS sync generation, so the synced
    // set membership is the guard that has to catch this.
    const didOpen = createDeferred<void>();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 742,
    };
    const path = "/workspace/src/App.ts";
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    // Hold the didOpen sync so the per-document sync queue stays busy; any
    // didChange enqueued afterwards is blocked behind it until we resolve it.
    vi.mocked(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).mockReturnValue(didOpen.promise);
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await flushAsyncTurns(24);

    // Edit the document, then let the 150ms debounce elapse so the didChange
    // timer fires and enqueues its (queued, blocked) sync operation.
    act(() => {
      getWorkbench().updateActiveDocument("export const value = 2;\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });

    // Close the document: this removes it from the synced set and enqueues a
    // didClose behind the still-blocked didChange.
    act(() => {
      getWorkbench().closeDocument(path);
    });

    // Release the held didOpen so the queue drains: didChange must be skipped.
    act(() => {
      didOpen.resolve(undefined);
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didChange,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
    ).toHaveBeenCalledWith("/workspace", path, 742);
  });
  it("applies a phpactor clear carrying the analysis version after the document version advanced", async () => {
    // BUG 1: phpactor publishes diagnostics asynchronously keyed by the analysis
    // version. After a didChange bumps the live document version to 2, phpactor
    // can still publish the clear (count=0) for its in-flight analysis at the
    // older analysis version (1). Comparing against the document version dropped
    // that clear, leaving the stale "1 error" marker visible. Comparing against
    // the last APPLIED diagnostic version instead lets the clear through.
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 711,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    // phpactor analysed the opened document (version 1) and reported one error.
    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Invalid class",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 711,
        uri: fileUriFromPath(path),
        version: 1,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);

    // The user edits the document; the live document version advances to 2 via a
    // debounced didChange.
    act(() => {
      getWorkbench().updateActiveDocument("<?php\nclass User\n{\n}\n");
    });
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    });
    await flushAsyncTurns(24);

    // phpactor finishes the in-flight analysis it started for version 1 and
    // publishes the clear at that analysis version, even though the live
    // document is now at version 2.
    act(() => {
      publishDiagnostics?.({
        diagnostics: [],
        rootPath: "/workspace",
        sessionId: 711,
        uri: fileUriFromPath(path),
        version: 1,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "phpactor" && notice.message.includes("Invalid class"),
      ),
    ).toBe(false);
  });
  it("suppresses an UnknownDocument feature error for a document that is not open", async () => {
    // RACE: a Monaco feature provider (hover/completion/codeAction) reports its
    // error through onLanguageServerError -> reportLanguageServerError. If the
    // tab was closed (didClose) between flushing the document change and the
    // server's reply, phpactor answers with UnknownDocument for a path that is
    // no longer synced. That is a benign desync, not a real failure, so it must
    // not surface a false error toast or status message.
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 821,
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    // The document was never opened on the server (the tab is already closed),
    // so its path is absent from the synced set.
    const closedPath = "/workspace/app/Models/User.php";
    const error = `UnknownDocument: Unknown text document "${fileUriFromPath(closedPath)}"`;

    act(() => {
      getWorkbench().reportLanguageServerError(error);
    });

    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("UnknownDocument")),
    ).toBe(false);
    expect(getWorkbench().message).toBeNull();
  });
  it("suppresses benign application errors before they become notices", async () => {
    const { getWorkbench } = renderController();
    await flushAsyncTurns();

    act(() => {
      getWorkbench().reportCommandError(
        new Error("ResizeObserver loop completed with undelivered notifications."),
      );
    });

    expect(getWorkbench().notices).toEqual([]);
    expect(getWorkbench().message).toBeNull();
  });
  it("reports one Command notice when an active-root async command rejects", async () => {
    const commandRun = createDeferred<void>();
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace");
    });
    const refreshCommand = getWorkbench().commands.find(
      (command) => command.id === "workspace.refresh",
    );
    expect(refreshCommand).toBeDefined();
    const runRefresh = vi.spyOn(refreshCommand!, "run").mockReturnValue(commandRun.promise);

    act(() => {
      expect(getWorkbench().runCommand("workspace.refresh")).toBe("executed");
    });
    expect(runRefresh).toHaveBeenCalledOnce();

    await act(async () => {
      commandRun.reject(new Error("active command failed"));
      await commandRun.promise.catch(() => undefined);
    });
    await flushAsyncTurns();

    const commandNotices = getWorkbench().notices.filter((notice) => notice.source === "Command");
    expect(commandNotices).toEqual([
      expect.objectContaining({ message: "Error: active command failed" }),
    ]);
    expect(getWorkbench().message).toBe("Error: active command failed");
  });
  it("drops an async command rejection after switching workspace roots", async () => {
    const commandRun = createDeferred<void>();
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    });
    const refreshCommand = getWorkbench().commands.find(
      (command) => command.id === "workspace.refresh",
    );
    expect(refreshCommand).toBeDefined();
    const runRefresh = vi.spyOn(refreshCommand!, "run").mockReturnValue(commandRun.promise);

    act(() => {
      expect(getWorkbench().runCommand("workspace.refresh")).toBe("executed");
    });
    expect(runRefresh).toHaveBeenCalledOnce();
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    await act(async () => {
      commandRun.reject(new Error("stale workspace-a command"));
      await commandRun.promise.catch(() => undefined);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).toBeNull();
    expect(getWorkbench().notices).toEqual([]);
  });
  it("suppresses a reportCommandError callback captured for an inactive root", async () => {
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await waitForReact(() => {
      expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    });
    const reportWorkspaceACommandError = getWorkbench().reportCommandError;

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);
    act(() => {
      reportWorkspaceACommandError(new Error("stale callback command"));
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).toBeNull();
    expect(getWorkbench().notices).toEqual([]);
  });
  it("suppresses benign language server cancellations before they become notices", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 824,
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    const cancellation = new Error("request superseded");
    cancellation.name = "CanceledError";

    act(() => {
      getWorkbench().reportLanguageServerError(cancellation);
    });

    expect(getWorkbench().notices).toEqual([]);
    expect(getWorkbench().message).toBeNull();
  });
  it("still reports a legitimate language server feature error", async () => {
    // A genuine LSP failure (not UnknownDocument) reported through the Monaco
    // feature path must continue to surface a notice and status message.
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 822,
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    const error = "Internal error: completion provider crashed";

    act(() => {
      getWorkbench().reportLanguageServerError(error);
    });

    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Language Server" &&
          notice.message.includes("completion provider crashed"),
      ),
    ).toBe(true);
    expect(getWorkbench().message).toBe(error);
  });
  it("still reports an UnknownDocument error for an open, synced document", async () => {
    // An UnknownDocument error for a document that IS still open is a real
    // desync problem, not the benign close race, so it must remain visible.
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 823,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    const error = `UnknownDocument: Unknown text document "${fileUriFromPath(path)}"`;

    act(() => {
      getWorkbench().reportLanguageServerError(error);
    });

    expect(
      getWorkbench().notices.some((notice) => notice.message.includes("UnknownDocument")),
    ).toBe(true);
    expect(getWorkbench().message).toBe(error);
  });
  it("drops a phpactor publication older than the last applied diagnostic", async () => {
    // BUG 1 protection: once a newer analysis version has been applied, a late
    // publication carrying an older analysis version must be dropped so it
    // cannot resurrect stale diagnostics.
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 712,
    };
    const path = "/workspace/app/Models/User.php";
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Newer analysis error",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 712,
        uri: fileUriFromPath(path),
        version: 5,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);

    // A late publication from an older analysis version must be ignored.
    act(() => {
      publishDiagnostics?.({
        diagnostics: [],
        rootPath: "/workspace",
        sessionId: 712,
        uri: fileUriFromPath(path),
        version: 3,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
  });
  it("clears stale diagnostics for the old path when renaming a PHP document", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 711,
    };
    const oldPath = "/workspace/app/Models/User.php";
    const newPath = "/workspace/app/Models/Account.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway: {
        getStatus: vi.fn(async () => runningStatus),
        openLog: vi.fn(async () => null),
        start: vi.fn(async () => runningStatus),
        stop: vi.fn(async (rootPath) => ({
          kind: "stopped" as const,
          rootPath,
        })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Undefined variable",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace",
        sessionId: 711,
        uri: fileUriFromPath(oldPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");
    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("clears stale diagnostics for the old path when renaming a TypeScript document", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 712,
    };
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === oldPath) {
          return "export class User {}\n";
        }

        return `// ${requestedPath}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Type mismatch",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace",
        sessionId: 712,
        uri: fileUriFromPath(oldPath),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");
    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(getWorkbench().languageServerDiagnosticsByPath[oldPath]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("clears diagnostics for a deleted TypeScript document and sends didClose", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    const javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 702,
    };
    const path = "/workspace/src/User.ts";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerDiagnosticsGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.ts"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Type mismatch",
            severity: "error",
            source: "tsserver",
          },
        ],
        rootPath: "/workspace",
        sessionId: 702,
        uri: fileUriFromPath(path),
        version: null,
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toHaveLength(1);
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 1,
      warnings: 0,
    });

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith("/workspace", path, 702);
    expect(getWorkbench().languageServerDiagnosticsByPath[path]).toBeUndefined();
    expect(getWorkbench().diagnosticsSummary).toEqual({
      errors: 0,
      warnings: 0,
    });
  });
  it("does not clear another project tab's cached diagnostics when deleting a file in the active tab", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 801)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 801)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const activePath = "/workspace-a/app/Models/User.php";
    const inactivePath = "/workspace-b/app/Models/Post.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async (requestedPath: string) => `<?php\n// ${requestedPath}\n`),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(activePath, "User.php"));
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 802));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Active error",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 801,
        uri: fileUriFromPath(activePath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Background error",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 802,
        uri: fileUriFromPath(inactivePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerDiagnosticsByPath[activePath]).toBeUndefined();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerDiagnosticsByPath[inactivePath]).toHaveLength(1);
  });
  it("navigates next and previous through active workspace problems with wrap-around", async () => {
    let publishDiagnostics: ((event: LanguageServerDiagnosticEvent) => void) | null = null;
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway = {
      subscribeDiagnostics: vi.fn(async (listener) => {
        publishDiagnostics = listener;
        return () => undefined;
      }),
    };
    const runningStatus = (rootPath: string, sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath,
      sessionId,
    });
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => runningStatus(rootPath, 501)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runningStatus(rootPath, 501)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const firstPath = "/workspace-a/app/Models/Account.php";
    const secondPath = "/workspace-a/app/Models/Zone.php";
    const inactivePath = "/workspace-b/app/Models/Comment.php";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerDiagnosticsGateway,
      languageServerRuntimeGateway,
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.(runningStatus("/workspace-b", 502));
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 2,
            line: 4,
            message: "First problem",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 501,
        uri: fileUriFromPath(firstPath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 9,
            message: "Second problem",
            severity: "warning",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-a",
        sessionId: 501,
        uri: fileUriFromPath(secondPath),
        version: null,
      });
      publishDiagnostics?.({
        diagnostics: [
          {
            character: 0,
            line: 0,
            message: "Inactive problem",
            severity: "error",
            source: "phpactor",
          },
        ],
        rootPath: "/workspace-b",
        sessionId: 502,
        uri: fileUriFromPath(inactivePath),
        version: null,
      });
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: firstPath,
      position: { column: 3, lineNumber: 5 },
    });

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: secondPath,
      position: { column: 1, lineNumber: 10 },
    });

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: firstPath,
      position: { column: 3, lineNumber: 5 },
    });

    await act(async () => {
      await getWorkbench().goToPreviousProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: secondPath,
      position: { column: 1, lineNumber: 10 },
    });

    expect(getWorkbench().editorRevealTarget?.path).not.toBe(inactivePath);
  });
  it("does nothing when navigating problems with no diagnostics", async () => {
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().goToNextProblem();
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toBeNull();
  });
});
