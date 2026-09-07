// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Commit, CommitDetails, DiffPayload, FileChange } from "../domain/git";
import {
  useAgentGitHistory,
  type AgentGitHistoryGateway,
  type AgentGitHistoryTarget,
} from "./useAgentGitHistory";

const commit = (hash: string): Commit => ({
  hash,
  abbrevHash: hash,
  subject: hash,
  authorName: "Author",
  authorEmail: "",
  date: "2026-01-01",
  labels: [],
  parents: [],
});
const file = (path: string): FileChange => ({
  path,
  oldPath: null,
  newPath: path,
  isRename: false,
  status: "M",
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
let root: Root;
let host: HTMLDivElement;
let result: ReturnType<typeof useAgentGitHistory>;
let gateway: AgentGitHistoryGateway;
const a = { rootPath: "/a", ownerKey: "a" };
function Harness({ target }: { target: AgentGitHistoryTarget | null }) {
  result = useAgentGitHistory({ target, gateway });
  return null;
}
async function render(target: AgentGitHistoryTarget | null = a) {
  await act(async () => {
    root.render(<Harness target={target} />);
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
  gateway = {
    getBranches: vi.fn(async () => ({
      current: "main",
      local: ["main", "feature"],
      remotes: { origin: ["main"] },
    })),
    getRepoStatus: vi.fn(async () => ({ gitAvailable: true, isRepository: true })),
    getCommitLog: vi.fn(async () => [commit("a"), commit("b")]),
    getCommitDetails: vi.fn(async (_root, hash) => ({
      ...commit(hash),
      body: "",
      containingBranches: [],
    })),
    getCommitFiles: vi.fn(async () => [file("one"), file("two")]),
    getCommitDiff: vi.fn(async (_root, hash, path): Promise<DiffPayload> => ({
      commitHash: hash,
      path,
      oldPath: null,
      status: "M",
      isRename: false,
      language: "text",
      originalContent: "old",
      modifiedContent: "new",
    })),
  };
});
afterEach(() => {
  act(() => root.unmount());
});
it("performs no work without a target and loads details and diffs only on selection", async () => {
  await render(null);
  expect(gateway.getRepoStatus).not.toHaveBeenCalled();
  await render();
  expect(result.status).toBe("ready");
  expect(gateway.getCommitDetails).not.toHaveBeenCalled();
  await act(async () => {
    result.selectCommit("a");
  });
  expect(result.details?.hash).toBe("a");
  expect(gateway.getCommitDiff).not.toHaveBeenCalled();
  await act(async () => {
    result.selectFile(result.files[0]);
  });
  expect(result.diff?.path).toBe("one");
});
it("rejects responses across A to B to A owner generations", async () => {
  const pending = deferred<Commit[]>();
  vi.mocked(gateway.getCommitLog).mockReturnValueOnce(pending.promise);
  await render();
  await render({ rootPath: "/b", ownerKey: "b" });
  await render();
  await act(async () => {
    pending.resolve([commit("stale")]);
  });
  expect(result.commits.map((value) => value.hash)).toEqual(["a", "b"]);
});
it("rejects superseded and foreign details", async () => {
  const pending = deferred<CommitDetails>();
  vi.mocked(gateway.getCommitDetails).mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => {
    result.selectCommit("a");
  });
  await act(async () => {
    result.selectCommit("b");
  });
  await act(async () => {
    pending.resolve({ ...commit("a"), body: "", containingBranches: [] });
  });
  expect(result.details?.hash).toBe("b");
  vi.mocked(gateway.getCommitDetails).mockResolvedValueOnce({
    ...commit("foreign"),
    body: "",
    containingBranches: [],
  });
  await act(async () => {
    result.selectCommit("a");
  });
  expect(result.details).toBeNull();
  expect(result.detailsError).toBeTruthy();
});
it("rejects superseded and foreign file diffs", async () => {
  const pending = deferred<DiffPayload>();
  await render();
  await act(async () => {
    result.selectCommit("a");
  });
  vi.mocked(gateway.getCommitDiff).mockReturnValueOnce(pending.promise);
  await act(async () => {
    result.selectFile(result.files[0]);
  });
  await act(async () => {
    result.selectFile(result.files[1]);
  });
  const diff = result.diff!;
  await act(async () => {
    pending.resolve({ ...diff, path: "one" });
  });
  expect(result.diff?.path).toBe("two");
  vi.mocked(gateway.getCommitDiff).mockResolvedValueOnce({ ...diff, commitHash: "foreign" });
  await act(async () => {
    result.selectFile(result.files[1]);
  });
  expect(result.diff).toBeNull();
  expect(result.diffError).toBeTruthy();
});
it("bounds retained commits and files and extends a cumulative graph prefix", async () => {
  vi.mocked(gateway.getCommitLog).mockResolvedValue(
    Array.from({ length: 51 }, (_, index) => commit(String(index))),
  );
  vi.mocked(gateway.getCommitFiles).mockResolvedValue(
    Array.from({ length: 300 }, (_, index) => file(String(index))),
  );
  await render();
  expect(result.commits).toHaveLength(50);
  expect(result.hasNext).toBe(true);
  await act(async () => {
    result.selectCommit("0");
  });
  expect(result.files).toHaveLength(200);
  expect(result.filesTruncated).toBe(true);
  await act(async () => {
    result.loadMore();
  });
  expect(gateway.getCommitLog).toHaveBeenLastCalledWith("/a", {
    limit: 101,
    cursor: "0",
    allBranches: true,
  });
  expect(result.details).toBeNull();
  expect(result.commits).toHaveLength(51);
  expect(result.hasNext).toBe(false);
});
it("reports unavailable repositories, empty history and retryable errors", async () => {
  vi.mocked(gateway.getRepoStatus).mockResolvedValueOnce({
    gitAvailable: false,
    isRepository: false,
  });
  await render();
  expect(result.status).toBe("unavailable");
  expect(gateway.getCommitLog).not.toHaveBeenCalled();
  vi.mocked(gateway.getCommitLog).mockRejectedValueOnce(new Error("failure"));
  await act(async () => {
    result.refresh();
  });
  expect(result.status).toBe("error");
  vi.mocked(gateway.getCommitLog).mockResolvedValueOnce([]);
  await act(async () => {
    result.refresh();
  });
  expect(result.status).toBe("ready");
  expect(result.commits).toEqual([]);
});
it("rejects old callbacks after A to B to A and discards a closed pending diff", async () => {
  await render();
  const oldSelectFile = result.selectFile;
  const oldSelectCommit = result.selectCommit;
  await render({ rootPath: "/b", ownerKey: "b" });
  await render();
  await act(async () => {
    result.selectCommit("a");
  });
  const calls = vi.mocked(gateway.getCommitDetails).mock.calls.length;
  await act(async () => {
    oldSelectFile(result.files[0]);
    oldSelectCommit("b");
  });
  expect(gateway.getCommitDiff).not.toHaveBeenCalled();
  expect(gateway.getCommitDetails).toHaveBeenCalledTimes(calls);
  const pending = deferred<DiffPayload>();
  vi.mocked(gateway.getCommitDiff).mockReturnValueOnce(pending.promise);
  await act(async () => {
    result.selectFile(result.files[0]);
  });
  await act(async () => {
    result.closeDiff();
  });
  await act(async () => {
    pending.resolve({
      commitHash: "a",
      path: "one",
      oldPath: null,
      status: "M",
      isRename: false,
      language: "text",
      originalContent: "old",
      modifiedContent: "new",
    });
  });
  expect(result.diff).toBeNull();
  expect(result.selectedFile).toBeNull();
});
it("invalidates retained actions and pending reads on unmount", async () => {
  await render();
  const actions = result;
  await act(async () => {
    root.render(null);
  });
  await act(async () => {
    actions.selectCommit("a");
    actions.refresh();
  });
  expect(gateway.getCommitDetails).not.toHaveBeenCalled();
  expect(gateway.getRepoStatus).toHaveBeenCalledTimes(1);
  const pending = deferred<Commit[]>();
  vi.mocked(gateway.getCommitLog).mockReturnValueOnce(pending.promise);
  await render();
  await act(async () => {
    root.render(null);
  });
  await act(async () => {
    pending.resolve([commit("late")]);
  });
  expect(result.commits).toEqual([]);
});
it("rejects duplicate commit and file identities", async () => {
  vi.mocked(gateway.getCommitLog).mockResolvedValueOnce([commit("a"), commit("a")]);
  await render();
  expect(result.status).toBe("error");
  await act(async () => {
    result.refresh();
  });
  vi.mocked(gateway.getCommitFiles).mockResolvedValueOnce([file("one"), file("one")]);
  await act(async () => {
    result.selectCommit("a");
  });
  expect(result.files).toEqual([]);
  expect(result.detailsError).toBeTruthy();
});
it("does not load a previous commit file while another selection starts", async () => {
  await render();
  await act(async () => {
    result.selectCommit("a");
  });
  const oldFile = result.files[0];
  await act(async () => {
    result.selectCommit("b");
    result.selectFile(oldFile);
  });
  expect(gateway.getCommitDiff).not.toHaveBeenCalled();
  expect(result.selectedHash).toBe("b");
});
it.each([
  ["Binary file; text preview unavailable.", "Binary files cannot be previewed."],
  [new Error("File exceeds the preview size limit."), "This file exceeds the preview size limit."],
  [
    "Git history contains non-UTF-8 data; preview unavailable.",
    "This file uses an unsupported text encoding and cannot be previewed.",
  ],
  [
    new Error("private path /workspace/secret"),
    "Could not load this file change. Select it to retry.",
  ],
  [
    "prefix Binary file; text preview unavailable.",
    "Could not load this file change. Select it to retry.",
  ],
])("presents only exact known permanent diff failures safely: %s", async (failure, message) => {
  await render();
  await act(async () => {
    result.selectCommit("a");
  });
  vi.mocked(gateway.getCommitDiff).mockRejectedValueOnce(failure);
  await act(async () => {
    result.selectFile(result.files[0]);
  });
  expect(result.diffError).toBe(message);
  expect(result.diffLoading).toBe(false);
  expect(result.diff).toBeNull();
});

it("loads all branches by default and uses exact local and remote references", async () => {
  await render();
  expect(gateway.getCommitLog).toHaveBeenLastCalledWith("/a", {
    limit: 51,
    cursor: "0",
    allBranches: true,
  });
  await act(async () => result.selectBranch({ kind: "branch", ref: "refs/remotes/origin/main" }));
  expect(gateway.getCommitLog).toHaveBeenLastCalledWith("/a", {
    limit: 51,
    cursor: "0",
    branch: "refs/remotes/origin/main",
  });
  await act(async () => result.selectBranch({ kind: "branch", ref: "refs/heads/main" }));
  expect(gateway.getCommitLog).toHaveBeenLastCalledWith("/a", {
    limit: 51,
    cursor: "0",
    branch: "refs/heads/main",
  });
  await act(async () => result.selectBranch({ kind: "head" }));
  expect(gateway.getCommitLog).toHaveBeenLastCalledWith("/a", { limit: 51, cursor: "0" });
  const calls = vi.mocked(gateway.getCommitLog).mock.calls.length;
  await act(async () => result.selectBranch({ kind: "branch", ref: "refs/heads/unknown" }));
  expect(gateway.getCommitLog).toHaveBeenCalledTimes(calls);
});
it("rejects deleted branches after revalidation and duplicate branch payloads", async () => {
  await render();
  vi.mocked(gateway.getBranches).mockResolvedValueOnce({
    current: "main",
    local: ["main"],
    remotes: {},
  });
  await act(async () => result.selectBranch({ kind: "branch", ref: "refs/heads/feature" }));
  expect(result.status).toBe("error");
  expect(gateway.getCommitLog).toHaveBeenCalledTimes(1);
  vi.mocked(gateway.getBranches).mockResolvedValueOnce({
    current: "main",
    local: ["main", "main"],
    remotes: {},
  });
  await act(async () => result.selectBranch({ kind: "all" }));
  expect(result.status).toBe("error");
});
it("rejects stale branch reads and callbacks across branch A to B to A", async () => {
  await render();
  const oldActions = result;
  const pending = deferred<Commit[]>();
  vi.mocked(gateway.getCommitLog).mockReturnValueOnce(pending.promise);
  await act(async () => result.selectBranch({ kind: "branch", ref: "refs/heads/main" }));
  await act(async () => result.selectBranch({ kind: "all" }));
  await act(async () => {
    oldActions.selectCommit("a");
    oldActions.refresh();
    pending.resolve([commit("stale")]);
  });
  expect(result.commits.map((value) => value.hash)).toEqual(["a", "b"]);
  expect(gateway.getCommitDetails).not.toHaveBeenCalled();
});
it("keeps the graph prefix while loading more and caps retained history at 500", async () => {
  vi.mocked(gateway.getCommitLog).mockImplementation(async (_root, filters) =>
    Array.from({ length: filters.limit ?? 51 }, (_, index) => commit(String(index))),
  );
  await render();
  const pending = deferred<Commit[]>();
  vi.mocked(gateway.getCommitLog).mockReturnValueOnce(pending.promise);
  await act(async () => result.loadMore());
  expect(result.commits).toHaveLength(50);
  expect(result.loadingMore).toBe(true);
  await act(async () =>
    pending.resolve(Array.from({ length: 101 }, (_, index) => commit(String(index)))),
  );
  expect(result.commits).toHaveLength(100);
  for (let index = 0; index < 8; index += 1) await act(async () => result.loadMore());
  expect(result.commits).toHaveLength(500);
  expect(result.hasNext).toBe(false);
  expect(result.reason).toContain("500");
  expect(gateway.getCommitLog).toHaveBeenLastCalledWith("/a", {
    limit: 500,
    cursor: "0",
    allBranches: true,
  });
});
it("closing details invalidates pending files and commit reads", async () => {
  await render();
  const pending = deferred<CommitDetails>();
  vi.mocked(gateway.getCommitDetails).mockReturnValueOnce(pending.promise);
  await act(async () => result.selectCommit("a"));
  await act(async () => result.clearSelection());
  await act(async () => pending.resolve({ ...commit("a"), body: "", containingBranches: [] }));
  expect(result.details).toBeNull();
  expect(result.selectedHash).toBeNull();
});
it("retries a failed prefix extension without skipping a batch", async () => {
  vi.mocked(gateway.getCommitLog).mockResolvedValue(
    Array.from({ length: 51 }, (_, index) => commit(String(index))),
  );
  await render();
  vi.mocked(gateway.getCommitLog).mockRejectedValueOnce(new Error("failure"));
  await act(async () => result.loadMore());
  expect(result.status).toBe("ready");
  expect(result.commits).toHaveLength(50);
  expect(result.loadingMore).toBe(false);
  await act(async () => result.loadMore());
  expect(gateway.getCommitLog).toHaveBeenLastCalledWith("/a", {
    limit: 101,
    cursor: "0",
    allBranches: true,
  });
});
it("rejects branch and commit count exhaustion", async () => {
  vi.mocked(gateway.getBranches).mockResolvedValueOnce({
    current: "main",
    local: Array.from({ length: 5001 }, (_, index) => String(index)),
    remotes: {},
  });
  await render();
  expect(result.status).toBe("error");
  expect(gateway.getCommitLog).not.toHaveBeenCalled();
  vi.mocked(gateway.getCommitLog).mockResolvedValueOnce(
    Array.from({ length: 52 }, (_, index) => commit(String(index))),
  );
  await act(async () => result.refresh());
  expect(result.status).toBe("error");
  expect(result.commits).toEqual([]);
});
