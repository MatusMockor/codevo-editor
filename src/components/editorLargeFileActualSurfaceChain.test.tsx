// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEditorIncrementalProductionChainHarness,
  type EditorIncrementalProductionChainHarness,
  type ProductionChainEditor,
  type ProductionChainModel,
} from "../test/editorIncrementalProductionChainHarness";

const MIB = 1024 * 1024;
const TEN_MIB = 10 * MIB;

const actualSurfaceMocks = vi.hoisted(() => ({
  editor: null as ProductionChainEditor | null,
  monaco: null as unknown,
}));
const providerMocks = vi.hoisted(() => ({
  configure: vi.fn(),
  register: vi.fn(() => ({ dispose: vi.fn() })),
}));

vi.mock("@monaco-editor/react", async () => {
  const React = await import("react");

  return {
    default: function MonacoEditorMock(props: {
      onMount(editor: unknown, monaco: unknown): void;
      value?: string;
    }) {
      const mounted = React.useRef(false);
      React.useEffect(() => {
        const editor = actualSurfaceMocks.editor;
        expect(editor && actualSurfaceMocks.monaco).toBeTruthy();
        if (!editor || !actualSurfaceMocks.monaco) {
          return;
        }
        if (!mounted.current) {
          mounted.current = true;
          props.onMount(editor, actualSurfaceMocks.monaco);
        }
        const model = editor.getModel() as ProductionChainModel | null;
        if (model && typeof props.value === "string" && model.currentContent() !== props.value) {
          model.setValue(props.value);
        }
      }, [props]);
      return React.createElement("div", { "data-testid": "actual-monaco-surface" });
    },
  };
});
vi.mock("./languageServerMonacoProviders", async (importOriginal) => ({
  ...(await importOriginal()),
  registerLanguageServerMonacoProviders: providerMocks.register,
}));
vi.mock("./composerManifestMonacoProviders", async (importOriginal) => ({
  ...(await importOriginal()),
  registerComposerManifestMonacoProviders: providerMocks.register,
}));
vi.mock("./npmManifestMonacoProviders", async (importOriginal) => ({
  ...(await importOriginal()),
  registerNpmManifestMonacoProviders: providerMocks.register,
}));
vi.mock("./javascriptTypescriptLanguageServerMonacoProviders", async (importOriginal) => ({
  ...(await importOriginal()),
  registerJavaScriptTypeScriptLanguageServerMonacoProviders: providerMocks.register,
}));
vi.mock("./typescriptJavascriptDefaults", async (importOriginal) => ({
  ...(await importOriginal()),
  configureTypescriptJavascriptDefaultsOnce: providerMocks.configure,
}));
vi.mock("./debugHoverMonacoProvider", async (importOriginal) => ({
  ...(await importOriginal()),
  registerDebugHoverMonacoProviders: providerMocks.register,
}));

