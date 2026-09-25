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
  const { renderController } = setupWorkbenchControllerTestHarness();

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
      document
        .querySelector<HTMLElement>('[role="option"]')
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
      document
        .querySelector<HTMLInputElement>('input[aria-label="Go to line"]')
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
    expect(document.querySelector('[role="dialog"][aria-label="Command palette"]')).not.toBeNull();
    expect(document.querySelector<HTMLInputElement>(".cv-command-field input")?.value).toBe(
      ">Toggle Terminal",
    );

    act(() => {
      getWorkbench().setPaletteOpen(false);
      getWorkbench().setPaletteOpen(true);
    });

    expect(getWorkbench().commandPaletteInitialQuery).toBe("");
  });

  it("routes Go to Line into Quick Open's current-file line mode", async () => {
    const path = "/workspace/src/foo.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile: vi.fn(async () => "first\nsecond\nthird\n"),
      renderQuickOpenSurfaces: true,
      searchFiles: vi.fn(async () => []),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile({ kind: "file", name: "foo.ts", path }, { pin: true });
    });
    await flushAsyncTurns();
    expect(getWorkbench().activeDocument?.path).toBe(path);

    act(() => {
      getWorkbench().setPaletteOpen(true);
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().runCommand("editor.gotoLine");
    });
    await flushAsyncTurns();

    expect(getWorkbench().paletteOpen).toBe(false);
    expect(getWorkbench().quickOpenOpen).toBe(true);
    expect(getWorkbench().quickOpenQuery).toBe(":");
    expect(document.body.textContent).toContain("Type a line number to go to.");

    act(() => {
      getWorkbench().setQuickOpenQuery(":3");
    });
    await flushAsyncTurns();
    act(() => {
      document
        .querySelector<HTMLInputElement>('input[aria-label="Go to line"]')
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    });
    await flushAsyncTurns();

    expect(getWorkbench().quickOpenOpen).toBe(false);
    expect(getWorkbench().editorRevealTarget).toEqual({
      path,
      position: { column: 1, lineNumber: 3 },
    });
  });

  it("keeps Quick Open in line mode when Go to Line runs from the command palette", async () => {
    const path = "/workspace/src/foo.ts";
    const { getWorkbench } = renderController({
      appSettings: {
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace",
        workspaceTabs: ["/workspace"],
      },
      readTextFile: vi.fn(async () => "first\nsecond\nthird\n"),
      renderQuickOpenSurfaces: true,
      searchFiles: vi.fn(async () => []),
      workspaceDescriptor: javaScriptTypeScriptWorkspaceDescriptor(),
    });
    await flushAsyncTurns();
    await act(async () => {
      await getWorkbench().openFile({ kind: "file", name: "foo.ts", path }, { pin: true });
    });
    await flushAsyncTurns();

    act(() => {
      getWorkbench().setPaletteOpen(true);
    });
    await flushAsyncTurns();
    const paletteInput = document.querySelector<HTMLInputElement>(".cv-command-field input");
    expect(paletteInput).not.toBeNull();
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(paletteInput, ">go to line");
      paletteInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await flushAsyncTurns();
    const titles = [...document.querySelectorAll('[role="option"]')].map(
      (option) => option.textContent ?? "",
    );
    expect(titles.filter((title) => /go to line/i.test(title))).toHaveLength(1);

    act(() => {
      [...document.querySelectorAll<HTMLElement>('[role="option"]')]
        .find((option) => option.textContent?.startsWith("Go to line"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flushAsyncTurns(10);

    expect(getWorkbench().paletteOpen).toBe(false);
    expect(getWorkbench().quickOpenOpen).toBe(true);
    expect(getWorkbench().quickOpenQuery).toBe(":");
    expect(document.querySelector<HTMLInputElement>('input[aria-label="Go to line"]')?.value).toBe(
      ":",
    );
  });
});
