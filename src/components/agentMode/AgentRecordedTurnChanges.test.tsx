// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  AgentRecordedTurnChanges,
  type AgentRecordedTurnChangesProps,
} from "./AgentRecordedTurnChanges";
import {
  agentTurnChangesDenialMessage,
  unsupportedAgentTurnChanges,
  type AgentTurnChangeSummary,
  type AgentTurnChangesDenialReason,
} from "../../domain/agentTurnChanges";
import { createAgentTurnChangesReader } from "../../application/agentTurnChangesReader";
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
const render = async (props: Partial<AgentRecordedTurnChangesProps> = {}) => {
  const full: AgentRecordedTurnChangesProps = {
    threadId: "thread",
    turnId: "t1",
    getTurnChanges: async (_, id) => summary(id),
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
  await render({ onOpenDiff });
  act(() => click("Open diff"));
  expect(onOpenDiff).toHaveBeenCalledWith(summary("t1"), undefined);
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
it("offers Retry only for a transient read failure and recovers on retry", async () => {
  const getTurnChanges = vi
    .fn()
    .mockResolvedValueOnce({
      turnId: "t1",
      state: "unavailable",
      files: [],
      truncated: false,
      reason: "Saved turn changes could not be read.",
    })
    .mockResolvedValue(summary("t1"));
  await render({ getTurnChanges });
  expect(host.textContent).toContain("Saved turn changes could not be read.");
  await act(async () => click("Retry recorded changes"));
  await vi.waitFor(() => expect(host.textContent).toContain("1 changed file"));
  expect(getTurnChanges).toHaveBeenCalledTimes(2);
  expect(host.textContent).not.toContain("Retry recorded changes");
});
it("shows a persisted capture failure as final without Retry", async () => {
  await render({
    getTurnChanges: async (_, turnId) => ({
      turnId,
      state: "unavailable",
      files: [],
      truncated: false,
      reason: "Snapshot Git command failed.",
    }),
  });
  expect(host.textContent).toContain("Snapshot Git command failed.");
  expect(host.querySelector(".agent-turn-changes--unavailable")).not.toBeNull();
  expect(host.textContent).not.toContain("Retry recorded changes");
});
it.each<AgentTurnChangesDenialReason>([
  "gatewayMissing",
  "untrusted",
  "ownerMismatch",
  "launchRootNotOwned",
])("shows the %s authority denial as a muted line without Retry", async (reason) => {
  const reader = createAgentTurnChangesReader(() => ({ kind: "denied", reason }));
  await render({ getTurnChanges: reader.getTurnChanges });
  expect(host.querySelector(".agent-turn-changes--unavailable")?.textContent).toBe(
    agentTurnChangesDenialMessage(reason),
  );
  expect(host.textContent).not.toContain("Retry recorded changes");
});
it("renders nothing for unsupported workspaces and not-applicable owners", async () => {
  for (const reason of ["notGitRepository", "notWorktreeRoot", "notApplicable"] as const) {
    const getTurnChanges = vi.fn(async (_: string, turnId: string) =>
      unsupportedAgentTurnChanges(turnId, reason),
    );
    await render({ getTurnChanges, revision: {} });
    await vi.waitFor(() => expect(getTurnChanges).toHaveBeenCalled());
    expect(host.innerHTML).toBe("");
  }
  for (const message of [
    "Recorded changes owner is no longer available.",
    "Viewing turn changes requires a trusted workspace.",
  ]) {
    const getTurnChanges = vi.fn(async () => {
      throw new Error(message);
    });
    await render({ getTurnChanges, revision: {} });
    await vi.waitFor(() => expect(getTurnChanges).toHaveBeenCalled());
    expect(host.innerHTML).toBe("");
  }
});

it("keeps the summary across unrelated parent updates", async () => {
  const getTurnChanges = vi.fn(async (_: string, id: string) => summary(id));
  const props = await render({ getTurnChanges, revision: {} });
  await render({ ...props, onOpenDiff: vi.fn() });
  expect(getTurnChanges).toHaveBeenCalledTimes(1);
});

it("shows safe known read failures without exposing unknown backend details", async () => {
  await render({
    getTurnChanges: async () => {
      throw new Error("Saved turn changes exceed the supported size.");
    },
  });
  expect(host.textContent).toContain("exceed the supported size");
  expect(host.textContent).not.toContain("Retry recorded changes");
  await render({
    getTurnChanges: async () => {
      throw new Error("/private/source.ts contains secret content");
    },
  });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Recorded changes could not be loaded"),
  );
  expect(host.textContent).not.toContain("private");
  expect(host.textContent).not.toContain("Retry recorded changes");
});

it("offers retry only for transient read failures", async () => {
  await render({
    getTurnChanges: async () => {
      throw new Error("Saved turn changes contain invalid checkpoint data.");
    },
  });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Recorded changes could not be loaded"),
  );
  expect(host.textContent).not.toContain("invalid checkpoint data");
  expect(host.textContent).not.toContain("Retry recorded changes");
  const getTurnChanges = vi
    .fn()
    .mockRejectedValueOnce(new Error("Too many turn changes reads. Try again shortly."))
    .mockResolvedValue(summary("t1"));
  await render({ getTurnChanges });
  await vi.waitFor(() => expect(host.textContent).toContain("Retry recorded changes"));
  await act(async () => click("Retry recorded changes"));
  await vi.waitFor(() => expect(host.textContent).toContain("a.ts"));
  expect(getTurnChanges).toHaveBeenCalledTimes(2);
});
