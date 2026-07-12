// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Commit,
  type CommitDetails,
  type CommitGraphNode,
  type FileChange,
  type GitBranches,
  type GitHistoryGateway,
  type GitRepoStatus,
} from "../domain/git";
import { GitHistoryPanel } from "./GitHistoryPanel";

type CommitHistoryGateway = GitHistoryGateway & {
  setCommitLog(next: Commit[]): void;
  setCommitFiles(next: FileChange[]): void;
  setCommitDetails(next: CommitDetails): void;
};

describe("GitHistoryPanel", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("loads branches and commits on mount and selects the first commit", async () => {
    const mainCommit = commitFixture("1111111111111111111111111111111111111111", "Initial");
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main", "feature"],
        remotes: { origin: ["main"] },
      },
      commitLog: [mainCommit],
      graphByCommit: {
        "1111111111111111111111111111111111111111": commitGraphNode(
          mainCommit,
          0,
          true,
        ),
      },
      commitDetails: commitDetailsFixture(mainCommit),
      commitFiles: [
        {
          isRename: false,
          newPath: null,
          oldPath: null,
          path: "src/index.ts",
          status: "A",
        },
      ],
    });

    await renderPanel(root, gateway);

    expect(gateway.getRepoStatus).toHaveBeenCalledTimes(1);
    expect(gateway.getBranches).toHaveBeenCalledTimes(1);
    expect(gateway.getCommitLog).toHaveBeenCalledWith(
      "/workspace",
      expect.objectContaining({
        author: undefined,
        branch: null,
        path: undefined,
        query: undefined,
      }),
    );

    expect(selectedCommitRow(host)?.textContent).toContain("Initial");
    expect(selectedCommitRow(host)?.textContent).toContain("Developer");
    expect(
      selectedCommitRow(host)?.querySelector(".git-history-commit-graph-svg"),
    ).not.toBeNull();
    expect(
      selectedCommitRow(host)?.querySelector(".git-history-commit-graph-line"),
    ).not.toBeNull();
  });

  it("reloads commits when branch filter changes and refreshes selection", async () => {
    const main = [
      commitFixture("1111111111111111111111111111111111111111", "main latest"),
      commitFixture("2222222222222222222222222222222222222222", "main previous"),
    ];
    const feature = [
      commitFixture("3333333333333333333333333333333333333333", "feature only"),
    ];
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main", "feature"],
        remotes: {},
      },
      commitLog: main,
      commitLogByBranch: {
        feature,
      },
      graphByBranch: {
        feature: [
          commitGraphNode(feature[0], 1, false),
        ],
      },
    });

    await renderPanel(root, gateway);

    expect(selectedCommitText(host)).toContain("main latest");

    act(() => {
      rowByText(host, ".git-history-branch-row", "feature").click();
    });

    const commitLogCalls = vi.mocked(gateway.getCommitLog).mock.calls;
    const lastCommitCall = commitLogCalls[commitLogCalls.length - 1];
    expect(lastCommitCall?.[1]?.branch).toBe("feature");
    expect(gateway.getCommitLog).toHaveBeenCalledTimes(2);

    await act(async () => {
      await flushAsync();
    });

    expect(selectedCommitText(host)).toContain("feature only");
    expect(host.querySelector(".git-history-commit-row[aria-selected='true']")?.textContent)
      .toContain("feature only");
  });

  it("calls the commit-file diff callback for clicked files", async () => {
    const commitHash = "1111111111111111111111111111111111111111";
    const commit = commitFixture(commitHash, "Initial");
    const onOpenCommitFileDiff = vi.fn();

    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog: [commit],
      commitDetails: commitDetailsFixture(commit),
      commitFiles: [
        {
          isRename: true,
          newPath: "src/App.tsx",
          oldPath: "src/App.old.tsx",
          path: "src/App.tsx",
          status: "R",
        },
      ],
      graphByCommit: {
        [commit.hash]: commitGraphNode(commit, 0, false),
      },
    });

    await renderPanel(root, gateway, onOpenCommitFileDiff);

    act(() => {
      host.querySelector<HTMLButtonElement>(
        ".git-history-file-row",
      )?.click();
    });

    expect(onOpenCommitFileDiff).toHaveBeenCalledWith(
      commitHash,
      "src/App.tsx",
      "src/App.old.tsx",
      [
        {
          isRename: true,
          newPath: "src/App.tsx",
          oldPath: "src/App.old.tsx",
          path: "src/App.tsx",
          status: "R",
        },
      ],
    );
  });

  it("loads details for a selected older commit without reloading the log", async () => {
    const latest = commitFixture("1111111111111111111111111111111111111111", "Latest");
    const older = commitFixture("2222222222222222222222222222222222222222", "Older");
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog: [latest, older],
      commitDetails: commitDetailsFixture(latest),
      commitDetailsByHash: {
        [older.hash]: commitDetailsFixture({ ...older, subject: "Older details" }),
      },
      commitFilesByHash: {
        [older.hash]: [
          {
            isRename: false,
            newPath: null,
            oldPath: null,
            path: "src/Older.ts",
            status: "M",
          },
        ],
      },
    });

    await renderPanel(root, gateway);

    expect(gateway.getCommitLog).toHaveBeenCalledTimes(1);

    act(() => {
      rowByText(host, ".git-history-commit-row", "Older").click();
    });
    await act(async () => {
      await flushAsync();
    });

    expect(gateway.getCommitLog).toHaveBeenCalledTimes(1);
    expect(gateway.getCommitDetails).toHaveBeenLastCalledWith(
      "/workspace",
      older.hash,
    );
    expect(gateway.getCommitFiles).toHaveBeenLastCalledWith(
      "/workspace",
      older.hash,
    );
    expect(host.textContent).toContain("Older details");
    expect(host.textContent).toContain("Older.ts");
  });

  it("reverts the selected commit and selects the new commit after refreshing history", async () => {
    const selected = commitFixture(
      "1111111111111111111111111111111111111111",
      "Change settings",
    );
    const gateway = createGateway({ commitLog: [selected] });
    const revertedEvents: unknown[] = [];
    const listener = (event: Event) => {
      revertedEvents.push((event as CustomEvent).detail);
    };
    window.addEventListener("mockor-git-commit-reverted", listener);

    await renderPanel(root, gateway);

    act(() => {
      host.querySelector<HTMLButtonElement>(
        "button[title='Revert selected commit']",
      )?.click();
    });
    await act(async () => {
      await flushAsync();
    });

    expect(gateway.revertCommit).toHaveBeenCalledWith("/workspace", selected.hash);
    expect(selectedCommitText(host)).toContain('Revert "Change settings"');
    expect(revertedEvents).toEqual([
      {
        rootPath: "/workspace",
        subject: 'Revert "Change settings"',
      },
    ]);

    window.removeEventListener("mockor-git-commit-reverted", listener);
  });

  it("supports an empty commit list fallback and allows re-fetch", async () => {
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog: [],
    });

    await renderPanel(root, gateway);

    expect(host.textContent).toContain("No commits yet");
    expect(
      host.querySelector<HTMLButtonElement>(
        ".git-history-commits .git-history-refresh",
      ),
    ).not.toBeNull();

    gateway.setCommitLog([
      commitFixture("1111111111111111111111111111111111111111", "Recovered"),
    ]);

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          ".git-history-commits .git-history-refresh",
        )
        ?.click();
    });
    await act(async () => {
      await flushAsync();
    });

    expect(gateway.getCommitLog).toHaveBeenCalledTimes(2);
    expect(selectedCommitText(host)).toContain("Recovered");
  });

  it("supports an empty file list fallback and allows re-fetch", async () => {
    const commit = commitFixture("1111111111111111111111111111111111111111", "Initial");
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog: [commit],
      commitDetails: commitDetailsFixture(commit),
      commitFiles: [],
    });

    await renderPanel(root, gateway);

    expect(host.textContent).toContain("No changed files");

    gateway.setCommitFiles([
      {
        isRename: false,
        newPath: null,
        oldPath: null,
        path: "src/main.ts",
        status: "M",
      },
    ]);

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          ".git-history-details .git-history-refresh",
        )
        ?.click();
    });
    await act(async () => {
      await flushAsync();
    });

    expect(gateway.getCommitFiles).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("src");
    expect(host.textContent).toContain("main.ts");
  });

  it("renders changed files as a folder tree", async () => {
    const commit = commitFixture("1111111111111111111111111111111111111111", "Initial");
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog: [commit],
      commitDetails: commitDetailsFixture(commit),
      commitFiles: [
        {
          isRename: false,
          newPath: null,
          oldPath: null,
          path: "src/components/App.tsx",
          status: "M",
        },
      ],
    });

    await renderPanel(root, gateway);

    expect(host.querySelector(".git-history-file-folder-label")?.textContent)
      .toContain("src");
    expect(host.textContent).toContain("components");
    expect(host.textContent).toContain("App.tsx");
  });

  it("renders file and child entries when a path changes from file to folder", async () => {
    const commit = commitFixture("1111111111111111111111111111111111111111", "Initial");
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog: [commit],
      commitDetails: commitDetailsFixture(commit),
      commitFiles: [
        {
          isRename: false,
          newPath: null,
          oldPath: null,
          path: "src",
          status: "D",
        },
        {
          isRename: false,
          newPath: null,
          oldPath: null,
          path: "src/main.ts",
          status: "A",
        },
      ],
    });

    await renderPanel(root, gateway);

    const fileRows = [
      ...host.querySelectorAll<HTMLButtonElement>(".git-history-file-row"),
    ].map((row) => row.textContent ?? "");

    expect(fileRows).toEqual(
      expect.arrayContaining([
        expect.stringContaining("src"),
        expect.stringContaining("main.ts"),
      ]),
    );
  });

  it("retries loading commit metadata and files when detail loading fails", async () => {
    const commit = commitFixture("1111111111111111111111111111111111111111", "Initial");
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog: [commit],
      graphByCommit: {
        [commit.hash]: commitGraphNode(commit, 0, false),
      },
      commitDetailsError: true,
    });

    await renderPanel(root, gateway);

    expect(host.textContent).toContain("Failed to load selected commit data.");

    gateway.setCommitDetails(
      commitDetailsFixture({ ...commit, subject: "Recovered" }),
    );

    act(() => {
      host
        .querySelector<HTMLButtonElement>(
          ".git-history-details .git-history-refresh",
        )
        ?.click();
    });
    await act(async () => {
      await flushAsync();
    });

    expect(gateway.getCommitDetails).toHaveBeenCalledTimes(2);
    expect(gateway.getCommitFiles).toHaveBeenCalledTimes(2);
    expect(host.textContent).not.toContain("Failed to load selected commit data.");
    expect(host.textContent).toContain("Recovered");
  });

  it("renders commit rows in a virtualized viewport for large histories", async () => {
    const commitLog = Array.from({ length: 220 }, (_, index) =>
      commitFixture(hashAt(index), `Commit ${index}`),
    );

    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog,
      commitDetails: commitDetailsFixture(commitLog[0]),
    });

    await renderPanel(root, gateway);

    expect(gateway.getCommitLog).toHaveBeenCalledTimes(1);
    expect(
      host.querySelector<HTMLDivElement>(
        ".git-history-commit-list",
      )?.querySelectorAll(".git-history-commit-row").length,
    ).toBeLessThan(commitLog.length);
  });

  it("does not snap scrolling back to the selected commit", async () => {
    const commitLog = Array.from({ length: 220 }, (_, index) =>
      commitFixture(hashAt(index), `Commit ${index}`),
    );

    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog,
      commitDetails: commitDetailsFixture(commitLog[0]),
    });

    await renderPanel(root, gateway);

    const list = host.querySelector<HTMLDivElement>(".git-history-commit-list");
    expect(list).not.toBeNull();

    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 6000,
    });

    await act(async () => {
      if (list) {
        list.scrollTop = 2100;
        list.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
      await flushAnimationFrame();
      await flushAsync();
    });

    expect(list?.scrollTop).toBe(2100);
  });

  it("renders colored lanes for branched commit graph rows", async () => {
    const commitLog = [
      commitFixture(hashAt(0), "Merge", [hashAt(1), hashAt(2)]),
      commitFixture(hashAt(1), "Main parent", [hashAt(3)]),
      commitFixture(hashAt(2), "Feature parent", [hashAt(3)]),
      commitFixture(hashAt(3), "Base"),
    ];

    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog,
      commitDetails: commitDetailsFixture(commitLog[0]),
    });

    await renderPanel(root, gateway);

    const mergeRow = rowByText(host, ".git-history-commit-row", "Merge");
    const strokes = [
      ...mergeRow.querySelectorAll<SVGElement>(
        ".git-history-commit-graph-line, .git-history-commit-graph-branch",
      ),
    ].map((element) => element.style.stroke);
    const branchPath = mergeRow.querySelector<SVGPathElement>(
      ".git-history-commit-graph-branch",
    );

    expect(new Set(strokes).size).toBeGreaterThan(1);
    expect(branchPath?.getAttribute("d")).toContain(" C ");
    expect(branchPath?.getAttribute("d")).toMatch(/^M 9 15 C /);
    expect(branchPath?.getAttribute("d")).toContain("32");
  });

  it("loads the next commit page when scrolling near the bottom", async () => {
    const commitLog = Array.from({ length: 220 }, (_, index) =>
      commitFixture(hashAt(index), `Commit ${index}`),
    );

    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog,
      commitDetails: commitDetailsFixture(commitLog[0]),
    });

    await renderPanel(root, gateway);

    const list = host.querySelector<HTMLDivElement>(".git-history-commit-list");
    expect(list).not.toBeNull();

    Object.defineProperty(list, "clientHeight", {
      configurable: true,
      value: 320,
    });
    Object.defineProperty(list, "scrollHeight", {
      configurable: true,
      value: 6000,
    });

    await act(async () => {
      if (list) {
        list.scrollTop = 5700;
        list.dispatchEvent(new Event("scroll", { bubbles: true }));
      }
      await flushAsync();
    });

    expect(gateway.getCommitLog).toHaveBeenCalledTimes(2);
    expect(gateway.getCommitLog).toHaveBeenLastCalledWith(
      "/workspace",
      expect.objectContaining({
        cursor: "200",
        limit: 200,
      }),
    );
  });

  it("supports Home/End/PageUp/PageDown commit-row navigation", async () => {
    const commitLog = Array.from({ length: 30 }, (_, index) =>
      commitFixture(hashAt(index), `Commit ${index}`),
    );
    const gateway = createGateway({
      branches: {
        current: "main",
        local: ["main"],
        remotes: {},
      },
      commitLog,
      commitDetails: commitDetailsFixture(commitLog[0]),
    });

    await renderPanel(root, gateway);

    const list = host.querySelector<HTMLDivElement>(".git-history-commit-list");

    act(() => {
      list?.focus();
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "End" }),
      );
    });

    expect(selectedCommitText(host)).toContain("Commit 29");

    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Home" }),
      );
    });

    expect(selectedCommitText(host)).toContain("Commit 0");

    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "PageDown" }),
      );
    });

    expect(selectedCommitText(host)).toContain("Commit 10");

    act(() => {
      list?.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "PageUp" }),
      );
    });

    expect(selectedCommitText(host)).toContain("Commit 0");
  });
});

