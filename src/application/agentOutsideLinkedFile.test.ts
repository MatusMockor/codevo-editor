import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileEntry } from "../domain/workspace";
import type { LinkedFileDirectoryReader } from "./agentLinkedFileProbe";
import {
  OUTSIDE_LINKED_FILE_READ_TIMEOUT_MS,
  openOutsideLinkedFile,
  type AgentLinkedFileWorkspace,
  type AgentOutsideLinkedFileOpening,
  type AgentOutsideTextFile,
  type AgentOutsideTextFilePort,
  type AgentOutsideTextFileRefusal,
  type ReadOnlySnapshotReader,
} from "./agentOutsideLinkedFile";

const PROJECT = "/Users/me/Developer/mono";
const OTHER_TAB = "/Users/me/Developer/billing";
const HANDOFF = "/Users/me/handoffs/oktober/02-cms-slideshow.md";

const WORKSPACE: AgentLinkedFileWorkspace = { root: PROJECT, tabs: [PROJECT, OTHER_TAB] };

function text(canonicalPath: string, content = "# Handoff\n"): AgentOutsideTextFile {
  return { kind: "file", canonicalPath, content };
}

function fileEntry(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}

function opening(result: AgentOutsideTextFile) {
  const state = { workspace: WORKSPACE, current: true, editorAccepts: true };
  const snapshots: Array<{ path: string; content: string | null }> = [];
  const readOutsideTextFile = vi.fn<AgentOutsideTextFilePort["readOutsideTextFile"]>(
    async () => result,
  );
  const open = vi.fn<AgentOutsideLinkedFileOpening["open"]>(async () => state.editorAccepts);
  const openSnapshot = vi.fn(async (path: string, read: ReadOnlySnapshotReader) => {
    const content = await read();
    snapshots.push({ path, content });
    return content !== null && state.current && state.editorAccepts;
  });
  const readDirectoryBounded = vi.fn<
    NonNullable<LinkedFileDirectoryReader["readDirectoryBounded"]>
  >(async () => ({ entries: [], truncated: false }));
  const ports: AgentOutsideLinkedFileOpening = {
    outsideFiles: { readOutsideTextFile },
    directories: { readDirectoryBounded },
    workspace: () => state.workspace,
    isCurrent: () => state.current,
    open,
    openSnapshot,
  };
  return { ports, state, snapshots, readOutsideTextFile, open, openSnapshot, readDirectoryBounded };
}

