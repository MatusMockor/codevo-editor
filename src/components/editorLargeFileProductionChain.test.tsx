// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEditorIncrementalProductionChainHarness,
  type EditorIncrementalProductionChainHarness,
} from "../test/editorIncrementalProductionChainHarness";

const providerMocks = vi.hoisted(() => ({
  configure: vi.fn(),
  register: vi.fn(() => ({ dispose: vi.fn() })),
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

const MIB = 1024 * 1024;
const LSP_INITIAL_TEXT_LIMIT = 2 * MIB;
const OVERSIZED_BOUNDARIES = [
  ["2 MiB + 1", LSP_INITIAL_TEXT_LIMIT + 1],
  ["3 MiB", 3 * MIB],
  ["5 MiB", 5 * MIB],
] as const;
const EXACT_LARGE_SAVE_BOUNDARIES = [...OVERSIZED_BOUNDARIES, ["10 MiB", 10 * MIB]] as const;

describe("editor large-file production chain", () => {
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
    fixture = null;
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(OVERSIZED_BOUNDARIES)(
    "keeps a %s LSP-ineligible model on metadata and bounded delta work",
    async (_label, initialUtf16Length) => {
      fixture = createEditorIncrementalProductionChainHarness(1, {
        initialUtf16Length,
      });
      await renderAndSettle(root, fixture);

      expect(fixture.gateway.openRequests).toHaveLength(0);
      expect(fixture.logicalCounters()).toMatchObject({
        fullTextReadCount: 1,
        fullTextReadUtf16Units: initialUtf16Length,
        openTextUtf16Units: 0,
      });

      fixture.model.getValue.mockClear();
      fixture.dirtyNotifications.mockClear();
      fixture.diskWrite.mockClear();
      fixture.legacyDidChange.mockClear();
      fixture.legacyFullPublication.mockClear();
      await emitEdits(fixture, 100);
      await vi.advanceTimersByTimeAsync(25);
      await settlePromises();

      expect(fixture.model.getValue).not.toHaveBeenCalled();
      expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
      expect(fixture.legacyDidChange).not.toHaveBeenCalled();
      expect(fixture.dirtyNotifications).toHaveBeenCalledOnce();
      expect(fixture.gateway.openRequests).toHaveLength(0);
      expect(fixture.gateway.changeRequests).toHaveLength(0);
      expect(fixture.logicalCounters()).toMatchObject({
        fullTextReadCount: 1,
        incrementalChangeCount: 0,
        legacyPublicationCount: 0,
        openTextUtf16Units: 0,
      });
      expect(fixture.activeSaveBinding()).not.toBeNull();
    },
  );

  it("keeps 100 same-length edits at exactly 10 MiB on metadata-only work", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1, {
      initialUtf16Length: 10 * MIB,
    });
    await renderAndSettle(root, fixture);

    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.logicalCounters()).toMatchObject({
      fullTextReadCount: 1,
      fullTextReadUtf16Units: 10 * MIB,
      openTextUtf16Units: 0,
    });

    fixture.model.getValue.mockClear();
    fixture.dirtyNotifications.mockClear();
    fixture.diskWrite.mockClear();
    fixture.legacyDidChange.mockClear();
    fixture.legacyFullPublication.mockClear();
    await act(async () => {
      for (let index = 0; index < 100; index += 1) {
        fixture?.editors[0]?.emitReplacement(String(index % 10));
      }
    });
    await vi.advanceTimersByTimeAsync(25);
    await settlePromises();

    expect(fixture.model.currentContent()).toHaveLength(10 * MIB);
    expect(fixture.model.getValue).not.toHaveBeenCalled();
    expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
    expect(fixture.legacyDidChange).not.toHaveBeenCalled();
    expect(fixture.dirtyNotifications).toHaveBeenCalledOnce();
    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.gateway.changeRequests).toHaveLength(0);
    expect(fixture.logicalCounters()).toMatchObject({
      fullTextReadCount: 1,
      incrementalChangeCount: 0,
      legacyPublicationCount: 0,
      openTextUtf16Units: 0,
    });
  });

  it.each(EXACT_LARGE_SAVE_BOUNDARIES)(
    "saves the exact current %s model with one save-phase full read and no LSP payload",
    async (label, initialUtf16Length) => {
      fixture = createEditorIncrementalProductionChainHarness(1, {
        initialUtf16Length,
      });
      await renderAndSettle(root, fixture);
      const marker = `/* exact-save:${label} */`;

      fixture.model.getValue.mockClear();
      fixture.diskWrite.mockClear();
      await act(async () => {
        fixture?.editors[0]?.emitReplacement(marker, marker.length);
      });
      await settlePromises();

      const exactCurrentContent = fixture.model.currentContent();
      expect(exactCurrentContent).toHaveLength(initialUtf16Length);
      expect(exactCurrentContent.endsWith(marker)).toBe(true);
      expect(fixture.isDirty()).toBe(true);
      expect(fixture.model.getValue).not.toHaveBeenCalled();
      expect(fixture.gateway.openRequests).toHaveLength(0);
      expect(fixture.gateway.changeRequests).toHaveLength(0);

      const saved = await fixture.attemptSave();

      expect(saved).toEqual({
        status: "admitted",
        writtenContent: exactCurrentContent,
      });
      expect(fixture.diskWrite).toHaveBeenCalledOnce();
      expect(fixture.diskWrite).toHaveBeenCalledWith(exactCurrentContent);
      expect(fixture.ownerRelativeWorkspaceWrite).toHaveBeenCalledOnce();
      expect(fixture.ownerRelativeWorkspaceWrite).toHaveBeenCalledWith(
        fixture.registeredIdentity.workspaceId,
        fixture.registeredIdentity.workspaceRelativePath,
        exactCurrentContent,
        fixture.initialRevision,
      );
      expect(fixture.rawWorkspaceWrite).not.toHaveBeenCalled();
      expect(fixture.model.getValue).toHaveBeenCalledOnce();
      expect(fixture.logicalCounters()).toMatchObject({
        diskWriteCount: 1,
        diskWriteUtf16Units: initialUtf16Length,
        fullTextReadCount: 2,
        fullTextReadUtf16Units: initialUtf16Length * 2,
        openTextUtf16Units: 0,
      });
      expect(fixture.isDirty()).toBe(false);
      expect(fixture.saveLifecycleEvents().map(({ kind }) => kind)).toEqual([
        "write",
        "acknowledge",
        "history",
        "sync-saved-document",
        "sync-saved-javascript-typescript",
      ]);
      expect(fixture.saveLifecycleEvents()).toEqual([
        { content: exactCurrentContent, kind: "write" },
        {
          expectedContent: exactCurrentContent,
          kind: "acknowledge",
          liveContentBeforeAcknowledgement: fixture.initialContent,
          revision: fixture.savedRevision,
          savedContent: exactCurrentContent,
          startingContent: exactCurrentContent,
        },
        { content: exactCurrentContent, kind: "history" },
        { content: exactCurrentContent, kind: "sync-saved-document" },
        {
          content: exactCurrentContent,
          kind: "sync-saved-javascript-typescript",
        },
      ]);
      expect(fixture.javaScriptTypeScriptDidSave).not.toHaveBeenCalled();
    },
  );

  it("keeps an edit arriving during a deferred 5 MiB write dirty", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1, {
      initialUtf16Length: 5 * MIB,
    });
    await renderAndSettle(root, fixture);
    const writtenMarker = "/* deferred-write */";
    const newerMarker = "/* newer-edit */";
    const initialContent = fixture.model.currentContent();
    const writtenContent = `${initialContent.slice(0, -writtenMarker.length)}${writtenMarker}`;
    fixture.model.getValue.mockClear();
    fixture.diskWrite.mockClear();
    expect(fixture.isDirty()).toBe(false);

    await act(async () => {
      fixture?.editors[0]?.emitReplacement(writtenMarker, writtenMarker.length);
    });
    await settlePromises();
    expect(fixture.model.currentContent()).toBe(writtenContent);
    expect(fixture.model.currentContent()).toHaveLength(5 * MIB);
    expect(fixture.isDirty()).toBe(true);
    expect(fixture.model.getValue).not.toHaveBeenCalled();

    const prepared = fixture.beginDeferredSave();
    expect(prepared.status).toBe("prepared");
    if (prepared.status !== "prepared") return;
    expect(await prepared.writeIssued).toBe(writtenContent);
    expect(prepared.writtenContent).toBe(writtenContent);
    expect(fixture.diskWrite).toHaveBeenCalledWith(writtenContent);
    expect(fixture.isDirty()).toBe(true);
    expect(fixture.model.getValue).toHaveBeenCalledOnce();

    await act(async () => {
      fixture?.editors[0]?.emitReplacement(newerMarker, newerMarker.length);
    });
    await settlePromises();
    const newerContent = `${writtenContent.slice(0, -newerMarker.length)}${newerMarker}`;
    expect(fixture.model.currentContent()).toBe(newerContent);
    expect(fixture.model.currentContent()).toHaveLength(5 * MIB);
    expect(fixture.isDirty()).toBe(true);

    expect(await prepared.complete()).toEqual({
      status: "admitted",
      writtenContent,
    });
    expect(fixture.diskWrite).toHaveBeenCalledOnce();
    expect(fixture.diskWrite).toHaveBeenCalledWith(writtenContent);
    expect(fixture.ownerRelativeWorkspaceWrite).toHaveBeenCalledWith(
      fixture.registeredIdentity.workspaceId,
      fixture.registeredIdentity.workspaceRelativePath,
      writtenContent,
      fixture.initialRevision,
    );
    expect(fixture.rawWorkspaceWrite).not.toHaveBeenCalled();
    expect(fixture.model.currentContent()).toBe(newerContent);
    expect(fixture.model.getValue).toHaveBeenCalledOnce();
    expect(fixture.isDirty()).toBe(true);
    expect(fixture.saveLifecycleEvents()).toEqual([
      { content: writtenContent, kind: "write" },
      {
        expectedContent: writtenContent,
        kind: "acknowledge",
        liveContentBeforeAcknowledgement: initialContent,
        revision: fixture.savedRevision,
        savedContent: writtenContent,
        startingContent: writtenContent,
      },
      { content: writtenContent, kind: "history" },
      { content: writtenContent, kind: "sync-saved-document" },
      {
        content: writtenContent,
        kind: "sync-saved-javascript-typescript",
      },
    ]);
    expect(fixture.javaScriptTypeScriptDidSave).not.toHaveBeenCalled();
  });

  it.each([1, 2, 4] as const)(
    "shares one 5 MiB degraded model across %i panes without multiplying reads",
    async (paneCount) => {
      fixture = createEditorIncrementalProductionChainHarness(paneCount, {
        initialUtf16Length: 5 * MIB,
      });
      await renderAndSettle(root, fixture);

      expect(fixture.logicalCounters()).toMatchObject({
        fullTextReadCount: 1,
        fullTextReadUtf16Units: 5 * MIB,
        openTextUtf16Units: 0,
      });
      expect(fixture.gateway.openRequests).toHaveLength(0);

      fixture.model.getValue.mockClear();
      fixture.legacyFullPublication.mockClear();
      await emitEdits(fixture, 100);
      await vi.advanceTimersByTimeAsync(25);
      await settlePromises();

      expect(fixture.model.getValue).not.toHaveBeenCalled();
      expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
      expect(fixture.logicalCounters()).toMatchObject({
        fullTextReadCount: 1,
        legacyPublicationCount: 0,
      });
    },
  );

  it("keeps the 10 MiB + 1 boundary out of bounded didOpen", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1, {
      initialUtf16Length: 10 * MIB + 1,
    });
    await renderAndSettle(root, fixture);

    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.logicalCounters().openTextUtf16Units).toBe(0);

    fixture.model.getValue.mockClear();
    fixture.legacyFullPublication.mockClear();
    await emitEdits(fixture, 1);

    expect(fixture.model.getValue).toHaveBeenCalledOnce();
    expect(fixture.legacyFullPublication).toHaveBeenCalledOnce();
    expect(fixture.gateway.openRequests).toHaveLength(0);
    expect(fixture.gateway.changeRequests).toHaveLength(0);
    expect((await fixture.attemptSave()).status).toBe("rejected");
    expect(fixture.diskWrite).not.toHaveBeenCalled();
    expect(fixture.ownerRelativeWorkspaceWrite).not.toHaveBeenCalled();
    expect(fixture.rawWorkspaceWrite).not.toHaveBeenCalled();
  });

  it("admits the exact 2 MiB boundary and keeps 100 same-length edits incremental", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1, {
      initialUtf16Length: LSP_INITIAL_TEXT_LIMIT,
    });
    await renderAndSettle(root, fixture);

    expect(fixture.gateway.openRequests).toHaveLength(1);
    expect(fixture.gateway.openRequests[0]?.text).toHaveLength(LSP_INITIAL_TEXT_LIMIT);
    expect(fixture.logicalCounters().openTextUtf16Units).toBe(LSP_INITIAL_TEXT_LIMIT);
    fixture.model.getValue.mockClear();
    fixture.legacyFullPublication.mockClear();

    await emitSameLengthEdits(fixture, 100);
    expect(fixture.model.getValue).not.toHaveBeenCalled();
    expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(25);
    await settlePromises();

    expect(fixture.gateway.changeRequests).toHaveLength(1);
    expect(fixture.logicalCounters()).toMatchObject({
      incrementalChangeCount: 100,
      incrementalInsertedUtf16Units: 100,
      maxChangesPerRequest: 100,
      openTextUtf16Units: LSP_INITIAL_TEXT_LIMIT,
    });
  });

  it("writes exact live content after an admitted model crosses 2 MiB", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1, {
      initialUtf16Length: LSP_INITIAL_TEXT_LIMIT,
    });
    await renderAndSettle(root, fixture);
    expect(fixture.activeSaveBinding()).not.toBeNull();
    fixture.legacyFullPublication.mockClear();
    fixture.diskWrite.mockClear();

    await emitEdits(fixture, 1);
    await vi.advanceTimersByTimeAsync(25);
    await settlePromises();
    expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
    expect(fixture.gateway.changeRequests).toHaveLength(0);
    expect(fixture.gateway.closeRequests).toHaveLength(1);

    const exactCurrentContent = fixture.model.currentContent();
    const saved = await fixture.attemptSave();
    expect(saved).toEqual({
      status: "admitted",
      writtenContent: exactCurrentContent,
    });
    expect(fixture.diskWrite).toHaveBeenCalledWith(exactCurrentContent);
    expect(fixture.ownerRelativeWorkspaceWrite).toHaveBeenCalledWith(
      fixture.registeredIdentity.workspaceId,
      fixture.registeredIdentity.workspaceRelativePath,
      exactCurrentContent,
      fixture.initialRevision,
    );
    expect(fixture.rawWorkspaceWrite).not.toHaveBeenCalled();
    expect(exactCurrentContent.endsWith("0")).toBe(true);
    expect(fixture.logicalCounters()).toMatchObject({
      diskWriteCount: 1,
      diskWriteUtf16Units: LSP_INITIAL_TEXT_LIMIT + 1,
      legacyPublicationCount: 0,
    });
    expect(fixture.isDirty()).toBe(false);
  });

  it("reopens a shrunken fresh model, rejects the stale model and resumes same-length incremental edits", async () => {
    fixture = createEditorIncrementalProductionChainHarness(1, {
      initialUtf16Length: 3 * MIB,
    });
    await renderAndSettle(root, fixture);
    expect(fixture.gateway.openRequests).toHaveLength(0);
    const staleModel = fixture.model;

    const shrunkenContent = "b".repeat(LSP_INITIAL_TEXT_LIMIT);
    let freshModel = fixture.currentModel();
    await act(async () => {
      freshModel = fixture!.replaceModel(shrunkenContent);
      root.render(fixture!.renderWithDocumentContent(shrunkenContent));
      await settlePromises();
    });

    expect(
      fixture.runtimeContext.current?.acknowledgeExactLiveModelContent?.(
        "pane-1",
        fixture.path,
        staleModel,
      ),
    ).toBe(false);
    await waitForExactOwnership(fixture);
    expect(fixture.currentModel()).toBe(freshModel);
    expect(fixture.gateway.openRequests).toHaveLength(1);
    expect(fixture.gateway.openRequests[0]?.text).toHaveLength(LSP_INITIAL_TEXT_LIMIT);

    freshModel.getValue.mockClear();
    fixture.legacyFullPublication.mockClear();
    await emitSameLengthEdits(fixture, 1);
    await vi.advanceTimersByTimeAsync(25);
    await settlePromises();

    expect(freshModel.getValue).not.toHaveBeenCalled();
    expect(fixture.legacyFullPublication).not.toHaveBeenCalled();
    expect(fixture.gateway.changeRequests).toHaveLength(1);
    const change = fixture.gateway.changeRequests[0]?.change;
    expect(change?.kind).toBe("incremental");
    if (change?.kind !== "incremental") return;
    expect(change.changes).toHaveLength(1);
    expect(change.changes[0]?.text).toBe("0");
  });
});

async function emitEdits(
  fixture: EditorIncrementalProductionChainHarness,
  count: number,
): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      fixture.editors[0]?.emitInsertion(String(index % 10));
    }
  });
}

async function emitSameLengthEdits(
  fixture: EditorIncrementalProductionChainHarness,
  count: number,
): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      fixture.editors[0]?.emitReplacement(String(index % 10));
    }
  });
}

async function renderAndSettle(
  root: Root,
  fixture: EditorIncrementalProductionChainHarness,
): Promise<void> {
  await act(async () => {
    root.render(fixture.view);
    await settlePromises();
  });
  if (fixture.expectsExactOwnership) await waitForExactOwnership(fixture);
}

async function waitForExactOwnership(
  fixture: EditorIncrementalProductionChainHarness,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    fixture.acknowledgeCurrentModel();
    if (
      fixture.runtimeContext.current?.ownsExactLiveModelContent?.(
        "pane-1",
        fixture.path,
        fixture.currentModel(),
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
      fixture.currentModel(),
    ),
  ).toBe(true);
}

async function settlePromises(): Promise<void> {
  for (let index = 0; index < 12; index += 1) {
    await Promise.resolve();
  }
}