describe("actual EditorSurface large-file production chain", () => {
  let container: HTMLDivElement;
  let fixture: EditorIncrementalProductionChainHarness | null;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fixture = null;
    actualSurfaceMocks.editor = null;
    actualSurfaceMocks.monaco = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    fixture?.unsubscribeDirty();
    fixture = null;
    container.remove();
    actualSurfaceMocks.editor = null;
    actualSurfaceMocks.monaco = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("saves an eligible exact 10 MiB model through the actual EditorSurface", async () => {
    fixture = prepareActualSurfaceFixture();
    await renderAndSettle(root, fixture);
    const marker = "/* actual-surface-save */";
    fixture.model.getValue.mockClear();
    fixture.model.setValue.mockClear();
    fixture.diskWrite.mockClear();
    expect(fixture.isDirty()).toBe(false);

    await act(async () => {
      fixture?.editors[0]?.emitReplacement(marker, marker.length);
    });
    await settlePromises();
    const exactCurrentContent = fixture.model.currentContent();
    expect(exactCurrentContent).toHaveLength(TEN_MIB);
    expect(exactCurrentContent.endsWith(marker)).toBe(true);
    expect(fixture.isDirty()).toBe(true);
    expect(fixture.model.getValue).not.toHaveBeenCalled();
    expect(fixture.model.setValue).not.toHaveBeenCalled();

    await expect(fixture.attemptSave()).resolves.toEqual({
      status: "admitted",
      writtenContent: exactCurrentContent,
    });

    expect(fixture.diskWrite).toHaveBeenCalledOnce();
    expect(fixture.diskWrite).toHaveBeenCalledWith(exactCurrentContent);
    expect(fixture.ownerRelativeWorkspaceWrite).toHaveBeenCalledWith(
      fixture.registeredIdentity.workspaceId,
      fixture.registeredIdentity.workspaceRelativePath,
      exactCurrentContent,
      fixture.initialRevision,
    );
    expect(fixture.rawWorkspaceWrite).not.toHaveBeenCalled();
    expect(fixture.model.getValue).toHaveBeenCalledOnce();
    expect(fixture.model.setValue).not.toHaveBeenCalled();
    expect(fixture.model.currentContent()).toBe(exactCurrentContent);
    expect(fixture.isDirty()).toBe(false);
    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.gateway.changeRequests).toHaveLength(0);
    expect(fixture.saveLifecycleEvents().map(({ kind }) => kind)).toEqual([
      "write",
      "acknowledge",
      "history",
      "sync-saved-document",
      "sync-saved-javascript-typescript",
    ]);
    expect(fixture.javaScriptTypeScriptDidSave).not.toHaveBeenCalled();
  });

  it("crosses 10 MiB with one truthful publication and never restores stale React content", async () => {
    fixture = prepareActualSurfaceFixture();
    await renderAndSettle(root, fixture);
    fixture.model.getValue.mockClear();
    fixture.model.setValue.mockClear();
    fixture.legacyFullPublication.mockClear();

    await act(async () => fixture?.editors[0]?.emitInsertion("x"));
    await settlePromises();

    expect(fixture.model.getValue.mock.calls.length).toBe(1);
    expect(fixture.legacyFullPublication).toHaveBeenCalledOnce();
    expect(fixture.legacyFullPublication.mock.calls[0]?.[0]).toHaveLength(TEN_MIB + 1);
    expect(fixture.model.currentContent()).toHaveLength(TEN_MIB + 1);
    expect(fixture.model.currentContent().endsWith("x")).toBe(true);
    expect(fixture.model.setValue.mock.calls.length).toBe(0);
    expect(fixture.gateway.openRequests).toHaveLength(0);

    expect((await fixture.attemptSave()).status).toBe("rejected");
    expect(fixture.diskWrite).not.toHaveBeenCalled();
    expect(fixture.ownerRelativeWorkspaceWrite).not.toHaveBeenCalled();
    expect(fixture.rawWorkspaceWrite).not.toHaveBeenCalled();
  });

  it("keeps a rejected reentrant publication pending and recovers with the latest retry", async () => {
    fixture = prepareActualSurfaceFixture();
    fixture.queueLegacyPublicationResults(false, true);
    await renderAndSettle(root, fixture);
    fixture.model.getValue.mockClear();
    fixture.model.setValue.mockClear();
    fixture.legacyFullPublication.mockClear();

    await act(async () => fixture?.editors[0]?.emitInsertion("x"));
    await settlePromises();
    expect(fixture.legacyFullPublication).toHaveBeenCalledOnce();
    expect(fixture.legacyFullPublication.mock.results[0]?.value).toBe(false);
    expect(fixture.model.currentContent().endsWith("x")).toBe(true);

    await act(async () => {
      root.render(fixture!.renderWithDocumentContent(fixture!.initialContent, "same-document"));
      await settlePromises();
    });
    expect(fixture.model.setValue.mock.calls.length).toBe(0);
    expect(fixture.model.currentContent().endsWith("x")).toBe(true);

    await act(async () => fixture?.editors[0]?.emitInsertion("y"));
    await settlePromises();

    expect(fixture.legacyFullPublication).toHaveBeenCalledTimes(2);
    expect(fixture.legacyFullPublication.mock.results[1]?.value).toBe(true);
    expect(fixture.legacyFullPublication.mock.calls[1]?.[0]).toHaveLength(TEN_MIB + 2);
    expect(fixture.model.currentContent().endsWith("xy")).toBe(true);
    expect(fixture.model.setValue.mock.calls.length).toBe(0);

    fixture.model.getValue.mockClear();
    await act(async () => fixture?.editors[0]?.emitInsertion("z"));
    await settlePromises();

    expect(fixture.legacyFullPublication).toHaveBeenCalledTimes(3);
    expect(fixture.legacyFullPublication.mock.calls[2]?.[0]).toHaveLength(TEN_MIB + 3);
    expect(fixture.legacyFullPublication.mock.calls[2]?.[0].endsWith("xyz")).toBe(true);
    expect(fixture.legacyDidChange).toHaveBeenCalledTimes(3);
    expect(fixture.model.getValue.mock.calls.length).toBe(1);
    expect(fixture.model.currentContent().endsWith("xyz")).toBe(true);
    expect(fixture.model.setValue.mock.calls.length).toBe(0);
    expect((await fixture.attemptSave()).status).toBe("rejected");
    expect(fixture.diskWrite).not.toHaveBeenCalled();
  });

  it("revokes a rejected projection guard for a new same-path empty document", async () => {
    fixture = prepareActualSurfaceFixture();
    fixture.queueLegacyPublicationResults(false);
    await renderAndSettle(root, fixture);
    fixture.model.setValue.mockClear();
    fixture.legacyFullPublication.mockClear();

    await act(async () => fixture?.editors[0]?.emitInsertion("x"));
    await settlePromises();
    expect(fixture.legacyFullPublication).toHaveBeenCalledOnce();
    expect(fixture.legacyFullPublication.mock.results[0]?.value).toBe(false);
    expect(fixture.model.currentContent().endsWith("x")).toBe(true);

    await act(async () => {
      root.render(fixture!.renderWithDocumentContent("", "new-document"));
      await settlePromises();
    });

    expect(fixture.model.setValue.mock.calls.length).toBe(1);
    expect(fixture.model.setValue.mock.calls[0]?.[0]).toBe("");
    expect(fixture.model.currentContent()).toBe("");
    expect(fixture.legacyFullPublication).toHaveBeenCalledOnce();
  });
});

function prepareActualSurfaceFixture(): EditorIncrementalProductionChainHarness {
  const fixture = createEditorIncrementalProductionChainHarness(1, {
    initialUtf16Length: TEN_MIB,
    surfaceMode: "editor-surface",
  });
  actualSurfaceMocks.editor = fixture.editors[0]!;
  actualSurfaceMocks.monaco = fixture.monaco;
  return fixture;
}

async function renderAndSettle(
  root: Root,
  fixture: EditorIncrementalProductionChainHarness,
): Promise<void> {
  await act(async () => {
    root.render(fixture.view);
    await settlePromises();
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (
      fixture.runtimeContext.current?.ownsExactLiveModelContent?.(
        "pane-1",
        fixture.path,
        fixture.model,
      ) === true
    ) {
      return;
    }
    await act(async () => Promise.resolve());
  }
  expect(
    fixture.runtimeContext.current?.ownsExactLiveModelContent?.(
      "pane-1",
      fixture.path,
      fixture.model,
    ),
  ).toBe(true);
}

async function settlePromises(): Promise<void> {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve();
  }
}
