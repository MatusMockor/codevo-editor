// @vitest-environment jsdom
import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentCliKind } from "../../domain/agentTask";
import type { AgentTurn, AgentTurnStatus } from "../../domain/agentThread";
import type { AgentPendingSend } from "./agentPendingSend";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import { AgentThreadSession } from "./AgentThreadSession";
import { agentPendingSendSelection, useAgentPendingSends } from "./useAgentPendingSends";

const send: AgentPendingSend = {
  id: 1,
  target: { kind: "followUp", threadId: "agt-1", baseTurnId: "t1" },
  prompt: "Next step",
  attachments: [],
  sentAtEpochMs: 1_700_000_000_000,
  status: "sending",
};

const WAITING = "Waiting for output…";
const INDICATOR = ".agent-answer > .agent-turn__events > .agent-note";

function turn(turnId: string, prompt: string, status: AgentTurnStatus): AgentTurn {
  return {
    turnId,
    prompt,
    status,
    startedAtEpochMs: 1,
    endedAtEpochMs: status.kind === "exited" ? 2 : null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 0,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function threadWith(
  turns: ReadonlyArray<AgentTurn>,
  provider: AgentCliKind = "claudeCode",
): AgentThreadView {
  const base = surfaceThreadView();
  return surfaceThreadView({
    thread: { ...base.thread, provider: { kind: provider, sessionId: null }, turns },
  });
}

function FollowUpHarness({ view }: { readonly view: AgentThreadView }) {
  const threadId = view.thread.threadId;
  const lastTurnId = view.thread.turns[view.thread.turns.length - 1]?.turnId ?? null;
  const selection = useMemo(
    () => agentPendingSendSelection(threadId, lastTurnId, null),
    [lastTurnId, threadId],
  );
  const pendingSends = useAgentPendingSends(selection);
  return (
    <>
      <button
        data-testid="send"
        onClick={() =>
          pendingSends.begin(
            { kind: "followUp", threadId, baseTurnId: lastTurnId },
            "Next step",
            [],
          )
        }
        type="button"
      />
      <AgentThreadSession
        composerRepositoryLabel="app"
        onReviewInDiff={() => undefined}
        pendingSend={pendingSends.visible}
        thread={view}
      />
    </>
  );
}

describe("AgentThreadSession pending send", () => {
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

  it("appends exactly one optimistic message after the recorded turns", () => {
    const base = surfaceThreadView();
    const view = surfaceThreadView({
      thread: {
        ...base.thread,
        turns: [
          {
            turnId: "t1",
            prompt: "First step",
            status: { kind: "exited", exitCode: 0 },
            startedAtEpochMs: 1,
            endedAtEpochMs: 2,
            events: [],
            eventsTruncated: false,
            lastStatusSequence: 0,
            lastOutputSequence: 0,
            launch: null,
            cliVersion: null,
          },
        ],
      },
    });
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          onReviewInDiff={() => undefined}
          pendingSend={send}
          thread={view}
        />,
      ),
    );
    const turns = [...host.querySelectorAll(".agent-turn-list > .agent-turn")];
    expect(turns).toHaveLength(2);
    expect(turns[1]?.getAttribute("data-pending-send")).toBe("sending");
    expect(turns[1]?.querySelector(".agent-prompt__body")?.textContent).toBe("Next step");
  });

  it("shows a new thread's first message instead of the empty hero", () => {
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          onReviewInDiff={() => undefined}
          pendingSend={{
            ...send,
            target: { kind: "new", projectRootKey: "/workspace/app", provider: "claudeCode" },
          }}
          thread={null}
        />,
      ),
    );
    expect(host.querySelector(".cv-empty-hero")).toBeNull();
    expect(host.querySelectorAll("[data-pending-send]")).toHaveLength(1);
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          onReviewInDiff={() => undefined}
          pendingSend={null}
          thread={null}
        />,
      ),
    );
    expect(host.querySelector(".cv-empty-hero")).not.toBeNull();
  });

  function renderSession(pendingSend: AgentPendingSend | null, thread: AgentThreadView | null) {
    act(() =>
      root.render(
        <AgentThreadSession
          composerRepositoryLabel="app"
          onReviewInDiff={() => undefined}
          pendingSend={pendingSend}
          thread={thread}
        />,
      ),
    );
  }

  function indicators(): ReadonlyArray<Element> {
    return [...host.querySelectorAll(INDICATOR)];
  }

  function indicatorPlacement(): {
    readonly markup: string | undefined;
    readonly turnIndex: number;
    readonly turnCount: number;
    readonly answerIndex: number;
    readonly answerRows: ReadonlyArray<string>;
  } {
    const indicator = indicators()[0];
    const answer = indicator?.closest(".agent-answer") ?? null;
    const article = answer?.parentElement ?? null;
    const turns = [...host.querySelectorAll(".agent-turn-list > .agent-turn")];
    return {
      markup: indicator?.outerHTML,
      turnIndex: article === null ? -1 : turns.indexOf(article),
      turnCount: turns.length,
      answerIndex: article === null || answer === null ? -1 : [...article.children].indexOf(answer),
      answerRows: answerRows(answer),
    };
  }

  function answerRows(answer: Element | null): ReadonlyArray<string> {
    return [...(answer?.children ?? [])].map((row) => row.className);
  }

  it("shows the working indicator under a follow-up from its first frame", () => {
    renderSession(send, threadWith([turn("t1", "First step", { kind: "exited", exitCode: 0 })]));

    expect(indicators()).toHaveLength(1);
    expect(indicators()[0]?.textContent).toBe(WAITING);
    expect(indicators()[0]?.closest("[data-pending-send]")?.getAttribute("data-pending-send")).toBe(
      "sending",
    );
  });

  it.each([
    ["this computer", "/workspace/app"],
    ["a server", "remote:linux:7389088c:app"],
  ])(
    "shows the working indicator under a new thread's first message on %s",
    (_, projectRootKey) => {
      renderSession(
        { ...send, target: { kind: "new", projectRootKey, provider: "claudeCode" } },
        null,
      );

      expect(host.querySelector(".cv-empty-hero")).toBeNull();
      expect(host.querySelector(".agent-prompt__body")?.textContent).toBe("Next step");
      expect(indicators()).toHaveLength(1);
      expect(indicators()[0]?.textContent).toBe(WAITING);
      expect(indicators()[0]?.closest('[data-pending-send="sending"]')).not.toBeNull();
    },
  );

  it("shows no working indicator once a send has failed", () => {
    const failed: AgentPendingSend = { ...send, status: "failed" };
    renderSession(failed, threadWith([turn("t1", "First step", { kind: "exited", exitCode: 0 })]));

    expect(host.querySelector('[data-pending-send="failed"] [role="alert"]')).not.toBeNull();
    expect(indicators()).toHaveLength(0);
    expect(host.textContent).not.toContain(WAITING);

    renderSession(
      {
        ...failed,
        target: { kind: "new", projectRootKey: "/workspace/app", provider: "claudeCode" },
      },
      null,
    );

    expect(host.querySelector('[data-pending-send="failed"] [role="alert"]')).not.toBeNull();
    expect(indicators()).toHaveLength(0);
    expect(host.textContent).not.toContain(WAITING);
  });

  it("uses the Codex startup note for a follow-up on a Codex thread", () => {
    const settled = turn("t1", "First step", { kind: "exited", exitCode: 0 });
    renderSession(send, threadWith([settled], "codex"));

    const pendingNote = host.querySelector("[data-pending-send] .agent-answer > .agent-note");
    const pendingRows = answerRows(pendingNote?.parentElement ?? null);
    expect(pendingNote?.textContent).toBe("Starting Codex…");
    expect(indicators()).toHaveLength(0);

    renderSession(
      null,
      threadWith([settled, turn("t2", "Next step", { kind: "pending" })], "codex"),
    );

    const turnNote = host.querySelector('[data-agent-turn="t2"] .agent-answer > .agent-note');
    expect(turnNote?.textContent).toBe("Starting Codex…");
    expect(turnNote?.className).toBe(pendingNote?.className);
    expect(answerRows(turnNote?.parentElement ?? null)).toEqual(pendingRows);
    expect(host.textContent?.split("Starting Codex…")).toHaveLength(2);
  });

  it("shows the Codex startup note under a new Codex thread's first message", () => {
    renderSession(
      { ...send, target: { kind: "new", projectRootKey: "/workspace/app", provider: "codex" } },
      null,
    );

    const pendingNote = host.querySelector("[data-pending-send] .agent-answer > .agent-note");
    const pendingRows = answerRows(pendingNote?.parentElement ?? null);
    expect(pendingNote?.textContent).toBe("Starting Codex…");
    expect(host.textContent).not.toContain(WAITING);

    renderSession(null, threadWith([turn("t1", "Next step", { kind: "pending" })], "codex"));

    const turnNote = host.querySelector('[data-agent-turn="t1"] .agent-answer > .agent-note');
    expect(turnNote?.textContent).toBe("Starting Codex…");
    expect(answerRows(turnNote?.parentElement ?? null)).toEqual(pendingRows);
    expect(host.textContent?.split("Starting Codex…")).toHaveLength(2);
    expect(host.textContent).not.toContain(WAITING);
  });

  it("keeps the indicator in place when a new thread's first turn appears", () => {
    renderSession(
      {
        ...send,
        target: { kind: "new", projectRootKey: "/workspace/app", provider: "claudeCode" },
      },
      null,
    );

    const sending = indicatorPlacement();
    expect(sending).toMatchObject({ turnIndex: 0, turnCount: 1, answerIndex: 1 });

    renderSession(null, threadWith([turn("t1", "Next step", { kind: "pending" })]));

    expect(host.querySelectorAll("[data-pending-send]")).toHaveLength(0);
    expect(indicators()).toHaveLength(1);
    expect(indicators()[0]?.closest('[data-agent-turn="t1"]')).not.toBeNull();
    expect(indicatorPlacement()).toEqual(sending);
  });

  it("hands the indicator to the started turn without duplicating or moving it", () => {
    const settled = turn("t1", "First step", { kind: "exited", exitCode: 0 });
    act(() => root.render(<FollowUpHarness view={threadWith([settled])} />));
    expect(indicators()).toHaveLength(0);

    act(() => host.querySelector<HTMLButtonElement>('[data-testid="send"]')?.click());

    const sending = indicatorPlacement();
    expect(indicators()).toHaveLength(1);
    expect(host.querySelectorAll("[data-pending-send]")).toHaveLength(1);
    expect(sending).toMatchObject({
      turnIndex: 1,
      turnCount: 2,
      answerIndex: 1,
      answerRows: ["agent-turn__events", "cv-turn-meta"],
    });

    act(() =>
      root.render(
        <FollowUpHarness
          view={threadWith([settled, turn("t2", "Next step", { kind: "pending" })])}
        />,
      ),
    );

    expect(host.querySelectorAll("[data-pending-send]")).toHaveLength(0);
    expect(indicators()).toHaveLength(1);
    expect(indicators()[0]?.closest('[data-agent-turn="t2"]')).not.toBeNull();
    expect(indicatorPlacement()).toEqual(sending);
    expect(host.textContent?.split(WAITING)).toHaveLength(2);
  });
});
