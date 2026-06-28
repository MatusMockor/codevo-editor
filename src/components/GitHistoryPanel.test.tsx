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
    expect(selectedCommitRow(host)?.textContent).toContain("◉");
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
    );
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
    expect(host.textContent).toContain("src/main.ts");
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
    expect(selectedCommitText(host)).toContain("Recovered");
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

async function renderPanel(
  root: Root,
  gateway: GitHistoryGateway,
  onOpenCommitFileDiff?: (
    commitHash: string,
    path: string,
    oldPath: string | null,
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

function commitFixture(hash: string, subject: string): Commit {
  return {
    abbrevHash: hash.slice(0, 8),
    authorEmail: "dev@example.test",
    authorName: "Developer",
    date: "2026-06-25T10:00:00.000Z",
    hash,
    labels: [],
    parents: [],
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
  commitDetailsError?: boolean;
  commitFiles?: FileChange[];
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

    if (filters.branch && branchCommits[filters.branch]) {
      return branchCommits[filters.branch];
    }

      return filters.branch ? [] : currentCommitLog;
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
    getCommitFiles: vi.fn(async (_rootPath, _commitHash) => commitFiles),
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
