// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedFileDirectoryReader } from "../../application/agentLinkedFileProbe";
import type {
  AgentOutsideTextFile,
  AgentOutsideTextFilePort,
} from "../../application/agentOutsideLinkedFile";
import type { AgentFileViewerOwner } from "../../application/rightPanel/useAgentFileRevealRequests";
import { MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES } from "../../domain/agentMarkdown/agentLinkedFileBasenameMatch";
import type { AgentLocalFileOpenOutcome } from "../../domain/agentMarkdown/agentLocalFileLinkFailure";
import type { FileEntry, FileSearchResult } from "../../domain/workspace";
import { resolveInReactAct } from "../../test/reactTestLifecycle";
import {
  useAgentLinkedFileOpener,
  type AgentLinkedFileOpenerDependencies,
  type AgentLinkedFileOpenerWorkspace,
} from "./useAgentLinkedFileOpener";
import type { AgentFileLocationOpener } from "./useAgentLocalFileLinks";

const HOME = "/Users/me";
const ROOT = "/Users/me/Developer/ebox-crm";
const OTHER = "/Users/me/Developer/billing";
const HANDOFF = "/Users/me/handoffs/oktober/02-cms-slideshow.md";
const WORKSPACE: AgentLinkedFileOpenerWorkspace = {
  root: ROOT,
  tabs: [ROOT, OTHER],
  workspaceId: "ws-1",
  admissionToken: 1,
};
const WORKSPACE_B: AgentLinkedFileOpenerWorkspace = {
  root: OTHER,
  tabs: [ROOT, OTHER],
  workspaceId: "ws-2",
  admissionToken: 1,
};
const TEXT: AgentOutsideTextFile = { kind: "file", canonicalPath: HANDOFF, content: "# Handoff\n" };

type SearchFiles = (root: string, query: string, limit: number) => Promise<FileSearchResult[]>;

type OpenRequest = Parameters<AgentFileLocationOpener>[0];

interface HarnessOptions {
  readonly accepted?: boolean;
  readonly external?: boolean;
  readonly listings?: Readonly<Record<string, ReadonlyArray<FileEntry>>>;
  readonly searchFiles?: SearchFiles;
  readonly home?: string | null;
  readonly revealSettled?: Promise<boolean>;
}

function file(path: string): FileEntry {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, kind: "file" };
}

function found(path: string): FileSearchResult {
  return { name: path.slice(path.lastIndexOf("/") + 1), path, relativePath: path };
}

