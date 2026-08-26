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
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  type FileEntry,
  fileHistoryGitGateway,
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
  serializeBreakpoints,
  type SettingsGateway,
  setupWorkbenchControllerTestHarness,
  trustedDescriptor,
  vi,
  waitForReact,
  withWorkspaceIdentityLease,
  type WorkbenchWorkspaceGateways,
  type WorkspaceDescriptor,
  type WorkspaceRuntimeLifecycleGateway,
  type WorkspaceTrustGateway,
  type WorkspaceTrustState,
} from "./testSupport";

describe("useWorkbenchController workspace identity, editor groups, bookmarks, and debugger wiring", () => {
  const { getRoot, renderController } = setupWorkbenchControllerTestHarness();
  const registeredIdentityGateway = (
    descriptor: ReturnType<typeof trustedDescriptor>,
    unregister: (workspaceId: string) => Promise<void> = vi.fn(async () => undefined),
  ): WorkbenchWorkspaceGateways["identity"] => ({
    getDescriptor: vi.fn(async (workspaceId) => {
      if (workspaceId !== descriptor.workspaceId) throw new Error("Unexpected workspace identity");
      return {
        ...descriptor,
        canonicalRootPath: descriptor.canonicalRoot,
        selectedRootPath: descriptor.selectedPath,
      };
    }),
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(async (path) => {
      if (path !== descriptor.selectedPath) throw new Error(`Unexpected workspace path: ${path}`);
      return descriptor;
    }),
    unregister,
  });
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
      workspaceIdentityGateway: registeredIdentityGateway(descriptor),
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
      workspaceIdentityGateway: registeredIdentityGateway(descriptor),
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
      workspaceIdentityGateway: registeredIdentityGateway(descriptor, unregister),
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
      workspaceIdentityGateway: registeredIdentityGateway(descriptor, unregister),
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
      workspaceIdentityGateway: registeredIdentityGateway(descriptor, unregister),
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
      workspaceIdentityGateway: registeredIdentityGateway(descriptor, unregister),
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
      workspaceIdentityGateway: registeredIdentityGateway(descriptor, unregister),
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
      workspaceIdentityGateway: registeredIdentityGateway(descriptor),
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
    const debugWorkspaceIdentity = trustedDescriptor("ws-debugger", "/workspace");
    const admitDebugWorkspace = (
      getWorkbench: ReturnType<typeof renderController>["getWorkbench"],
    ) =>
      act(async () => {
        await getWorkbench().openWorkspaceRoot(debugWorkspaceIdentity.selectedPath);
        await flushAsyncTurns();
      });
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
        workspaceIdentityGateway: registeredIdentityGateway(debugWorkspaceIdentity),
      });
      await flushAsyncTurns();
      await admitDebugWorkspace(getWorkbench);

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
        workspaceIdentityGateway: registeredIdentityGateway(debugWorkspaceIdentity),
      });
      await flushAsyncTurns();
      await admitDebugWorkspace(getWorkbench);

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
        workspaceIdentityGateway: registeredIdentityGateway(debugWorkspaceIdentity),
      });
      await flushAsyncTurns();
      await admitDebugWorkspace(getWorkbench);

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
        workspaceIdentityGateway: registeredIdentityGateway(debugWorkspaceIdentity),
      });
      await flushAsyncTurns();
      await admitDebugWorkspace(getWorkbench);

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
        workspaceIdentityGateway: registeredIdentityGateway(debugWorkspaceIdentity),
      });
      await flushAsyncTurns();
      await admitDebugWorkspace(getWorkbench);

      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(testPath, "sum.test.ts"));
      });

      let pendingStart: Promise<void> = Promise.resolve();
      act(() => {
        pendingStart = runCommand(getWorkbench(), "debug.start");
      });
      await waitForReact(() => {
        expect(readTextFile).toHaveBeenCalledWith("/workspace/vitest.config.ts");
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
});
