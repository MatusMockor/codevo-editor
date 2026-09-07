import { describe, expect, it, vi } from "vitest";
import {
  rescanOpenWorkspaceDocuments,
  MAX_RESCANNED_OPEN_DOCUMENTS,
} from "./rescanOpenWorkspaceDocuments";
import type { EditorDocument, FileEntry } from "../domain/workspace";

const doc = (path: string): EditorDocument => ({
  path,
  name: "a",
  content: "unsaved",
  savedContent: "old",
  language: "typescript",
});
const entry = (path: string): FileEntry => ({ path, name: "a", kind: "file" });
const event = {
  rootPath: "/workspace",
  path: "/workspace/repo",
  relativePath: "repo",
  kind: "rescanRequired" as const,
};

function harness(
  paths = ["/workspace/repo/a.ts", "/workspace/repo/gone.ts", "/workspace/other/b.ts"],
) {
  return {
    event,
    documents: Object.fromEntries(paths.map((path) => [path, doc(path)])),
    files: { readDirectory: vi.fn(async (_path: string) => [entry(paths[0])]) },
    isCurrent: () => true,
    dispatch: vi.fn(async () => undefined),
    reportIncomplete: vi.fn(),
  };
}

describe("rescanOpenWorkspaceDocuments", () => {
  it("reuses the conflict pipeline for changed and removed files only inside the checkout", async () => {
    const test = harness();
    await rescanOpenWorkspaceDocuments(test);
    expect(test.files.readDirectory).toHaveBeenCalledOnce();
    expect(test.dispatch.mock.calls).toEqual([
      [
        {
          ...event,
          path: "/workspace/repo/a.ts",
          relativePath: "repo/a.ts",
          kind: "modified",
          fileKind: "file",
        },
      ],
      [
        {
          ...event,
          path: "/workspace/repo/gone.ts",
          relativePath: "repo/gone.ts",
          kind: "deleted",
          fileKind: "file",
        },
      ],
    ]);
  });
  it("detects removed parent directories without treating unreadable directories as deletion", async () => {
    const test = harness(["/workspace/repo/removed/a.ts"]);
    test.files.readDirectory.mockImplementation(async (path) => {
      if (path === "/workspace/repo/removed") throw new Error("missing");
      return [];
    });
    await rescanOpenWorkspaceDocuments(test);
    expect(test.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kind: "deleted" }));
    test.dispatch.mockClear();
    test.files.readDirectory.mockRejectedValue(new Error("unreadable"));
    await rescanOpenWorkspaceDocuments(test);
    expect(test.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kind: "modified" }));
    expect(test.reportIncomplete).toHaveBeenCalledOnce();
  });
  it("never infers removal from a truncated directory", async () => {
    const test = harness(["/workspace/repo/a.ts"]);
    await rescanOpenWorkspaceDocuments({
      ...test,
      files: {
        ...test.files,
        readDirectoryBounded: vi.fn(async () => ({ entries: [], truncated: true })),
      },
    });
    expect(test.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kind: "modified" }));
    expect(test.reportIncomplete).toHaveBeenCalledOnce();
  });
  it("rejects a superseded owner after awaiting a directory", async () => {
    const test = harness();
    let current = true;
    test.isCurrent = () => current;
    test.files.readDirectory.mockImplementation(async () => {
      current = false;
      return [];
    });
    await rescanOpenWorkspaceDocuments(test);
    expect(test.dispatch).not.toHaveBeenCalled();
  });
  it("bounds open-document work and reports incomplete refresh", async () => {
    const test = harness(
      Array.from({ length: MAX_RESCANNED_OPEN_DOCUMENTS + 1 }, (_, n) => `/workspace/repo/${n}.ts`),
    );
    await rescanOpenWorkspaceDocuments(test);
    expect(test.dispatch).toHaveBeenCalledTimes(MAX_RESCANNED_OPEN_DOCUMENTS);
    expect(test.reportIncomplete).toHaveBeenCalledOnce();
  });
  it("refreshes root-level documents and excludes malformed rescan paths", async () => {
    const test = harness(["/workspace/a.ts"]);
    await rescanOpenWorkspaceDocuments({
      ...test,
      event: { ...event, path: "/workspace", relativePath: "" },
    });
    expect(test.files.readDirectory).toHaveBeenCalledWith("/workspace");
    expect(test.dispatch).toHaveBeenCalledWith(expect.objectContaining({ kind: "modified" }));
    test.dispatch.mockClear();
    await rescanOpenWorkspaceDocuments({
      ...test,
      event: { ...event, path: "/workspace/../foreign" },
    });
    expect(test.dispatch).not.toHaveBeenCalled();
  });
});
