// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
function openDiff() {
  const button = host.querySelector<HTMLButtonElement>("button.cv-changes-row");
  expect(button).not.toBeNull();
  button?.click();
}
it("routes Open diff to the sidebar callback without mounting an inline viewer", async () => {
  const onOpenDiff = vi.fn();
  await render({ onOpenDiff });
  act(() => openDiff());
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
  const stale = summary("t1", "stale.ts");
  await act(async () =>
    resolve({ ...stale, files: [...stale.files, ...summary("t1", "extra.ts").files] }),
  );
  expect(host.querySelector(".cv-changes-row__count")?.textContent).toBe("1 changed file");
  expect(host.textContent).not.toContain("2 changed files");
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
it.each([
  "No snapshot is available for this turn.",
  "No snapshot was recorded before this turn.",
  "No completed snapshot is available for this turn.",
  "A complete snapshot of this turn is unavailable.",
])("renders nothing inline when the turn simply has no snapshot: %s", async (reason) => {
  const getTurnChanges = vi.fn(async (_: string, turnId: string) => ({
    turnId,
    state: "unavailable" as const,
    files: [],
    truncated: false,
    reason,
  }));
  await render({ getTurnChanges });
  await vi.waitFor(() => expect(getTurnChanges).toHaveBeenCalled());
  expect(host.innerHTML).toBe("");
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
  expect(host.querySelector(".cv-changes-row--unavailable")).not.toBeNull();
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
  expect(host.querySelector(".cv-changes-row--unavailable")?.textContent).toBe(
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

it("shows safe known read failures as final without Retry", async () => {
  for (const [message, shown] of [
    ["Saved turn changes exceed the supported size.", "exceed the supported size"],
    ["Runner response exceeds output limit.", "exceed the supported size"],
    ["Runner returned an invalid response.", "response is invalid"],
  ]) {
    await render({
      revision: {},
      getTurnChanges: async () => {
        throw new Error(message);
      },
    });
    await vi.waitFor(() => expect(host.textContent).toContain(shown));
    expect(host.textContent).not.toContain("Retry recorded changes");
  }
});

it("offers manual Retry for an unknown failure without exposing backend details", async () => {
  const getTurnChanges = vi
    .fn()
    .mockRejectedValueOnce(new Error("/private/source.ts contains secret content"))
    .mockResolvedValue(summary("t1"));
  await render({ getTurnChanges });
  await vi.waitFor(() =>
    expect(host.textContent).toContain("Recorded changes could not be loaded"),
  );
  expect(host.textContent).not.toContain("private");
  await act(async () => click("Retry recorded changes"));
  await vi.waitFor(() => expect(host.textContent).toContain("1 changed file"));
  expect(getTurnChanges).toHaveBeenCalledTimes(2);
});

it("offers retry for a transient local read failure", async () => {
  const getTurnChanges = vi
    .fn()
    .mockRejectedValueOnce(new Error("Too many turn changes reads. Try again shortly."))
    .mockResolvedValue(summary("t1"));
  await render({ getTurnChanges });
  await vi.waitFor(() => expect(host.textContent).toContain("Retry recorded changes"));
  await act(async () => click("Retry recorded changes"));
  await vi.waitFor(() => expect(host.textContent).toContain("1 changed file"));
  expect(getTurnChanges).toHaveBeenCalledTimes(2);
});

describe("automatic retry of transient server read failures", () => {
  const SERVER_READ_FAILED =
    "Server changes could not be loaded. Check the connection and try again.";
  const serverFailure = (turnId: string): AgentTurnChangeSummary => ({
    turnId,
    state: "unavailable",
    files: [],
    truncated: false,
    reason: SERVER_READ_FAILED,
  });
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers from a brief disconnect without ever rendering a failure row", async () => {
    const getTurnChanges = vi
      .fn()
      .mockRejectedValueOnce(new Error("Server is not connected"))
      .mockResolvedValueOnce(serverFailure("t1"))
      .mockResolvedValue(summary("t1"));
    await render({ getTurnChanges });
    expect(host.innerHTML).toBe("");
    await advance(999);
    expect(getTurnChanges).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(getTurnChanges).toHaveBeenCalledTimes(2);
    expect(host.innerHTML).toBe("");
    await advance(1_999);
    expect(getTurnChanges).toHaveBeenCalledTimes(2);
    expect(host.innerHTML).toBe("");
    await advance(1);
    expect(getTurnChanges).toHaveBeenCalledTimes(3);
    expect(host.textContent).toContain("1 changed file");
    expect(host.textContent).not.toContain("Retry recorded changes");
    await advance(60_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(3);
  });

  it("renders nothing when the retried read reports a turn without a snapshot", async () => {
    const getTurnChanges = vi
      .fn()
      .mockRejectedValueOnce(new Error("Server is not connected"))
      .mockResolvedValue({
        ...serverFailure("t1"),
        reason: "A complete snapshot of this turn is unavailable.",
      });
    await render({ getTurnChanges });
    await advance(1_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(2);
    expect(host.innerHTML).toBe("");
  });

  it("shows the row with Retry once the bounded automatic retries are exhausted", async () => {
    const getTurnChanges = vi
      .fn()
      .mockRejectedValue(new Error("Runner request failed (HTTP 503)."));
    await render({ getTurnChanges });
    await advance(1_000);
    await advance(2_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(3);
    expect(host.innerHTML).toBe("");
    await advance(4_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(4);
    expect(host.textContent).toContain(SERVER_READ_FAILED);
    expect(host.textContent).not.toContain("HTTP 503");
    expect(host.textContent).toContain("Retry recorded changes");
    await advance(60_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(4);
    getTurnChanges.mockResolvedValue(summary("t1"));
    await act(async () => click("Retry recorded changes"));
    expect(getTurnChanges).toHaveBeenCalledTimes(5);
    expect(host.textContent).toContain("1 changed file");
    expect(host.textContent).not.toContain("Retry recorded changes");
  });

  const retryButton = () => host.querySelector<HTMLButtonElement>(".agent-turn-changes-retry");
  const deferredSummary = () => {
    let settle!: (value: AgentTurnChangeSummary) => void;
    const promise = new Promise<AgentTurnChangeSummary>((resolve) => {
      settle = resolve;
    });
    return { promise, settle: (value: AgentTurnChangeSummary) => act(async () => settle(value)) };
  };

  it("keeps the failure row with a disabled Retrying… button during one manual read", async () => {
    const pending = deferredSummary();
    const getTurnChanges = vi
      .fn()
      .mockResolvedValueOnce(serverFailure("t1"))
      .mockResolvedValueOnce(serverFailure("t1"))
      .mockResolvedValueOnce(serverFailure("t1"))
      .mockResolvedValueOnce(serverFailure("t1"))
      .mockReturnValueOnce(pending.promise);
    await render({ getTurnChanges });
    await advance(7_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(4);
    await act(async () => click("Retry recorded changes"));
    expect(getTurnChanges).toHaveBeenCalledTimes(5);
    expect(host.textContent).toContain(SERVER_READ_FAILED);
    expect(retryButton()?.textContent).toBe("Retrying…");
    expect(retryButton()?.disabled).toBe(true);
    await advance(60_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(5);
    expect(host.textContent).toContain(SERVER_READ_FAILED);
    await pending.settle(serverFailure("t1"));
    expect(host.textContent).toContain(SERVER_READ_FAILED);
    expect(retryButton()?.textContent).toBe("Retry recorded changes");
    expect(retryButton()?.disabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(5);
  });

  it("replaces or removes the row when a manual retry settles without a failure", async () => {
    const settled = [
      [summary("t1"), "1 changed file"],
      [
        { ...serverFailure("t1"), reason: "A complete snapshot of this turn is unavailable." },
        null,
      ],
    ] as const;
    for (const [value, count] of settled) {
      const pending = deferredSummary();
      const getTurnChanges = vi
        .fn()
        .mockRejectedValueOnce(new Error("/private/source.ts contains secret content"))
        .mockReturnValueOnce(pending.promise);
      await render({ getTurnChanges, revision: {} });
      await act(async () => click("Retry recorded changes"));
      expect(host.textContent).toContain("Recorded changes could not be loaded.");
      expect(retryButton()?.disabled).toBe(true);
      await pending.settle(value);
      expect(host.querySelector(".cv-changes-row__count")?.textContent ?? null).toBe(count);
      expect(host.textContent).not.toContain("Recorded changes could not be loaded.");
      expect(retryButton()).toBeNull();
      expect(getTurnChanges).toHaveBeenCalledTimes(2);
    }
  });

  it("hides the old row and drops the late result when the identity changes during a manual retry", async () => {
    const pending = deferredSummary();
    const next = deferredSummary();
    const getTurnChanges = vi
      .fn()
      .mockRejectedValueOnce(new Error("/private/source.ts contains secret content"))
      .mockReturnValueOnce(pending.promise)
      .mockReturnValueOnce(next.promise)
      .mockResolvedValue(serverFailure("t2"));
    const props = await render({ getTurnChanges });
    await act(async () => click("Retry recorded changes"));
    expect(retryButton()?.disabled).toBe(true);
    await render({ ...props, threadId: "other", turnId: "t2" });
    expect(host.innerHTML).toBe("");
    await pending.settle(serverFailure("t1"));
    expect(host.innerHTML).toBe("");
    expect(vi.getTimerCount()).toBe(0);
    await next.settle(serverFailure("t2"));
    expect(host.innerHTML).toBe("");
    await advance(7_000);
    expect(getTurnChanges.mock.calls.map(([, id]) => id)).toEqual([
      "t1",
      "t1",
      "t2",
      "t2",
      "t2",
      "t2",
    ]);
    expect(host.textContent).toContain(SERVER_READ_FAILED);
    expect(retryButton()?.textContent).toBe("Retry recorded changes");
    expect(retryButton()?.disabled).toBe(false);
  });

  it("recovers from the shared IPC permit limit during a thread-open burst without a failure row", async () => {
    const getTurnChanges = vi
      .fn()
      .mockRejectedValueOnce(new Error("Runner is busy; retry shortly"))
      .mockResolvedValue(summary("t1"));
    await render({ getTurnChanges });
    expect(host.innerHTML).toBe("");
    await advance(1_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(2);
    expect(host.textContent).toContain("1 changed file");
    expect(host.textContent).not.toContain("Retry recorded changes");
    expect(host.textContent).not.toContain("busy");
  });

  it("shows a server rejection as final without a retry that could never succeed", async () => {
    for (const [message, shown] of [
      [
        "Runner request failed (HTTP 404).",
        "Recorded changes for this turn are no longer available on the server.",
      ],
      ["Runner request failed (HTTP 409).", "The server rejected this recorded changes request."],
      [
        "Invalid remote runner getTurnChanges response.",
        "The saved changes response is invalid and cannot be displayed.",
      ],
    ]) {
      const getTurnChanges = vi.fn().mockRejectedValue(new Error(message));
      await render({ getTurnChanges, revision: {} });
      expect(host.textContent).toContain(shown);
      expect(host.textContent).not.toContain("HTTP");
      expect(host.textContent).not.toContain("Retry recorded changes");
      await advance(60_000);
      expect(getTurnChanges).toHaveBeenCalledTimes(1);
    }
  });

  it("does not automatically retry unknown or local transient failures", async () => {
    for (const message of [
      "/private/source.ts contains secret content",
      "Saved turn changes could not be read.",
    ]) {
      const getTurnChanges = vi.fn().mockRejectedValue(new Error(message));
      await render({ getTurnChanges, revision: {} });
      expect(host.textContent).toContain("Retry recorded changes");
      await advance(60_000);
      expect(getTurnChanges).toHaveBeenCalledTimes(1);
    }
  });

  it("cancels the pending automatic retry on unmount", async () => {
    const getTurnChanges = vi.fn().mockResolvedValue(serverFailure("t1"));
    await render({ getTurnChanges });
    expect(vi.getTimerCount()).toBe(1);
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(1);
  });

  it("cancels the pending automatic retry when the identity changes", async () => {
    const getTurnChanges = vi.fn(async (_: string, id: string) =>
      id === "t1" ? serverFailure(id) : summary(id, "b.ts"),
    );
    const props = await render({ getTurnChanges });
    expect(vi.getTimerCount()).toBe(1);
    await render({ ...props, threadId: "other", turnId: "t2" });
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(getTurnChanges.mock.calls.map(([, id]) => id)).toEqual(["t1", "t2"]);
    expect(host.textContent).toContain("1 changed file");
  });

  it("drops a retried read that settles after the identity changed", async () => {
    let settle!: (value: AgentTurnChangeSummary) => void;
    const getTurnChanges = vi
      .fn()
      .mockResolvedValueOnce(serverFailure("t1"))
      .mockReturnValueOnce(
        new Promise<AgentTurnChangeSummary>((resolve) => {
          settle = resolve;
        }),
      )
      .mockResolvedValue(unsupportedAgentTurnChanges("t1", "notApplicable"));
    const props = await render({ getTurnChanges });
    await advance(1_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(2);
    await render({ ...props, revision: {} });
    expect(getTurnChanges).toHaveBeenCalledTimes(3);
    await act(async () => settle(serverFailure("t1")));
    expect(vi.getTimerCount()).toBe(0);
    await advance(60_000);
    expect(getTurnChanges).toHaveBeenCalledTimes(3);
    expect(host.innerHTML).toBe("");
  });
});
