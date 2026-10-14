// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type {
  AgentThreadRequestFeed,
  AgentThreadRequestScope,
} from "../../application/agentThreadRequestPorts";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import { AGENT_REQUEST_NOT_LIVE } from "../../application/useAgentThreadPendingRequests";
import type { AgentRuntimeRequest } from "../../domain/agentRuntimeRequest";
import {
  agentRuntimeRequestOf,
  agentThreadRequestFeedFake,
  agentThreadRequestsOf,
  type AgentThreadRequestFeedFake,
} from "../../test/agentThreadRequestFeedFake";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  COMPOSER_REQUEST_QUESTION_PROMPT as PROMPT,
  COMPOSER_REQUEST_TURN as TURN,
  COMPOSER_REQUEST_WORKSPACE as WORKSPACE,
  chooseComposerOption,
  composerApprovalPanel,
  composerButton,
  composerQuestionCard,
  composerRequestTurn,
  localAnswerGatewayFake,
  localComposerThread,
  type LocalAnswerGatewayFake,
} from "./agentComposerRequestTestFixtures";
import { ComposerWithRequests } from "./ComposerWithRequests";

const THREAD = "agt-thread-0001";
const OTHER_THREAD = "agt-thread-0002";
const OTHER_WORKSPACE = "agent-root:other";

function question(overrides: Record<string, unknown> = {}): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingQuestion", { turnId: TURN, ...overrides });
}

function approval(overrides: Record<string, unknown> = {}): AgentRuntimeRequest {
  return agentRuntimeRequestOf("pendingApproval", { turnId: TURN, ...overrides });
}

function resolvedQuestion(): AgentRuntimeRequest {
  return agentRuntimeRequestOf("resolvedQuestion", { id: "req-0001", turnId: TURN, version: 3 });
}

function resolvedApproval(): AgentRuntimeRequest {
  return agentRuntimeRequestOf("resolvedApproval", { id: "req-0002", turnId: TURN, version: 3 });
}

async function flush(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await act(async () => Promise.resolve());
}

function workspaceFeed(
  feeds: ReadonlyMap<string | null, AgentThreadRequestFeedFake>,
): AgentThreadRequestFeed {
  const feedOf = (scope: AgentThreadRequestScope): AgentThreadRequestFeedFake => {
    const feed = feeds.get(scope.workspaceId);
    expect(feed).toBeDefined();
    return feed ?? agentThreadRequestFeedFake();
  };
  return {
    currentThreadRequests: (scope, turnIds, cursor) =>
      feedOf(scope).currentThreadRequests(scope, turnIds, cursor),
    subscribeThreadRequests: async (handler) => {
      const releases = await Promise.all(
        [...feeds.values()].map((feed) => feed.subscribeThreadRequests(handler)),
      );
      return () => releases.forEach((release) => release());
    },
  };
}