function location(path: string, line: number | null = null) {
  return { path, line, column: null };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("useAgentLinkedFileOpener", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  function harness(options: HarnessOptions = {}) {
    const reveals: Array<{ path: string; line: number | null }> = [];
    const externals: Array<{ path: string; contents: string; line: number | null }> = [];
    const viewer: { owner: AgentFileViewerOwner } = { owner: { threadId: "t-1", generation: 1 } };
    const revealFileInViewer = vi.fn(async (path: string, line: number | null) => {
      reveals.push({ path, line });
      if (options.revealSettled !== undefined) return options.revealSettled;
      return options.accepted ?? true;
    });
    const showExternalFileInViewer = vi.fn(
      async (path: string, contents: string, line: number | null) => {
        externals.push({ path, contents, line });
        return true;
      },
    );
    const readOutsideTextFile = vi.fn<AgentOutsideTextFilePort["readOutsideTextFile"]>(
      async () => TEXT,
    );
    const listings = options.listings ?? {};
    const readDirectoryBounded = vi.fn<
      NonNullable<LinkedFileDirectoryReader["readDirectoryBounded"]>
    >(async (path) => ({ entries: listings[path] ?? [], truncated: false }));
    const searchFiles = vi.fn<SearchFiles>(options.searchFiles ?? (async () => []));
    const homePath = options.home === undefined ? HOME : options.home;
    const dependencies: AgentLinkedFileOpenerDependencies = {
      files: { readDirectoryBounded },
      outsideFiles: { readOutsideTextFile },
      workspace: WORKSPACE,
      fileSearch: {
        searchFilesWithMetadata: async (root, query, limit, requestGeneration = "") => ({
          requestGeneration,
          results: await searchFiles(root, query, limit),
          truncated: false,
        }),
      },
      resolveHome: async () => ({ path: homePath, pathCase: "sensitive" }),
      revealFileInViewer,
      captureViewerOwner: () => viewer.owner,
      ...(options.external === false ? {} : { showExternalFileInViewer }),
    };
    const captured: { opener: AgentFileLocationOpener | null } = { opener: null };
    function Probe(props: { readonly workspace: AgentLinkedFileOpenerWorkspace }) {
      captured.opener = useAgentLinkedFileOpener({ ...dependencies, workspace: props.workspace });
      return null;
    }
    const render = (workspace: AgentLinkedFileOpenerWorkspace) =>
      act(() => root.render(<Probe workspace={workspace} />));
    render(WORKSPACE);
    const open = (request: OpenRequest): Promise<AgentLocalFileOpenOutcome> =>
      resolveInReactAct(() => captured.opener!(request));
    const start = (request: OpenRequest): Promise<AgentLocalFileOpenOutcome> =>
      captured.opener!(request);
    return {
      open,
      start,
      render,
      viewer,
      reveals,
      externals,
      readOutsideTextFile,
      readDirectoryBounded,
      searchFiles,
    };
  }

  it("reveals a listed file inside the thread root in the Files viewer at the linked line", async () => {
    const path = `${ROOT}/src/app.ts`;
    const view = harness({ listings: { [`${ROOT}/src`]: [file(path)] } });

    const outcome = await view.open({
      kind: "path",
      location: { path, line: 3, column: 7 },
      root: ROOT,
    });

    expect(outcome).toBe("opened");
    expect(view.reveals).toEqual([{ path, line: 3 }]);
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it("reports a missing project file as notFound without opening the Files viewer", async () => {
    const view = harness({ listings: { [ROOT]: [file(`${ROOT}/package.json`)] } });

    const outcome = await view.open({
      kind: "path",
      location: location(`${ROOT}/auth.json`),
      root: ROOT,
    });

    expect(outcome).toBe("notFound");
    expect(view.reveals).toEqual([]);
  });

  it("reveals a workspace file outside the thread root in the Files viewer", async () => {
    const path = `${ROOT}/packages/web/App.tsx`;
    const view = harness({ listings: { [`${ROOT}/packages/web`]: [file(path)] } });

    const outcome = await view.open({ kind: "path", location: location(path), root: null });

    expect(outcome).toBe("opened");
    expect(view.reveals).toEqual([{ path, line: null }]);
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it("refuses a file owned by another open project without revealing anything", async () => {
    const view = harness();

    const outcome = await view.open({
      kind: "path",
      location: location(`${OTHER}/src/billing.ts`),
      root: null,
    });

    expect(outcome).toBe("otherProject");
    expect(view.reveals).toEqual([]);
  });

  it("classifies a listed file the viewer did not accept", async () => {
    const path = `${ROOT}/src/locked.ts`;
    const view = harness({ accepted: false, listings: { [`${ROOT}/src`]: [file(path)] } });

    const outcome = await view.open({ kind: "path", location: location(path), root: ROOT });

    expect(view.reveals).toEqual([{ path, line: null }]);
    expect(outcome).toBe("unreadable");
  });

  it("shows a file outside every project as a read-only snapshot in the viewer", async () => {
    const view = harness();

    const outcome = await view.open({
      kind: "path",
      location: { path: HANDOFF, line: 12, column: 5 },
      root: null,
    });

    expect(outcome).toBe("opened");
    expect(view.readOutsideTextFile).toHaveBeenCalledWith(HANDOFF);
    expect(view.externals).toEqual([{ path: HANDOFF, contents: "# Handoff\n", line: 12 }]);
    expect(view.reveals).toEqual([]);
  });

  it("does not open a file outside every project without an external viewer", async () => {
    const view = harness({ external: false });

    const outcome = await view.open({
      kind: "path",
      location: { path: HANDOFF, line: 12, column: 5 },
      root: null,
    });

    expect(outcome).toBe("failed");
    expect(view.reveals).toEqual([]);
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it("opens a home link below the backend's home folder as a read-only snapshot", async () => {
    const view = harness();

    const outcome = await view.open({
      kind: "home",
      location: location(".coderabbit/auth.json", 2),
    });

    expect(outcome).toBe("opened");
    expect(view.readOutsideTextFile).toHaveBeenCalledExactlyOnceWith(
      `${HOME}/.coderabbit/auth.json`,
    );
    expect(view.externals).toEqual([
      { path: `${HOME}/.coderabbit/auth.json`, contents: "# Handoff\n", line: 2 },
    ]);
  });

  it("fails a home link when the home folder is unknown", async () => {
    const view = harness({ home: null });

    await expect(
      view.open({ kind: "home", location: location(".coderabbit/auth.json") }),
    ).resolves.toBe("failed");
    expect(view.readOutsideTextFile).not.toHaveBeenCalled();
  });

  it("opens a bare file name through the project's file search", async () => {
    const match = `${ROOT}/src/components/ChatView.tsx`;
    const view = harness({
      listings: { [`${ROOT}/src/components`]: [file(match)] },
      searchFiles: async () => [found(match)],
    });

    const outcome = await view.open({
      kind: "name",
      location: location(`${ROOT}/ChatView.tsx`, 12),
      root: ROOT,
    });

    expect(outcome).toBe("opened");
    expect(view.searchFiles).toHaveBeenCalledWith(
      ROOT,
      "ChatView.tsx",
      MAX_AGENT_LINKED_FILE_BASENAME_CANDIDATES,
    );
    expect(view.reveals).toEqual([{ path: match, line: 12 }]);
  });

  it("reports a bare name the search cannot find as notFound", async () => {
    const view = harness();

    await expect(
      view.open({ kind: "name", location: location(`${ROOT}/auth.json`), root: ROOT }),
    ).resolves.toBe("notFound");
    expect(view.reveals).toEqual([]);
  });

  it("lets the latest click win over a lookup that is still searching", async () => {
    const search = deferred<FileSearchResult[]>();
    const later = `${ROOT}/src/later.ts`;
    const view = harness({
      listings: {
        [`${ROOT}/src`]: [file(later)],
        [`${ROOT}/src/components`]: [file(`${ROOT}/src/components/ChatView.tsx`)],
      },
      searchFiles: () => search.promise,
    });

    const first = view.start({
      kind: "name",
      location: location(`${ROOT}/ChatView.tsx`),
      root: ROOT,
    });
    await vi.waitFor(() => expect(view.searchFiles).toHaveBeenCalledOnce());
    const second = await view.open({ kind: "path", location: location(later), root: ROOT });
    search.resolve([found(`${ROOT}/src/components/ChatView.tsx`)]);

    await expect(first).resolves.toBe("superseded");
    expect(second).toBe("opened");
    expect(view.reveals).toEqual([{ path: later, line: null }]);
  });

  it("drops a lookup when the workspace went A to B and back to A", async () => {
    const search = deferred<FileSearchResult[]>();
    const match = `${ROOT}/src/components/ChatView.tsx`;
    const view = harness({
      listings: { [`${ROOT}/src/components`]: [file(match)] },
      searchFiles: () => search.promise,
    });

    const pending = view.start({
      kind: "name",
      location: location(`${ROOT}/ChatView.tsx`),
      root: ROOT,
    });
    await vi.waitFor(() => expect(view.searchFiles).toHaveBeenCalledOnce());
    view.render(WORKSPACE_B);
    view.render(WORKSPACE);
    search.resolve([found(match)]);

    await expect(pending).resolves.toBe("superseded");
    expect(view.reveals).toEqual([]);
  });

  it("drops a lookup when the viewer moved to another thread", async () => {
    const search = deferred<FileSearchResult[]>();
    const match = `${ROOT}/src/components/ChatView.tsx`;
    const view = harness({
      listings: { [`${ROOT}/src/components`]: [file(match)] },
      searchFiles: () => search.promise,
    });

    const pending = view.start({
      kind: "name",
      location: location(`${ROOT}/ChatView.tsx`),
      root: ROOT,
    });
    await vi.waitFor(() => expect(view.searchFiles).toHaveBeenCalledOnce());
    view.viewer.owner = { threadId: "t-2", generation: 2 };
    search.resolve([found(match)]);

    await expect(pending).resolves.toBe("superseded");
    expect(view.reveals).toEqual([]);
  });

  it("supersedes a reveal the viewer settles only after the thread changed", async () => {
    const settled = deferred<boolean>();
    const path = `${ROOT}/src/app.ts`;
    const view = harness({
      listings: { [`${ROOT}/src`]: [file(path)] },
      revealSettled: settled.promise,
    });

    const pending = view.start({ kind: "path", location: location(path), root: ROOT });
    await vi.waitFor(() => expect(view.reveals).toEqual([{ path, line: null }]));
    view.viewer.owner = { threadId: "t-2", generation: 2 };
    settled.resolve(true);

    await expect(pending).resolves.toBe("superseded");
  });
});
