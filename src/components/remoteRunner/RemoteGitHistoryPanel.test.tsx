// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  RemoteGitHistory,
  RemoteRunnerSurfacesGateway,
  RemoteSurfaceScope,
} from "../../domain/remoteRunnerSurfaces";
import { RemoteGitHistoryPanel } from "./RemoteGitHistoryPanel";
vi.mock("../GitDiffPreview", () => ({
  GitDiffPreview: ({
    diff,
  }: {
    diff: {
      originalContent: string;
      modifiedContent: string;
      previewUnavailableReason: string | null;
    };
  }) => (
    <div data-diff>
      {diff.previewUnavailableReason ?? `${diff.originalContent} → ${diff.modifiedContent}`}
    </div>
  ),
}));
let host: HTMLDivElement;
let root: Root;
const scope: RemoteSurfaceScope = {
  serverId: "server",
  runnerId: "runner",
  projectId: "project",
  taskId: "task",
};
const commit = "a".repeat(40);
const history: RemoteGitHistory = {
  commits: [
    {
      id: commit,
      parents: [],
      subject: "Initial commit",
      authorName: "Author",
      authoredAt: "2026-09-18",
    },
  ],
  truncated: false,
  nextOffset: 100,
};
function gateway() {
  return {
    history: vi.fn(async () => history),
    commitFiles: vi.fn(async () => ({
      files: [{ path: "src/index.ts", status: "modified" as const }],
      truncated: false,
    })),
    commitDiff: vi.fn(async () => ({
      path: "src/index.ts",
      original: { text: "before", truncated: false },
      modified: { text: "after", truncated: false },
      unavailableReason: null as "binary" | "large" | null,
    })),
  };
}
function render(api: ReturnType<typeof gateway>, owner = scope) {
  return act(() =>
    root.render(
      <RemoteGitHistoryPanel
        scope={owner}
        gateway={api as unknown as RemoteRunnerSurfacesGateway}
      />,
    ),
  );
}
async function click(text: string) {
  await act(async () => {
    const button = Array.from(host.querySelectorAll("button")).find((item) =>
      item.textContent?.includes(text),
    );
    if (!button) throw new Error(`Missing ${text}`);
    button.click();
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(() => act(() => root.unmount()));
it("loads commits, files and a read-only diff using the exact remote checkout", async () => {
  const api = gateway();
  await render(api);
  expect(api.history).toHaveBeenCalledWith({ ...scope, offset: 0 });
  await click("Initial commit");
  expect(api.commitFiles).toHaveBeenCalledWith({ ...scope, commit });
  await click("src/index.ts");
  expect(api.commitDiff).toHaveBeenCalledWith({ ...scope, commit, path: "src/index.ts" });
  expect(host.textContent).toContain("before → after");
  await click("Back to history");
  await click("Older commits");
  expect(api.history).toHaveBeenLastCalledWith({ ...scope, offset: 100 });
});
it("rejects a late A response after A to B to A and clears previous display immediately", async () => {
  const api = gateway();
  let resolve!: (page: RemoteGitHistory) => void;
  api.history.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(api);
  await render(api, { ...scope, projectId: "other" });
  await render(api);
  await act(async () =>
    resolve({ ...history, commits: [{ ...history.commits[0], subject: "Stale secret" }] }),
  );
  expect(host.textContent).not.toContain("Stale secret");
  expect(host.textContent).toContain("Initial commit");
});
it("discards a pending diff when navigating back and surfaces failures without a local fallback", async () => {
  const api = gateway();
  let resolve!: (diff: Awaited<ReturnType<typeof api.commitDiff>>) => void;
  api.commitDiff.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(api);
  await click("Initial commit");
  await click("src/index.ts");
  await click("Back to history");
  await act(async () =>
    resolve({
      path: "src/index.ts",
      original: { text: "late", truncated: false },
      modified: { text: "late", truncated: false },
      unavailableReason: null,
    }),
  );
  expect(host.querySelector("[data-diff]")).toBeNull();
  api.commitFiles.mockRejectedValueOnce(new Error("offline"));
  await click("Initial commit");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Could not load");
});
it("marks partial file lists and partial previews truthfully", async () => {
  const api = gateway();
  api.commitFiles.mockResolvedValueOnce({
    files: [{ path: "src/index.ts", status: "modified" }],
    truncated: true,
  });
  api.commitDiff.mockResolvedValueOnce({
    path: "src/index.ts",
    original: { text: "before", truncated: true },
    modified: { text: "after", truncated: false },
    unavailableReason: null,
  });
  await render(api);
  await click("Initial commit");
  await click("src/index.ts");
  expect(host.textContent).toContain("file list is incomplete");
  expect(host.textContent).toContain("diff is incomplete");
});

it("does not refetch on equivalent scope objects and preserves binary preview state", async () => {
  const api = gateway();
  api.commitDiff.mockResolvedValueOnce({
    path: "src/index.ts",
    original: { text: "", truncated: false },
    modified: { text: "", truncated: false },
    unavailableReason: "binary",
  });
  await render(api);
  await render(api, { ...scope });
  expect(api.history).toHaveBeenCalledTimes(1);
  await click("Initial commit");
  await click("src/index.ts");
  expect(host.querySelector("[data-diff]")?.textContent).toBe("binary");
});

it("discards commit files returned for a checkout that was replaced", async () => {
  const api = gateway();
  let resolve!: (value: Awaited<ReturnType<typeof api.commitFiles>>) => void;
  api.commitFiles.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render(api);
  await click("Initial commit");
  await render(api, { ...scope, taskId: "different-task" });
  await act(async () =>
    resolve({ files: [{ path: "foreign-private.ts", status: "modified" }], truncated: false }),
  );
  expect(host.textContent).not.toContain("foreign-private.ts");
  expect(api.history).toHaveBeenLastCalledWith({ ...scope, taskId: "different-task", offset: 0 });
});

it("bounds large commit file lists to 100 rows per page", async () => {
  const api = gateway();
  api.commitFiles.mockResolvedValue({
    files: Array.from({ length: 350 }, (_, index) => ({
      path: `file-${index}.ts`,
      status: "modified" as const,
    })),
    truncated: false,
  });
  await render(api);
  await click("Initial commit");
  expect(host.querySelectorAll('[aria-label="Commit files"] button')).toHaveLength(100);
  expect(host.textContent).toContain("1–100 of 350 files");
  await click("Next files");
  expect(host.querySelectorAll('[aria-label="Commit files"] button')).toHaveLength(100);
  expect(host.textContent).toContain("101–200 of 350 files");
  await click("Back to history");
  await click("Initial commit");
  expect(host.textContent).toContain("1–100 of 350 files");
});