describe("composer cards of a local thread from the thread request projection", () => {
  let host: HTMLDivElement;
  let root: Root;
  let feed: AgentThreadRequestFeedFake;
  let gateway: LocalAnswerGatewayFake;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    feed = agentThreadRequestFeedFake();
    gateway = localAnswerGatewayFake();
    consoleError = vi.spyOn(console, "error");
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    expect(
      consoleError.mock.calls.filter((args) =>
        /Maximum update depth|Too many re-renders|not wrapped in act/.test(args.join(" ")),
      ),
    ).toEqual([]);
    host.remove();
    vi.restoreAllMocks();
  });

  function render(thread: AgentThreadView, requests: AgentThreadRequestFeed = feed): void {
    act(() =>
      root.render(<ComposerWithRequests feed={requests} gateway={gateway} thread={thread} />),
    );
  }

  function publish(records: readonly AgentRuntimeRequest[], workspaceId = WORKSPACE): void {
    act(() => feed.publish(agentThreadRequestsOf({ threadId: THREAD, workspaceId }, records)));
  }

  async function sendAnswer(): Promise<void> {
    act(() => chooseComposerOption(host, "Narrow"));
    await act(async () => composerButton(host, "Send answer")?.click());
  }

  it("shows a pushed question, answers it once through the local command and clears it from the projection", async () => {
    render(localComposerThread());
    await waitForReact(() => expect(feed.currentThreadRequests).toHaveBeenCalled());
    expect(composerQuestionCard(host)).toBeNull();

    publish([question()]);
    await waitForReact(() => expect(host.textContent).toContain(PROMPT));

    let accept: () => void = () => undefined;
    gateway.answer.mockImplementation(
      (owner, requestId) =>
        new Promise((resolve) => {
          accept = () =>
            resolve({
              id: requestId,
              taskId: owner.taskId,
              provider: "codex",
              questions: [],
              status: "answered",
              answers: [],
            });
        }),
    );
    await sendAnswer();
    await act(async () => composerButton(host, "Sending…")?.click());

    expect(gateway.answer).toHaveBeenCalledTimes(1);
    expect(gateway.answer).toHaveBeenCalledWith(
      { kind: "local", workspaceId: WORKSPACE, taskId: TURN },
      "req-0001",
      { answers: [{ questionId: "scope", optionIds: ["narrow"], text: "" }] },
    );
    await act(async () => accept());
    await flush();
    expect(composerQuestionCard(host)?.getAttribute("aria-busy")).toBe("true");
    expect(composerButton(host, "Send answer")).toBeNull();

    publish([resolvedQuestion()]);
    await waitForReact(() => expect(composerQuestionCard(host)).toBeNull());
    expect(gateway.answer).toHaveBeenCalledTimes(1);
  });

  it("decides a pending approval once through the local command and keeps it busy until the projection settles it", async () => {
    render(localComposerThread());
    publish([approval()]);
    await waitForReact(() => expect(composerApprovalPanel(host)).not.toBeNull());
    gateway.answerApproval.mockResolvedValue({
      id: "req-0002",
      taskId: TURN,
      provider: "claudeCode",
      kind: "command",
      title: "Run the test suite",
      detail: "npm test -- --run",
      detailTruncated: false,
      facts: [],
      decisions: ["allowOnce", "allowForSession", "deny"],
      status: "approved",
      decision: "allowOnce",
    });

    await act(async () => {
      composerButton(host, "Approve")?.click();
      composerButton(host, "Approve")?.click();
    });
    await flush();

    expect(gateway.answerApproval).toHaveBeenCalledTimes(1);
    expect(gateway.answerApproval).toHaveBeenCalledWith(
      { kind: "local", workspaceId: WORKSPACE, taskId: TURN },
      "req-0002",
      "allowOnce",
    );
    expect(composerButton(host, "Approve")?.disabled).toBe(true);

    publish([resolvedApproval()]);
    await waitForReact(() => expect(composerApprovalPanel(host)).toBeNull());
  });

  it("re-enables a question with the drafted answer when the local command fails", async () => {
    gateway.answer.mockRejectedValue(new Error("The agent task is gone."));
    render(localComposerThread());
    publish([question()]);
    await waitForReact(() => expect(host.textContent).toContain(PROMPT));

    await sendAnswer();

    await waitForReact(() =>
      expect(host.textContent).toContain("Could not send your answer. Please try again."),
    );
    expect(composerButton(host, "Send answer")?.disabled).toBe(false);
    expect(gateway.answer).toHaveBeenCalledTimes(1);
  });

  it("shows a request whose answer channel is not live but never lets it be answered", async () => {
    render(localComposerThread());
    publish([
      agentRuntimeRequestOf("submittingQuestionWithAnswers", { id: "req-0001", turnId: TURN }),
    ]);

    await waitForReact(() => expect(host.textContent).toContain(AGENT_REQUEST_NOT_LIVE));
    expect(host.textContent).toContain(PROMPT);
    expect(composerButton(host, "Send answer")?.disabled).toBe(true);
    expect(composerQuestionCard(host)?.querySelector("fieldset")?.disabled).toBe(true);
    expect(gateway.answer).not.toHaveBeenCalled();
  });

  it("never shows another thread's card, even for one render, after the open thread changes", async () => {
    render(localComposerThread());
    publish([question()]);
    await waitForReact(() => expect(host.textContent).toContain(PROMPT));

    render(localComposerThread(OTHER_THREAD));
    expect(host.textContent).not.toContain(PROMPT);
    await waitForReact(() =>
      expect(feed.currentThreadRequests.mock.calls.map(([scope]) => scope.threadId)).toContain(
        OTHER_THREAD,
      ),
    );
    publish([question({ id: "req-late" })]);
    await act(async () => Promise.resolve());
    expect(host.textContent).not.toContain(PROMPT);

    act(() =>
      feed.publish(
        agentThreadRequestsOf({ threadId: OTHER_THREAD, workspaceId: WORKSPACE }, [
          approval({ id: "req-other" }),
        ]),
      ),
    );
    await waitForReact(() => expect(composerApprovalPanel(host)).not.toBeNull());
    expect(host.textContent).not.toContain(PROMPT);
  });

  it("keeps workspace A -> B -> A apart for the same thread id", async () => {
    const first = agentThreadRequestFeedFake();
    const second = agentThreadRequestFeedFake();
    const routed = workspaceFeed(
      new Map([
        [WORKSPACE, first],
        [OTHER_WORKSPACE, second],
      ]),
    );
    first.record(agentThreadRequestsOf({ threadId: THREAD, workspaceId: WORKSPACE }, [question()]));
    render(localComposerThread(THREAD, WORKSPACE), routed);
    await waitForReact(() => expect(host.textContent).toContain(PROMPT));

    render(localComposerThread(THREAD, OTHER_WORKSPACE), routed);
    expect(host.textContent).not.toContain(PROMPT);
    await waitForReact(() => expect(second.currentThreadRequests).toHaveBeenCalled());
    act(() =>
      first.push(
        agentThreadRequestsOf({ threadId: THREAD, workspaceId: WORKSPACE }, [
          question({ id: "req-foreign" }),
        ]),
      ),
    );
    await act(async () => Promise.resolve());
    expect(composerQuestionCard(host)).toBeNull();

    render(localComposerThread(THREAD, WORKSPACE), routed);
    await waitForReact(() => expect(host.textContent).toContain(PROMPT));
    expect(
      second.currentThreadRequests.mock.calls.every(
        ([scope]) => scope.workspaceId === OTHER_WORKSPACE,
      ),
    ).toBe(true);
  });

  it("shows nothing while the projection is pending or unavailable and keeps the card through a re-plan", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = feed.currentThreadRequests.getMockImplementation();
    feed.currentThreadRequests.mockImplementation(async (scope, turnIds, cursor) => {
      await held;
      return original === undefined
        ? Promise.reject(new Error("no journal"))
        : original(scope, turnIds, cursor);
    });
    feed.record(agentThreadRequestsOf({ threadId: THREAD, workspaceId: WORKSPACE }, [question()]));
    render(localComposerThread());
    await waitForReact(() => expect(feed.currentThreadRequests).toHaveBeenCalled());
    expect(composerQuestionCard(host)).toBeNull();

    await act(async () => release());
    await waitForReact(() => expect(host.textContent).toContain(PROMPT));
    const card = composerQuestionCard(host);

    render(
      localComposerThread(THREAD, WORKSPACE, [
        composerRequestTurn(),
        composerRequestTurn("agt-turn-0002"),
      ]),
    );
    expect(composerQuestionCard(host)).toBe(card);
    await waitForReact(() =>
      expect(
        feed.currentThreadRequests.mock.calls.some(([, turnIds]) =>
          turnIds.includes("agt-turn-0002"),
        ),
      ).toBe(true),
    );
    expect(composerQuestionCard(host)).toBe(card);

    const unavailable = agentThreadRequestFeedFake();
    unavailable.subscribeThreadRequests.mockRejectedValue(new Error("no runtime"));
    render(localComposerThread(), unavailable);
    await waitForReact(() => expect(unavailable.subscribeThreadRequests).toHaveBeenCalled());
    expect(composerQuestionCard(host)).toBeNull();
    expect(host.textContent).not.toContain("could not be refreshed");
  });
});
