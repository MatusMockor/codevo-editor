// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { AGENT_PENDING_REQUEST_POLL_MS } from "../../application/agentPendingRequestPolling";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentQuestionRequest } from "../../domain/agentQuestion";
import type { AgentTurn } from "../../domain/agentThread";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import {
  AgentComposerController,
  type AgentComposerControllerProps,
} from "./AgentComposerController";
import { FakeAgentInteractionGateway } from "./agentInteractionGatewayTestFixtures";
import { surfaceThreadView } from "./agentSurfaceTestFixtures";

const APP = "/workspace/app";
const NESTED_REPOSITORY = "/workspace/app/packages/nested";
const WORKSPACE_ID = "agent-root:app";
const noop = (): void => undefined;
const submit: AgentComposerControllerProps["submit"] = async () => true;
const PROVIDERS_ENABLED = { claudeCode: true, codex: true } as const;
const PROVIDER_MANAGEMENT = unconfiguredAgentProviderManagement();
const COMPOSER_PROPS: AgentComposerControllerProps["composerProps"] = {
  draftKey: "local-thread",
  promptOwnerKey: "local-thread",
  target: {
    projectLabel: "app",
    projectRoot: APP,
    selectedRepositoryRoot: APP,
    repositoryOptions: [],
  },
  isolation: "in-place",
  isolationReason: null,
  worktreeAvailable: false,
  worktreeOnly: false,
  worktreeOnlyReason: null,
  guard: { kind: "safe" },
  launch: { provider: "claudeCode", model: "default", mode: "default", effort: "default" },
  launchProvider: "claudeCode",
  dispatching: false,
  running: true,
  mode: { kind: "steer", threadId: "local-thread" },
  onStop: noop,
  onSelectRepository: noop,
  onIsolationChange: noop,
  onLaunchChange: noop,
  onNewThread: noop,
};

function question(taskId: string, prompt: string): AgentQuestionRequest {
  return {
    id: "q1",
    taskId,
    provider: "claudeCode",
    status: "pending",
    questions: [
      {
        id: "question-0",
        header: "",
        prompt,
        options: [{ id: "option-0", label: "Sidebar", description: "" }],
        multiple: false,
        allowCustom: true,
      },
    ],
  };
}

function runningTurn(turnId: string): AgentTurn {
  return {
    turnId,
    prompt: "Do the work",
    status: { kind: "running" },
    startedAtEpochMs: 1_700_000_000_000,
    endedAtEpochMs: null,
    events: [],
    eventsTruncated: false,
    lastStatusSequence: 1,
    lastOutputSequence: 0,
    launch: null,
    cliVersion: null,
  };
}

function localThread(turnId: string, repositoryRoot: string = APP): AgentThreadView {
  const base = surfaceThreadView().thread;
  return surfaceThreadView({
    lifecycle: "running",
    thread: {
      ...base,
      threadId: "local-thread",
      target: { isolation: "in-place", worktreePath: null },
      owner: { rootKey: APP, ownerId: WORKSPACE_ID, repositoryRoot },
      turns: [runningTurn(turnId)],
    },
  });
}

describe("composer interactions of a local thread", () => {
  let host: HTMLDivElement;
  let root: Root;
  let gateway: FakeAgentInteractionGateway;
  let consoleError: MockInstance<typeof console.error>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    gateway = new FakeAgentInteractionGateway();
    gateway.list.mockImplementation(() =>
      Promise.reject(new Error("The repository could not be resolved.")),
    );
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function render(thread: AgentThreadView): Promise<void> {
    await act(async () => {
      root.render(
        <AgentComposerController
          composerProps={COMPOSER_PROPS}
          interactions={{ gateway, thread }}
          onOpenProviderSettings={noop}
          providerEnabled={PROVIDERS_ENABLED}
          providerManagement={PROVIDER_MANAGEMENT}
          submissionBlocked={false}
          submit={submit}
        />,
      );
    });
  }

  async function advance(milliseconds: number): Promise<void> {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(milliseconds);
    });
  }

  function push(turnId: string, questions: readonly AgentQuestionRequest[]): void {
    act(() => gateway.push({ workspaceId: WORKSPACE_ID, taskId: turnId }, { questions }));
  }

  it("shows a pushed question without polling and never the reconnecting notice", async () => {
    await render(localThread("turn-1"));
    await advance(0);
    expect(host.textContent).not.toContain("Which layout?");

    push("turn-1", [question("turn-1", "Which layout?")]);
    expect(host.textContent).toContain("Which layout?");

    await advance(5 * AGENT_PENDING_REQUEST_POLL_MS);
    expect(host.textContent).toContain("Which layout?");
    expect(host.textContent).not.toContain("Questions could not be refreshed");
    expect(gateway.list).not.toHaveBeenCalled();
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);

    push("turn-1", []);
    expect(host.textContent).not.toContain("Which layout?");
  });

  it("keeps watching the same turn when the thread runs in a nested repository", async () => {
    await render(localThread("turn-1"));
    await advance(0);
    push("turn-1", [question("turn-1", "Which layout?")]);

    await render(localThread("turn-1", NESTED_REPOSITORY));
    await advance(5 * AGENT_PENDING_REQUEST_POLL_MS);

    expect(host.textContent).toContain("Which layout?");
    expect(host.textContent).not.toContain("Questions could not be refreshed");
    expect(gateway.currentInteractions).toHaveBeenCalledTimes(1);
    expect(gateway.currentInteractions).toHaveBeenCalledWith({
      workspaceId: WORKSPACE_ID,
      taskId: "turn-1",
    });
    expect(gateway.list).not.toHaveBeenCalled();
  });

  it("drops the previous turn's question at once and shows only the new turn's", async () => {
    await render(localThread("turn-1"));
    await advance(0);
    push("turn-1", [question("turn-1", "Which layout?")]);
    expect(host.textContent).toContain("Which layout?");

    await render(localThread("turn-2"));
    expect(host.textContent).not.toContain("Which layout?");
    await advance(0);

    push("turn-1", [question("turn-1", "Which layout again?")]);
    expect(host.textContent).not.toContain("Which layout");

    push("turn-2", [question("turn-2", "Which theme?")]);
    expect(host.textContent).toContain("Which theme?");
    expect(gateway.list).not.toHaveBeenCalled();
  });
});
