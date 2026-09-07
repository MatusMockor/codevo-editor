// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentGitHistoryGateway } from "../../application/useAgentGitHistory";
import type { Commit, DiffPayload, FileChange } from "../../domain/git";
import { waitForReact } from "../../test/reactTestLifecycle";
import { AgentSurfaceHistory } from "./AgentSurfaceHistory";
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
async function render(currentScope: AgentGitHistoryScope = scope) {
  await act(async () =>
    root.render(
      <AgentSurfaceHistory scope={currentScope} gateway={gateway} monacoTheme="calm-dark" />,
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
