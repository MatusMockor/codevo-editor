// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentGitHistoryGateway } from "../../application/useAgentGitHistory";
import type { Commit, DiffPayload, FileChange } from "../../domain/git";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentSurfaceHistory } from "./AgentSurfaceHistory";
import type { AgentHistoryRepositories } from "./agentHistoryRepositories";
import type { AgentGitHistoryScope } from "./agentGitHistoryTarget";

const preview = vi.hoisted(() => ({ props: [] as Array<Record<string, unknown>> }));
vi.mock("../GitDiffPreview", () => ({
  GitDiffPreview: (props: Record<string, unknown>) => {
    preview.props.push(props);
    return <div aria-label="Historical file diff" />;
  },
}));
const commit: Commit = {
  hash: "0123456789abcdef",
  abbrevHash: "0123456",
  subject: "Fix Linux startup",
  authorName: "Contributor",
  authorEmail: "",
  date: "2026-09-07T10:00:00Z",
  labels: [],
  parents: [],
};
const scope: AgentGitHistoryScope = {
  kind: "available",
  target: { rootPath: "/workspace/app/packages/api", ownerKey: "owner-1" },
};
let root: Root;
let host: HTMLDivElement;
let gateway: AgentGitHistoryGateway;
async function render(
  currentScope: AgentGitHistoryScope = scope,
  repositories?: AgentHistoryRepositories,
) {
  await act(async () =>
    root.render(
      <AgentSurfaceHistory
        repositories={repositories}
        scope={currentScope}
        gateway={gateway}
        monacoTheme="calm-dark"
      />,
    ),
  );
}
function button(name: string) {
  const found = Array.from(host.querySelectorAll("button")).find((element) =>
    (element.getAttribute("aria-label") ?? element.textContent ?? "").includes(name),
  );
  if (found === undefined) throw new Error(`Missing button ${name}`);
  return found;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  preview.props.length = 0;
  gateway = {
    getRepoStatus: vi.fn(async () => ({ gitAvailable: true, isRepository: true })),
    getCommitLog: vi.fn(async () => [commit]),
    getCommitDetails: vi.fn(async () => ({
      ...commit,
      body: "Use the platform-specific launcher.",
      containingBranches: [],
    })),
    getCommitFiles: vi.fn(async (): Promise<FileChange[]> => [
      {
        path: "src/new.ts",
        oldPath: "src/old.ts",
        newPath: "src/new.ts",
        isRename: true,
        status: "R",
      },
    ]),
    getCommitDiff: vi.fn(async (): Promise<DiffPayload> => ({
      commitHash: commit.hash,
      path: "src/new.ts",
      oldPath: "src/old.ts",
      status: "R",
      isRename: true,
      language: "typescript",
      originalContent: "old",
      modifiedContent: "new",
    })),
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

it("opens commit details and renamed file history without mutation actions", async () => {
  await render();
  expect(gateway.getRepoStatus).toHaveBeenCalledWith("/workspace/app/packages/api");
  expect(gateway.getCommitDetails).not.toHaveBeenCalled();
  expect(button("Newer commits").disabled).toBe(true);
  expect(button("Older commits").disabled).toBe(true);
  await act(async () => button("Fix Linux startup").click());
  expect(gateway.getCommitDetails).toHaveBeenCalledWith("/workspace/app/packages/api", commit.hash);
  expect(host.textContent).toContain("Use the platform-specific launcher.");
  expect(button("src/new.ts").title).toBe("src/old.ts → src/new.ts");
  expect(gateway.getCommitDiff).not.toHaveBeenCalled();
  await act(async () => button("src/new.ts").click());
  await waitForReact(() => expect(preview.props.length).toBeGreaterThan(0));
  expect(gateway.getCommitDiff).toHaveBeenCalledWith(
    "/workspace/app/packages/api",
    commit.hash,
    "src/new.ts",
    "src/old.ts",
    [expect.objectContaining({ path: "src/new.ts", oldPath: "src/old.ts", status: "R" })],
  );
  expect(preview.props.slice(-1)[0]).toMatchObject({
    canRevertChange: false,
    comparisonLabels: { original: "Empty tree", modified: commit.abbrevHash },
    diff: {
      change: { relativePath: "src/new.ts", oldRelativePath: "src/old.ts", status: "renamed" },
      originalContent: "old",
      modifiedContent: "new",
    },
  });
  const actions = Array.from(host.querySelectorAll("button"))
    .map((value) => value.getAttribute("aria-label") ?? value.textContent)
    .join(" ");
  expect(actions).not.toMatch(/checkout|cherry.pick|revert|reset|stage|push/i);
});

it("labels a non-root commit against its parent", async () => {
  vi.mocked(gateway.getCommitDetails).mockResolvedValue({
    ...commit,
    parents: ["parent-hash"],
    body: "",
    containingBranches: [],
  });
  await render();
  await act(async () => button("Fix Linux startup").click());
  await act(async () => button("src/new.ts").click());
  await waitForReact(() =>
    expect(preview.props.slice(-1)[0]).toMatchObject({
      comparisonLabels: { original: "Parent", modified: commit.abbrevHash },
    }),
  );
});

it("explains an unavailable scope without reading Git", async () => {
  await render({
    kind: "unavailable",
    reason: "Reopen this thread's project to browse its Git history.",
  });
  expect(host.textContent).toContain("Reopen this thread's project");
  expect(gateway.getRepoStatus).not.toHaveBeenCalled();
  expect(host.querySelector("button")).toBeNull();
});

it("distinguishes empty history from a failed load and retries using refresh", async () => {
  vi.mocked(gateway.getCommitLog).mockRejectedValueOnce(new Error("Git history unavailable"));
  await render();
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "Could not load Git history. Try refreshing.",
  );
  expect(host.textContent).not.toContain("No commits");
  vi.mocked(gateway.getCommitLog).mockResolvedValueOnce([]);
  await act(async () => button("Refresh Git history").click());
  expect(host.textContent).toContain("No commits in this repository yet.");
  expect(host.querySelector('[role="status"]')).toBeNull();
});

it("shows detail failures without displaying stale changed files", async () => {
  vi.mocked(gateway.getCommitDetails).mockRejectedValueOnce(
    new Error("Commit no longer available"),
  );
  await render();
  await act(async () => button("Fix Linux startup").click());
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not load this commit. Select it to retry.",
  );
  expect(host.querySelector('[aria-label="Commit files"]')).toBeNull();
  expect(gateway.getCommitDiff).not.toHaveBeenCalled();
});

