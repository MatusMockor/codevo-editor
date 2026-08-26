// @vitest-environment jsdom

import {
  workspaceAppSettings,
  act,
  createDeferred,
  createInitialEditorGroupsState,
  defaultAppSettings,
  defaultWorkspaceSettings,
  describe,
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  type FileEntry,
  fileUriFromPath,
  flushAsyncTurns,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  type LanguageServerPlan,
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
  phpactorLanguageServerPlan,
  phpWorkspaceDescriptor,
  range,
  readyJavaScriptTypeScriptPlan,
  registeredWorkspaceIdentityGateway as registeredIdentity,
  setupWorkbenchControllerTestHarness,
  vi,
  waitForReact,
  type LanguageServerWorkspaceEdit,
  emptyPhpFileOutline,
  expectSmartModeSet,
  expectInitialWorkspaceIndexScan as expectInitialScan,
  expectWorkspaceIndexClear,
  expectedWorkspaceSettingsIdentity,
  workspaceSettingsRoot,
  type PhpFileOutlineGateway,
} from "./testSupport";

describe("useWorkbenchController document editing and language-service mutations", () => {
  const { renderRegisteredController: renderController } = setupWorkbenchControllerTestHarness();

  it("retries JavaScript and TypeScript autostart after a rootless running response", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const rootlessRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 67,
    };
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      ...rootlessRunningStatus,
      rootPath: "/workspace",
      sessionId: 68,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi
        .fn<LanguageServerRuntimeGateway["start"]>(async () => rootedRunningStatus)
        .mockResolvedValueOnce(rootlessRunningStatus),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };

    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(36);

    expect(javaScriptTypeScriptLanguageServerRuntimeGateway.start).toHaveBeenCalledTimes(2);
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 68,
      }),
    );
  });
  it("starts JavaScript and TypeScript language service lazily for inferred workspaces", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan,
      readTextFile: vi.fn(async (path: string) => {
        if (path === "/workspace/src/App.ts") {
          return "export const app = 1;\n";
        }

        return `// ${path}\n`;
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/src/App.ts", "App.ts"));
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });
  it("starts inferred JavaScript and TypeScript service for restored JS TS tabs", async () => {
    const restoredPath = "/workspace/src/App.ts";
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const { dependencies } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan,
      readTextFile: vi.fn(async (path: string) => {
        if (path === restoredPath) {
          return "export const app = 1;\n";
        }

        return `// ${path}\n`;
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        session: {
          activePath: restoredPath,
          bottomPanelView: "problems",
          openPaths: [restoredPath],
          sidebarView: "files",
        },
      },
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });
  it("starts inferred JavaScript and TypeScript service for restored JS TS tabs in PHP workspaces", async () => {
    const restoredPath = "/workspace/scripts/tool.ts";
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const { dependencies } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan,
      readTextFile: vi.fn(async (path: string) => {
        if (path === restoredPath) {
          return "export const tool = 1;\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        session: {
          activePath: restoredPath,
          bottomPanelView: "problems",
          openPaths: [restoredPath],
          sidebarView: "files",
        },
      },
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(dependencies.languageServerRuntimeGateway.start).not.toHaveBeenCalled();
  });
  it("starts JavaScript and TypeScript language service with workspace TypeScript preference", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 16,
    };
    const { dependencies } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptVersion: "workspace",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
  });
  it("asks the JavaScript TypeScript service for import edits before renaming a file", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 24,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [oldPath],
    );
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("blocks JavaScript TypeScript file rename when import edits cannot be requested", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).mockRejectedValueOnce(new Error("will rename crashed"));
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 24,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Rename" &&
          notice.message.includes("will rename crashed"),
      ),
    ).toBe(true);
  });
  it("blocks JavaScript TypeScript file rename when import edits cannot be applied", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 24,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.workspaceGateways.files.applyWorkspaceEdit).mockRejectedValueOnce(
      new Error("apply workspace edit crashed"),
    );
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [oldPath],
    );
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Rename" &&
          notice.message.includes("apply workspace edit crashed"),
      ),
    ).toBe(true);
  });
  it("keeps an open import document unchanged when transactional rename edits fail", async () => {
    const oldPath = "/workspace/src/User.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const consumerContent = 'import { User } from "./User";\n';
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
    const applyWorkspaceEditTransaction = vi.fn(async () => {
      throw new Error("injected second-file failure");
    });
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }
        if (path === consumerPath) {
          return consumerContent;
        }
        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      workspaceFiles: { applyWorkspaceEditTransaction },
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
      await getWorkbench().openPinnedFile(fileEntry(consumerPath, "Consumer.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(applyWorkspaceEditTransaction).toHaveBeenCalledWith(
      "/workspace",
      edit,
      expect.arrayContaining([oldPath, consumerPath]),
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().activeDocument?.path).toBe(consumerPath);
    expect(getWorkbench().activeDocument?.content).toBe(consumerContent);
  });
  it("notifies the JavaScript TypeScript service after rename when only did-rename is supported", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
      },
      kind: "running",
      sessionId: 24,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("asks the JavaScript TypeScript service for import edits before renaming a folder", async () => {
    const oldPath = "/workspace/src/models";
    const newPath = "/workspace/src/domain";
    const consumerPath = "/workspace/src/Consumer.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "domain/User",
            range: {
              end: { character: 28, line: 0 },
              start: { character: 17, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 624,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "models",
        path: oldPath,
      });
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [],
    );
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("remaps open documents under a renamed folder without losing dirty content", async () => {
    const oldFolderPath = "/workspace/src/models";
    const newFolderPath = "/workspace/src/domain";
    const oldDocumentPath = "/workspace/src/models/User.ts";
    const newDocumentPath = "/workspace/src/domain/User.ts";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 626,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldDocumentPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldDocumentPath, "User.ts"));
    });
    await flushAsyncTurns(24);
    act(() => {
      getWorkbench().updateActiveDocument("export class User { dirty = true }\n");
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "models",
        path: oldFolderPath,
      });
    });

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
      oldFolderPath,
      newFolderPath,
    );
    expect(
      getWorkbench().openDocuments.find((document) => document.path === oldDocumentPath),
    ).toBeUndefined();
    expect(
      getWorkbench().openDocuments.find((document) => document.path === newDocumentPath),
    ).toMatchObject({
      content: "export class User { dirty = true }\n",
      language: "typescript",
      name: "User.ts",
      path: newDocumentPath,
    });
    expect(getWorkbench().activePath).toBe(newDocumentPath);
    expect(getWorkbench().activeDocument?.path).toBe(newDocumentPath);
    expect(getWorkbench().activeDocument?.content).toBe("export class User { dirty = true }\n");
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didClose,
    ).toHaveBeenCalledWith("/workspace", oldDocumentPath, 626);
    await flushAsyncTurns(24);
    expect(
      dependencies.javaScriptTypeScriptLanguageServerDocumentSyncGateway.didOpen,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path: newDocumentPath,
        text: "export class User { dirty = true }\n",
      }),
      626,
    );
  });
  it("drops stale JavaScript TypeScript folder rename edits after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/models";
    const newPath = "/workspace-a/src/domain";
    const consumerPath = "/workspace-a/src/Consumer.ts";
    const renameEdit = createDeferred<LanguageServerWorkspaceEdit | null>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).mockImplementationOnce(async () => renameEdit.promise);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 625,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("domain");

    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = getWorkbench().renameEntry({
        kind: "directory",
        name: "models",
        path: oldPath,
      });
    });
    await flushAsyncTurns(4);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    renameEdit.resolve({
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "domain/User",
            range: {
              end: { character: 28, line: 0 },
              start: { character: 17, line: 0 },
            },
          },
        ],
      },
    });
    await act(async () => {
      await renamePromise;
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace-a",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("asks the PHP language server for edits and re-syncs documents when renaming a folder", async () => {
    const oldPath = "/workspace/app/Services";
    const newPath = "/workspace/app/Domain";
    const oldDocumentPath = "/workspace/app/Services/UserService.php";
    const newDocumentPath = "/workspace/app/Domain/UserService.php";
    const consumerPath = "/workspace/app/Services/Consumer.php";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "namespace App\\Domain;",
            range: {
              end: { character: 23, line: 1 },
              start: { character: 0, line: 1 },
            },
          },
        ],
      },
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.willRenameFiles).mockResolvedValue(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 627,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldDocumentPath) {
          return "<?php\nnamespace App\\Services;\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldDocumentPath, "UserService.php"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "Services",
        path: oldPath,
      });
    });

    expect(languageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [oldDocumentPath],
    );
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(languageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(
      vi.mocked(languageServerFeaturesGateway.willRenameFiles).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(dependencies.workspaceGateways.files.renamePath).mock.invocationCallOrder[0] ?? 0,
    );
    expect(
      vi.mocked(dependencies.workspaceGateways.files.renamePath).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(languageServerFeaturesGateway.didRenameFiles).mock.invocationCallOrder[0] ?? 0,
    );
    expect(dependencies.languageServerDocumentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      oldDocumentPath,
      627,
    );
    await flushAsyncTurns(24);
    expect(dependencies.languageServerDocumentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({ path: newDocumentPath }),
      627,
    );
  });
  it("notifies the PHP language server after a folder rename with no edits", async () => {
    const oldPath = "/workspace/app/Services";
    const newPath = "/workspace/app/Domain";
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.willRenameFiles).mockResolvedValue(null);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 628,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "Services",
        path: oldPath,
      });
    });

    expect(languageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(languageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("does not call the PHP language server for a folder rename in light mode", async () => {
    const oldPath = "/workspace/src/models";
    const newPath = "/workspace/src/domain";
    const languageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 629,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("domain");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "models",
        path: oldPath,
      });
    });

    expect(languageServerFeaturesGateway.willRenameFiles).not.toHaveBeenCalled();
    expect(languageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
  });
  it.each([
    ["/workspace/vendor", "vendor", "vendor-old", "/workspace/vendor-old"],
    ["/workspace/node_modules", "node_modules", "node_modules-old", "/workspace/node_modules-old"],
    ["/workspace/node_modules/pkg", "pkg", "pkg-two", "/workspace/node_modules/pkg-two"],
  ])(
    "skips JavaScript TypeScript rename machinery for excluded folder %s",
    async (oldPath, oldName, nextName, newPath) => {
      const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
      const runningStatus: LanguageServerRuntimeStatus = {
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          didRenameFiles: true,
          willRenameFiles: true,
        },
        kind: "running",
        sessionId: 624,
      };
      const { dependencies, getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
        javaScriptTypeScriptLanguageServerFeaturesGateway,
        javaScriptTypeScriptRuntimeStatus: runningStatus,
        workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
      });
      await flushAsyncTurns(24);
      vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce(nextName);

      await act(async () => {
        await getWorkbench().renameEntry({
          kind: "directory",
          name: oldName,
          path: oldPath,
        });
      });

      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
      ).not.toHaveBeenCalled();
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
      ).not.toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
      expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
        oldPath,
        newPath,
      );
    },
  );
  it("skips PHP rename machinery for an excluded vendor folder", async () => {
    const oldPath = "/workspace/vendor";
    const newPath = "/workspace/vendor-old";
    const languageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 628,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("vendor-old");

    await act(async () => {
      await getWorkbench().renameEntry({
        kind: "directory",
        name: "vendor",
        path: oldPath,
      });
    });

    expect(languageServerFeaturesGateway.willRenameFiles).not.toHaveBeenCalled();
    expect(languageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
  });
  it("asks the PHP language server for file rename edits before renaming a PHP file", async () => {
    const oldPath = "/workspace/src/User.php";
    const newPath = "/workspace/src/Account.php";
    const consumerPath = "/workspace/src/Consumer.php";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.willRenameFiles).mockResolvedValue(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 31,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "<?php\nclass User {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(languageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [oldPath],
    );
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(languageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("notifies the PHP language server after rename when only did-rename is supported", async () => {
    const oldPath = "/workspace/src/User.php";
    const newPath = "/workspace/src/Account.php";
    const languageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
      },
      kind: "running",
      sessionId: 32,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "<?php\nclass User {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(languageServerFeaturesGateway.willRenameFiles).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(languageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
  it("drops stale PHP rename edits after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.php";
    const newPath = "/workspace-a/src/Account.php";
    const consumerPath = "/workspace-a/src/Consumer.php";
    const renameEdit = createDeferred<LanguageServerWorkspaceEdit | null>();
    const languageServerFeaturesGateway = featuresGateway();
    vi.mocked(languageServerFeaturesGateway.willRenameFiles).mockImplementationOnce(
      () => renameEdit.promise,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 33,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      languageServerFeaturesGateway,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "<?php\nclass User {}\n";
        }

        return `<?php\n// ${path}\n`;
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(languageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
        "/workspace-a",
        oldPath,
        newPath,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    renameEdit.resolve({
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    });
    await act(async () => {
      await renamePromise;
    });

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("ignores stale rename errors after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.php";
    const newPath = "/workspace-a/src/Account.php";
    const rename = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");
    vi.mocked(dependencies.workspaceGateways.files.renamePath).mockImplementationOnce(
      async () => rename.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
        oldPath,
        newPath,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      rename.reject(new Error("stale rename"));
      await renamePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Rename File" && notice.message.includes("stale rename"),
      ),
    ).toBe(false);
  });
  it("does not publish stale rename success after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.php";
    const newPath = "/workspace-a/src/Account.php";
    const parentPath = "/workspace-a/src";
    const staleDirectoryRefresh = createDeferred<FileEntry[]>();
    let holdNextParentRead = false;
    const readDirectory = vi.fn(async (path: string) => {
      if (path === parentPath && holdNextParentRead) {
        return staleDirectoryRefresh.promise;
      }

      return [];
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readDirectory,
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.php");
    holdNextParentRead = true;

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(readDirectory).toHaveBeenCalledWith(parentPath);
    });
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    staleDirectoryRefresh.resolve([]);
    await act(async () => {
      await renamePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().message).not.toBe("Renamed User.php");
  });
  it("does not notify JavaScript TypeScript did-rename after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.ts";
    const newPath = "/workspace-a/src/Account.ts";
    const rename = createDeferred<void>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
      },
      kind: "running",
      sessionId: 61,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");
    vi.mocked(dependencies.workspaceGateways.files.renamePath).mockImplementationOnce(
      async () => rename.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(
        oldPath,
        newPath,
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      rename.resolve(undefined);
      await renamePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
  });
  it("ignores stale JavaScript TypeScript did-rename errors after same-root session restart", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const didRenameFiles = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(24)),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus(24)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles,
    ).mockImplementationOnce(() => didRenameFiles.promise);
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(24),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(24),
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
        "/workspace",
        oldPath,
        newPath,
      );
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(25));
    });
    await flushAsyncTurns();

    await act(async () => {
      didRenameFiles.reject(new Error("stale did rename"));
      await renamePromise;
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(getWorkbench().message).toBe("Renamed User.ts");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Rename" &&
          notice.message.includes("stale did rename"),
      ),
    ).toBe(false);
  });
  it("synchronizes JavaScript TypeScript edits already applied to open Monaco models", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const openUri = "file://localhost/workspace/src/%55ser.ts";
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 31,
    };
    const edit = {
      changes: {
        [openUri]: [
          {
            newText: "let",
            range: {
              end: { character: 5, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "export const helper = true;\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      documentVersions: {
        [openUri]: 1,
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === openPath) {
          return "const value = 1;\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          documents: [{ content: "let value = 1;\n", path: openPath, versionId: 8 }],
          kind: "applied",
        }),
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(getWorkbench().activeDocument?.content).toBe("let value = 1;\n");
    expect(getWorkbench().activeDocument?.savedContent).toBe("const value = 1;\n");
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [openPath],
    );
  });
  it("keeps an inactive edited Monaco model authoritative and dirty when activated", async () => {
    const inactivePath = "/workspace/src/Inactive.ts";
    const activePath = "/workspace/src/Active.ts";
    const originalContent = "export const value = 1;\n";
    const editedContent = "export const value = 2;\n";
    const applyOpenModels = vi.fn(() => ({
      documents: [{ content: editedContent, path: inactivePath, versionId: 8 }],
      kind: "applied" as const,
    }));
    const edit = {
      changes: {
        [fileUriFromPath(inactivePath)]: [
          {
            newText: "2",
            range: {
              end: { character: 22, line: 0 },
              start: { character: 21, line: 0 },
            },
          },
        ],
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) =>
        path === inactivePath ? originalContent : "export const active = true;\n",
      ),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(inactivePath, "Inactive.ts"));
      await getWorkbench().openPinnedFile(fileEntry(activePath, "Active.ts"));
    });

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        applyOpenModels,
        openPaths: [inactivePath],
        rootPath: "/workspace",
      });
      getWorkbench().setActivePath(inactivePath);
    });

    expect(getWorkbench().activeDocument).toEqual(
      expect.objectContaining({
        content: editedContent,
        path: inactivePath,
        savedContent: originalContent,
      }),
    );
    expect(applyOpenModels).toHaveBeenCalledOnce();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [inactivePath, activePath],
    );
  });
  it("rejects invalid staged open models before React, disk, or file operations", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const originalContent = "export const value = 1;\n";
    const edit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "2",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "helper",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.ts"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => originalContent),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });

    let decision;
    await act(async () => {
      decision = await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          kind: "rejected",
          path: openPath,
          reason: "invalidOpenModelEdits",
        }),
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(decision).toEqual({
      kind: "rejected",
      path: openPath,
      reason: "invalidOpenModelEdits",
    });
    expect(getWorkbench().activeDocument?.content).toBe(originalContent);
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
  it("rolls back transactional closed-file edits when the open Monaco commit is rejected", async () => {
    const openPath = "/workspace/src/Open.php";
    const closedPath = "/workspace/src/Closed.php";
    const rollback = vi.fn(async () => undefined);
    const applyWorkspaceEditTransaction = vi.fn(async () => ({
      appliedCount: 1,
      rollback,
    }));
    const edit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "final ",
            range: {
              end: { character: 0, line: 1 },
              start: { character: 0, line: 1 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "closed",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "<?php\nclass Open {}\n"),
      workspaceFiles: { applyWorkspaceEditTransaction },
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "Open.php"));
    });

    let decision;
    await act(async () => {
      decision = await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          kind: "rejected",
          path: openPath,
          reason: "invalidOpenModelEdits",
        }),
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(decision).toEqual({
      kind: "rejected",
      path: openPath,
      reason: "invalidOpenModelEdits",
    });
    expect(applyWorkspaceEditTransaction).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [openPath],
      undefined,
    );
    expect(rollback).toHaveBeenCalledOnce();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass Open {}\n");
  });
  it.each([
    { family: "JavaScript TypeScript", extension: "ts", overlap: false },
    { family: "JavaScript TypeScript", extension: "ts", overlap: true },
    { family: "PHP", extension: "php", overlap: false },
    { family: "PHP", extension: "php", overlap: true },
  ])(
    "rejects controller-only $family document B before staged A commit (overlap: $overlap)",
    async ({ extension, overlap }) => {
      const stagedPath = `/workspace/src/A.${extension}`;
      const controllerOnlyPath = `/workspace/src/B.${extension}`;
      const source = "abc";
      const invalidEdits = overlap
        ? [
            {
              newText: "first",
              range: {
                end: { character: 2, line: 0 },
                start: { character: 0, line: 0 },
              },
            },
            {
              newText: "second",
              range: {
                end: { character: 3, line: 0 },
                start: { character: 1, line: 0 },
              },
            },
          ]
        : [
            {
              newText: "invalid",
              range: {
                end: { character: 9, line: 0 },
                start: { character: 9, line: 0 },
              },
            },
          ];
      const edit = {
        changes: {
          [fileUriFromPath(stagedPath)]: [
            {
              newText: "A",
              range: {
                end: { character: 1, line: 0 },
                start: { character: 0, line: 0 },
              },
            },
          ],
          [fileUriFromPath(controllerOnlyPath)]: invalidEdits,
        },
        fileOperations: [
          {
            kind: "create" as const,
            uri: fileUriFromPath(`/workspace/src/Created.${extension}`),
          },
        ],
      };
      const { dependencies, getWorkbench } = renderController({
        appSettings: workspaceAppSettings(),
        readTextFile: vi.fn(async () => source),
        ...(extension === "ts"
          ? { workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor() }
          : {}),
      });
      await flushAsyncTurns(24);
      await act(async () => {
        await getWorkbench().openPinnedFile(fileEntry(stagedPath, `A.${extension}`));
        await getWorkbench().openPinnedFile(fileEntry(controllerOnlyPath, `B.${extension}`));
      });
      const applyOpenModels = vi.fn(() => ({
        documents: [{ content: "Abc", path: stagedPath, versionId: 8 }],
        kind: "applied" as const,
      }));

      let decision;
      await act(async () => {
        decision =
          extension === "ts"
            ? await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
                applyOpenModels,
                openPaths: [stagedPath],
                rootPath: "/workspace",
              })
            : await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
                applyOpenModels,
                openPaths: [stagedPath],
                rootPath: "/workspace",
              });
      });

      expect(decision).toEqual({
        kind: "rejected",
        path: controllerOnlyPath,
        reason: "invalidOpenModelEdits",
      });
      expect(applyOpenModels).not.toHaveBeenCalled();
      expect(getWorkbench().openDocuments.map(({ content, path }) => ({ content, path }))).toEqual(
        expect.arrayContaining([
          { content: source, path: stagedPath },
          { content: source, path: controllerOnlyPath },
        ]),
      );
      expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    },
  );
  it("does not synchronize an open-model result for another workspace root", async () => {
    const openPath = "/workspace/src/User.ts";
    const originalContent = "export const value = 1;\n";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => originalContent),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(
        { changes: {} },
        {
          applyOpenModels: () => ({
            documents: [
              {
                content: "export const value = 2;\n",
                path: openPath,
                versionId: 8,
              },
            ],
            kind: "applied",
          }),
          openPaths: [openPath],
          rootPath: "/other",
        },
      );
    });

    expect(getWorkbench().activeDocument?.content).toBe(originalContent);
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
  it("synchronizes PHP edits already applied to open Monaco models", async () => {
    const openPath = "/workspace/src/User.php";
    const closedPath = "/workspace/src/Helper.php";
    const edit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "final ",
            range: {
              end: { character: 0, line: 1 },
              start: { character: 0, line: 1 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "<?php\nfinal class Helper {}\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === openPath) {
          return "<?php\nclass User {}\n";
        }

        return "";
      }),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.php"));
    });

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        applyOpenModels: () => ({
          documents: [
            {
              content: "<?php\nfinal class User {}\n",
              path: openPath,
              versionId: 43,
            },
          ],
          kind: "applied",
        }),
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(getWorkbench().activeDocument?.content).toBe("<?php\nfinal class User {}\n");
    expect(getWorkbench().activeDocument?.savedContent).toBe("<?php\nclass User {}\n");
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [openPath],
    );
  });
  it("rejects a stale mixed PHP workspace edit before any mutation", async () => {
    const openPath = "/workspace/src/User.php";
    const closedPath = "/workspace/src/Helper.php";
    const uri = fileUriFromPath(openPath);
    const applyOpenModels = vi.fn(() => ({
      documents: [
        {
          content: "<?php\nfinal class User {}\n",
          path: openPath,
          versionId: 43,
        },
      ],
      kind: "applied" as const,
    }));
    const edit = {
      changes: {
        [uri]: [
          {
            newText: "final ",
            range: {
              end: { character: 0, line: 1 },
              start: { character: 0, line: 1 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "<?php\nfinal class Helper {}\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      documentVersions: {
        [uri]: 0,
      },
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.php"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "<?php\nclass User {}\n"),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.php"));
    });
    await flushAsyncTurns(24);

    let decision;
    await act(async () => {
      decision = await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        applyOpenModels,
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(decision).toEqual({
      kind: "rejected",
      path: openPath,
      reason: "staleDocumentVersion",
    });
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass User {}\n");
    expect(applyOpenModels).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
  it("filters PHP workspace edit file operations before applying closed files", async () => {
    const openPath = "/workspace/src/User.php";
    const closedPath = "/workspace/src/Helper.php";
    const outsidePath = "/other/src/Outside.php";
    const filteredEdit = {
      changes: {
        [fileUriFromPath(closedPath)]: [
          {
            newText: "<?php\nfinal class Helper {}\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.php"),
        },
        {
          kind: "rename" as const,
          newUri: fileUriFromPath("/workspace/src/Account.php"),
          oldUri: fileUriFromPath("/workspace/src/OldName.php"),
        },
      ],
    };
    const edit = {
      changes: {
        ...filteredEdit.changes,
        [fileUriFromPath(outsidePath)]: [
          {
            newText: "<?php\nfinal class Outside {}\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        ...filteredEdit.fileOperations,
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/other/src/OutsideDelete.php"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === openPath) {
          return "<?php\nclass User {}\n";
        }

        if (path === outsidePath) {
          return "<?php\nclass Outside {}\n";
        }

        return "";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(outsidePath, "Outside.php"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.php"));
    });

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(
      getWorkbench().openDocuments.find((document) => document.path === openPath)?.content,
    ).toBe("<?php\nclass User {}\n");
    expect(
      getWorkbench().openDocuments.find((document) => document.path === outsidePath)?.content,
    ).toBe("<?php\nclass Outside {}\n");
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      expect.arrayContaining([openPath, outsidePath]),
    );
  });
  it("refreshes directories affected by PHP workspace edit file operations", async () => {
    const filteredEdit = {
      changes: {},
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.php"),
        },
        {
          kind: "rename" as const,
          newUri: fileUriFromPath("/workspace/app/Models/Account.php"),
          oldUri: fileUriFromPath("/workspace/src/User.php"),
        },
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/workspace/tests/UserTest.php"),
        },
      ],
    };
    const edit = {
      changes: {},
      fileOperations: [
        ...filteredEdit.fileOperations,
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/other/tests/OutsideTest.php"),
        },
      ],
    };
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace/src") {
        return [fileEntry("/workspace/src/Created.php", "Created.php")];
      }

      if (path === "/workspace/app/Models") {
        return [fileEntry("/workspace/app/Models/Account.php", "Account.php")];
      }

      if (path === "/workspace/tests") {
        return [];
      }

      return [];
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readDirectory,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.workspaceGateways.files.readDirectory).mockClear();

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      [],
    );
    expect(
      vi
        .mocked(dependencies.workspaceGateways.files.readDirectory)
        .mock.calls.map(([path]) => path),
    ).toEqual(["/workspace/src", "/workspace/app/Models", "/workspace/tests"]);
    expect(getWorkbench().entriesByDirectory["/workspace/app/Models"]).toEqual([
      fileEntry("/workspace/app/Models/Account.php", "Account.php"),
    ]);
  });
  it("syncs every open PHP document changed by one workspace edit", async () => {
    const firstPath = "/workspace/src/First.php";
    const secondPath = "/workspace/src/Second.php";
    const edit = {
      changes: {
        [fileUriFromPath(firstPath)]: [
          {
            newText: "ChangedFirst",
            range: {
              end: { character: 11, line: 1 },
              start: { character: 6, line: 1 },
            },
          },
        ],
        [fileUriFromPath(secondPath)]: [
          {
            newText: "ChangedSecond",
            range: {
              end: { character: 12, line: 1 },
              start: { character: 6, line: 1 },
            },
          },
        ],
      },
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId: 29,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === firstPath) {
          return "<?php\nclass First {}\n";
        }
        if (path === secondPath) {
          return "<?php\nclass Second {}\n";
        }
        return "";
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(firstPath, "First.php"));
      await getWorkbench().openPinnedFile(fileEntry(secondPath, "Second.php"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.documentSyncGateway.didChange).mockClear();

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });
    await act(async () => {
      await Promise.all([
        getWorkbench().flushPendingLanguageServerDocument(firstPath),
        getWorkbench().flushPendingLanguageServerDocument(secondPath),
      ]);
    });

    expect(
      vi
        .mocked(dependencies.documentSyncGateway.didChange)
        .mock.calls.map(([, value]) => value.path),
    ).toEqual(expect.arrayContaining([firstPath, secondPath]));
  });
  it("reconciles open PHP tabs after workspace edit file operations", async () => {
    const oldPath = "/workspace/src/User.php";
    const newPath = "/workspace/src/Account.php";
    const deletedPath = "/workspace/src/DeleteMe.php";
    const edit = {
      changes: {
        [fileUriFromPath(newPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 10, line: 1 },
              start: { character: 6, line: 1 },
            },
          },
        ],
      },
      fileOperations: [
        {
          kind: "rename" as const,
          newUri: fileUriFromPath(newPath),
          oldUri: fileUriFromPath(oldPath),
        },
        {
          kind: "delete" as const,
          uri: fileUriFromPath(deletedPath),
        },
      ],
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 28,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "<?php\nclass User {}\n";
        }

        if (path === deletedPath) {
          return "<?php\nclass DeleteMe {}\n";
        }

        return "";
      }),
      runtimeStatus: runningStatus,
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.php"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(deletedPath, "DeleteMe.php"));
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await Promise.all([
        getWorkbench().flushPendingLanguageServerDocument(oldPath),
        getWorkbench().flushPendingLanguageServerDocument(deletedPath),
      ]);
    });
    vi.mocked(dependencies.documentSyncGateway.didClose).mockClear();
    vi.mocked(dependencies.documentSyncGateway.didOpen).mockClear();

    await act(async () => {
      await getWorkbench().applyPhpLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([newPath]);
    expect(getWorkbench().activeDocument?.path).toBe(newPath);
    expect(getWorkbench().activeDocument?.name).toBe("Account.php");
    expect(getWorkbench().activeDocument?.content).toBe("<?php\nclass Account {}\n");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      28,
    );
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      deletedPath,
      28,
    );
    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path: newPath,
        text: "<?php\nclass Account {}\n",
      }),
      28,
    );
  });
  it("rejects a stale mixed JavaScript TypeScript workspace edit before any mutation", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const uri = fileUriFromPath(openPath);
    const aliasUri = "file://localhost/workspace/src/%55ser.ts";
    const applyOpenModels = vi.fn();
    const edit = {
      changes: {
        [uri]: [
          {
            newText: "let",
            range: {
              end: { character: 5, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [aliasUri]: [
          {
            newText: "/* alias */\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "export const helper = true;\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      documentVersions: {
        [aliasUri]: 2,
        [uri]: 1,
      },
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.ts"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "const value = 1;\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });
    await flushAsyncTurns(24);

    let decision;
    await act(async () => {
      decision = await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        applyOpenModels,
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(decision).toEqual({
      kind: "rejected",
      path: openPath,
      reason: "staleDocumentVersion",
    });
    expect(getWorkbench().activeDocument?.content).toBe("const value = 1;\n");
    expect(applyOpenModels).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
  });
  it("filters JavaScript TypeScript workspace edits before applying closed files", async () => {
    const openPath = "/workspace/src/User.ts";
    const closedPath = "/workspace/src/Helper.ts";
    const outsidePath = "/other/src/Outside.ts";
    const malformedUri = "not a uri";
    const filteredEdit = {
      changes: {
        [fileUriFromPath(openPath)]: [
          {
            newText: "let",
            range: {
              end: { character: 5, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [fileUriFromPath(closedPath)]: [
          {
            newText: "export const helper = true;\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        {
          kind: "create" as const,
          options: { ignoreIfExists: true },
          uri: fileUriFromPath("/workspace/src/Created.ts"),
        },
        {
          kind: "rename" as const,
          newUri: fileUriFromPath("/workspace/src/NewName.ts"),
          oldUri: fileUriFromPath("/workspace/src/OldName.ts"),
        },
      ],
    };
    const edit = {
      changes: {
        ...filteredEdit.changes,
        [fileUriFromPath(outsidePath)]: [
          {
            newText: "leak",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        [malformedUri]: [
          {
            newText: "leak",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        ...filteredEdit.fileOperations,
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/other/src/OutsideDelete.ts"),
        },
      ],
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === openPath) {
          return "const value = 1;\n";
        }

        if (path === outsidePath) {
          return "const outside = true;\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(outsidePath, "Outside.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(openPath, "User.ts"));
    });

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        openPaths: [openPath],
        rootPath: "/workspace",
      });
    });

    expect(
      getWorkbench().openDocuments.find((document) => document.path === openPath)?.content,
    ).toBe("const value = 1;\n");
    expect(
      getWorkbench().openDocuments.find((document) => document.path === outsidePath)?.content,
    ).toBe("const outside = true;\n");
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      expect.arrayContaining([openPath, outsidePath]),
    );
  });
  it("refreshes directories affected by JavaScript TypeScript workspace edit file operations", async () => {
    const filteredEdit = {
      changes: {},
      fileOperations: [
        {
          kind: "create" as const,
          uri: fileUriFromPath("/workspace/src/Created.ts"),
        },
        {
          kind: "rename" as const,
          newUri: fileUriFromPath("/workspace/components/Account.ts"),
          oldUri: fileUriFromPath("/workspace/src/User.ts"),
        },
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/workspace/tests/User.test.ts"),
        },
      ],
    };
    const edit = {
      changes: {},
      fileOperations: [
        ...filteredEdit.fileOperations,
        {
          kind: "delete" as const,
          uri: fileUriFromPath("/other/tests/Outside.test.ts"),
        },
      ],
    };
    const readDirectory = vi.fn(async (path: string) => {
      if (path === "/workspace/src") {
        return [fileEntry("/workspace/src/Created.ts", "Created.ts")];
      }

      if (path === "/workspace/components") {
        return [fileEntry("/workspace/components/Account.ts", "Account.ts")];
      }

      if (path === "/workspace/tests") {
        return [];
      }

      return [];
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readDirectory,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.workspaceGateways.files.readDirectory).mockClear();

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      [],
    );
    expect(
      vi
        .mocked(dependencies.workspaceGateways.files.readDirectory)
        .mock.calls.map(([path]) => path),
    ).toEqual(["/workspace/src", "/workspace/components", "/workspace/tests"]);
    expect(getWorkbench().entriesByDirectory["/workspace/components"]).toEqual([
      fileEntry("/workspace/components/Account.ts", "Account.ts"),
    ]);
  });
  it("reconciles open JavaScript TypeScript tabs after workspace edit file operations", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const deletedPath = "/workspace/src/DeleteMe.ts";
    const edit = {
      changes: {
        [fileUriFromPath(newPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 17, line: 0 },
              start: { character: 13, line: 0 },
            },
          },
        ],
      },
      fileOperations: [
        {
          kind: "rename" as const,
          newUri: fileUriFromPath(newPath),
          oldUri: fileUriFromPath(oldPath),
        },
        {
          kind: "delete" as const,
          uri: fileUriFromPath(deletedPath),
        },
      ],
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 27,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        if (path === deletedPath) {
          return "export const deleted = true;\n";
        }

        return "";
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(deletedPath, "DeleteMe.ts"));
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.documentSyncGateway.didClose).mockClear();
    vi.mocked(dependencies.documentSyncGateway.didOpen).mockClear();

    await act(async () => {
      await getWorkbench().applyJavaScriptTypeScriptLanguageServerWorkspaceEdit(edit, {
        openPaths: [],
        rootPath: "/workspace",
      });
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().openDocuments.map((document) => document.path)).toEqual([newPath]);
    expect(getWorkbench().activeDocument?.path).toBe(newPath);
    expect(getWorkbench().activeDocument?.name).toBe("Account.ts");
    expect(getWorkbench().activeDocument?.content).toBe("export class Account {}\n");
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      27,
    );
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith(
      "/workspace",
      deletedPath,
      27,
    );
    expect(dependencies.documentSyncGateway.didOpen).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        path: newPath,
        text: "export class Account {}\n",
      }),
      27,
    );
  });
  it("filters JavaScript TypeScript rename edits to the active workspace root", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const outsidePath = "/other/src/Consumer.ts";
    const filteredEdit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const edit = {
      changes: {
        ...filteredEdit.changes,
        [fileUriFromPath(outsidePath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      edit,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      sessionId: 24,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        if (path === outsidePath) {
          return "import { User } from '../workspace/src/User';\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(outsidePath, "Consumer.ts"));
    });
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      filteredEdit,
      expect.arrayContaining([oldPath, outsidePath]),
    );
    expect(
      getWorkbench().openDocuments.find((document) => document.path === outsidePath)?.content,
    ).toBe("import { User } from '../workspace/src/User';\n");
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
  });
  it("drops stale JavaScript TypeScript rename edits after switching project tabs", async () => {
    const oldPath = "/workspace-a/src/User.ts";
    const newPath = "/workspace-a/src/Account.ts";
    const consumerPath = "/workspace-a/src/Consumer.ts";
    const renameEdit = createDeferred<LanguageServerWorkspaceEdit | null>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).mockImplementationOnce(async () => renameEdit.promise);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace-a",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renameResolved = false;
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = (command?.run() ?? Promise.resolve()).then(() => {
        renameResolved = true;
      });
    });
    await flushAsyncTurns(4);

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(4);

    renameEdit.resolve({
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    });
    await act(async () => {
      await renamePromise;
    });

    expect(renameResolved).toBe(true);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).toHaveBeenCalledWith(
      "/workspace-a",
      oldPath,
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
  });
  it("does not apply stale JavaScript TypeScript rename edits to an active nested project tab", async () => {
    const parentRoot = "/workspace";
    const childRoot = "/workspace/packages/app";
    const oldPath = "/workspace/src/User.ts";
    const childConsumerPath = "/workspace/packages/app/src/Consumer.ts";
    const initialConsumerSource = "import { User } from '../../src/User';\n";
    const staleRenameEdit: LanguageServerWorkspaceEdit = {
      changes: {
        [fileUriFromPath(childConsumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    };
    const applyClosedFiles = createDeferred<number>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles).mockResolvedValue(
      staleRenameEdit,
    );
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: parentRoot,
      sessionId: 46,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: parentRoot,
        workspaceTabs: [parentRoot, childRoot],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        if (path === childConsumerPath) {
          return initialConsumerSource;
        }

        return `// ${path}\n`;
      }),
      settingsGateway: {
        loadAppSettings: vi.fn(async () => ({
          ...defaultAppSettings(),
          recentWorkspacePath: parentRoot,
          workspaceTabs: [parentRoot, childRoot],
        })),
        loadWorkspaceSettings: vi.fn(async (identity) => {
          const rootPath = workspaceSettingsRoot(identity);
          if (rootPath === childRoot) {
            return {
              ...defaultWorkspaceSettings(),
              session: {
                ...defaultWorkspaceSettings().session,
                editor: createInitialEditorGroupsState("editor-main", {
                  activePath: childConsumerPath,
                  openPaths: [childConsumerPath],
                  previewPath: null,
                }),
              },
            };
          }

          return defaultWorkspaceSettings();
        }),
        saveAppSettings: vi.fn(async () => undefined),
        saveWorkspaceSettings: vi.fn(async () => undefined),
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");
    vi.mocked(dependencies.workspaceGateways.files.applyWorkspaceEdit).mockImplementationOnce(
      async () => applyClosedFiles.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
        parentRoot,
        staleRenameEdit,
        expect.arrayContaining([oldPath]),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab(childRoot);
    });
    await flushAsyncTurns(24);

    await act(async () => {
      applyClosedFiles.resolve(0);
      await renamePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe(childRoot);
    expect(getWorkbench().activeDocument?.path).toBe(childConsumerPath);
    expect(getWorkbench().activeDocument?.content).toBe(initialConsumerSource);
    expect(dependencies.workspaceGateways.files.renamePath).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).not.toHaveBeenCalled();
  });
  it("drops stale JavaScript TypeScript rename edits after same-root session restart", async () => {
    const oldPath = "/workspace/src/User.ts";
    const newPath = "/workspace/src/Account.ts";
    const consumerPath = "/workspace/src/Consumer.ts";
    const renameEdit = createDeferred<LanguageServerWorkspaceEdit | null>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didRenameFiles: true,
        willRenameFiles: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(26)),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus(26)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
    ).mockImplementationOnce(async () => renameEdit.promise);
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(26),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(26),
      readTextFile: vi.fn(async (path: string) => {
        if (path === oldPath) {
          return "export class User {}\n";
        }

        return `// ${path}\n`;
      }),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(oldPath, "User.ts"));
    });
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("Account.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.rename");
    let renamePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      renamePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.willRenameFiles,
      ).toHaveBeenCalledWith("/workspace", oldPath, newPath);
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(27));
    });
    await flushAsyncTurns();

    renameEdit.resolve({
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "Account",
            range: {
              end: { character: 13, line: 0 },
              start: { character: 9, line: 0 },
            },
          },
        ],
      },
    });
    await act(async () => {
      await renamePromise;
    });

    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).not.toHaveBeenCalled();
    expect(dependencies.workspaceGateways.files.renamePath).toHaveBeenCalledWith(oldPath, newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didRenameFiles).toHaveBeenCalledWith(
      "/workspace",
      oldPath,
      newPath,
    );
  });
});