describe("openOutsideLinkedFile", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("hands the bounded text of an outside file to the editor as a read-only snapshot", async () => {
    const link = opening(text(HANDOFF));

    await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe("opened");

    expect(link.readOutsideTextFile).toHaveBeenCalledExactlyOnceWith(HANDOFF);
    expect(link.snapshots).toEqual([{ path: HANDOFF, content: "# Handoff\n" }]);
    expect(link.open).not.toHaveBeenCalled();
  });

  it("keeps the linked path as the tab when the file was reached through an alias", async () => {
    const link = opening(text("/private/tmp/handoff.md"));

    await expect(openOutsideLinkedFile("/tmp/handoff.md", link.ports)).resolves.toBe("opened");

    expect(link.snapshots).toEqual([{ path: "/tmp/handoff.md", content: "# Handoff\n" }]);
  });

  it("does not read at all when the editor already has the path open", async () => {
    const link = opening(text(HANDOFF));
    link.openSnapshot.mockImplementationOnce(async () => true);

    await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe("opened");

    expect(link.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it.each<[AgentOutsideTextFileRefusal, string]>([
    ["doesNotExist", "doesNotExist"],
    ["folder", "folder"],
    ["specialFile", "specialFile"],
    ["tooLarge", "tooLarge"],
    ["notText", "notText"],
    ["notLocal", "notLocal"],
    ["busy", "busy"],
    ["unreadable", "unreadable"],
    ["unavailable", "failed"],
  ])("reports a %s read as %s and gives the editor nothing", async (kind, outcome) => {
    const link = opening({ kind });

    await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe(outcome);

    expect(link.snapshots).toEqual([{ path: HANDOFF, content: null }]);
  });

  it("reads before judging an image name, so a missing image is missing and a folder is a folder", async () => {
    const missing = opening({ kind: "doesNotExist" });
    const folder = opening({ kind: "folder" });
    const image = opening({ kind: "notText" });

    await expect(openOutsideLinkedFile("/Users/me/gone.png", missing.ports)).resolves.toBe(
      "doesNotExist",
    );
    await expect(openOutsideLinkedFile("/Users/me/shots.png", folder.ports)).resolves.toBe(
      "folder",
    );
    await expect(openOutsideLinkedFile("/Users/me/shot.png", image.ports)).resolves.toBe("notText");
  });

  it("reports a failed open when the backend read rejects", async () => {
    const link = opening(text(HANDOFF));
    link.readOutsideTextFile.mockRejectedValueOnce(new Error("ipc"));

    await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe("failed");

    expect(link.snapshots).toEqual([{ path: HANDOFF, content: null }]);
  });

  it("gives up on a read that outlasts the timeout and clears its timer otherwise", async () => {
    vi.useFakeTimers();
    const stalled = opening(text(HANDOFF));
    stalled.readOutsideTextFile.mockImplementationOnce(() => new Promise(() => undefined));

    const pending = openOutsideLinkedFile(HANDOFF, stalled.ports);
    await vi.advanceTimersByTimeAsync(OUTSIDE_LINKED_FILE_READ_TIMEOUT_MS);

    await expect(pending).resolves.toBe("failed");
    expect(stalled.snapshots).toEqual([{ path: HANDOFF, content: null }]);

    const prompt = opening(text(HANDOFF));
    await expect(openOutsideLinkedFile(HANDOFF, prompt.ports)).resolves.toBe("opened");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a superseded open without a failure when the editor drops delivered text", async () => {
    const link = opening(text(HANDOFF));
    link.readOutsideTextFile.mockImplementationOnce(async () => {
      link.state.current = false;
      return text(HANDOFF);
    });

    await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe("superseded");

    expect(link.snapshots).toEqual([{ path: HANDOFF, content: null }]);
  });

  it("reports a superseded open when the editor itself drops text of a still-current request", async () => {
    const link = opening(text(HANDOFF));
    link.openSnapshot.mockImplementationOnce(async (_path, read) => {
      await read();
      return false;
    });

    await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe("superseded");
  });

  it.each<AgentOutsideTextFileRefusal>(["doesNotExist", "unreadable", "busy", "unavailable"])(
    "supersedes a %s refusal that arrives after the request went stale",
    async (kind) => {
      const link = opening({ kind });
      link.readOutsideTextFile.mockImplementationOnce(async () => {
        link.state.current = false;
        return { kind };
      });

      await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe("superseded");

      expect(link.snapshots).toEqual([{ path: HANDOFF, content: null }]);
    },
  );

  it("supersedes a timeout and a rejected read that settle after the request went stale", async () => {
    vi.useFakeTimers();
    const stalled = opening(text(HANDOFF));
    stalled.readOutsideTextFile.mockImplementationOnce(() => new Promise(() => undefined));

    const pending = openOutsideLinkedFile(HANDOFF, stalled.ports);
    stalled.state.current = false;
    await vi.advanceTimersByTimeAsync(OUTSIDE_LINKED_FILE_READ_TIMEOUT_MS);

    await expect(pending).resolves.toBe("superseded");

    const rejected = opening(text(HANDOFF));
    rejected.readOutsideTextFile.mockImplementationOnce(async () => {
      rejected.state.current = false;
      return Promise.reject(new Error("ipc"));
    });
    await expect(openOutsideLinkedFile(HANDOFF, rejected.ports)).resolves.toBe("superseded");
  });

  it("supersedes a folder classification that finishes after the request went stale", async () => {
    const sibling = `${PROJECT}/packages/web/Gone.tsx`;
    const link = opening(text(sibling));
    link.state.editorAccepts = false;
    link.readDirectoryBounded.mockImplementationOnce(async () => {
      link.state.current = false;
      return { entries: [], truncated: false };
    });

    await expect(openOutsideLinkedFile(sibling, link.ports)).resolves.toBe("superseded");
  });

  it("refuses a file whose project tab opened during the read, even with an unchanged path", async () => {
    const path = `${OTHER_TAB}/docs/handoff.md`;
    const link = opening(text(path));
    link.state.workspace = { root: PROJECT, tabs: [PROJECT] };
    link.readOutsideTextFile.mockImplementationOnce(async () => {
      link.state.workspace = WORKSPACE;
      return text(path);
    });

    await expect(openOutsideLinkedFile(path, link.ports)).resolves.toBe("otherProject");

    expect(link.snapshots).toEqual([{ path, content: null }]);
  });

  it("refuses an alias whose own folder became a project tab during the read", async () => {
    const alias = `${OTHER_TAB}/handoff-link.md`;
    const link = opening(text(HANDOFF));
    link.state.workspace = { root: PROJECT, tabs: [PROJECT] };
    link.readOutsideTextFile.mockImplementationOnce(async () => {
      link.state.workspace = WORKSPACE;
      return text(HANDOFF);
    });

    await expect(openOutsideLinkedFile(alias, link.ports)).resolves.toBe("otherProject");

    expect(link.snapshots).toEqual([{ path: alias, content: null }]);
  });

  it("reports a superseded open when the editor declined before reading a stale request", async () => {
    const link = opening(text(HANDOFF));
    link.openSnapshot.mockImplementationOnce(async () => {
      link.state.current = false;
      return false;
    });

    await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe("superseded");

    expect(link.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it("reports a failed open when the editor declined a current request before reading", async () => {
    const link = opening(text(HANDOFF));
    link.openSnapshot.mockImplementationOnce(async () => false);

    await expect(openOutsideLinkedFile(HANDOFF, link.ports)).resolves.toBe("failed");
  });

  it("refuses a file of another open project tab without touching the disk", async () => {
    const link = opening(text(`${OTHER_TAB}/src/invoice.ts`));

    await expect(openOutsideLinkedFile(`${OTHER_TAB}/src/invoice.ts`, link.ports)).resolves.toBe(
      "otherProject",
    );

    expect(link.readOutsideTextFile).not.toHaveBeenCalled();
    expect(link.openSnapshot).not.toHaveBeenCalled();
    expect(link.open).not.toHaveBeenCalled();
  });

  it("refuses an alias into a project tab that opened while the file was read", async () => {
    const link = opening(text(`${OTHER_TAB}/src/invoice.ts`));
    link.state.workspace = { root: PROJECT, tabs: [PROJECT] };
    link.readOutsideTextFile.mockImplementationOnce(async () => {
      link.state.workspace = WORKSPACE;
      return text(`${OTHER_TAB}/src/invoice.ts`);
    });

    await expect(openOutsideLinkedFile("/Users/me/shortcut.ts", link.ports)).resolves.toBe(
      "otherProject",
    );

    expect(link.snapshots).toEqual([{ path: "/Users/me/shortcut.ts", content: null }]);
  });

  it("keeps a sibling folder that only shares a tab's name prefix openable", async () => {
    const sibling = `${OTHER_TAB}-docs/readme.md`;
    const link = opening(text(sibling));

    await expect(openOutsideLinkedFile(sibling, link.ports)).resolves.toBe("opened");
  });

  it("opens a workspace file outside the thread's checkout through the normal editable open", async () => {
    const sibling = `${PROJECT}/packages/web/App.tsx`;
    const link = opening(text(sibling));
    link.state.workspace = { root: PROJECT, tabs: [PROJECT, `${PROJECT}/packages`] };

    await expect(openOutsideLinkedFile(sibling, link.ports)).resolves.toBe("opened");

    expect(link.open).toHaveBeenCalledExactlyOnceWith(sibling);
    expect(link.openSnapshot).not.toHaveBeenCalled();
    expect(link.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it("says a missing workspace file outside the thread's checkout does not exist", async () => {
    const sibling = `${PROJECT}/packages/web/Gone.tsx`;
    const link = opening(text(sibling));
    link.state.editorAccepts = false;
    link.readDirectoryBounded.mockResolvedValueOnce({
      entries: [fileEntry(`${PROJECT}/packages/web/App.tsx`)],
      truncated: false,
    });

    await expect(openOutsideLinkedFile(sibling, link.ports)).resolves.toBe("doesNotExist");

    expect(link.readDirectoryBounded).toHaveBeenCalledWith(
      `${PROJECT}/packages/web`,
      expect.any(Number),
    );
  });

  it("opens an alias that resolves into the workspace as the real editable file", async () => {
    const real = `${PROJECT}/docs/handoff.md`;
    const link = opening(text(real));

    await expect(openOutsideLinkedFile("/Users/me/handoff-link.md", link.ports)).resolves.toBe(
      "opened",
    );

    expect(link.snapshots).toEqual([{ path: "/Users/me/handoff-link.md", content: null }]);
    expect(link.open).toHaveBeenCalledExactlyOnceWith(real);
  });

  it("drops an alias into the workspace when the request went stale during the read", async () => {
    const link = opening(text(`${PROJECT}/docs/handoff.md`));
    link.readOutsideTextFile.mockImplementationOnce(async () => {
      link.state.current = false;
      return text(`${PROJECT}/docs/handoff.md`);
    });

    await expect(openOutsideLinkedFile("/Users/me/handoff-link.md", link.ports)).resolves.toBe(
      "superseded",
    );

    expect(link.open).not.toHaveBeenCalled();
  });
});
