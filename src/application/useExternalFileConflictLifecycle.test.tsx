// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { EditorDocument, WorkspaceFileGateway } from "../domain/workspace";
import { useExternalFileConflictLifecycle } from "./useExternalFileConflictLifecycle";

const ROOT = "/workspace";
const PATH = `${ROOT}/file.php`;

function editorDocument(content = "local", savedContent = "base"): EditorDocument {
  return { content, savedContent, language: "php", name: "file.php", path: PATH };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

async function createHarness(readTextFile = vi.fn(async () => "disk")) {
  const host = document.createElement("div");
  const root = createRoot(host);
  const initial = editorDocument();
  const refs = {
    activeDocumentRef: { current: initial as EditorDocument | null },
    currentWorkspaceRootRef: { current: ROOT },
    documentsRef: { current: { [PATH]: initial } as Record<string, EditorDocument> },
    openPathsRef: { current: [PATH] },
  };
  let lifecycle!: ReturnType<typeof useExternalFileConflictLifecycle>;

  function Probe() {
    lifecycle = useExternalFileConflictLifecycle({
      ...refs,
      activePath: PATH,
      setActivePath: vi.fn(),
      setDocuments: vi.fn(),
      setOpenPaths: vi.fn(),
      workspaceFiles: { readTextFile } as unknown as WorkspaceFileGateway,
      workspaceRoot: ROOT,
    });
    return null;
  }

  await act(async () => root.render(<Probe />));
  return { lifecycle: () => lifecycle, refs, root };
}

const modified = () => ({
  rootPath: ROOT,
  kind: "modified" as const,
  path: PATH,
  relativePath: "file.php",
});

describe("useExternalFileConflictLifecycle", () => {
  it("shows a save conflict with the actual disk revision and advances only on reload", async () => {
    const test = await createHarness();
    const diskRevision = revision(2);
    const loaded = { ...test.refs.documentsRef.current[PATH], revision: revision(1) };
    test.refs.documentsRef.current[PATH] = loaded;
    test.refs.activeDocumentRef.current = loaded;

    act(() => {
      test.lifecycle().detectSaveConflict(ROOT, loaded, {
        content: "disk after save race",
        revision: diskRevision,
      });
    });

    expect(test.lifecycle().activeState.conflict?.disk).toEqual({
      content: "disk after save race",
      path: PATH,
      revision: diskRevision,
    });
    expect(test.refs.documentsRef.current[PATH].revision).toEqual(revision(1));

    await act(async () => test.lifecycle().action("reload"));
    expect(test.refs.documentsRef.current[PATH].revision).toEqual(diskRevision);
    expect(test.refs.documentsRef.current[PATH].savedContent).toBe(
      "disk after save race",
    );
    act(() => test.root.unmount());
  });

  it("retains dirty local text and records modified, deleted, and renamed conflicts", async () => {
    const test = await createHarness();
    await act(async () => { await test.lifecycle().handleFileChange(modified()); });
    expect(test.refs.documentsRef.current[PATH].content).toBe("local");
    expect(test.lifecycle().activeState.conflict?.kind).toBe("modified");

    await act(async () => {
      await test.lifecycle().handleFileChange({ ...modified(), kind: "deleted" });
    });
    expect(test.lifecycle().activeState.conflict?.kind).toBe("deleted");

    await act(async () => {
      await test.lifecycle().handleFileChange({
        ...modified(), kind: "renamed", path: `${ROOT}/renamed.php`, previousPath: PATH,
      });
    });
    expect(test.lifecycle().activeState.conflict?.kind).toBe("renamed");
    expect(test.lifecycle().conflictCount).toBe(1);
    act(() => test.root.unmount());
  });

  it("passes clean modifications through to the existing refresh flow", async () => {
    const test = await createHarness();
    test.refs.documentsRef.current[PATH] = editorDocument("base", "base");
    expect(await test.lifecycle().handleFileChange(modified())).toBe(false);
    expect(test.lifecycle().activeState.conflict).toBeNull();
    act(() => test.root.unmount());
  });

  it("ignores stale out-of-order disk reads", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const read = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const test = await createHarness(read);
    const old = test.lifecycle().handleFileChange(modified());
    const fresh = test.lifecycle().handleFileChange(modified());
    await act(async () => { second.resolve("fresh disk"); await fresh; });
    await act(async () => { first.resolve("stale disk"); await old; });
    expect(test.lifecycle().activeState.conflict?.disk?.content).toBe("fresh disk");
    act(() => test.root.unmount());
  });

  it("does not publish a pending watcher read after the project switches", async () => {
    const read = deferred<string>();
    const test = await createHarness(vi.fn(() => read.promise));
    let pending!: ReturnType<ReturnType<typeof test.lifecycle>["handleFileChange"]>;
    await act(async () => {
      pending = test.lifecycle().handleFileChange(modified());
      await Promise.resolve();
    });
    expect(test.lifecycle().activeState.conflict?.kind).toBe("unreadable");

    test.refs.currentWorkspaceRootRef.current = "/other-workspace";
    await act(async () => {
      read.resolve("late disk");
      await pending;
    });

    expect(test.lifecycle().activeState.conflict?.kind).toBe("unreadable");
    expect(test.lifecycle().activeState.conflict?.disk).toBeNull();
    act(() => test.root.unmount());
  });

  it("reloads from captured disk content and never writes", async () => {
    const read = vi.fn(async () => "captured disk");
    const test = await createHarness(read);
    await act(async () => { await test.lifecycle().handleFileChange(modified()); });
    await act(async () => {
      await test.lifecycle().action("reload");
    });
    expect(test.refs.documentsRef.current[PATH].content).toBe("captured disk");
    expect(test.lifecycle().activeState.conflict).toBeNull();
    act(() => test.root.unmount());
  });

  it("keeps a retryable unreadable conflict and recovers on manual retry", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("unreadable"))
      .mockResolvedValueOnce("recovered disk");
    const test = await createHarness(read);
    let consumed: false | "resolved" | "unreadable" = false;
    await act(async () => {
      consumed = await test.lifecycle().handleFileChange(modified());
    });
    expect(consumed).toBe("unreadable");
    expect(test.lifecycle().activeState.conflict?.kind).toBe("unreadable");
    expect(test.lifecycle().hasConflict(ROOT, PATH)).toBe(true);
    await act(async () => {
      await test.lifecycle().action("retryRead");
    });
    expect(test.lifecycle().activeState.conflict?.kind).toBe("modified");
    expect(test.lifecycle().activeState.conflict?.disk?.content).toBe(
      "recovered disk",
    );
    act(() => test.root.unmount());
  });

  it("keeps the conflict unresolved when a manual retry is still unreadable", async () => {
    const read = vi.fn(async () => { throw new Error("still unreadable"); });
    const test = await createHarness(read);
    expect(await test.lifecycle().handleFileChange(modified())).toBe("unreadable");

    await act(async () => {
      await test.lifecycle().action("retryRead");
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(test.lifecycle().activeState.conflict?.kind).toBe("unreadable");
    expect(test.lifecycle().activeState.error).toContain("still unreadable");
    expect(test.lifecycle().hasConflict(ROOT, PATH)).toBe(true);
    act(() => test.root.unmount());
  });

  it("does not resolve a retry when its workspace changes during the read", async () => {
    const retryRead = deferred<string>();
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("unreadable"))
      .mockReturnValueOnce(retryRead.promise);
    const test = await createHarness(read);
    expect(await test.lifecycle().handleFileChange(modified())).toBe("unreadable");

    let retry!: Promise<void>;
    await act(async () => {
      retry = test.lifecycle().action("retryRead");
      await Promise.resolve();
    });
    test.refs.currentWorkspaceRootRef.current = "/other-workspace";
    await act(async () => {
      retryRead.resolve("disk from stale workspace");
      await retry;
    });

    expect(test.lifecycle().activeState.conflict?.kind).toBe("unreadable");
    expect(test.lifecycle().activeState.error).toContain("workspace changed");
    expect(test.lifecycle().hasConflict(ROOT, PATH)).toBe(true);
    expect(test.lifecycle().hasConflict("/other-workspace", PATH)).toBe(false);
    act(() => test.root.unmount());
  });

  it("clears state and invalidates a pending read when the document closes", async () => {
    const read = deferred<string>();
    const test = await createHarness(vi.fn(() => read.promise));
    const pending = test.lifecycle().handleFileChange(modified());
    expect(test.lifecycle().hasConflict(ROOT, PATH)).toBe(true);

    act(() => test.lifecycle().clearConflict(ROOT, PATH));
    expect(test.lifecycle().hasConflict(ROOT, PATH)).toBe(false);
    await act(async () => { read.resolve("late disk"); await pending; });
    expect(test.lifecycle().activeState.conflict).toBeNull();
    act(() => test.root.unmount());
  });

  it("clears every conflict and pending token for a disposed workspace root", async () => {
    const read = deferred<string>();
    const test = await createHarness(vi.fn(() => read.promise));
    const pending = test.lifecycle().handleFileChange(modified());
    expect(test.lifecycle().hasConflictsForRoot(ROOT)).toBe(true);

    act(() => test.lifecycle().clearRoot(ROOT));
    expect(test.lifecycle().hasConflictsForRoot(ROOT)).toBe(false);
    await act(async () => {
      read.resolve("late disk");
      await pending;
    });
    expect(test.lifecycle().activeState.conflict).toBeNull();
    act(() => test.root.unmount());
  });

  it("rejects Follow Rename when the target tab is dirty", async () => {
    const targetPath = `${ROOT}/renamed.php`;
    const test = await createHarness();
    await act(async () => {
      await test.lifecycle().handleFileChange({
        ...modified(), kind: "renamed", path: targetPath, previousPath: PATH,
      });
    });
    const target = { ...editorDocument("target local", "target base"), path: targetPath };
    test.refs.documentsRef.current[targetPath] = target;
    test.refs.openPathsRef.current.push(targetPath);

    await act(async () => {
      await test.lifecycle().action("followRename");
    });
    expect(test.refs.documentsRef.current[PATH]?.content).toBe("local");
    expect(test.refs.documentsRef.current[targetPath]).toBe(target);
    expect(test.lifecycle().activeState.error).toContain("rename target");
    act(() => test.root.unmount());
  });

  it("deduplicates a clean target when following a rename", async () => {
    const targetPath = `${ROOT}/renamed.php`;
    const test = await createHarness();
    await act(async () => {
      await test.lifecycle().handleFileChange({
        ...modified(), kind: "renamed", path: targetPath, previousPath: PATH,
      });
    });
    test.refs.documentsRef.current[targetPath] = {
      ...editorDocument("disk", "disk"), path: targetPath,
    };
    test.refs.openPathsRef.current.push(targetPath);

    await act(async () => {
      await test.lifecycle().action("followRename");
    });
    expect(test.refs.documentsRef.current[PATH]).toBeUndefined();
    expect(test.refs.documentsRef.current[targetPath].content).toBe("local");
    expect(test.refs.openPathsRef.current).toEqual([targetPath]);
    act(() => test.root.unmount());
  });
});

function revision(contentHash: number) {
  return {
    device: 1,
    inode: 2,
    size: 3,
    modifiedSeconds: 4,
    modifiedNanoseconds: 5,
    contentHash,
  };
}