describe("useWorkbenchController document editing and language-service mutations", () => {
  const { renderRegisteredController: renderController } = setupWorkbenchControllerTestHarness();
  it("notifies the JavaScript TypeScript service when a JS TS file is created", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).toHaveBeenCalledWith("/workspace", [
      {
        changeType: "created",
        path: newPath,
      },
    ]);
  });
  it("asks the JavaScript TypeScript service for file create edits before creating a JS TS file", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const consumerPath = "/workspace/src/index.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "import { NewWidget } from './NewWidget';\n",
            range: {
              end: { character: 0, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles,
    ).mockResolvedValueOnce(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didCreateFiles: true,
        willCreateFiles: true,
      },
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles).toHaveBeenCalledWith(
      "/workspace",
      newPath,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [],
    );
    expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didCreateFiles).toHaveBeenCalledWith(
      "/workspace",
      newPath,
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).not.toHaveBeenCalled();
  });
  it("blocks JS TS file creation when create edits fail", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles,
    ).mockRejectedValueOnce(new Error("will create crashed"));
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didCreateFiles: true,
        willCreateFiles: true,
      },
      kind: "running",
      sessionId: 25,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willCreateFiles).toHaveBeenCalledWith(
      "/workspace",
      newPath,
    );
    expect(dependencies.workspaceGateways.files.createTextFile).not.toHaveBeenCalled();
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didCreateFiles).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Create" &&
          notice.message.includes("will create crashed"),
      ),
    ).toBe(true);
  });
  it("ignores stale create file errors after switching project tabs", async () => {
    const newPath = "/workspace-a/src/NewWidget.php";
    const creation = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.php");
    vi.mocked(dependencies.workspaceGateways.files.createTextFile).mockImplementationOnce(
      async () => creation.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      creation.reject(new Error("stale create file"));
      await createPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Create File" && notice.message.includes("stale create file"),
      ),
    ).toBe(false);
  });
  it("does not notify JavaScript TypeScript watched files after switching project tabs", async () => {
    const newPath = "/workspace-a/src/NewWidget.ts";
    const creation = createDeferred<void>();
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 62,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");
    vi.mocked(dependencies.workspaceGateways.files.createTextFile).mockImplementationOnce(
      async () => creation.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      creation.resolve(undefined);
      await createPromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).not.toHaveBeenCalled();
  });
  it("ignores stale create folder errors after switching project tabs", async () => {
    const newPath = "/workspace-a/src/Domain";
    const creation = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/Domain");
    vi.mocked(dependencies.workspaceGateways.files.createDirectory).mockImplementationOnce(
      async () => creation.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "folder.new");
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.createDirectory).toHaveBeenCalledWith(newPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      creation.reject(new Error("stale create folder"));
      await createPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Create Folder" && notice.message.includes("stale create folder"),
      ),
    ).toBe(false);
  });
  it("ignores stale JavaScript TypeScript watched-file errors after same-root session restart", async () => {
    const newPath = "/workspace/src/NewWidget.ts";
    const watchedFilesChanged = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(25)),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus(25)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).mockImplementationOnce(() => watchedFilesChanged.promise);
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(25),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(25),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("src/NewWidget.ts");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    let createPromise: Promise<void> = Promise.resolve();
    await act(async () => {
      createPromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
      ).toHaveBeenCalledWith("/workspace", [
        {
          changeType: "created",
          path: newPath,
        },
      ]);
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(26));
    });
    await flushAsyncTurns();

    await act(async () => {
      watchedFilesChanged.reject(new Error("stale watched files"));
      await createPromise;
    });
    await flushAsyncTurns(24);

    expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
    expect(getWorkbench().activePath).toBe(newPath);
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript" &&
          notice.message.includes("stale watched files"),
      ),
    ).toBe(false);
  });
  it("notifies the JavaScript TypeScript service when package metadata is created", async () => {
    const newPath = "/workspace/package.json";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.prompter.prompt).mockReturnValueOnce("package.json");

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.new");
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.createTextFile).toHaveBeenCalledWith(newPath);
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).toHaveBeenCalledWith("/workspace", [
      {
        changeType: "created",
        path: newPath,
      },
    ]);
  });
  it("closes a JS TS document before notifying the service that its file was deleted", async () => {
    const path = "/workspace/src/User.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: emptyLanguageServerCapabilities(),
      kind: "running",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.ts"));
    });
    await flushAsyncTurns();

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });

    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith("/workspace", path, 26);
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).toHaveBeenCalledWith("/workspace", [
      {
        changeType: "deleted",
        path,
      },
    ]);
    expect(
      vi.mocked(dependencies.documentSyncGateway.didClose).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles).mock
        .invocationCallOrder[0],
    );
  });
  it("asks the JavaScript TypeScript service for file delete edits before deleting a JS TS file", async () => {
    const path = "/workspace/src/User.ts";
    const consumerPath = "/workspace/src/index.ts";
    const edit = {
      changes: {
        [fileUriFromPath(consumerPath)]: [
          {
            newText: "",
            range: {
              end: { character: 31, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
      },
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles,
    ).mockResolvedValueOnce(edit);
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didDeleteFiles: true,
        willDeleteFiles: true,
      },
      kind: "running",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.ts"));
    });
    await flushAsyncTurns();

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(dependencies.workspaceGateways.files.applyWorkspaceEdit).toHaveBeenCalledWith(
      "/workspace",
      edit,
      [path],
    );
    expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    expect(dependencies.documentSyncGateway.didClose).toHaveBeenCalledWith("/workspace", path, 26);
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didDeleteFiles).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeWatchedFiles,
    ).not.toHaveBeenCalled();
  });
  it("blocks JS TS file deletion when delete edits fail", async () => {
    const path = "/workspace/src/User.ts";
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles,
    ).mockRejectedValueOnce(new Error("will delete crashed"));
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        didDeleteFiles: true,
        willDeleteFiles: true,
      },
      kind: "running",
      sessionId: 26,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async () => "export class User {}\n"),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "User.ts"));
    });
    await flushAsyncTurns();

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    await act(async () => {
      await command?.run();
    });

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.willDeleteFiles).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(dependencies.workspaceGateways.files.deletePath).not.toHaveBeenCalled();
    expect(dependencies.documentSyncGateway.didClose).not.toHaveBeenCalledWith(
      "/workspace",
      path,
      26,
    );
    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.didDeleteFiles).not.toHaveBeenCalled();
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "JavaScript/TypeScript Delete" &&
          notice.message.includes("will delete crashed"),
      ),
    ).toBe(true);
  });
  it("ignores stale delete errors after switching project tabs", async () => {
    const path = "/workspace-a/src/User.php";
    const deletion = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
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
    vi.mocked(dependencies.workspaceGateways.files.deletePath).mockImplementationOnce(
      async () => deletion.promise,
    );

    const command = getWorkbench().commands.find((candidate) => candidate.id === "file.delete");
    let deletePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      deletePromise = command?.run() ?? Promise.resolve();
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.workspaceGateways.files.deletePath).toHaveBeenCalledWith(path);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      deletion.reject(new Error("stale delete"));
      await deletePromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Delete File" && notice.message.includes("stale delete"),
      ),
    ).toBe(false);
  });
  it("does not start JavaScript and TypeScript language service when disabled", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const { dependencies } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
        javaScriptTypeScriptService: "off",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
  });
  it("does not start-loop a crashed JavaScript and TypeScript language service from the frontend", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const { dependencies } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: {
        kind: "crashed",
        message: "tsserver crashed",
        rootPath: "/workspace",
      },
      javaScriptTypeScriptLanguageServerPlan,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptService: "auto",
      },
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: true,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: true,
      typeScriptVersionPreference: "bundled",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
  });
  it("leaves a crashed JavaScript and TypeScript language service for backend auto-restart", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async (rootPath) => ({
        kind: "stopped" as const,
        rootPath,
      })),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => ({ kind: "stopped" as const })),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      publishRuntimeStatus?.({
        kind: "crashed",
        message: "tsserver crashed",
        rootPath: "/workspace",
      });
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "crashed",
        message: "tsserver crashed",
        rootPath: "/workspace",
      }),
    );

    act(() => {
      publishRuntimeStatus?.({
        kind: "starting",
        rootPath: "/workspace",
        sessionId: 2,
      });
      publishRuntimeStatus?.({
        capabilities: {
          ...emptyLanguageServerCapabilities(),
          completion: true,
        },
        kind: "running",
        rootPath: "/workspace",
        sessionId: 2,
      });
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 2,
      }),
    );
  });
  it("caches a crashed background JavaScript and TypeScript service without stopping it or changing the active project status", async () => {
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const runtimeStatuses = new Map<string, LanguageServerRuntimeStatus>();
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(
        async (rootPath) =>
          runtimeStatuses.get(rootPath) ?? {
            kind: "stopped" as const,
            rootPath,
          },
      ),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => ({ kind: "stopped" as const })),
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
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      javaScriptTypeScriptLanguageServerRuntimeGateway,
    });
    await flushAsyncTurns(24);

    act(() => {
      const crashedStatus: LanguageServerRuntimeStatus = {
        kind: "crashed",
        message: "workspace b tsserver crashed",
        rootPath: "/workspace-b",
      };
      runtimeStatuses.set("/workspace-b", crashedStatus);
      publishRuntimeStatus?.(crashedStatus);
    });
    await flushAsyncTurns(24);

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace-a" }),
    );

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "crashed",
        message: "workspace b tsserver crashed",
        rootPath: "/workspace-b",
      }),
    );
  });
  it("stops JavaScript and TypeScript language service when settings disable it", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 14,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerPlan,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptService: "off",
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
  });
  it("does not attach the workspace root to a rootless JavaScript and TypeScript stop response", async () => {
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 14,
    };
    const rootlessStopStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 15,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => rootedRunningStatus),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => rootedRunningStatus),
      stop: vi.fn(async () => rootlessStopStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan: readyJavaScriptTypeScriptPlan("/workspace"),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "basic",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 14,
      }),
    );

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptService: "off",
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
  });
  it("notifies the running JavaScript and TypeScript language service when workspace settings change", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 15,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: true,
        javaScriptTypeScriptCodeLens: false,
        javaScriptTypeScriptReferencesCodeLensOnAllFunctions: false,
        javaScriptTypeScriptImportModuleSpecifierEnding: "auto",
        javaScriptTypeScriptImportModuleSpecifierPreference: "shortest",
        javaScriptTypeScriptInlayHints: true,
        javaScriptTypeScriptPreferTypeOnlyAutoImports: false,
        javaScriptTypeScriptQuotePreference: "auto",
        javaScriptTypeScriptValidation: true,
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptAutoImports: false,
          javaScriptTypeScriptCodeLens: true,
          javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
          javaScriptTypeScriptImportModuleSpecifierEnding: "minimal",
          javaScriptTypeScriptImportModuleSpecifierPreference: "relative",
          javaScriptTypeScriptInlayHints: false,
          javaScriptTypeScriptPreferTypeOnlyAutoImports: true,
          javaScriptTypeScriptQuotePreference: "single",
          javaScriptTypeScriptValidation: false,
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        preferences: expect.objectContaining({
          includeCompletionsWithSnippetText: true,
          includePackageJsonAutoImports: "off",
          importModuleSpecifierEnding: "minimal",
          importModuleSpecifierPreference: "relative",
          preferTypeOnlyAutoImports: true,
          quotePreference: "single",
        }),
        implementationsCodeLens: { enabled: true },
        referencesCodeLens: {
          enabled: true,
          showOnAllFunctions: true,
        },
        updateImportsOnFileMove: {
          enabled: "never",
        },
        suggest: expect.objectContaining({
          autoImports: false,
          includeCompletionsForImportStatements: false,
          includeCompletionsForModuleExports: false,
        }),
        validate: {
          enable: false,
        },
      }),
    );
    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        inlayHints: expect.objectContaining({
          parameterNames: {
            enabled: "none",
            suppressWhenArgumentMatchesName: false,
          },
        }),
      }),
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop,
    ).not.toHaveBeenCalled();
  });
  it("notifies the running JavaScript and TypeScript language service when reference CodeLens scope changes", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 15,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptCodeLens: true,
        javaScriptTypeScriptReferencesCodeLensOnAllFunctions: false,
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptCodeLens: true,
          javaScriptTypeScriptReferencesCodeLensOnAllFunctions: true,
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        referencesCodeLens: {
          enabled: true,
          showOnAllFunctions: true,
        },
      }),
    );
  });
  it("restarts JavaScript and TypeScript instead of notifying configuration when automatic type acquisition changes", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 16,
    };
    const stoppedStatus: LanguageServerRuntimeStatus = {
      kind: "stopped",
      rootPath: "/workspace",
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => stoppedStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptLanguageServerPlan: readyJavaScriptTypeScriptPlan("/workspace"),
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutomaticTypeAcquisition: false,
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptAutomaticTypeAcquisition: true,
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).not.toHaveBeenCalled();
    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        automaticTypeAcquisitionEnabled: true,
        typeScriptVersionPreference: "bundled",
      }),
    );
    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
  });
  it("includes active EditorConfig formatting options in JavaScript and TypeScript configuration changes", async () => {
    const path = "/workspace/src/App.ts";
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 15,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      readTextFile: vi.fn(async (requestedPath: string) => {
        if (requestedPath === "/workspace/.editorconfig") {
          return ["root = true", "[*.ts]", "indent_style = space", "indent_size = 4"].join("\n");
        }

        if (requestedPath.endsWith("/.editorconfig")) {
          throw new Error(`No .editorconfig at ${requestedPath}`);
        }

        return ["export function run() {", "    return 1;", "}", ""].join("\n");
      }),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: true,
      },
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(path, "App.ts"));
    });
    await waitForReact(() => {
      expect(getWorkbench().activeEditorConfig).toEqual(
        expect.objectContaining({
          indentStyle: "space",
          indentSize: 4,
        }),
      );
    });

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptAutoImports: false,
        },
        true,
      );
      await flushAsyncTurns(24);
    });

    expect(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        formattingOptions: {
          insertSpaces: true,
          tabSize: 4,
        },
      }),
    );
  });
  it("ignores stale JavaScript and TypeScript configuration errors after same-root session restart", async () => {
    const configurationChange = createDeferred<void>();
    const runningStatus = (sessionId: number): LanguageServerRuntimeStatus => ({
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId,
    });
    let publishRuntimeStatus: ((status: LanguageServerRuntimeStatus) => void) | null = null;
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus(15)),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => runningStatus(15)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async (listener) => {
        publishRuntimeStatus = listener;
        return () => undefined;
      }),
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(
      javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
    ).mockImplementationOnce(() => configurationChange.promise);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus(15),
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      javaScriptTypeScriptRuntimeStatus: runningStatus(15),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: true,
      },
    });
    await flushAsyncTurns(24);

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace",
        },
        {
          ...defaultWorkspaceSettings(),
          javaScriptTypeScriptAutoImports: false,
        },
        true,
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(
        javaScriptTypeScriptLanguageServerFeaturesGateway.didChangeConfiguration,
      ).toHaveBeenCalledWith("/workspace", expect.any(Object));
    });

    act(() => {
      publishRuntimeStatus?.(runningStatus(16));
    });
    await flushAsyncTurns();

    await act(async () => {
      configurationChange.reject(new Error("stale configuration"));
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().message).toBe("Settings saved.");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Settings" && notice.message.includes("stale configuration"),
      ),
    ).toBe(false);
  });
  it("ignores stale workspace settings save errors after switching project tabs", async () => {
    const workspaceSettingsSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockImplementationOnce(
      async () => workspaceSettingsSave.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        getWorkbench().workspaceSettings,
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        expectedWorkspaceSettingsIdentity("/workspace-a"),
        expect.any(Object),
      );
    });

    let switchPromise: Promise<void> = Promise.resolve();
    act(() => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    await act(async () => {
      workspaceSettingsSave.reject(new Error("stale workspace settings"));
      await Promise.all([savePromise, switchPromise]);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Settings" && notice.message.includes("stale workspace settings"),
      ),
    ).toBe(false);
  });
  it("does not continue stale settings saves after app settings persistence resolves", async () => {
    const appSettingsSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
    });
    await flushAsyncTurns(24);
    vi.mocked(dependencies.smartModeGateway.setMode).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockImplementationOnce(
      async () => appSettingsSave.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        {
          ...getWorkbench().workspaceSettings,
          intelligenceMode: "fullSmart",
        },
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenCalled();
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    await act(async () => {
      appSettingsSave.resolve(undefined);
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      vi
        .mocked(dependencies.smartModeGateway.setMode)
        .mock.calls.some(([request]) => request.mode === "fullSmart"),
    ).toBe(false);
    expect(getWorkbench().message).not.toBe("Settings saved.");
  });
  it("keeps an in-flight settings save current when active workspace close is declined", async () => {
    const appSettingsSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      workspaceIdentityGateway: registeredIdentity(["/workspace"]),
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/src/Dirty.php", "Dirty.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("dirty content");
    });
    vi.mocked(dependencies.smartModeGateway.setMode).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockImplementationOnce(
      async () => appSettingsSave.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        {
          ...getWorkbench().workspaceSettings,
          intelligenceMode: "fullSmart",
        },
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledOnce();
    });

    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(false);
    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });

    await act(async () => {
      appSettingsSave.resolve(undefined);
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(dependencies.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expectSmartModeSet(dependencies.smartModeGateway, "/workspace", "fullSmart");
    expect(getWorkbench().workspaceRoot).toBe("/workspace");
    expect(getWorkbench().workspaceTabs).toEqual(["/workspace"]);
  });
  it("invalidates a delayed settings save before accepted workspace teardown", async () => {
    const appSettingsSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
    });
    await flushAsyncTurns(24);
    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace/src/Dirty.php", "Dirty.php"));
    });
    act(() => {
      getWorkbench().updateActiveDocument("dirty content");
    });
    vi.mocked(dependencies.smartModeGateway.setMode).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockClear();
    vi.mocked(dependencies.settingsGateway.saveAppSettings).mockImplementationOnce(
      async () => appSettingsSave.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().saveWorkbenchSettings(
        getWorkbench().appSettings,
        {
          ...getWorkbench().workspaceSettings,
          intelligenceMode: "fullSmart",
        },
        getWorkbench().workspaceTrust?.trusted ?? null,
      );
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveAppSettings).toHaveBeenCalledOnce();
    });
    vi.mocked(
      dependencies.workspaceRuntimeLifecycleGateway.disposeWorkspace,
    ).mockImplementationOnce(async () => {
      appSettingsSave.resolve(undefined);
      await savePromise;
      expect(dependencies.smartModeGateway.setMode).not.toHaveBeenCalled();
    });
    vi.mocked(dependencies.prompter.confirm).mockReturnValueOnce(true);

    await act(async () => {
      await getWorkbench().closeWorkspaceTab("/workspace");
    });

    await act(async () => {
      await savePromise;
    });
    await flushAsyncTurns(24);

    expect(dependencies.prompter.confirm).toHaveBeenCalledWith(
      "Close workspace and discard unsaved changes?",
    );
    expect(
      vi
        .mocked(dependencies.smartModeGateway.setMode)
        .mock.calls.some(([request]) => request.mode === "fullSmart"),
    ).toBe(false);
    expect(getWorkbench().workspaceRoot).toBeNull();
  });
  it("ignores stale status bar setting rollbacks after switching project tabs", async () => {
    const statusBarSave = createDeferred<void>();
    const workspaceSettings = {
      ...defaultWorkspaceSettings(),
      statusBar: {
        ...defaultWorkspaceSettings().statusBar,
        message: false,
      },
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      workspaceSettings,
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockImplementationOnce(
      async () => statusBarSave.promise,
    );

    let savePromise: Promise<void> = Promise.resolve();
    await act(async () => {
      savePromise = getWorkbench().setStatusBarItemVisibility("message", true);
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        expectedWorkspaceSettingsIdentity("/workspace-a"),
        expect.objectContaining({
          statusBar: expect.objectContaining({ message: true }),
        }),
      );
    });

    let switchPromise: Promise<void> = Promise.resolve();
    act(() => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await act(async () => {
      statusBarSave.reject(new Error("stale status bar"));
      await Promise.all([savePromise, switchPromise]);
    });
    await act(async () => {
      await getWorkbench().setStatusBarItemVisibility("message", true);
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceSettings.statusBar.message).toBe(true);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().workspaceSettings.statusBar.message).toBe(true);
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Status Bar" && notice.message.includes("stale status bar"),
      ),
    ).toBe(false);
  });
  it("ignores stale session persistence errors after switching project tabs", async () => {
    const sessionSave = createDeferred<void>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    });
    await flushAsyncTurns();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockImplementation(
      async () => sessionSave.promise,
    );

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry("/workspace-a/src/User.php", "User.php"));
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        expectedWorkspaceSettingsIdentity("/workspace-a"),
        expect.objectContaining({
          session: expect.objectContaining({
            editor: expect.objectContaining({
              groups: expect.objectContaining({
                "editor-main": expect.objectContaining({
                  activePath: "/workspace-a/src/User.php",
                }),
              }),
            }),
          }),
        }),
      );
    });

    let switchPromise = Promise.resolve();
    void act(() => {
      switchPromise = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    await act(async () => {
      sessionSave.reject(new Error("stale session save"));
      await switchPromise;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(
      getWorkbench().notices.some(
        (notice) => notice.source === "Session" && notice.message.includes("stale session save"),
      ),
    ).toBe(false);
  });
  it("reports active session persistence failures during overlapping project switches", async () => {
    const sessionSave = createDeferred<void>();
    const workspaceCSettings = createDeferred<ReturnType<typeof defaultWorkspaceSettings>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b", "/workspace-c"],
      },
    });
    await flushAsyncTurns(24);

    vi.mocked(dependencies.settingsGateway.loadWorkspaceSettings).mockClear();
    vi.mocked(dependencies.workspaceGateways.detection.detectWorkspace).mockClear();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockClear();
    vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mockImplementationOnce(
      async () => sessionSave.promise,
    );
    vi.mocked(dependencies.settingsGateway.loadWorkspaceSettings).mockImplementation(
      async (identity) =>
        workspaceSettingsRoot(identity) === "/workspace-c"
          ? workspaceCSettings.promise
          : defaultWorkspaceSettings(),
    );

    act(() => {
      getWorkbench().splitActiveEditorGroup("right");
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.saveWorkspaceSettings).toHaveBeenCalledWith(
        expectedWorkspaceSettingsIdentity("/workspace-a"),
        expect.any(Object),
      );
    });
    const persistedSession = vi.mocked(dependencies.settingsGateway.saveWorkspaceSettings).mock
      .calls[0]?.[1].session;
    expect(Object.keys(persistedSession.editor.groups)).toHaveLength(2);

    let switchToB: Promise<void> = Promise.resolve();
    act(() => {
      switchToB = getWorkbench().activateWorkspaceTab("/workspace-b");
    });

    let switchToC: Promise<void> = Promise.resolve();
    act(() => {
      switchToC = getWorkbench().activateWorkspaceTab("/workspace-c");
    });
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");

    await act(async () => {
      sessionSave.reject(new Error("A session persistence failed"));
      await Promise.resolve();
    });
    await waitForReact(() => {
      expect(dependencies.settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith(
        expectedWorkspaceSettingsIdentity("/workspace-c"),
      );
    });

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(
      getWorkbench().notices.some(
        (notice) =>
          notice.source === "Session" && notice.message.includes("A session persistence failed"),
      ),
    ).toBe(true);

    await act(async () => {
      workspaceCSettings.resolve(defaultWorkspaceSettings());
      await Promise.all([switchToB, switchToC]);
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-c");
    expect(dependencies.settingsGateway.loadWorkspaceSettings).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.settingsGateway.loadWorkspaceSettings).toHaveBeenCalledWith(
      expectedWorkspaceSettingsIdentity("/workspace-c"),
    );
    expect(dependencies.workspaceGateways.detection.detectWorkspace).not.toHaveBeenCalledWith(
      "/workspace-b",
    );
    expect(dependencies.workspaceGateways.detection.detectWorkspace).toHaveBeenCalledWith(
      "/workspace-c",
    );
  });
  it("restarts JavaScript and TypeScript language service with current settings", async () => {
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 18,
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runningStatus,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus: runningStatus,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptVersion: "workspace",
      },
    });
    await flushAsyncTurns(24);

    vi.mocked(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).mockClear();
    vi.mocked(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start).mockClear();

    await act(async () => {
      await getWorkbench().restartJavaScriptTypeScriptService();
      await flushAsyncTurns(24);
    });

    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(
      dependencies.languageServerGateway.planJavaScriptTypeScriptLanguageServer,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(getWorkbench().message).toBe("JavaScript/TypeScript service restarted.");
  });
  it("does not attach the workspace root to a rootless JavaScript and TypeScript restart response", async () => {
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 18,
    };
    const rootlessRestartStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 19,
    };
    const javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => rootedRunningStatus),
      openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
      start: vi.fn(async () => rootlessRestartStatus),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptLanguageServerPlan: readyJavaScriptTypeScriptPlan("/workspace"),
      javaScriptTypeScriptLanguageServerRuntimeGateway,
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        javaScriptTypeScriptAutoImports: false,
        javaScriptTypeScriptInlayHints: false,
        javaScriptTypeScriptVersion: "workspace",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 18,
      }),
    );

    await act(async () => {
      await getWorkbench().restartJavaScriptTypeScriptService();
      await flushAsyncTurns(24);
    });

    expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).toHaveBeenCalledWith(
      "/workspace",
    );
    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.start,
    ).toHaveBeenCalledWith("/workspace", {
      autoImportsEnabled: false,
      automaticTypeAcquisitionEnabled: false,
      codeLensEnabled: false,
      completeFunctionCalls: false,
      inlayHintsEnabled: false,
      typeScriptVersionPreference: "workspace",
      validationEnabled: true,
    });
    expect(getWorkbench().javaScriptTypeScriptLanguageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
  });
  it("opens JavaScript and TypeScript language service log for the active workspace", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openJavaScriptTypeScriptServiceLog();
      await flushAsyncTurns(4);
    });

    expect(
      dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.openLog,
    ).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().message).toBe(
      "Opened JavaScript/TypeScript service log: /tmp/typescript-language-server.log",
    );
  });
  it("detects PHP workspace metadata before restoring startup tabs", async () => {
    const restoredPath = "/workspace/app/Http/Controllers/CommentController.php";
    const readTextFile = vi.fn(async () => "<?php\nclass CommentController {}\n");
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        session: {
          activePath: restoredPath,
          bottomPanelView: "problems",
          openPaths: [restoredPath],
          sidebarView: "files",
        },
      },
    });
    await flushAsyncTurns();

    const detectOrder = vi.mocked(dependencies.workspaceGateways.detection.detectWorkspace).mock
      .invocationCallOrder[0];
    const restoreReadOrder = readTextFile.mock.invocationCallOrder[0];

    expect(detectOrder).toBeDefined();
    expect(restoreReadOrder).toBeDefined();
    expect(detectOrder ?? Number.MAX_SAFE_INTEGER).toBeLessThan(restoreReadOrder ?? 0);
    expect(getWorkbench().workspaceDescriptor?.php).not.toBeNull();
    expect(getWorkbench().activePath).toBe(restoredPath);
  });
  it("clears indexed intelligence and stops the language server when IDE mode is turned off", async () => {
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      workspaceIdentityGateway: registeredIdentity(["/workspace"]),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().toggleSmartMode();
    });
    await act(async () => {
      await getWorkbench().toggleSmartMode();
    });

    expectInitialScan(dependencies.indexProgressGateway, "/workspace");
    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expectWorkspaceIndexClear(dependencies.indexProgressGateway, "/workspace");
    expect(getWorkbench().intelligenceMode).toBe("basic");
  });
  it("does not attach the workspace root to a rootless PHP stop response", async () => {
    const rootedRunningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 44,
    };
    const rootlessStopStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      sessionId: 45,
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => rootedRunningStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => rootedRunningStatus),
      stop: vi.fn(async () => rootlessStopStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({
        kind: "running",
        rootPath: "/workspace",
        sessionId: 44,
      }),
    );

    await act(async () => {
      await getWorkbench().toggleSmartMode();
      await flushAsyncTurns(24);
    });

    expect(dependencies.languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(
      expect.objectContaining({ kind: "stopped", rootPath: "/workspace" }),
    );
  });
  it("does not autostart phpactor again while IDE mode is being disabled", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 44,
    };
    const stoppedStatus: LanguageServerRuntimeStatus = {
      kind: "stopped",
      rootPath: "/workspace",
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => stoppedStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);
    vi.mocked(languageServerRuntimeGateway.start).mockClear();

    await act(async () => {
      await getWorkbench().toggleSmartMode();
      await flushAsyncTurns(24);
    });

    expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expect(languageServerRuntimeGateway.start).not.toHaveBeenCalled();
    expect(getWorkbench().intelligenceMode).toBe("basic");
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(stoppedStatus);
  });
  it("does not autostart phpactor again after a manual stop in IDE mode", async () => {
    const runningStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        completion: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 44,
    };
    const stoppedStatus: LanguageServerRuntimeStatus = {
      kind: "stopped",
      rootPath: "/workspace",
    };
    const languageServerRuntimeGateway: LanguageServerRuntimeGateway = {
      getStatus: vi.fn(async () => runningStatus),
      openLog: vi.fn(async () => null),
      start: vi.fn(async () => runningStatus),
      stop: vi.fn(async () => stoppedStatus),
      subscribeStatus: vi.fn(async () => () => undefined),
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      languageServerPlan: phpactorLanguageServerPlan(),
      languageServerRuntimeGateway,
      workspaceDescriptor: phpWorkspaceDescriptor(),
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        intelligenceMode: "fullSmart",
      },
    });
    await flushAsyncTurns(24);
    vi.mocked(languageServerRuntimeGateway.start).mockClear();

    await act(async () => {
      await getWorkbench().stopLanguageServer();
      await flushAsyncTurns(24);
    });

    expect(languageServerRuntimeGateway.stop).toHaveBeenCalledWith("/workspace");
    expect(languageServerRuntimeGateway.start).not.toHaveBeenCalled();
    expect(getWorkbench().intelligenceMode).toBe("fullSmart");
    expect(getWorkbench().languageServerRuntimeStatus).toEqual(stoppedStatus);
  });
  it("toggles file structure to inherited members on the second Cmd+R", async () => {
    const childPath = "/workspace/app/Child.php";
    const parentPath = "/workspace/app/ParentClass.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === childPath) {
          return "<?php\nnamespace App;\nclass Child extends ParentClass {}\n";
        }

        return "<?php\nnamespace App;\nclass ParentClass { public function inherited() {} }\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(childPath, "Child.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureScope).toBe("inherited");
    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      parentPath,
      expect.stringContaining("inherited"),
    );
  });
  it("uses live-parse signature metadata for PHP file structure even when the index is non-empty", async () => {
    const path = "/workspace/app/UserService.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async () => "<?php\nclass UserService { public function handle() {} }\n"),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });

    dependencies.phpFileOutlineGateway.getPhpFileOutline = vi.fn(async () => ({
      nodes: [
        {
          children: [
            {
              children: [],
              column: 5,
              fullyQualifiedName: "UserService::handle",
              id: "indexed-handle",
              kind: "method" as const,
              label: "handle",
              lineNumber: 2,
              path,
              relativePath: "app/UserService.php",
            },
          ],
          column: 1,
          fullyQualifiedName: "UserService",
          id: "indexed-class",
          kind: "class" as const,
          label: "UserService",
          lineNumber: 1,
          path,
          relativePath: "app/UserService.php",
        },
      ],
    }));
    dependencies.phpFileOutlineGateway.parsePhpFileOutline = vi.fn(async () => ({
      nodes: [
        {
          children: [
            {
              children: [],
              column: 5,
              fullyQualifiedName: "UserService::handle",
              id: "live-handle",
              kind: "method" as const,
              label: "handle",
              lineNumber: 2,
              parameters: [{ name: "$request", type: "Request" }],
              path,
              relativePath: "app/UserService.php",
              returnType: "void",
              visibility: "public" as const,
            },
          ],
          column: 1,
          fullyQualifiedName: "UserService",
          id: "live-class",
          kind: "class" as const,
          label: "UserService",
          lineNumber: 1,
          path,
          relativePath: "app/UserService.php",
        },
      ],
    }));

    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      path,
      expect.stringContaining("UserService"),
    );

    const method = getWorkbench().fileStructureOutline?.nodes[0]?.children[0];
    expect(method?.visibility).toBe("public");
    expect(method?.returnType).toBe("void");
    expect(method?.parameters).toEqual([{ name: "$request", type: "Request" }]);
  });
  it("re-parses the live dirty buffer when file structure reopens after an edit", async () => {
    const path = "/workspace/app/UserService.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(
        async () => "<?php\nclass UserService { public function originalMethod() {} }\n",
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "UserService.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      path,
      expect.stringContaining("originalMethod"),
    );

    act(() => {
      getWorkbench().setFileStructureOpen(false);
    });
    act(() => {
      getWorkbench().updateActiveDocument(
        "<?php\nclass UserService { public function renamedMethod() {} }\n",
      );
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      path,
      expect.stringContaining("renamedMethod"),
    );
  });
  it("re-resolves the inherited outline from the live dirty buffer after an extends edit", async () => {
    const childPath = "/workspace/app/Child.php";
    const parentPath = "/workspace/app/ParentClass.php";
    const otherParentPath = "/workspace/app/OtherParent.php";
    const { dependencies, getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      readTextFile: vi.fn(async (path: string) => {
        if (path === childPath) {
          return "<?php\nnamespace App;\nclass Child extends ParentClass {}\n";
        }

        if (path === otherParentPath) {
          return "<?php\nnamespace App;\nclass OtherParent { public function inheritedRenamed() {} }\n";
        }

        return "<?php\nnamespace App;\nclass ParentClass { public function inheritedOriginal() {} }\n";
      }),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(childPath, "Child.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(getWorkbench().fileStructureScope).toBe("inherited");
    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      parentPath,
      expect.stringContaining("inheritedOriginal"),
    );

    act(() => {
      getWorkbench().setFileStructureOpen(false);
    });
    act(() => {
      getWorkbench().updateActiveDocument(
        "<?php\nnamespace App;\nclass Child extends OtherParent {}\n",
      );
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();

    expect(getWorkbench().fileStructureScope).toBe("inherited");
    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
      otherParentPath,
      expect.stringContaining("inheritedRenamed"),
    );
  });
  it("drops delayed current PHP file structure outlines after switching project tabs", async () => {
    const workspaceAPath = "/workspace-a/app/UserService.php";
    const workspaceBPath = "/workspace-b/app/OrderService.php";
    const workspaceAOutline =
      createDeferred<Awaited<ReturnType<PhpFileOutlineGateway["parsePhpFileOutline"]>>>();
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile: vi.fn(async (path: string) =>
        path === workspaceAPath
          ? "<?php\nclass UserService { public function staleWorkspaceA() {} }\n"
          : "<?php\nclass OrderService {}\n",
      ),
      workspaceDescriptor: phpWorkspaceDescriptor(),
    });
    dependencies.phpFileOutlineGateway.parsePhpFileOutline = vi.fn(async (path) => {
      if (path === workspaceAPath) {
        return workspaceAOutline.promise;
      }

      return emptyPhpFileOutline();
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openPinnedFile(fileEntry(workspaceAPath, "UserService.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await waitForReact(() => {
      expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).toHaveBeenCalledWith(
        workspaceAPath,
        expect.stringContaining("staleWorkspaceA"),
      );
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(workspaceBPath, "OrderService.php"));
    });
    await flushAsyncTurns();

    workspaceAOutline.resolve({
      nodes: [
        {
          children: [],
          column: 1,
          fullyQualifiedName: "UserService",
          id: "stale-workspace-a-service",
          kind: "class",
          label: "StaleWorkspaceAService",
          lineNumber: 1,
          path: workspaceAPath,
          relativePath: "app/UserService.php",
        },
      ],
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(getWorkbench().activePath).toBe(workspaceBPath);
    expect(getWorkbench().fileStructureOutline).toBeNull();

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-a");
    });
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(getWorkbench().activePath).toBe(workspaceAPath);
    expect(getWorkbench().fileStructureOutline).toBeNull();
  });
  it("stops reading stale inherited PHP file structure candidates after switching project tabs", async () => {
    const childPath = "/workspace-a/app/Child.php";
    const primaryParentPath = "/workspace-a/app/ParentClass.php";
    const packageParentPath = "/workspace-a/vendor/shared/package/src/ParentClass.php";
    const childSource = "<?php\nnamespace App;\nclass Child extends ParentClass {}\n";
    const primaryParentRead = createDeferred<string>();
    const readTextFile = vi.fn(async (path: string) => {
      if (path === childPath) {
        return childSource;
      }

      if (path === primaryParentPath) {
        return primaryParentRead.promise;
      }

      if (path === packageParentPath) {
        return "<?php\nnamespace App;\nclass ParentClass {}\n";
      }

      return "<?php\n";
    });
    const { dependencies, getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      },
      readTextFile,
      workspaceDescriptor: phpWorkspaceDescriptor({
        packages: [
          {
            classmapRoots: [],
            dev: false,
            installPath: "../shared/package",
            name: "shared/package",
            packageType: "library",
            psr4Roots: [
              {
                dev: false,
                namespace: "App\\",
                paths: ["src/"],
              },
            ],
            version: "1.0.0",
          },
        ],
      }),
    });
    await flushAsyncTurns();

    await act(async () => {
      await getWorkbench().openFile(fileEntry(childPath, "Child.php"));
    });
    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns();
    act(() => {
      getWorkbench().openFileStructure();
    });
    await waitForReact(() => {
      expect(readTextFile).toHaveBeenCalledWith(primaryParentPath);
    });

    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();

    primaryParentRead.reject(new Error("missing parent"));
    await flushAsyncTurns(24);

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(readTextFile).not.toHaveBeenCalledWith(packageParentPath);
    expect(dependencies.phpFileOutlineGateway.parsePhpFileOutline).not.toHaveBeenCalledWith(
      packageParentPath,
      expect.stringContaining("ParentClass"),
    );
  });
  it("loads JavaScript and TypeScript file structure from the language server", async () => {
    const path = "/workspace/src/userService.ts";
    const javaScriptTypeScriptLanguageServerPlan: LanguageServerPlan = {
      command: {
        args: ["--stdio"],
        executable: "typescript-language-server",
        workingDirectory: "/workspace",
      },
      initializeRequest: {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {},
      },
      message: "TypeScript language server is ready.",
      provider: "typeScriptLanguageServer",
      status: "ready",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      sessionId: 12,
    };
    const javaScriptTypeScriptLanguageServerFeaturesGateway = featuresGateway();
    vi.mocked(javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols).mockResolvedValue([
      {
        children: [
          {
            children: [],
            containerName: null,
            detail: "(id: string)",
            kind: 6,
            name: "loadUser",
            range: range(2, 2, 4, 3),
            selectionRange: range(2, 8, 2, 16),
          },
        ],
        containerName: null,
        detail: null,
        kind: 5,
        name: "UserService",
        range: range(1, 0, 6, 1),
        selectionRange: range(1, 13, 1, 24),
      },
    ]);
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway,
      javaScriptTypeScriptLanguageServerPlan,
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "export class UserService {}"),
    });
    await flushAsyncTurns(24);

    await act(async () => {
      await getWorkbench().openFile(fileEntry(path, "userService.ts"));
    });
    await flushAsyncTurns(12);

    const command = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.fileStructure",
    );

    expect(
      command?.isEnabled({
        activeDocumentDirty: false,
        hasActiveDocument: true,
        hasWorkspace: true,
      }),
    ).toBe(true);
    await act(async () => {
      await command?.run();
    });
    await flushAsyncTurns(12);

    expect(javaScriptTypeScriptLanguageServerFeaturesGateway.documentSymbols).toHaveBeenCalledWith(
      "/workspace",
      path,
    );
    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureCanIncludeInheritedMembers).toBe(false);
    expect(getWorkbench().fileStructureOutline?.nodes[0]).toMatchObject({
      kind: "class",
      label: "UserService",
    });
    expect(getWorkbench().fileStructureOutline?.nodes[0]?.children[0]).toMatchObject({
      kind: "method",
      label: "loadUser",
      lineNumber: 3,
    });
  });
});
