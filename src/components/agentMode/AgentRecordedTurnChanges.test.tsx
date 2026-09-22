// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AgentRecordedTurnChanges,
  type RecordedTurnChangesProps,
} from "./AgentRecordedTurnChanges";
import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
vi.mock("../GitDiffPreview", () => ({
  GitDiffPreview: (props: {
    diff: { originalContent: string; modifiedContent: string } | null;
    isLoading: boolean;
  }) => (
    <div data-testid="diff">
      {props.isLoading
        ? "Loading"
        : `${props.diff?.originalContent} → ${props.diff?.modifiedContent}`}
    </div>
  ),
}));
let host: HTMLDivElement;
let root: Root;
const summary = (turnId: string, path = "a.ts"): AgentTurnChangeSummary => ({
  turnId,
  state: "ready",
  files: [
    {
      relativePath: path,
      oldRelativePath: null,
      status: "modified",
      addedLines: 1,
      deletedLines: 1,
    },
  ],
  truncated: false,
  reason: null,
});
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
const render = async (props: Partial<RecordedTurnChangesProps> = {}) => {
  const full: RecordedTurnChangesProps = {
    threadId: "thread",
    turnId: "t1",
    monacoTheme: "calm-dark",
    getTurnChanges: async (_, id) => summary(id),
    getTurnFileDiff: async (_, __, relativePath) => ({
      relativePath,
      original: { text: "before", truncated: false },
      modified: { text: "after", truncated: false },
      unavailableReason: null,
    }),
    ...props,
  };
  await act(async () => {
    root.render(<AgentRecordedTurnChanges {...full} />);
  });
  return full;
};
function click(text: string) {
  const button = [...host.querySelectorAll("button")].find((b) => b.textContent === text);
  expect(button).toBeDefined();
  button!.click();
}
it("routes Open diff to the sidebar callback without mounting an inline viewer", async () => {
  const onOpenDiff = vi.fn();
  const getTurnFileDiff = vi.fn();
  await render({ onOpenDiff, getTurnFileDiff });
  act(() => click("Open diff"));
  expect(onOpenDiff).toHaveBeenCalledWith(summary("t1"), undefined);
  expect(getTurnFileDiff).not.toHaveBeenCalled();
  expect(host.querySelector('[aria-label="Recorded turn diff"]')).toBeNull();
});
it("ignores a previous thread's late summary", async () => {
  let resolve!: (value: AgentTurnChangeSummary) => void;
  const getTurnChanges = vi.fn((_thread: string, id: string) =>
    id === "t1"
      ? new Promise<AgentTurnChangeSummary>((r) => {
          resolve = r;
        })
      : Promise.resolve(summary(id, "b.ts")),
  );
  const props = await render({ getTurnChanges });
  await render({ ...props, threadId: "other", turnId: "t2" });
  await act(async () => resolve(summary("t1", "stale.ts")));
  expect(host.textContent).toContain("b.ts");
  expect(host.textContent).not.toContain("stale.ts");
});
it("never invents live changes when the snapshot is unavailable", async () => {
  await render({
    getTurnChanges: async (_, turnId) => ({
      turnId,
      state: "unavailable",
      files: [],
      truncated: false,
      reason: "Snapshot expired",
    }),
  });
  expect(host.textContent).toContain("Snapshot expired");
  expect(host.textContent).not.toContain("Open diff");
});
it("rereads on availability generation changes", async () => {
  const getTurnChanges = vi.fn(async (_: string, id: string) => summary(id));
  const props = await render({ getTurnChanges, revision: {} });
  await render({ ...props, revision: {} });
  expect(getTurnChanges).toHaveBeenCalledTimes(2);
});
it("lets unavailable snapshots be retried explicitly", async () => {
  const getTurnChanges = vi
    .fn()
    .mockResolvedValueOnce({
      turnId: "t1",
      state: "unavailable",
      files: [],
      truncated: false,
      reason: "Unavailable",
    })
    .mockResolvedValue(summary("t1"));
  await render({ getTurnChanges });
  await act(async () => click("Retry recorded changes"));
  expect(getTurnChanges).toHaveBeenCalledTimes(2);
  expect(host.textContent).toContain("1 changed file");
});

it("keeps the summary across unrelated parent updates", async () => {
  const getTurnChanges = vi.fn(async (_: string, id: string) => summary(id));
  const props = await render({ getTurnChanges, revision: {} });
  await render({ ...props, monacoTheme: "calm-light" });
  expect(getTurnChanges).toHaveBeenCalledTimes(1);
});