function commitGraphNode(
  commit: Commit,
  depth: number,
  isMerge: boolean,
  children: string[] = [],
): CommitGraphNode {
  return {
    children,
    commit,
    depth,
    hash: commit.hash,
    isMerge,
  };
}

async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function flushAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

async function renderPanel(
  root: Root,
  gateway: GitHistoryGateway,
  onOpenCommitFileDiff?: (
    commitHash: string,
    path: string,
    oldPath: string | null,
    files?: FileChange[],
  ) => Promise<void> | void,
) {
  await act(async () => {
    root.render(
      <GitHistoryPanel
        gateway={gateway}
        onOpenCommitFileDiff={onOpenCommitFileDiff ?? vi.fn()}
        rootPath="/workspace"
      />,
    );
    await flushAsync();
  });
}

function rowByText(
  rootNode: Element,
  selector: string,
  text: string,
): HTMLButtonElement {
  const candidates = rootNode.querySelectorAll<HTMLButtonElement>(selector);

  const match = [...candidates].find((candidate) =>
    candidate.textContent?.includes(text),
  );

  if (!match) {
    throw new Error(`Unable to find ${selector} containing ${text}`);
  }

  return match;
}

function selectedCommitText(rootNode: Element): string {
  return selectedCommitRow(rootNode)?.textContent ?? "";
}