const repositoryChoices: AgentHistoryRepositories = {
  identity: "project-generation-1",
  projectLabel: "Projects",
  defaultValue: "root:choose",
  options: [
    {
      value: "root:choose",
      label: "Choose a repository",
      description: "Projects",
      scope: {
        kind: "unavailable",
        reason: "Choose a repository to browse its commits and changed files.",
      },
    },
    {
      value: "root:/projects/api",
      label: "api",
      description: "packages/api",
      scope: { kind: "available", target: { rootPath: "/projects/api", ownerKey: "owner-1" } },
    },
    {
      value: "root:/projects/web",
      label: "web",
      description: "packages/web",
      scope: { kind: "available", target: { rootPath: "/projects/web", ownerKey: "owner-1" } },
    },
  ],
};

it("lets a parent-folder user choose history without reading the parent as a repository", async () => {
  await render(scope, repositoryChoices);
  expect(gateway.getRepoStatus).not.toHaveBeenCalled();
  expect(host.textContent).toContain("Choose a repository");
  await act(async () => button("History repository").click());
  const api = Array.from(host.querySelectorAll<HTMLElement>('[role="option"]')).find((option) =>
    option.textContent?.includes("packages/api"),
  );
  expect(api).toBeDefined();
  await act(async () => api?.click());
  expect(gateway.getRepoStatus).toHaveBeenLastCalledWith("/projects/api");
  expect(host.textContent).toContain("Fix Linux startup");
  await render(scope, { ...repositoryChoices, identity: "project-generation-2" });
  expect(host.textContent).toContain("Choose a repository");
  expect(host.textContent).not.toContain("Fix Linux startup");
  await render(scope, repositoryChoices);
  expect(host.textContent).not.toContain("Fix Linux startup");
  expect(gateway.getRepoStatus).toHaveBeenCalledTimes(1);
});

it("switches history through keyboard choices without affecting a thread checkout", async () => {
  const checkout = {
    ...repositoryChoices,
    defaultValue: "root:checkout",
    options: [
      { ...repositoryChoices.options[0]!, value: "root:checkout", label: "Thread checkout", scope },
      ...repositoryChoices.options.slice(1),
    ],
  };
  await render(scope, checkout);
  expect(gateway.getRepoStatus).toHaveBeenLastCalledWith("/workspace/app/packages/api");
  await act(async () =>
    button("History repository").dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
  const options = host.querySelectorAll<HTMLElement>('[role="option"]');
  await act(async () =>
    options[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })),
  );
  await act(async () =>
    options[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(gateway.getRepoStatus).toHaveBeenLastCalledWith("/projects/api");
  expect(scope).toEqual({
    kind: "available",
    target: { rootPath: "/workspace/app/packages/api", ownerKey: "owner-1" },
  });
});

it("preserves a repository search across equivalent project updates", async () => {
  vi.useFakeTimers();
  const repositories = {
    ...repositoryChoices,
    options: [
      repositoryChoices.options[0]!,
      ...Array.from({ length: 65 }, (_, index) => ({
        ...repositoryChoices.options[1]!,
        value: `root:/projects/repo-${index}`,
        label: `repo-${index}`,
      })),
    ],
  };
  await render(scope, repositories);
  await act(async () => button("History repository").click());
  const input = host.querySelector<HTMLInputElement>('[aria-label="Search repositories"]');
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      input,
      "repo-64",
    );
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  for (let index = 0; index < 4; index += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
    await render(scope, { ...repositories, options: [...repositories.options] });
  }
  expect(host.querySelector<HTMLInputElement>('[aria-label="Search repositories"]')?.value).toBe(
    "repo-64",
  );
  expect(host.querySelector('[role="listbox"]')?.textContent).toContain("repo-64");
  expect(host.querySelectorAll('[role="option"]').length).toBeLessThanOrEqual(51);
});

it("ignores a pending sibling history after selecting a different repository", async () => {
  let finish: ((commits: Commit[]) => void) | undefined;
  vi.mocked(gateway.getCommitLog).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render(scope, repositoryChoices);
  await act(async () => button("History repository").click());
  await act(async () => host.querySelectorAll<HTMLElement>('[role="option"]')[1]?.click());
  expect(gateway.getRepoStatus).toHaveBeenLastCalledWith("/projects/api");
  await act(async () => button("History repository").click());
  await act(async () => host.querySelectorAll<HTMLElement>('[role="option"]')[2]?.click());
  expect(gateway.getRepoStatus).toHaveBeenLastCalledWith("/projects/web");
  await act(async () => finish?.([{ ...commit, subject: "Stale API commit" }]));
  expect(host.textContent).not.toContain("Stale API commit");
  expect(host.textContent).toContain("Fix Linux startup");
  await render({ kind: "unavailable", reason: "Project unavailable." });
  expect(host.textContent).not.toContain("Fix Linux startup");
});
