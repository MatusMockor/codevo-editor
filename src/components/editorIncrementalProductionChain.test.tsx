// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEditorIncrementalProductionChainHarness,
  type EditorIncrementalProductionChainHarness,
} from "../test/editorIncrementalProductionChainHarness";
import {
  editorSurfaceControlledValue,
  reconcileActiveDocumentModelContent,
} from "./editorSurfaceLiveModelContentAuthority";

const providerMocks = vi.hoisted(() => ({
  register: vi.fn(() => ({ dispose: vi.fn() })),
  configure: vi.fn(),
}));

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

describe("editor incremental production chain", () => {
  let container: HTMLDivElement;
  let fixture: EditorIncrementalProductionChainHarness | null;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    fixture = null;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    fixture?.unsubscribeDirty();
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([1, 2, 4] as const)(
    "keeps %i shared panes on one bounded batch with no edit-phase full-text publication",
    async (paneCount) => {
      fixture = createEditorIncrementalProductionChainHarness(paneCount);
      await renderAndSettle(root, fixture);

      expect(fixture.gateway.openRequests).toHaveLength(1);
      const readsBeforeEdits = fixture.model.getValue.mock.calls.length;
      fixture.model.getValue.mockClear();
      fixture.model.getValueLength.mockClear();
      fixture.dirtyNotifications.mockClear();
      fixture.legacyDidChange.mockClear();
      fixture.legacyFullPublication.mockClear();

      await act(async () => {
        for (let index = 0; index < 100; index += 1) {
          fixture?.editors[0]?.emitInsertion(String(index % 10));
        }
      });

      expect(fixture.model.getValue).not.toHaveBeenCalled();
      expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
      expect(fixture.legacyDidChange).not.toHaveBeenCalled();
      expect(fixture.dirtyNotifications).toHaveBeenCalledOnce();
      expect(
        fixture.editors.reduce(
          (total, editor) => total + vi.mocked(editor.onDidChangeModelContent).mock.calls.length,
          0,
        ),
      ).toBe(1);
      expect(fixture.gateway.changeRequests).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(24);
      expect(fixture.gateway.changeRequests).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      await settlePromises();

      expect(fixture.gateway.changeRequests).toHaveLength(1);
      const envelope = fixture.gateway.changeRequests[0]?.change;
      expect(envelope?.kind).toBe("incremental");
      if (envelope?.kind !== "incremental") throw new Error("Expected incremental batch");
      expect(envelope.changes).toHaveLength(100);
      expect(envelope.changes.map(({ text }) => text)).toEqual(
        Array.from({ length: 100 }, (_, index) => String(index % 10)),
      );
      expect(fixture.gateway.openRequests).toHaveLength(1);
      expect(fixture.model.getValue).not.toHaveBeenCalled();
      expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
      expect(fixture.legacyDidChange).not.toHaveBeenCalled();
      expect(readsBeforeEdits).toBeGreaterThan(0);
    },
  );

  it("keeps exact document checkpoints authoritative when incremental binding is rejected", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1, {
      admitIncremental: false,
    });
    await renderAndSettle(root, fixture);
    fixture.model.getValue.mockClear();
    fixture.legacyFullPublication.mockClear();
    fixture.legacyDidChange.mockClear();

    await act(async () => {
      for (let index = 0; index < 10; index += 1) {
        fixture?.editors[0]?.emitInsertion("x");
      }
    });

    expect(fixture.model.getValue).not.toHaveBeenCalled();
    expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
    expect(fixture.legacyDidChange).not.toHaveBeenCalled();
    expect(fixture.gateway.changeRequests).toHaveLength(0);
  });

  it("cleans accepted claims across 300 revisions in two bounded batches without fallback reads", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1);
    await renderAndSettle(root, fixture);
    fixture.model.getValue.mockClear();
    fixture.legacyFullPublication.mockClear();

    for (let wave = 0; wave < 2; wave += 1) {
      await act(async () => {
        for (let index = 0; index < 150; index += 1) {
          fixture?.editors[0]?.emitInsertion(String((wave * 150 + index) % 10));
        }
      });
      await vi.advanceTimersByTimeAsync(25);
      await settlePromises();
    }

    expect(fixture.model.getValue).not.toHaveBeenCalled();
    expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
    expect(fixture.gateway.changeRequests).toHaveLength(2);
    const envelopes = fixture.gateway.changeRequests.map(({ change }) => change);
    expect(envelopes.every(({ kind }) => kind === "incremental")).toBe(true);
    expect(
      envelopes.reduce(
        (total, envelope) =>
          total + (envelope.kind === "incremental" ? envelope.changes.length : 0),
        0,
      ),
    ).toBe(300);
  });

  it("publishes one current full snapshot when the first incremental edit falls back asynchronously", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1, {
      changeReceipt: { kind: "staleAuthority" },
    });
    await renderAndSettle(root, fixture);
    fixture.model.getValue.mockClear();
    fixture.legacyFullPublication.mockClear();
    fixture.legacyDidChange.mockClear();

    await act(async () => fixture?.editors[0]?.emitInsertion("x"));
    expect(fixture.model.getValue).not.toHaveBeenCalled();
    expect(fixture.legacyFullPublication).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(25);
    await settlePromises();

    expect(fixture.gateway.changeRequests).toHaveLength(1);
    expect(fixture.model.getValue).toHaveBeenCalledOnce();
    expect(fixture.legacyFullPublication).toHaveBeenCalledOnce();
    expect(fixture.legacyFullPublication).toHaveBeenCalledWith(
      `${fixture.initialContent}x`,
      fixture.path,
    );
    expect(fixture.legacyDidChange).toHaveBeenCalledOnce();
  });

  it("applies one same-path reload and acknowledges only the exact current model", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1);
    await renderAndSettle(root, fixture);
    fixture.model.getValue.mockClear();
    fixture.model.setValue.mockClear();
    const reloadedDocument = {
      content: "",
      language: "typescript",
      name: "large.ts",
      path: fixture.path,
      savedContent: fixture.initialContent,
    };

    await act(async () => {
      root.render(fixture!.renderWithDocumentContent(reloadedDocument.content));
      await settlePromises();
    });

    expect(
      fixture.runtimeContext.current?.ownsExactLiveModelContent?.(
        "pane-1",
        fixture.path,
        fixture.model,
      ),
    ).toBe(false);
    expect(
      editorSurfaceControlledValue(
        fixture.runtimeContext.current,
        "pane-1",
        fixture.editors[0]!,
        reloadedDocument,
        true,
        false,
      ),
    ).toBe("");
    await act(async () => {
      reconcileActiveDocumentModelContent(
        fixture!.runtimeContext.current,
        "pane-1",
        fixture!.editors[0]!,
        "/workspace",
        reloadedDocument,
      );
    });

    expect(fixture.model.getValue).toHaveBeenCalledOnce();
    expect(fixture.model.setValue).toHaveBeenCalledOnce();
    expect(fixture.model.setValue).toHaveBeenCalledWith("");
    expect(
      fixture.runtimeContext.current?.acknowledgeExactLiveModelContent?.(
        "pane-1",
        fixture.path,
        fixture.model,
      ),
    ).toBe(true);
    expect(
      editorSurfaceControlledValue(
        fixture.runtimeContext.current,
        "pane-1",
        fixture.editors[0]!,
        reloadedDocument,
        true,
        false,
      ),
    ).toBeUndefined();
    const staleModel = { ...fixture.model } as typeof fixture.model;
    expect(
      fixture.runtimeContext.current?.acknowledgeExactLiveModelContent?.(
        "pane-1",
        fixture.path,
        staleModel,
      ),
    ).toBe(false);
  });
});

async function renderAndSettle(
  root: Root,
  fixture: EditorIncrementalProductionChainHarness,
): Promise<void> {
  await act(async () => {
    root.render(fixture.view);
    await settlePromises();
  });
  if (fixture.expectsExactOwnership) {
    await waitForExactOwnership(fixture);
  }
}

async function settlePromises(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

async function waitForExactOwnership(
  fixture: EditorIncrementalProductionChainHarness,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const context = fixture.runtimeContext.current;
    context?.acknowledgeExactLiveModelContent?.("pane-1", fixture.path, fixture.model);
    if (context?.ownsExactLiveModelContent?.("pane-1", fixture.path, fixture.model) === true) {
      return;
    }
    await act(async () => Promise.resolve());
  }
  throw new Error("Expected exact production-chain live ownership to settle");
}
