// @vitest-environment jsdom

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { emptyLanguageServerCapabilities } from "../domain/languageServerRuntime";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { defaultAppSettings } from "../domain/settings";
import type { FileSearchResult } from "../domain/workspace";
import {
  featuresGateway,
  flushAsyncTurns,
  javaScriptTypeScriptWorkspaceDescriptor,
  setupWorkbenchControllerTestHarness,
} from "../test/workbenchControllerTestHarness";

describe("useWorkbenchController Quick Open dispatch", () => {
  const { getHost, renderController } = setupWorkbenchControllerTestHarness();

  it("dispatches Quick Open file locations and command prefixes through the workbench", async () => {
    const result: FileSearchResult = {
      name: "foo.ts",
      path: "/workspace/src/foo.ts",
      relativePath: "src/foo.ts",
    };
    const javaScriptTypeScriptRuntimeStatus: LanguageServerRuntimeStatus = {
      capabilities: {
        ...emptyLanguageServerCapabilities(),
        documentSymbol: true,
        workspaceSymbol: true,
      },
      kind: "running",
      rootPath: "/workspace",
      sessionId: 42,
    };
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      javaScriptTypeScriptInitialRuntimeStatus: javaScriptTypeScriptRuntimeStatus,
      javaScriptTypeScriptLanguageServerFeaturesGateway: featuresGateway(),
      javaScriptTypeScriptRuntimeStatus,
      readTextFile: vi.fn(async () => "first\nsecond\n"),
      renderQuickOpenSurfaces: true,
      searchFiles: vi.fn(async () => [result]),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setQuickOpenQuery("src/foo.ts:42");
    });
    await act(async () => {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 140);
      });
    });
    await flushAsyncTurns();

    expect(getWorkbench().quickOpenResults).toEqual([result]);

    act(() => {
      getHost()
        .querySelector<HTMLButtonElement>(".quick-open-result")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: result.path,
      position: { column: 1, lineNumber: 42 },
    });

    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setQuickOpenQuery(":2");
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: result.path,
      position: { column: 1, lineNumber: 42 },
    });

    act(() => {
      getHost()
        .querySelector<HTMLInputElement>('input[aria-label="Search files"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    await flushAsyncTurns();

    expect(getWorkbench().editorRevealTarget).toEqual({
      path: result.path,
      position: { column: 1, lineNumber: 2 },
    });

    act(() => {
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setQuickOpenQuery("@method");
    });
    await flushAsyncTurns();

    expect(getWorkbench().fileStructureOpen).toBe(true);
    expect(getWorkbench().fileStructureInitialQuery).toBe("method");

    act(() => {
      getWorkbench().setFileStructureOpen(false);
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setQuickOpenQuery("#handler");
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceSymbolsOpen).toBe(true);
    expect(getWorkbench().workspaceSymbolsQuery).toBe("handler");

    act(() => {
      getWorkbench().setWorkspaceSymbolsOpen(false);
      getWorkbench().openWorkspaceSymbols();
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceSymbolsOpen).toBe(true);
    expect(getWorkbench().workspaceSymbolsQuery).toBe("");

    act(() => {
      getWorkbench().setWorkspaceSymbolsOpen(false);
      getWorkbench().setQuickOpenOpen(true);
      getWorkbench().setQuickOpenQuery(">Toggle Terminal");
    });
    await flushAsyncTurns();

    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().paletteOpen).toBe(true);
    expect(getWorkbench().commandPaletteInitialQuery).toBe("Toggle Terminal");
    expect(getHost().querySelector(".command-palette")).not.toBeNull();

    act(() => {
      getWorkbench().setPaletteOpen(false);
      getWorkbench().setPaletteOpen(true);
    });

    expect(getWorkbench().commandPaletteInitialQuery).toBe("");
  });
});
