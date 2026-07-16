// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildGitHistoryDiffDocumentPath } from "../domain/editorDocumentSchemes";
import type { DiffPayload, GitHistoryGateway } from "../domain/git";
import type { EditorDocument } from "../domain/workspace";
import {
  useGitHistoryDiffDocuments,
  type GitHistoryDiffDocumentsController,
} from "./useGitHistoryDiffDocuments";

const ROOT = "/workspace";

describe("useGitHistoryDiffDocuments", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("retains independent reverse-order results for parallel history tabs", async () => {
    const first = deferred<DiffPayload>();
    const second = deferred<DiffPayload>();
    const harness = await renderHarness(root, {
      getCommitDiff: vi.fn(async (_root, commitHash) =>
        commitHash === "first" ? first.promise : second.promise),
    });

    let firstRequest!: Promise<void>;
    let secondRequest!: Promise<void>;
    await act(async () => {
      firstRequest = harness.api().openCommitDiff(
        "first",
        "src/First.php",
        null,
      );
      secondRequest = harness.api().openCommitDiff(
        "second",
        "src/Second.php",
        null,
      );
    });

    await act(async () => {
      second.resolve(payload("second", "src/Second.php", "second content"));
      await secondRequest;
      first.resolve(payload("first", "src/First.php", "first content"));
      await firstRequest;
    });

    expect(harness.api().documentsByPath[firstPath()]).toMatchObject({
      diff: { modifiedContent: "first content" },
      isLoading: false,
    });
    expect(harness.api().documentsByPath[secondPath()]).toMatchObject({
      diff: { modifiedContent: "second content" },
      isLoading: false,
    });
  });

  it("keeps last-request-wins semantics within one history document", async () => {
    const stale = deferred<DiffPayload>();
    const fresh = deferred<DiffPayload>();
    const getCommitDiff = vi.fn()
      .mockImplementationOnce(async () => stale.promise)
      .mockImplementationOnce(async () => fresh.promise);
    const harness = await renderHarness(root, { getCommitDiff });

    let staleRequest!: Promise<void>;
    let freshRequest!: Promise<void>;
    await act(async () => {
      staleRequest = harness.api().openCommitDiff(
        "first",
        "src/First.php",
        null,
      );
      freshRequest = harness.api().openCommitDiff(
        "first",
        "src/First.php",
        null,
      );
    });
    await act(async () => {
      fresh.resolve(payload("first", "src/First.php", "fresh"));
      await freshRequest;
      stale.resolve(payload("first", "src/First.php", "stale"));
      await staleRequest;
    });

    expect(harness.api().documentsByPath[firstPath()]?.diff?.modifiedContent)
      .toBe("fresh");
  });

  it("drops a late result after its editor document closes", async () => {
    const pending = deferred<DiffPayload>();
    const harness = await renderHarness(root, {
      getCommitDiff: vi.fn(async () => pending.promise),
    });
    let request!: Promise<void>;

    await act(async () => {
      request = harness.api().openCommitDiff("first", "src/First.php", null);
    });
    await act(async () => {
      harness.api().closeDocumentPaths([firstPath()]);
      pending.resolve(payload("first", "src/First.php", "late"));
      await request;
    });

    expect(harness.api().documentsByPath).toEqual({});
  });

  it("drops a late result after a workspace owner replacement at the same root", async () => {
    const pending = deferred<DiffPayload>();
    const harness = await renderHarness(root, {
      getCommitDiff: vi.fn(async () => pending.promise),
    });
    let request!: Promise<void>;

    await act(async () => {
      request = harness.api().openCommitDiff("first", "src/First.php", null);
    });
    await harness.render({ ownerId: "owner-b", workspaceRoot: ROOT });
    await act(async () => {
      pending.resolve(payload("first", "src/First.php", "late"));
      await request;
    });

    expect(harness.api().documentsByPath).toEqual({});
  });

  it("rejects a retained opener from a replaced workspace owner", async () => {
    const getCommitDiff = vi.fn(async () =>
      payload("first", "src/First.php", "stale"));
    const onOpenDocument = vi.fn();
    const harness = await renderHarness(root, {
      getCommitDiff,
      onOpenDocument,
    });
    const staleOpen = harness.api().openCommitDiff;

    await harness.render({ ownerId: "owner-b", workspaceRoot: ROOT });
    await act(async () => {
      await staleOpen("first", "src/First.php", null);
    });

    expect(getCommitDiff).not.toHaveBeenCalled();
    expect(onOpenDocument).not.toHaveBeenCalled();
    expect(harness.api().documentsByPath).toEqual({});
  });

  it("keeps a failed document owned and renderable instead of losing the tab state", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const harness = await renderHarness(root, {
      getCommitDiff: vi.fn(async () => {
        throw new Error("git history failed");
      }),
    });

    await act(async () => {
      await harness.api().openCommitDiff("first", "src/First.php", null);
    });

    expect(harness.api().documentsByPath[firstPath()]).toEqual({
      diff: null,
      isLoading: false,
    });
    expect(console.error).toHaveBeenCalledWith(
      "Failed to load commit file diff.",
      expect.any(Error),
    );
  });

  it("opens each commit as a read-only document with a stable identity", async () => {
    const onOpenDocument = vi.fn();
    const harness = await renderHarness(root, {
      getCommitDiff: vi.fn(async () => payload(
        "first",
        "src/Renamed.php",
        "content",
        "src/Original.php",
      )),
      onOpenDocument,
    });

    await act(async () => {
      await harness.api().openCommitDiff(
        "first",
        "src/Renamed.php",
        "src/Original.php",
      );
    });

    expect(onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({
      name: "Diff: Renamed.php",
      path: buildGitHistoryDiffDocumentPath(
        "first",
        "src/Renamed.php",
        "src/Original.php",
      ),
      readOnly: true,
    } satisfies Partial<EditorDocument>));
  });
});

interface HarnessOptions {
  getCommitDiff: GitHistoryGateway["getCommitDiff"];
  onOpenDocument?: (document: EditorDocument) => void;
  ownerId?: string;
  workspaceRoot?: string | null;
}

async function renderHarness(root: Root, initial: HarnessOptions) {
  let options = initial;
  let controller: GitHistoryDiffDocumentsController | null = null;

  function Harness() {
    controller = useGitHistoryDiffDocuments({
      gateway: { getCommitDiff: options.getCommitDiff },
      onOpenDocument: options.onOpenDocument ?? (() => undefined),
      ownerId: options.ownerId ?? "owner-a",
      workspaceRoot: options.workspaceRoot === undefined
        ? ROOT
        : options.workspaceRoot,
    });
    return null;
  }

  async function render(next?: Partial<HarnessOptions>) {
    options = { ...options, ...next };
    await act(async () => root.render(<Harness />));
  }

  await render();

  return {
    api: () => {
      if (!controller) {
        throw new Error("Harness did not render.");
      }

      return controller;
    },
    render,
  };
}

function payload(
  commitHash: string,
  path: string,
  modifiedContent: string,
  oldPath: string | null = null,
): DiffPayload {
  return {
    commitHash,
    isRename: oldPath !== null,
    language: "php",
    modifiedContent,
    originalContent: "original",
    oldPath,
    path,
    status: oldPath ? "R" : "M",
  };
}

function firstPath(): string {
  return buildGitHistoryDiffDocumentPath("first", "src/First.php", null);
}

function secondPath(): string {
  return buildGitHistoryDiffDocumentPath("second", "src/Second.php", null);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });

  return { promise, resolve };
}