function selectedCommitRow(rootNode: Element): HTMLButtonElement | null {
  return rootNode.querySelector<HTMLButtonElement>(
    ".git-history-commit-row[aria-selected='true']",
  );
}

function hashAt(index: number): string {
  return `0000000000000000000000000000000000000000${String(index)}`.slice(
    -40,
  );
}

function commitFixture(
  hash: string,
  subject: string,
  parents: string[] = [],
): Commit {
  return {
    abbrevHash: hash.slice(0, 8),
    authorEmail: "dev@example.test",
    authorName: "Developer",
    date: "2026-06-25T10:00:00.000Z",
    hash,
    labels: [],
    parents,
    subject,
  };
}

function commitDetailsFixture(commit: Commit): CommitDetails {
  return {
    ...commit,
    body: "",
    containingBranches: ["main"],
  };
}

function createGateway(seed: {
  branches?: GitBranches;
  commitLog?: Commit[];
  commitLogByBranch?: Record<string, Commit[]>;
  commitDetails?: CommitDetails;
  commitDetailsByHash?: Record<string, CommitDetails>;
  commitDetailsError?: boolean;
  commitFiles?: FileChange[];
  commitFilesByHash?: Record<string, FileChange[]>;
  graphByCommit?: Record<string, CommitGraphNode>;
  graphByBranch?: Record<string, CommitGraphNode[]>;
  repoStatus?: GitRepoStatus;
} = {}): CommitHistoryGateway {
  const branchCommits = seed.commitLogByBranch ?? {};
  const graphByBranch = seed.graphByBranch ?? {};
  const commitDetailsByHash = new Map<string, CommitDetails>();

  let commitLog = seed.commitLog ?? [];
  let currentCommitLog = commitLog;
  let commitFiles = seed.commitFiles ?? [];
  let commitDetailsError = seed.commitDetailsError ?? false;
  let lastCommitBranch: string | null = null;

  const graphByCommit = seed.graphByCommit ?? {};
  const seedDefaultCommit =
    commitLog[0] ??
    commitFixture("1111111111111111111111111111111111111111", "Initial");

  if (seed.commitDetails) {
    commitDetailsByHash.set(seed.commitDetails.hash, seed.commitDetails);
  } else {
    commitDetailsByHash.set(seedDefaultCommit.hash, commitDetailsFixture(seedDefaultCommit));
  }
  for (const details of Object.values(seed.commitDetailsByHash ?? {})) {
    commitDetailsByHash.set(details.hash, details);
  }

  const gateway: CommitHistoryGateway = {
    getRepoStatus: vi.fn(async () =>
      seed.repoStatus ?? { gitAvailable: true, isRepository: true },
    ),
    getBranches: vi.fn(async () =>
      seed.branches ?? {
        current: null,
        local: [],
        remotes: {},
      },
    ),
    getCommitLog: vi.fn(async (_rootPath, filters) => {
      lastCommitBranch = filters.branch ?? null;

      const source =
        filters.branch && branchCommits[filters.branch]
          ? branchCommits[filters.branch]
          : filters.branch
            ? []
            : currentCommitLog;
      const start = Number.parseInt(filters.cursor ?? "0", 10) || 0;
      const end = filters.limit ? start + filters.limit : undefined;

      return source.slice(start, end);
    }),
    getCommitGraphPage: vi.fn(async (_rootPath, _cursor) => {
      if (lastCommitBranch && graphByBranch[lastCommitBranch]) {
        return graphByBranch[lastCommitBranch];
      }

      const firstCommit = currentCommitLog[0];
      const fallbackNode = firstCommit ? graphByCommit[firstCommit.hash] : null;

      return fallbackNode ? [fallbackNode] : [];
    }),
    getCommitDetails: vi.fn(async (_rootPath, commitHash) => {
      if (commitDetailsError) {
        commitDetailsError = false;
        throw new Error("Commit details failed");
      }

      return (
        commitDetailsByHash.get(commitHash) ??
        commitDetailsFixture(
          commitFixture(
            commitHash,
            commitHash === seedDefaultCommit.hash
              ? seedDefaultCommit.subject
              : "Recovered",
          ),
        )
      );
    }),
    getCommitFiles: vi.fn(async (_rootPath, commitHash) =>
      seed.commitFilesByHash?.[commitHash] ?? commitFiles,
    ),
    getCommitDiff: vi.fn(async () => ({
      commitHash: "",
      isRename: false,
      language: "plaintext",
      modifiedContent: "",
      originalContent: "",
      oldPath: null,
      path: "",
      status: "M" as const,
    })),
    revertCommit: vi.fn(async (_rootPath, commitHash) => {
      const selected = currentCommitLog.find((commit) => commit.hash === commitHash);
      const reverted = commitFixture(
        "9999999999999999999999999999999999999999",
        `Revert "${selected?.subject ?? "commit"}"`,
        [currentCommitLog[0]?.hash].filter((hash): hash is string => Boolean(hash)),
      );
      currentCommitLog = [reverted, ...currentCommitLog];
      commitDetailsByHash.set(reverted.hash, commitDetailsFixture(reverted));
      return reverted;
    }),
    setCommitLog(next) {
      currentCommitLog = next;
    },
    setCommitFiles(next) {
      commitFiles = next;
    },
    setCommitDetails(next) {
      commitDetailsByHash.set(next.hash, next);
      commitDetailsError = false;
    },
  };

  return gateway;
}
