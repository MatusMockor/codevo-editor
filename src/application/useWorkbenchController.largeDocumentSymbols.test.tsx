// @vitest-environment jsdom

import {
  act,
  describe,
  emptyLanguageServerCapabilities,
  expect,
  featuresGateway,
  fileEntry,
  flushAsyncTurns,
  it,
  javaScriptTypeScriptWorkspaceDescriptor,
  setupWorkbenchControllerTestHarness,
  waitForReact,
  workspaceAppSettings,
  type LanguageServerRuntimeStatus,
} from "./useWorkbenchController.preview/testSupport";

const ROOT = "/workspace";
const LARGE_PATH = `${ROOT}/large.ts`;
const LARGE_BODY = "export const value = 1;\n".repeat(6_000);

describe("useWorkbenchController large JavaScript/TypeScript document symbols", () => {
  const { renderController } = setupWorkbenchControllerTestHarness();

  it("never requests document symbols for a policy-large document", async () => {
    const gateway = featuresGateway();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: ROOT,
      sessionId: 11,
    };
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runtimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
      javaScriptTypeScriptRuntimeStatus: runtimeStatus,
      readDirectory: async (directory: string) =>
        directory === ROOT ? [fileEntry(LARGE_PATH, "large.ts")] : [],
      readTextFile: async () => LARGE_BODY,
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(ROOT);
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(LARGE_PATH, "large.ts"), { pin: true });
    });
    await flushAsyncTurns(30);
    await waitForReact(() => {
      expect(getWorkbench().activeDocument?.path).toBe(LARGE_PATH);
    });

    expect(gateway.documentSymbols).not.toHaveBeenCalled();

    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns(30);

    expect(gateway.documentSymbols).not.toHaveBeenCalled();

    const fileStructureCommand = getWorkbench().commands.find(
      (candidate) => candidate.id === "editor.fileStructure",
    );
    expect(fileStructureCommand).toBeDefined();
    act(() => {
      fileStructureCommand?.run();
    });
    await flushAsyncTurns(30);

    expect(gateway.documentSymbols).not.toHaveBeenCalled();
  });

  it("requests document symbols for an eligible document through the same path", async () => {
    const gateway = featuresGateway();
    const runtimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
      },
      kind: "running",
      rootPath: ROOT,
      sessionId: 11,
    };
    const smallPath = `${ROOT}/small.ts`;
    const { getWorkbench } = renderController({
      appSettings: workspaceAppSettings(),
      javaScriptTypeScriptInitialRuntimeStatus: runtimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway: gateway,
      javaScriptTypeScriptRuntimeStatus: runtimeStatus,
      readDirectory: async (directory: string) =>
        directory === ROOT ? [fileEntry(smallPath, "small.ts")] : [],
      readTextFile: async () => "export const value = 1;\n",
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });

    await act(async () => {
      await getWorkbench().openWorkspaceRoot(ROOT);
    });
    await act(async () => {
      await getWorkbench().openFile(fileEntry(smallPath, "small.ts"), { pin: true });
    });
    await flushAsyncTurns(30);
    await waitForReact(() => {
      expect(getWorkbench().activeDocument?.path).toBe(smallPath);
    });

    act(() => {
      getWorkbench().openFileStructure();
    });
    await flushAsyncTurns(30);

    expect(gateway.documentSymbols).toHaveBeenCalled();
  });
});
