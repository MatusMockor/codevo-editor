// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { AgentRecordedTurnDiff, type AgentRecordedTurnSelection } from "./AgentRecordedTurnDiff";
vi.mock("../GitDiffPreview", () => ({
  GitDiffPreview: (p: {
    diff: { originalContent: string; modifiedContent: string } | null;
    isLoading: boolean;
    editorFontSize?: number;
  }) => (
    <div data-font-size={p.editorFontSize}>
      {p.isLoading ? "Loading" : `${p.diff?.originalContent} → ${p.diff?.modifiedContent}`}
    </div>
  ),
}));
let host: HTMLDivElement, root: Root;
const onClose = vi.fn();
const read = vi.fn(async (_: string, __: string, relativePath: string) => ({
  relativePath,
  original: { text: "before " + relativePath, truncated: false },
  modified: { text: "after " + relativePath, truncated: false },
  unavailableReason: null,
}));
let selection: AgentRecordedTurnSelection;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  read.mockClear();
  onClose.mockClear();
  selection = {
    threadId: "t",
    revision: {},
    relativePath: "a.ts",
    summary: {
      turnId: "turn",
      state: "ready",
      files: ["a.ts", "b.ts"].map((relativePath) => ({
        relativePath,
        oldRelativePath: null,
        status: "modified",
        addedLines: 1,
        deletedLines: 1,
      })),
      truncated: false,
      reason: null,
    },
    getTurnFileDiff: read,
  };
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <AgentRecordedTurnDiff
        selection={selection}
        monacoTheme="calm-light"
        editorFontSize={17}
        onClose={onClose}
      />,
    ),
  );
}
it("reads frozen before/after contents with editor preferences", async () => {
  await render();
  await vi.waitFor(() => expect(host.textContent).toContain("before a.ts → after a.ts"));
  expect(read).toHaveBeenCalledWith("t", "turn", "a.ts");
  expect(host.querySelector('[data-font-size="17"]')).not.toBeNull();
});
it("reselects the requested timeline file after another sidebar selection", async () => {
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Open diff for b.ts"]')!.click(),
  );
  expect(read).toHaveBeenLastCalledWith("t", "turn", "b.ts");
  selection = { ...selection };
  await render();
  expect(read).toHaveBeenLastCalledWith("t", "turn", "a.ts");
});
it("hides old contents on revocation and rereads after same-turn reopening", async () => {
  await render();
  const original = selection;
  selection = {
    ...selection,
    summary: {
      turnId: "turn",
      state: "unavailable",
      files: [],
      reason: "Connection changed",
      truncated: false,
    },
  };
  await render();
  expect(host.textContent).not.toContain("before a.ts");
  expect(read).toHaveBeenCalledTimes(1);
  selection = { ...original, revision: {} };
  await render();
  expect(read).toHaveBeenCalledTimes(2);
});
it("closes while the snapshot read is pending", async () => {
  selection = { ...selection, getTurnFileDiff: () => new Promise(() => {}) };
  await render();
  act(() => host.querySelector<HTMLButtonElement>('[aria-label="Close recorded diff"]')!.click());
  expect(onClose).toHaveBeenCalledOnce();
});
